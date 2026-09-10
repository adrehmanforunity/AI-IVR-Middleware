import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type { Logger } from "../logging.js";
import {
  backoffDelay,
  emptyLinkStatus,
  type AsteriskTarget,
  type ConnectionState,
  type LinkStatus,
} from "./types.js";

export type AriLinkStatus = LinkStatus & {
  restState: ConnectionState;
  wsState: ConnectionState;
};

export class AriClient extends EventEmitter {
  readonly status: AriLinkStatus = {
    ...emptyLinkStatus(),
    restState: "stopped",
    wsState: "stopped",
  };

  private stopped = true;
  private target: AsteriskTarget | null = null;
  private ws: WebSocket | null = null;
  private restTimer: NodeJS.Timeout | null = null;
  private wsTimer: NodeJS.Timeout | null = null;
  private restAttempt = 0;
  private wsAttempt = 0;
  private restAbort: AbortController | null = null;

  private retryDelayMs = 5000;

  constructor(private readonly log: Logger) {
    super();
    this.setMaxListeners(50);
  }

  setRetryDelayMs(ms: number): void {
    this.retryDelayMs = Math.max(500, ms);
  }

  start(target: AsteriskTarget): void {
    this.target = target;
    this.stopped = false;
    void this.pollRest();
    this.connectWs();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.restAbort?.abort();
    this.teardownWs();
    this.status.state = "stopped";
    this.status.restState = "stopped";
    this.status.wsState = "stopped";
  }

  updateTarget(target: AsteriskTarget): void {
    this.target = target;
  }

  private authHeader(target: AsteriskTarget): string {
    const token = Buffer.from(`${target.ariUser}:${target.ariPassword}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  private restUrl(target: AsteriskTarget, path: string): URL {
    const base = target.ariBaseUrl.replace(/\/+$/, "");
    return new URL(`${base}/ari${path}`);
  }

  private wsUrl(target: AsteriskTarget): URL {
    const u = this.restUrl(target, "/events");
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("app", target.stasisApp);
    u.searchParams.set("subscribeAll", "false");
    u.searchParams.set("api_key", `${target.ariUser}:${target.ariPassword}`);
    return u;
  }

  private async pollRest(): Promise<void> {
    if (this.stopped || !this.target) return;
    this.status.restState = this.status.restState === "connected" ? "connected" : "connecting";
    this.restAbort?.abort();
    const ac = new AbortController();
    this.restAbort = ac;
    const target = this.target;

    try {
      const url = this.restUrl(target, "/asterisk/info");
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader(target) },
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(8000)]),
      });
      if (!res.ok) {
        throw new Error(`ari rest ${res.status}`);
      }
      this.restAttempt = 0;
      this.status.restState = "connected";
      this.status.lastError = this.status.wsState === "disconnected" ? this.status.lastError : null;
      this.recompute();
      this.log.debug({ component: "ari" }, "ari rest ok");
    } catch (err) {
      if (ac.signal.aborted && this.stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      this.status.restState = "disconnected";
      this.status.lastError = message;
      this.recompute();
      this.log.warn({ component: "ari", err: message }, "ari rest failed");
    }

    this.scheduleRest();
  }

  private connectWs(): void {
    if (this.stopped || !this.target) return;
    this.teardownWs();
    this.status.wsState = "connecting";
    const url = this.wsUrl(this.target);
    this.log.info({ component: "ari", url: redactWs(url) }, "ari websocket connecting");

    const ws = new WebSocket(url, { handshakeTimeout: 8000 });
    this.ws = ws;

    ws.on("open", () => {
      this.wsAttempt = 0;
      this.status.wsState = "connected";
      this.status.lastConnectedAt = new Date().toISOString();
      this.recompute();
      this.log.info({ component: "ari", app: this.target?.stasisApp }, "ari websocket connected");
      this.emit("connected");
    });

    ws.on("message", (data) => {
      try {
        this.status.lastEventAt = new Date().toISOString();
        const text = typeof data === "string" ? data : data.toString("utf8");
        const event = JSON.parse(text) as { type?: string };
        this.emit("event", event);
        if (event.type) {
          this.log.debug({ component: "ari", ariEvent: event.type }, "ari event");
        }
      } catch (err) {
        this.log.error({ component: "ari", err }, "ari event handler error");
      }
    });

    ws.on("error", (err) => {
      this.status.lastError = err.message;
      this.log.warn({ component: "ari", err: err.message }, "ari websocket error");
    });

    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return;
      this.status.wsState = "disconnected";
      this.status.lastError = `ari ws closed ${code} ${reason.toString() || ""}`.trim();
      this.recompute();
      this.log.warn({ component: "ari", code }, "ari websocket closed");
      this.scheduleWs();
    });
  }

  private scheduleRest(): void {
    if (this.stopped || this.restTimer) return;
    const delay = this.status.restState === "connected" ? 15_000 : backoffDelay(this.restAttempt++, this.retryDelayMs);
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      void this.pollRest();
    }, delay);
  }

  private scheduleWs(): void {
    if (this.stopped || this.wsTimer) return;
    this.status.reconnectCount += 1;
    const delay = backoffDelay(this.wsAttempt++, this.retryDelayMs);
    this.log.warn({ component: "ari", delayMs: delay, attempt: this.wsAttempt }, "ari ws reconnect scheduled");
    this.wsTimer = setTimeout(() => {
      this.wsTimer = null;
      this.connectWs();
    }, delay);
  }

  private recompute(): void {
    const rest = this.status.restState;
    const ws = this.status.wsState;
    let state: ConnectionState;
    if (rest === "connected" && ws === "connected") state = "connected";
    else if (rest === "connected" || ws === "connected") state = "degraded";
    else if (rest === "connecting" || ws === "connecting") state = "connecting";
    else if (this.stopped) state = "stopped";
    else state = "disconnected";
    this.status.state = state;
  }

  private clearTimers(): void {
    if (this.restTimer) {
      clearTimeout(this.restTimer);
      this.restTimer = null;
    }
    if (this.wsTimer) {
      clearTimeout(this.wsTimer);
      this.wsTimer = null;
    }
  }

  private teardownWs(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.removeAllListeners();
    try {
      ws.close();
    } catch {
      // ignore
    }
    try {
      ws.terminate();
    } catch {
      // ignore
    }
  }
}

function redactWs(url: URL): string {
  const copy = new URL(url);
  if (copy.searchParams.has("api_key")) copy.searchParams.set("api_key", "***");
  return copy.toString();
}
