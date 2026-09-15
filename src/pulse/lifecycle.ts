import type { CallSession, RejectReason } from "../domain/types.js";
import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging/index.js";
import { applyPulseFacts, callLogFields } from "../calls/progress.js";
import type { PulseClient } from "./client.js";

/** Pulse IVR channel id for this product. */
export const PULSE_CHANNEL_IVR = 1;
const CLOSE_MIN_ATTEMPTS = 5;

export type PulseScreenResult = { ok: true } | { ok: false; reason: RejectReason };

export type AddCallInteractionFields = {
  languageQueueId?: number;
  menuQueueId?: number;
  virtualQueueId?: number;
  action?: string;
};

export class PulseLifecycle {
  private readonly closing = new Map<string, Promise<void>>();

  constructor(
    private readonly store: ConfigStore,
    private readonly pulse: PulseClient,
    private readonly log: Logger,
  ) {}

  /**
   * Create Interaction then Create Session while the channel is still ringing.
   * Skip both only when neither API is enabled. Fail either → do not answer.
   */
  async screenBeforeAnswer(session: CallSession): Promise<PulseScreenResult> {
    const needInteraction = this.slotReady("createInteraction");
    const needSession = this.slotReady("createSession");
    if (!needInteraction && !needSession) {
      this.log.info({ component: "pulse", ...callLogFields(session) }, "PULSE screen skipped — create APIs not enabled");
      return { ok: true };
    }

    const created = await this.createInteraction(session);
    if (!created.ok) return created;

    const opened = await this.createSession(session);
    if (!opened.ok) return opened;

    return { ok: true };
  }

  async createInteraction(session: CallSession): Promise<PulseScreenResult> {
    if (session.interactionId) return { ok: true };

    const body = {
      cli: session.callerId,
      autoAgentId: (this.store.getSettings().pulse_auto_agent_id ?? "").trim(),
      direction: "inbound",
      refCallId: session.uniqueId,
      designatedNumber: session.did || undefined,
    };
    const result = await this.pulse.invoke<Record<string, unknown>>("createInteraction", body);
    if (result.ok && result.data && typeof result.data === "object") {
      applyPulseFacts(session, result.data);
    }

    const rec = result.data;
    const rejected = rec && typeof rec === "object" && (rec.accept === false || rec.rejectReason != null);
    if (!result.ok || rejected || !session.interactionId) {
      const reason = this.rejectReason(result);
      this.log.warn(
        {
          component: "pulse",
          pulseError: result.error,
          mocked: result.mocked,
          timedOut: result.timedOut,
          ...callLogFields(session),
        },
        "Create Interaction failed — will not answer",
      );
      return { ok: false, reason };
    }

    this.log.info({ component: "pulse", mocked: result.mocked, ...callLogFields(session) }, "Create Interaction ok");
    return { ok: true };
  }

  async createSession(session: CallSession): Promise<PulseScreenResult> {
    if (session.pulseSessionId) return { ok: true };
    if (!session.interactionId) {
      return { ok: false, reason: "pulse_error" };
    }

    const body = {
      interactionId: session.interactionId,
      callReferenceId: session.uniqueId,
      channelId: PULSE_CHANNEL_IVR,
      callStatus: "start",
      cli: session.callerId,
      recordingRelativePath: session.recordingRelativePath || "",
    };
    const result = await this.pulse.invoke<Record<string, unknown>>("createSession", body);
    if (result.ok && result.data && typeof result.data === "object") {
      applyPulseFacts(session, result.data);
    }

    if (!result.ok || !session.pulseSessionId) {
      const reason = this.rejectReason(result);
      this.log.warn(
        {
          component: "pulse",
          pulseError: result.error,
          mocked: result.mocked,
          timedOut: result.timedOut,
          ...callLogFields(session),
        },
        "Create Session failed — will not answer",
      );
      return { ok: false, reason };
    }

    this.log.info({ component: "pulse", mocked: result.mocked, ...callLogFields(session) }, "Create Session ok");
    return { ok: true };
  }

  async addCallInteraction(
    session: CallSession,
    fields: AddCallInteractionFields = {},
  ): Promise<{ ok: boolean }> {
    if (!session.interactionId || !session.pulseSessionId) {
      this.log.warn({ component: "pulse", ...callLogFields(session) }, "Add Interaction skipped — no Pulse ids");
      return { ok: false };
    }

    const body = {
      interactionId: session.interactionId,
      sessionId: session.pulseSessionId,
      callReferenceId: session.uniqueId,
      languageQueueId: fields.languageQueueId ?? 0,
      menuQueueId: fields.menuQueueId ?? 0,
      virtualQueueId: fields.virtualQueueId ?? 0,
      action: (fields.action ?? "").trim() || "IvrStep",
    };
    const result = await this.pulse.invoke<Record<string, unknown>>("addCallInteraction", body);
    if (result.ok && result.data && typeof result.data === "object") {
      applyPulseFacts(session, result.data);
    }
    this.log.info(
      {
        component: "pulse",
        ok: result.ok,
        pulseError: result.error,
        mocked: result.mocked,
        action: body.action,
        ...callLogFields(session),
      },
      "Add Interaction finished",
    );
    return { ok: result.ok };
  }

  /**
   * Close Session if both ids exist. Retries several times, then gives up.
   * Safe to call from IVR hangup and from StasisEnd.
   */
  async closeIfOpen(session: CallSession, callClosureStatus: number): Promise<void> {
    if (session.pulseClosed) return;
    if (!session.interactionId || !session.pulseSessionId) {
      if (session.interactionId) {
        this.log.warn(
          { component: "pulse", ...callLogFields(session) },
          "Close Session skipped — interaction exists but session was never created",
        );
      }
      session.pulseClosed = true;
      return;
    }

    const existing = this.closing.get(session.uniqueId);
    if (existing) {
      await existing;
      return;
    }

    const work = this.closeNow(session, callClosureStatus);
    this.closing.set(session.uniqueId, work);
    try {
      await work;
    } finally {
      this.closing.delete(session.uniqueId);
    }
  }

  private async closeNow(session: CallSession, callClosureStatus: number): Promise<void> {
    const body = {
      interactionId: session.interactionId,
      sessionId: session.pulseSessionId,
      channelId: PULSE_CHANNEL_IVR,
      callClosureStatus,
      agentId: session.agentId ?? "",
      feedback: "",
    };
    const result = await this.pulse.invoke("closeSession", body, {
      minAttempts: CLOSE_MIN_ATTEMPTS,
      ignoreDisabled: true,
    });
    session.pulseClosed = true;
    if (!result.ok) {
      this.log.error(
        {
          component: "pulse",
          pulseError: result.error,
          mocked: result.mocked,
          timedOut: result.timedOut,
          ...callLogFields(session),
        },
        "Close Session failed after retries — giving up",
      );
      return;
    }
    this.log.info({ component: "pulse", mocked: result.mocked, ...callLogFields(session) }, "Close Session ok");
  }

  private slotReady(slot: "createInteraction" | "createSession"): boolean {
    const cfg = this.store.getPulseApi(slot);
    return Boolean(cfg && cfg.enabled && (cfg.mockEnabled || cfg.endpoint.trim() || cfg.mockJson.trim() || cfg.mockError.trim()));
  }

  private rejectReason(result: { timedOut: boolean; error: string | null }): RejectReason {
    if (result.timedOut) return "pulse_timeout";
    const err = (result.error ?? "").toLowerCase();
    if (err.includes("not configured") || err.includes("not found") || err.includes("disabled")) {
      return "pulse_not_configured";
    }
    return "pulse_error";
  }
}

export function addInteractionFieldsForFunction(name: string, arg: string): AddCallInteractionFields {
  const lower = name.toLowerCase();
  const n = Number(String(arg).trim());
  const num = Number.isFinite(n) ? n : 0;
  if (lower === "proc_setlanguagequeueid" || lower === "setlanguage") {
    return { languageQueueId: num, action: "LanguageSelected" };
  }
  if (lower === "proc_setmenuqueueid") {
    return { menuQueueId: num, action: "MenuSelected" };
  }
  if (lower === "proc_setvirtualqueueid") {
    return { virtualQueueId: num, action: "VirtualQueue" };
  }
  if (lower === "proc_reportproduct") {
    return { action: arg.trim() || "Product" };
  }
  return { action: arg.trim() || "IvrStep" };
}
