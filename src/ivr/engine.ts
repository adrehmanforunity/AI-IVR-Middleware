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
  parsePrompt,
  resolveMenuKey,
  toAriSound,
} from "./document.js";
import { IvrFunctionRunner } from "./functions.js";
import { callLogFields } from "../calls/progress.js";

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
  tries: number;
  playbackId: string | null;
  waitingPlayThen: string | null;
  afterInvalid: boolean;
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
      tries: 0,
      playbackId: null,
      waitingPlayThen: null,
      afterInvalid: false,
      timer: null,
      busy: false,
      answered: false,
    };
    this.runs.set(session.uniqueId, run);
    this.log.info(
      { component: "ivr", ivr: ivr.name, entry: ivr.entryKey, ...callLogFields(session) },
      "IVR started",
    );
    void this.enterMenu(run);
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
      if (run && digit && !run.busy) void this.onDigit(run, digit);
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
            void this.follow(run, next);
            break;
          }
          if (run.afterInvalid) {
            run.afterInvalid = false;
            void this.enterMenu(run);
            break;
          }
          this.afterPrompt(run);
          break;
        }
      }
    }
  }

  private menu(run: Run): IvrMenu | undefined {
    return run.ivr.menus.find((m) => m.key === run.menuKey);
  }

  private async enterMenu(run: Run): Promise<void> {
    if (!this.runs.has(run.session.uniqueId)) return;
    const menu = this.menu(run);
    if (!menu) {
      await this.hangup(run);
      return;
    }
    run.buffer = "";
    run.session.currentMenu = menu.key;
    this.registry.update(run.session);
    this.clearTimer(run);
    const prompt = parsePrompt(menu.fileMenu);
    if (prompt.sound) {
      await this.play(run, prompt.sound);
      if (run.playbackId) return;
    }
    this.afterPrompt(run);
  }

  private afterPrompt(run: Run): void {
    if (!this.runs.has(run.session.uniqueId)) return;
    const menu = this.menu(run);
    if (!menu) return;
    if (menu.inputTimeout <= 0) {
      void this.takeWhen(run, "none");
      return;
    }
    this.armTimeout(run);
  }

  private async play(run: Run, sound: string): Promise<void> {
    if (run.playbackId) {
      await this.ari.stopPlayback(run.playbackId);
      run.playbackId = null;
    }
    if (!sound.trim()) return;
    run.playbackId = await this.ari.play(run.session.uniqueId, sound);
  }

  private armTimeout(run: Run): void {
    this.clearTimer(run);
    const menu = this.menu(run);
    if (!menu || menu.inputTimeout <= 0) return;
    run.timer = setTimeout(() => {
      run.timer = null;
      void this.takeWhen(run, "none");
    }, menu.inputTimeout * 1000);
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
    const prompt = parsePrompt(menu.fileMenu);
    const mask = menu.interrupt || prompt.interrupt;
    if (run.playbackId && !interruptAllows(mask, digit)) return;
    this.clearTimer(run);
    if (run.playbackId) {
      await this.ari.stopPlayback(run.playbackId);
      run.playbackId = null;
    }
    run.buffer += digit;
    const exact = findOption(menu, run.buffer);
    if (exact) {
      run.tries = 0;
      await this.execOption(run, exact, run.buffer);
      return;
    }
    const prefix = menu.options.some((o) => {
      const w = optionWhen(o.when);
      return w !== "none" && w !== "MaxTries" && w.startsWith(run.buffer);
    });
    if (prefix) {
      this.armTimeout(run);
      return;
    }
    await this.onInvalid(run);
  }

  private async onInvalid(run: Run): Promise<void> {
    const menu = this.menu(run);
    if (!menu) return;
    run.buffer = "";
    run.tries += 1;
    if (menu.retries > 0 && run.tries >= menu.retries) {
      await this.takeWhen(run, "MaxTries");
      return;
    }
    const invalid = toAriSound(menu.fileInvalid);
    if (invalid) {
      run.afterInvalid = true;
      await this.play(run, invalid);
      if (run.playbackId) return;
      run.afterInvalid = false;
    }
    await this.enterMenu(run);
  }

  private async takeWhen(run: Run, when: string): Promise<void> {
    const menu = this.menu(run);
    if (!menu) return;
    const opt = findOption(menu, when);
    if (!opt) {
      if (when === "MaxTries") {
        await this.hangup(run);
        return;
      }
      if (when === "none") {
        run.tries += 1;
        if (menu.retries > 0 && run.tries >= menu.retries) {
          await this.takeWhen(run, "MaxTries");
          return;
        }
        if (menu.retries === 0) {
          await this.hangup(run);
          return;
        }
        await this.enterMenu(run);
      }
      return;
    }
    if (when === "none" && (opt.action.toLowerCase() === "repeat" || opt.action.toLowerCase() === "replay")) {
      run.tries += 1;
      if (menu.retries > 0 && run.tries >= menu.retries) {
        await this.takeWhen(run, "MaxTries");
        return;
      }
    }
    await this.execOption(run, opt, when);
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
    run.tries = 0;
    await this.enterMenu(run);
  }

  private async hangup(run: Run): Promise<void> {
    this.log.info({ component: "ivr", menu: run.menuKey, ...callLogFields(run.session) }, "IVR hangup");
    await this.ari.hangup(run.session.uniqueId, "normal");
    this.stop(run.session.uniqueId, "hangup");
  }
}
