import type { CallSession, IvrFunctionDef } from "../domain/types.js";
import type { ConfigStore } from "../db/sqlite.js";
import type { PulseClient } from "../pulse/client.js";
import type { PulseLifecycle } from "../pulse/lifecycle.js";
import { addInteractionFieldsForFunction } from "../pulse/lifecycle.js";
import type { Logger } from "../logging/index.js";
import type { AriClient } from "../asterisk/ari.js";
import { genericByName } from "./catalog.js";
import { parseAction, toAriSound } from "./document.js";
import { applyPulseFacts, callLogFields, parseCallerLanguage } from "../calls/progress.js";

export type FnContext = {
  session: CallSession;
  menuKey: string;
  digit: string;
  answered: boolean;
};

export class IvrFunctionRunner {
  constructor(
    private readonly store: ConfigStore,
    private readonly pulse: PulseClient,
    private readonly lifecycle: PulseLifecycle,
    private readonly ari: AriClient,
    private readonly log: Logger,
  ) {}

  resolve(action: string, param: string): { name: string; arg: string; def: IvrFunctionDef | undefined } {
    const parsed = parseAction(action, param);
    const name = parsed.name;
    const generic = genericByName(name);
    const custom = this.store
      .listCustomIvrFunctions()
      .find((f) => f.name.toLowerCase() === name.toLowerCase() && f.enabled);
    const def: IvrFunctionDef | undefined = generic
      ? generic
      : custom
        ? {
            name: custom.name,
            kind: "pulse",
            source: "custom",
            description: custom.description,
            pulseSlot: custom.pulseSlot,
            paramHint: custom.paramHint,
            enabled: custom.enabled,
          }
        : undefined;
    return { name, arg: parsed.arg, def };
  }

  async run(
    action: string,
    param: string,
    ctx: FnContext,
  ): Promise<{ ok: boolean; hangup: boolean; repeat: boolean; play?: string }> {
    try {
      return await this.runInner(action, param, ctx);
    } catch (err) {
      this.log.error({ component: "ivr", err, action, ...callLogFields(ctx.session) }, "function threw");
      return { ok: false, hangup: false, repeat: false };
    }
  }

  private async runInner(
    action: string,
    param: string,
    ctx: FnContext,
  ): Promise<{ ok: boolean; hangup: boolean; repeat: boolean; play?: string }> {
    const { name, arg, def } = this.resolve(action, param);
    const lower = name.toLowerCase();
    if (!lower) return { ok: true, hangup: false, repeat: false };

    if (lower === "hangup") return { ok: true, hangup: true, repeat: false };
    if (lower === "repeat" || lower === "replay") return { ok: true, hangup: false, repeat: true };
    if (lower === "goto") return { ok: true, hangup: false, repeat: false };
    if (lower === "answer") {
      await this.ari.answer(ctx.session.uniqueId);
      ctx.answered = true;
      this.log.info({ component: "ivr", ...callLogFields(ctx.session) }, "answered");
      return { ok: true, hangup: false, repeat: false };
    }
    if (lower === "play") {
      const sound = toAriSound(arg);
      if (!sound) return { ok: false, hangup: false, repeat: false };
      return { ok: true, hangup: false, repeat: false, play: sound };
    }
    if (lower === "setlanguage") {
      ctx.session.language = parseCallerLanguage(arg, ctx.session.language);
    }

    if (def?.kind === "pulse" && def.pulseSlot) {
      if (def.pulseSlot === "createInteraction") {
        const r = await this.lifecycle.createInteraction(ctx.session);
        return { ok: r.ok, hangup: false, repeat: false };
      }
      if (def.pulseSlot === "createSession") {
        const r = await this.lifecycle.createSession(ctx.session);
        return { ok: r.ok, hangup: false, repeat: false };
      }
      if (def.pulseSlot === "closeSession") {
        await this.lifecycle.closeIfOpen(ctx.session, 1);
        return { ok: true, hangup: false, repeat: false };
      }
      if (def.pulseSlot === "addCallInteraction") {
        const r = await this.lifecycle.addCallInteraction(
          ctx.session,
          addInteractionFieldsForFunction(def.name, arg),
        );
        return { ok: r.ok, hangup: false, repeat: false };
      }
      const body = {
        function: def.name,
        param: arg,
        ...callLogFields(ctx.session),
        uniqueId: ctx.session.uniqueId,
        menuKey: ctx.menuKey,
        digit: ctx.digit,
      };
      const result = await this.pulse.invoke<Record<string, unknown>>(def.pulseSlot, body);
      if (result.ok && result.data && typeof result.data === "object") {
        applyPulseFacts(ctx.session, result.data);
      }
      this.log.info(
        {
          component: "ivr",
          fn: def.name,
          slot: def.pulseSlot,
          ok: result.ok,
          pulseError: result.error,
          mocked: result.mocked,
          ...callLogFields(ctx.session),
        },
        "function finished",
      );
      return { ok: result.ok, hangup: false, repeat: false };
    }

    if (lower === "setlanguage") {
      this.log.info({ component: "ivr", ...callLogFields(ctx.session) }, "language set");
      return { ok: true, hangup: false, repeat: false };
    }

    this.log.warn({ component: "ivr", action, param, ...callLogFields(ctx.session) }, "unknown function — treated as fail");
    return { ok: false, hangup: false, repeat: false };
  }
}
