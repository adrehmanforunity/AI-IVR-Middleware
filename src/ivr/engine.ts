import type { AriClient } from "../asterisk/ari.js";
import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging/index.js";
import type { CallSession, Ivr, IvrMenu, IvrOption } from "../domain/types.js";
import type { CallRegistry } from "../calls/registry.js";
import type { PulseClient } from "../pulse/client.js";
import {
  findOption,
  interruptAllows,
  optionWhen,
  parseAction,
  resolveMenuKey,
  toAriSound,
} from "./document.js";
import { resolveMenu, type MenuRuntime } from "./menuDefaults.js";
import { IvrFunctionRunner } from "./functions.js";
import { callLogFields } from "../calls/progress.js";
import { DEFAULT_VOICE_FILES_PATH, resolveVoiceMedia, VOICE_PATH_SETTING } from "./voice.js";

type AriEvent = {
  type?: string;
  digit?: string;
  channel?: { id?: string };
  playback?: { id?: string; target_uri?: string };
};

type Run = {
  session: CallSession;
  ivr: Ivr;
  menuKey: string;
  buffer: string;
  noInputTries: number;
  invalidTries: number;
  playbackId: string | null;
  playQueue: string[];
  waitingPlayThen: string | null;
  afterInvalid: boolean;
  afterNoInput: boolean;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  answered: boolean;
};

export class IvrEngine {
  private readonly runs = new Map<string, Run>();
  private readonly fns: IvrFunctionRunner;

  constructor(
    private readonly store: ConfigStore,
    private readonly registry: CallRegistry,
    private readonly ari: AriClient,
    pulse: PulseClient,
    private readonly log: Logger,
  ) {
    this.fns = new IvrFunctionRunner(store, pulse, ari, log);
  }

  start(session: CallSession, ivrId: number): void {
    const ivr = this.store.getIvr(ivrId);
    if (!ivr || !ivr.enabled || !ivr.entryKey) {
      this.log.warn({ component: "ivr", ivrId, ...callLogFields(session) }, "IVR missing or disabled");
      return;
    }
    this.stop(session.uniqueId);
    session.state = "ivr";
    session.currentMenu = ivr.entryKey;
    this.registry.update(session);
    const run: Run = {
      session,
      ivr,
      menuKey: ivr.entryKey,
      buffer: "",
      noInputTries: 0,
      invalidTries: 0,
      playbackId: null,
      playQueue: [],
      waitingPlayThen: null,
      afterInvalid: false,
      afterNoInput: false,
      timer: null,
      busy: false,
      answered: false,
    };
    this.runs.set(session.uniqueId, run);
    this.log.info(
      { component: "ivr", ivr: ivr.name, entry: ivr.entryKey, ...callLogFields(session) },
      "IVR started",
    );
    this.safe(run, this.enterMenu(run));
  }

  stop(uniqueId: string, reason = "stopped"): void {
    const run = this.runs.get(uniqueId);
    if (!run) return;
    this.clearTimer(run);
    if (run.playbackId) void this.ari.stopPlayback(run.playbackId);
    this.runs.delete(uniqueId);
    this.log.info(
      { component: "ivr", menu: run.menuKey, reason, ...callLogFields(run.session) },
      "IVR shutdown",
    );
  }

  onAriEvent(ev: AriEvent): void {
    try {
      const type = ev.type;
      if (type === "StasisEnd" || type === "ChannelDestroyed") {
        const id = ev.channel?.id;
        if (id) this.stop(id, "channel gone");
        return;
      }
      if (type === "ChannelDtmfReceived") {
        const id = ev.channel?.id;
        const digit = ev.digit ?? "";
        const run = id ? this.runs.get(id) : undefined;
        if (run && digit && !run.busy) this.safe(run, this.onDigit(run, digit));
        return;
      }
      if (type === "PlaybackFinished") {
        const pb = ev.playback?.id;
        if (!pb) return;
        for (const run of this.runs.values()) {
          if (run.playbackId === pb) {
            run.playbackId = null;
            if (run.waitingPlayThen) {
              const next = run.waitingPlayThen;
              run.waitingPlayThen = null;
              run.busy = false;
              this.safe(run, this.follow(run, next));
              break;
            }
            if (run.afterInvalid) {
              run.afterInvalid = false;
              this.safe(run, this.enterMenu(run));
              break;
            }
            if (run.afterNoInput) {
              run.afterNoInput = false;
              this.safe(run, this.enterMenu(run));
              break;
            }
            if (run.playQueue.length) {
              this.safe(run, this.playNextFile(run));
              break;
            }
            this.afterPrompt(run);
            break;
          }
        }
      }
    } catch (err) {
      this.log.error({ component: "ivr", err, type: ev.type }, "IVR event handler error");
    }
  }

  private safe(run: Run, work: Promise<void>): void {
    void work.catch((err) => {
      this.log.error({ component: "ivr", err, ...callLogFields(run.session) }, "IVR step failed — call continues or hangs up next event");
    });
  }

  private menu(run: Run): IvrMenu | undefined {
    return run.ivr.menus.find((m) => m.key === run.menuKey);
  }

  private runtime(menu: IvrMenu): MenuRuntime {
    return resolveMenu(menu, this.store.getSettings());
  }

  private async enterMenu(run: Run): Promise<void> {
    if (!this.runs.has(run.session.uniqueId)) return;
    const menu = this.menu(run);
    if (!menu) {
      await this.hangup(run);
      return;
    }
    run.buffer = "";
    run.playQueue = [];
    run.session.currentMenu = menu.key;
    this.registry.update(run.session);
    this.clearTimer(run);
    const rt = this.runtime(menu);
    if (rt.none) {
      this.afterPrompt(run);
      return;
    }
    run.playQueue = [...rt.files];
    if (run.playQueue.length) {
      await this.playNextFile(run);
      return;
    }
    this.afterPrompt(run);
  }

  private async playNextFile(run: Run): Promise<void> {
    const sound = run.playQueue.shift();
    if (!sound) {
      this.afterPrompt(run);
      return;
    }
    await this.play(run, sound);
    if (!run.playbackId) await this.playNextFile(run);
  }

  private afterPrompt(run: Run): void {
    if (!this.runs.has(run.session.uniqueId)) return;
    const menu = this.menu(run);
    if (!menu) return;
    const rt = this.runtime(menu);
    if (rt.inputTimeout <= 0) {
      this.safe(run, this.takeWhen(run, "none"));
      return;
    }
    this.armTimeout(run, rt.inputTimeout);
  }

  private async play(run: Run, sound: string): Promise<void> {
    if (run.playbackId) {
      await this.ari.stopPlayback(run.playbackId);
      run.playbackId = null;
    }
    if (!sound.trim()) return;
    const root = this.store.getSettings()[VOICE_PATH_SETTING] || DEFAULT_VOICE_FILES_PATH;
    const media = resolveVoiceMedia(sound, run.session.language, root);
    if (!media) return;
    run.playbackId = await this.ari.play(run.session.uniqueId, media);
  }

  private armTimeout(run: Run, seconds: number): void {
    this.clearTimer(run);
    if (seconds <= 0) return;
    run.timer = setTimeout(() => {
      run.timer = null;
      this.safe(run, this.takeWhen(run, "none"));
    }, seconds * 1000);
    run.timer.unref();
  }

  private clearTimer(run: Run): void {
    if (run.timer) {
      clearTimeout(run.timer);
      run.timer = null;
    }
  }

  private async onDigit(run: Run, digit: string): Promise<void> {
    if (!this.runs.has(run.session.uniqueId)) return;
    const menu = this.menu(run);
    if (!menu) return;
    const rt = this.runtime(menu);
    if (run.playbackId && !interruptAllows(rt.inputsAcceptable, digit)) return;
    this.clearTimer(run);
    if (run.playbackId) {
      await this.ari.stopPlayback(run.playbackId);
      run.playbackId = null;
      run.playQueue = [];
    }
    if (!interruptAllows(rt.inputsAcceptable, digit)) {
      await this.onInvalid(run);
      return;
    }
    run.buffer += digit;
    const exact = findOption(menu, run.buffer);
    if (exact) {
      run.noInputTries = 0;
      run.invalidTries = 0;
      await this.execOption(run, exact, run.buffer);
      return;
    }
    const prefix = menu.options.some((o) => {
      const w = optionWhen(o.when);
      return w !== "none" && w !== "MaxTries" && w !== "MaxNoInput" && w !== "MaxInvalid" && w.startsWith(run.buffer);
    });
    if (prefix) {
      this.armTimeout(run, rt.inputTimeout);
      return;
    }
    await this.onInvalid(run);
  }

  private async onInvalid(run: Run): Promise<void> {
    const menu = this.menu(run);
    if (!menu) return;
    const rt = this.runtime(menu);
    run.buffer = "";
    run.invalidTries += 1;
    if (run.invalidTries >= rt.maxInvalid) {
      await this.takeWhen(run, "MaxInvalid");
      return;
    }
    const invalid = toAriSound(rt.fileInvalid);
    if (invalid) {
      run.afterInvalid = true;
      await this.play(run, invalid);
      if (run.playbackId) return;
      run.afterInvalid = false;
    }
    await this.enterMenu(run);
  }

  private async onNoInput(run: Run): Promise<void> {
    const menu = this.menu(run);
    if (!menu) return;
    const rt = this.runtime(menu);
    run.noInputTries += 1;
    if (run.noInputTries >= rt.maxNoInput) {
      await this.takeWhen(run, "MaxNoInput");
      return;
    }
    const sound = toAriSound(rt.fileNoInput);
    if (sound) {
      run.afterNoInput = true;
      await this.play(run, sound);
      if (run.playbackId) return;
      run.afterNoInput = false;
    }
    await this.enterMenu(run);
  }

  private async takeWhen(run: Run, when: string): Promise<void> {
    const menu = this.menu(run);
    if (!menu) return;
    const rt = this.runtime(menu);
    let want = optionWhen(when);
    if (want === "MaxTries") want = "MaxNoInput";
    const opt =
      findOption(menu, want) ||
      (want === "MaxNoInput" ? findOption(menu, "MaxTries") : undefined) ||
      (want === "MaxInvalid" ? findOption(menu, "MaxTries") : undefined);
    if (!opt) {
      if (want === "MaxNoInput") {
        await this.follow(run, rt.onMaxNoInput);
        return;
      }
      if (want === "MaxInvalid") {
        await this.follow(run, rt.onMaxInvalid);
        return;
      }
      if (want === "none") {
        await this.onNoInput(run);
        return;
      }
      await this.onInvalid(run);
      return;
    }
    if (want === "none") {
      const act = opt.action.toLowerCase();
      if (act === "repeat" || act === "replay" || !opt.action) {
        await this.onNoInput(run);
        return;
      }
    }
    await this.execOption(run, opt, want);
  }

  private async execOption(run: Run, opt: IvrOption, digit: string): Promise<void> {
    if (!this.runs.has(run.session.uniqueId)) return;
    run.busy = true;
    try {
      const result = await this.fns.run(opt.action, opt.param, {
        session: run.session,
        menuKey: run.menuKey,
        digit,
        answered: run.answered,
      });
      run.answered = run.answered || result.ok === true;
      this.registry.update(run.session);
      if (result.hangup || opt.action.toLowerCase() === "hangup") {
        await this.hangup(run);
        return;
      }
      if (result.repeat) {
        await this.enterMenu(run);
        return;
      }
      if (result.play) {
        run.waitingPlayThen = result.ok ? opt.success : opt.fail;
        await this.play(run, result.play);
        if (!run.playbackId) {
          const next = run.waitingPlayThen;
          run.waitingPlayThen = null;
          await this.follow(run, next ?? "");
        }
        return;
      }
      const parsed = parseAction(opt.action, opt.param);
      let dest = result.ok ? opt.success : opt.fail;
      if (!dest && result.ok && parsed.name.toLowerCase() === "goto") dest = parsed.arg;
      await this.follow(run, dest);
    } catch (err) {
      this.log.error({ component: "ivr", err, ...callLogFields(run.session) }, "IVR option failed");
      await this.hangup(run);
    } finally {
      if (!run.waitingPlayThen) run.busy = false;
    }
  }

  private async follow(run: Run, raw: string): Promise<void> {
    const next = resolveMenuKey(raw, run.ivr.menus);
    if (next === "hangup" || next === "") {
      await this.hangup(run);
      return;
    }
    if (next === "repeat") {
      await this.enterMenu(run);
      return;
    }
    const exists = run.ivr.menus.some((m) => m.key === next);
    if (!exists) {
      this.log.warn({ component: "ivr", next, ivr: run.ivr.name }, "unknown menu key");
      await this.hangup(run);
      return;
    }
    run.menuKey = next;
    run.noInputTries = 0;
    run.invalidTries = 0;
    await this.enterMenu(run);
  }

  private async hangup(run: Run): Promise<void> {
    this.log.info({ component: "ivr", menu: run.menuKey, ...callLogFields(run.session) }, "IVR hangup");
    await this.ari.hangup(run.session.uniqueId, "normal");
    this.stop(run.session.uniqueId, "hangup");
  }
}
