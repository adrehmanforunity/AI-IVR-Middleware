import type { AmiClient } from "../asterisk/ami.js";
import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging.js";
import type { CallSession, RejectReason } from "../domain/types.js";
import { PulseClient } from "../pulse/client.js";
import { CallRegistry } from "./registry.js";
import { isInboundChannel, matchSetup, trunkFromChannel, usableDid } from "./match.js";

type AmiEvent = Record<string, string>;

const BUSY_CAUSE = "17";
const REJECT_CAUSE = "21";

export class InboundController {
  private readonly pendingDid = new Map<string, AmiEvent>();
  private readonly admitting = new Set<string>();

  constructor(
    private readonly store: ConfigStore,
    private readonly registry: CallRegistry,
    private readonly pulse: PulseClient,
    private readonly ami: AmiClient,
    private readonly log: Logger,
  ) {}

  onAmiEvent(msg: AmiEvent): void {
    const event = msg.Event;
    if (!event) return;
    try {
      if (event === "Hangup") {
        this.onHangup(msg);
        return;
      }
      if (event === "Newchannel" || event === "Newexten") {
        this.onProgress(msg);
      }
    } catch (err) {
      this.log.error({ component: "inbound", err }, "inbound handler error");
    }
  }

  private onHangup(msg: AmiEvent): void {
    const uniqueId = msg.Uniqueid ?? "";
    if (!uniqueId) return;
    this.pendingDid.delete(uniqueId);
    this.admitting.delete(uniqueId);
    const ended = this.registry.end(uniqueId);
    if (ended) {
      this.log.info(
        { component: "inbound", sessionId: ended.sessionId, uniqueId, state: ended.state },
        "call released",
      );
    }
  }

  private onProgress(msg: AmiEvent): void {
    const channel = msg.Channel ?? "";
    const uniqueId = msg.Uniqueid ?? "";
    if (!uniqueId || !isInboundChannel(channel)) return;
    if (this.registry.getByUnique(uniqueId) || this.admitting.has(uniqueId)) return;

    const did = usableDid(msg.Exten) || usableDid(msg.ConnectedLineNum);
    const callerId = msg.CallerIDNum ?? msg.CallerID ?? "";
    const trunk = trunkFromChannel(channel);
    if (!did) {
      this.pendingDid.set(uniqueId, msg);
      return;
    }

    const merged = { ...this.pendingDid.get(uniqueId), ...msg };
    this.pendingDid.delete(uniqueId);
    this.beginAdmit({
      uniqueId,
      channel: merged.Channel ?? channel,
      callerId: merged.CallerIDNum ?? merged.CallerID ?? callerId,
      did,
      trunk,
    });
  }

  private beginAdmit(facts: {
    uniqueId: string;
    channel: string;
    callerId: string;
    did: string;
    trunk: string;
  }): void {
    if (this.admitting.has(facts.uniqueId) || this.registry.getByUnique(facts.uniqueId)) return;
    this.admitting.add(facts.uniqueId);

    const setup = matchSetup(facts.did, facts.trunk, this.store.listSetups());
    if (!setup) {
      this.log.warn({ component: "inbound", ...facts }, "no matching call setup");
      this.ami.hangup(facts.channel, REJECT_CAUSE);
      this.admitting.delete(facts.uniqueId);
      return;
    }

    const reserved = this.registry.tryReserve({ ...facts, setup });
    if (!reserved.session) {
      const reason = reserved.reason;
      this.log.warn({ component: "inbound", ...facts, setupId: setup.id, reason }, "call not admitted");
      this.ami.hangup(facts.channel, reason === "busy" ? BUSY_CAUSE : REJECT_CAUSE);
      this.admitting.delete(facts.uniqueId);
      return;
    }

    void this.screen(reserved.session).finally(() => this.admitting.delete(facts.uniqueId));
  }

  private async screen(session: CallSession): Promise<void> {
    const pre = await this.pulse.invoke<Record<string, unknown>>("preAnswer", {
      callerId: session.callerId,
      did: session.did,
      trunk: session.trunk,
      uniqueId: session.uniqueId,
      sessionId: session.sessionId,
    });

    if (!this.registry.getByUnique(session.uniqueId)) return;

    if (!pre.ok) {
      const reason: RejectReason = !this.store.getPulseApi("preAnswer")?.endpoint
        ? "pulse_not_configured"
        : pre.timedOut
          ? "pulse_timeout"
          : "pulse_error";
      this.reject(session, reason);
      return;
    }

    const data = pre.data ?? {};
    const rejectReason = stringField(data, "rejectReason", "reason", "reject_reason");
    const interactionId = stringField(data, "interactionId", "interaction_id", "InteractionId");

    if (!interactionId) {
      this.reject(session, rejectReason || "pulse_reject");
      return;
    }

    session.interactionId = interactionId;
    session.state = "screened";
    this.registry.update(session);

    const started = await this.pulse.invoke<Record<string, unknown>>("startSession", {
      sessionId: session.sessionId,
      interactionId,
      callerId: session.callerId,
      did: session.did,
      trunk: session.trunk,
    });

    if (!this.registry.getByUnique(session.uniqueId)) return;

    if (!started.ok || !started.data) {
      const reason: RejectReason = started.timedOut ? "pulse_timeout" : "pulse_error";
      this.reject(session, reason);
      return;
    }

    const body = started.data;
    session.callerType = stringField(body, "callerType", "caller_type", "type") || null;
    session.ivrPointer = stringField(body, "ivrPointer", "ivr_pointer", "ivr", "flow") || null;
    session.customer = body.customer ?? body.profile ?? body;
    session.state = "session";
    this.registry.update(session);
    this.log.info(
      {
        component: "inbound",
        sessionId: session.sessionId,
        interactionId,
        callerType: session.callerType,
        ivrPointer: session.ivrPointer,
      },
      "session ready — IVR interpreter not in this slice",
    );
  }

  private reject(session: CallSession, reason: RejectReason | string): void {
    this.registry.end(session.uniqueId, reason, true);
    this.ami.hangup(session.channel, reason === "busy" ? BUSY_CAUSE : REJECT_CAUSE);
    this.log.warn({ component: "inbound", sessionId: session.sessionId, reason }, "call rejected");
  }
}

function stringField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
