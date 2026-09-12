import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging/index.js";
import { AmiClient } from "./ami.js";
import { AriClient } from "./ari.js";
import type { AsteriskTarget, LinkStatus } from "./types.js";
import type { TelephonyConfig } from "../domain/types.js";
import { CallRegistry } from "../calls/registry.js";
import { InboundController } from "../calls/inbound.js";
import { PulseClient } from "../pulse/client.js";
import { IvrEngine } from "../ivr/engine.js";
import { buildStationsBoard, STATIONS_CACHE_MS, type StationsBoard } from "../stations/board.js";

export type TelephonyEvent = {
  at: string;
  source: "ami" | "ari" | "supervisor";
  level: "info" | "warn" | "error";
  message: string;
};

export type SupervisorSnapshot = {
  uptimeSeconds: number;
  telephony: {
    ami: TelephonyConfig["ami"] & { running: boolean };
    ari: TelephonyConfig["ari"] & { running: boolean };
    ownedExtensions: TelephonyConfig["ownedExtensions"];
  };
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
  readonly ivr: IvrEngine;
  private readonly startedAt = Date.now();
  private target: AsteriskTarget | null = null;
  private amiRunning = false;
  private ariRunning = false;
  private readonly events: TelephonyEvent[] = [];
  private stationsCache: { at: number; data: StationsBoard } | null = null;

  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger,
  ) {
    this.ami = new AmiClient(log);
    this.ari = new AriClient(log);
    this.registry = new CallRegistry(store);
    this.pulse = new PulseClient(store, log);
    this.ivr = new IvrEngine(store, this.registry, this.ari, this.pulse, log);
    this.inbound = new InboundController(store, this.registry, this.ari, this.ivr, log);

    // AMI stays connected (login + keepalive) but is not used for call control.
    this.ami.on("journal", (row: { level: TelephonyEvent["level"]; message: string }) => {
      this.note("ami", row.level, row.message);
    });
    this.ari.on("event", (ev: { type?: string }) => {
      if (!this.inbound.eventIsOurs(ev) && ev.type !== "ChannelDtmfReceived" && ev.type !== "PlaybackFinished") {
        return;
      }
      if (ev.type && ev.type !== "ChannelVarset" && ev.type !== "ChannelDtmfReceived") {
        this.note("ari", "info", `WS ${ev.type}`);
      }
      setImmediate(() => {
        this.inbound.onAriEvent(ev);
        this.ivr.onAriEvent(ev);
      });
    });
    this.ari.on("journal", (row: { level: TelephonyEvent["level"]; message: string }) => {
      this.note("ari", row.level, row.message);
    });
  }

  recentEvents(): TelephonyEvent[] {
    return [...this.events].reverse();
  }

  private note(source: TelephonyEvent["source"], level: TelephonyEvent["level"], message: string): void {
    this.events.push({ at: new Date().toISOString(), source, level, message });
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100);
  }

  applyLinkSettings(): void {
    const tel = this.store.getTelephony();
    this.ami.setRetryDelayMs(tel.ami.retryDelayMs);
    this.ami.setConnectTimeoutMs(tel.ami.connectTimeoutMs);
    this.ari.setRetryDelayMs(tel.ari.retryDelayMs);
    this.ari.setConnectTimeoutMs(tel.ari.connectTimeoutMs);
  }

  bootTelephony(): void {
    this.applyLinkSettings();
    const tel = this.store.getTelephony();
    if (tel.ami.desired === "connect") this.startAmi();
    else this.log.info({ component: "supervisor" }, "AMI desired=disconnect — stay down");
    if (tel.ari.desired === "connect") this.startAri();
    else this.log.info({ component: "supervisor" }, "ARI desired=disconnect — stay down");
  }

  startAmi(): void {
    this.amiRunning = true;
    this.applyLinkSettings();
    this.target = this.store.getTarget();
    this.log.info({ component: "supervisor", host: this.target.host, port: this.target.amiPort }, "starting AMI");
    this.note(
      "supervisor",
      "info",
      `Starting AMI ${this.target.host}:${this.target.amiPort} (idle: connected, Events off, not used for calls)`,
    );
    this.ami.start(this.target);
  }

  startAri(): void {
    this.ariRunning = true;
    this.applyLinkSettings();
    this.target = this.store.getTarget();
    this.log.info(
      { component: "supervisor", url: this.target.ariBaseUrl, stasisApp: this.target.stasisApp },
      "starting ARI",
    );
    this.note("supervisor", "info", `Starting ARI ${this.target.ariBaseUrl} (auto-reconnect while enabled)`);
    this.ari.start(this.target);
  }

  stopAmi(): void {
    this.amiRunning = false;
    this.ami.stop();
  }

  stopAri(): void {
    this.ariRunning = false;
    this.ari.stop();
  }

  connectLink(link: "ami" | "ari", actor: string): SupervisorSnapshot {
    this.store.putTelephony({ [link]: { desired: "connect" } }, actor);
    this.applyLinkSettings();
    this.log.info({ component: "supervisor", link }, `${link} connect`);
    this.note("supervisor", "info", `${link.toUpperCase()} enable & connect — will retry if Asterisk is down`);
    if (link === "ami") this.startAmi();
    else this.startAri();
    return this.snapshot();
  }

  disconnectLink(link: "ami" | "ari", actor: string): SupervisorSnapshot {
    this.store.putTelephony({ [link]: { desired: "disconnect" } }, actor);
    this.log.info({ component: "supervisor", link }, `${link} disconnect — no retry until connect`);
    this.note("supervisor", "warn", `${link.toUpperCase()} disable & disconnect — no retry`);
    if (link === "ami") this.stopAmi();
    else this.stopAri();
    return this.snapshot();
  }

  reconnectLink(link: "ami" | "ari"): SupervisorSnapshot {
    const tel = this.store.getTelephony();
    if (tel[link].desired !== "connect") {
      this.log.warn({ component: "supervisor", link }, "reconnect ignored — link is disabled");
      this.note("supervisor", "warn", `${link.toUpperCase()} reconnect ignored — disabled`);
      return this.snapshot();
    }
    this.target = this.store.getTarget();
    this.applyLinkSettings();
    this.log.info({ component: "supervisor", link }, "operator requested reconnect");
    this.note("supervisor", "info", `${link.toUpperCase()} reconnect — applying current settings`);
    if (link === "ami") {
      this.ami.updateTarget(this.target);
      this.stopAmi();
      this.startAmi();
    } else {
      this.ari.updateTarget(this.target);
      this.stopAri();
      this.startAri();
    }
    return this.snapshot();
  }

  connectTelephony(actor: string): SupervisorSnapshot {
    this.connectLink("ami", actor);
    return this.connectLink("ari", actor);
  }

  disconnectTelephony(actor: string): SupervisorSnapshot {
    this.disconnectLink("ami", actor);
    return this.disconnectLink("ari", actor);
  }

  reconnect(): SupervisorSnapshot {
    this.reconnectLink("ami");
    return this.reconnectLink("ari");
  }

  stop(): void {
    this.stopAmi();
    this.stopAri();
  }

  async stationsBoard(): Promise<StationsBoard> {
    const now = Date.now();
    if (this.stationsCache && now - this.stationsCache.at < STATIONS_CACHE_MS) {
      return this.stationsCache.data;
    }
    const range = this.store.getTelephony().ownedExtensions;
    let endpoints = null;
    if (this.ariRunning && this.ari.status.restState !== "stopped") {
      const listed = await this.ari.listPjsipEndpoints();
      endpoints = listed.ok ? listed.endpoints : null;
    }
    const data = buildStationsBoard({
      range,
      endpoints,
      directory: this.store.listStations(),
      calls: this.registry.listActive(),
    });
    this.stationsCache = { at: now, data };
    return data;
  }

  snapshot(): SupervisorSnapshot {
    const telephony = this.store.getTelephony();
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      telephony: {
        ami: { ...telephony.ami, running: this.amiRunning },
        ari: { ...telephony.ari, running: this.ariRunning },
        ownedExtensions: telephony.ownedExtensions,
      },
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
    if (snap.telephony.ami.desired === "connect" && snap.ami.state !== "connected") {
      reasons.push(`ami:${snap.ami.state}`);
    }
    if (snap.telephony.ari.desired === "connect" && snap.ari.state !== "connected") {
      reasons.push(`ari:${snap.ari.state}`);
    }
    if (snap.telephony.ami.desired === "disconnect" && snap.telephony.ari.desired === "disconnect") {
      reasons.push("telephony:disconnected");
    }
    if (!snap.sqlite.ok) reasons.push("sqlite:unavailable");
    return { ready: reasons.length === 0, reasons };
  }
}
