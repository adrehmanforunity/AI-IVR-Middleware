import type { AriClient } from "../asterisk/ari.js";
import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging/index.js";
import type { CallSession } from "../domain/types.js";
import { CallRegistry } from "./registry.js";
import type { IvrEngine } from "../ivr/engine.js";
import { isForeignStation, isInboundChannel, matchSetup, trunkFromChannel, usableDid } from "./match.js";
import { callLogFields } from "./progress.js";

type AriChannel = {
  id?: string;
  name?: string;
  caller?: { name?: string; number?: string };
  connected?: { name?: string; number?: string };
  dialplan?: { context?: string; exten?: string; priority?: number };
};

type AriEvent = {
  type?: string;
  args?: unknown;
  channel?: AriChannel;
};

export class InboundController {
  private readonly admitting = new Set<string>();

  constructor(
    private readonly store: ConfigStore,
    private readonly registry: CallRegistry,
    private readonly ari: AriClient,
    private readonly ivr: IvrEngine,
    private readonly log: Logger,
  ) {}

  onAriEvent(ev: AriEvent): void {
    const type = ev.type;
    if (!type) return;
    try {
      if (!this.eventIsOurs(ev)) return;
      if (type === "StasisEnd" || type === "ChannelDestroyed") {
        this.onChannelGone(ev);
        return;
      }
      if (type === "StasisStart") {
        this.onStasisStart(ev);
      }
    } catch (err) {
      this.log.error({ component: "inbound", err }, "inbound handler error");
    }
  }

  /**
   * Only Stasis traffic and IIM stations (default 3001–3999). Other phones (2098, …) are ignored
   * unless that channel already entered our Stasis inbound (lab: 2098 dials DID 7777).
   */
  eventIsOurs(ev: AriEvent): boolean {
    const uniqueId = ev.channel?.id ?? "";
    if (uniqueId && (this.registry.getByUnique(uniqueId) || this.admitting.has(uniqueId))) {
      return true;
    }
    const type = ev.type ?? "";
    if (type === "StasisStart" || type === "StasisEnd" || type === "ChannelDestroyed" || type === "ChannelDtmfReceived" || type === "PlaybackFinished") {
      return true;
    }
    const channel = ev.channel?.name ?? "";
    if (!channel) return false;
    const range = this.store.getTelephony().ownedExtensions;
    if (isForeignStation(channel, range)) return false;
    return true;
  }

  private didFromEvent(ev: AriEvent): string {
    const args = Array.isArray(ev.args) ? ev.args.map((a) => String(a ?? "")) : [];
    const ch = ev.channel;
    return usableDid(args[0]) || usableDid(ch?.dialplan?.exten) || usableDid(ch?.connected?.number);
  }

  private onChannelGone(ev: AriEvent): void {
    const uniqueId = ev.channel?.id ?? "";
    if (!uniqueId) return;
    this.admitting.delete(uniqueId);
    this.ivr.stop(uniqueId, "channel gone");
    const ended = this.registry.end(uniqueId);
    if (ended) {
      this.log.info(
        { component: "inbound", ...callLogFields(ended) },
        "call shutdown",
      );
    }
  }

  private onStasisStart(ev: AriEvent): void {
    const ch = ev.channel;
    const uniqueId = ch?.id ?? "";
    const channel = ch?.name ?? "";
    if (!uniqueId || !isInboundChannel(channel)) return;
    if (this.registry.getByUnique(uniqueId) || this.admitting.has(uniqueId)) return;

    const did = this.didFromEvent(ev);
    const callerId = (Array.isArray(ev.args) ? String(ev.args[1] ?? "") : "") || (ch?.caller?.number || "").trim();
    const trunk = trunkFromChannel(channel);

    if (!did) {
      this.log.warn({ component: "inbound", uniqueId, channel, args: ev.args }, "StasisStart with no DID");
      void this.ari.hangup(uniqueId, "rejected");
      return;
    }

    this.beginAdmit({ uniqueId, channel, callerId, did, trunk });
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
      void this.ari.hangup(facts.uniqueId, "rejected");
      this.admitting.delete(facts.uniqueId);
      return;
    }

    const reserved = this.registry.tryReserve({ ...facts, setup });
    if (!reserved.session) {
      const reason = reserved.reason;
      this.log.warn({ component: "inbound", ...facts, setupId: setup.id, reason }, "call not admitted");
      void this.ari.hangup(facts.uniqueId, reason === "busy" ? "busy" : "rejected");
      this.admitting.delete(facts.uniqueId);
      return;
    }

    this.log.info(
      {
        component: "inbound",
        setup: setup.name,
        ...callLogFields(reserved.session),
        channel: facts.channel,
        trunk: facts.trunk,
      },
      "admitted via ARI StasisStart",
    );
    void this.holdInStasis(reserved.session).finally(() => this.admitting.delete(facts.uniqueId));
  }

  /** Admit only. Answer is an IVR function when a program is attached. */
  private async holdInStasis(session: CallSession): Promise<void> {
    if (!this.registry.getByUnique(session.uniqueId)) return;
    session.state = "session";
    this.registry.update(session);
    const setup = session.setupId != null ? this.store.getSetup(session.setupId) : null;
    if (setup?.ivrId) {
      this.log.info(
        { component: "inbound", ivrId: setup.ivrId, ...callLogFields(session) },
        "admitted — IVR starts (answer only if the script says so)",
      );
      this.ivr.start(session, setup.ivrId);
      return;
    }
    await this.ari.answer(session.uniqueId);
    this.log.info(
      { component: "inbound", ...callLogFields(session) },
      "answered — no IVR on this call setup",
    );
  }
}
