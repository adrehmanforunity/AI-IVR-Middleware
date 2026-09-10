import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging.js";
import { AmiClient } from "./ami.js";
import { AriClient } from "./ari.js";
import type { AsteriskTarget, LinkStatus } from "./types.js";
import type { TelephonyConfig, TelephonyDesired } from "../domain/types.js";
import { CallRegistry } from "../calls/registry.js";
import { InboundController } from "../calls/inbound.js";
import { PulseClient } from "../pulse/client.js";

export type SupervisorSnapshot = {
  uptimeSeconds: number;
  telephony: TelephonyConfig & { running: boolean };
  ami: LinkStatus;
  ari: LinkStatus & { restState: string; wsState: string };
  sqlite: { ok: boolean; lastError: string | null; usingSnapshot: boolean };
  stasisApp: string;
  setups: ReturnType<CallRegistry["setupsWithCounts"]>;
  activeCalls: number;
};

export class Supervisor {
  readonly ami: AmiClient;
  readonly ari: AriClient;
  readonly registry: CallRegistry;
  readonly inbound: InboundController;
  readonly pulse: PulseClient;
  private readonly startedAt = Date.now();
  private target: AsteriskTarget | null = null;
  private running = false;

  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger,
  ) {
    this.ami = new AmiClient(log);
    this.ari = new AriClient(log);
    this.registry = new CallRegistry(store);
    this.pulse = new PulseClient(store, log);
    this.inbound = new InboundController(store, this.registry, this.pulse, this.ami, log);

    this.ami.on("event", (msg: Record<string, string>) => {
      setImmediate(() => this.inbound.onAmiEvent(msg));
    });
    this.ari.on("event", () => {
      // v2: StasisStart enters the selected IVR
    });
  }

  applyRetryDelay(): void {
    const delay = this.store.getTelephony().retryDelayMs;
    this.ami.setRetryDelayMs(delay);
    this.ari.setRetryDelayMs(delay);
  }

  bootTelephony(): void {
    this.applyRetryDelay();
    if (this.store.getTelephony().desired === "connect") {
      this.start();
    } else {
      this.log.info({ component: "supervisor" }, "telephony desired=disconnect — AMI/ARI stay down");
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.applyRetryDelay();
    this.target = this.store.getTarget();
    this.log.info(
      { component: "supervisor", host: this.target.host, stasisApp: this.target.stasisApp },
      "supervisor starting asterisk links",
    );
    this.ami.start(this.target);
    this.ari.start(this.target);
  }

  stop(): void {
    this.running = false;
    this.ami.stop();
    this.ari.stop();
  }

  connectTelephony(actor: string, retryDelayMs?: number): SupervisorSnapshot {
    this.store.putTelephony(
      {
        desired: "connect",
        retryDelayMs,
      },
      actor,
    );
    this.applyRetryDelay();
    this.log.info({ component: "supervisor" }, "telephony connect");
    if (!this.running) this.start();
    return this.snapshot();
  }

  disconnectTelephony(actor: string): SupervisorSnapshot {
    this.store.putTelephony({ desired: "disconnect" }, actor);
    this.log.info({ component: "supervisor" }, "telephony disconnect — no retry until connect");
    this.stop();
    return this.snapshot();
  }

  reconnect(): SupervisorSnapshot {
    if (this.store.getTelephony().desired !== "connect") {
      this.log.warn({ component: "supervisor" }, "reconnect ignored — telephony is disconnected");
      return this.snapshot();
    }
    this.target = this.store.getTarget();
    this.applyRetryDelay();
    this.ami.updateTarget(this.target);
    this.ari.updateTarget(this.target);
    this.log.info({ component: "supervisor" }, "operator requested asterisk reconnect");
    this.ami.stop();
    this.ari.stop();
    this.running = false;
    this.start();
    return this.snapshot();
  }

  snapshot(): SupervisorSnapshot {
    const telephony = this.store.getTelephony();
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      telephony: { ...telephony, running: this.running },
      ami: { ...this.ami.status },
      ari: { ...this.ari.status },
      sqlite: this.store.status(),
      stasisApp: this.store.getTarget().stasisApp,
      setups: this.registry.setupsWithCounts(),
      activeCalls: this.registry.listActive().length,
    };
  }

  ready(): { ready: boolean; reasons: string[] } {
    const snap = this.snapshot();
    const reasons: string[] = [];
    if (snap.telephony.desired === "disconnect") reasons.push("telephony:disconnected");
    else {
      if (snap.ami.state !== "connected") reasons.push(`ami:${snap.ami.state}`);
      if (snap.ari.state !== "connected") reasons.push(`ari:${snap.ari.state}`);
    }
    if (!snap.sqlite.ok) reasons.push("sqlite:unavailable");
    return { ready: reasons.length === 0, reasons };
  }

  desired(): TelephonyDesired {
    return this.store.getTelephony().desired;
  }
}
