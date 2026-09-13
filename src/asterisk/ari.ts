import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { writeAriLog, type Logger } from "../logging/index.js";
import {
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
  private connectTimeoutMs = 8000;

  constructor(private readonly log: Logger) {
    super();
    this.setMaxListeners(50);
  }

  setRetryDelayMs(ms: number): void {
    this.retryDelayMs = Math.max(500, ms);
  }

  setConnectTimeoutMs(ms: number): void {
    this.connectTimeoutMs = Math.max(500, ms);
  }

  start(target: AsteriskTarget): void {
    this.target = target;
    this.stopped = false;
    this.restAttempt = 0;
    this.wsAttempt = 0;
    this.status.nextRetryAt = null;
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
    writeAriLog("meta", "ARI client stopped");
  }

  updateTarget(target: AsteriskTarget): void {
    this.target = target;
  }

  /** Answer a Stasis channel after admission. */
  async answer(channelId: string): Promise<void> {
    await this.rest("POST", `/channels/${encodeURIComponent(channelId)}/answer`);
  }

  /** Hang up a Stasis channel. `id` is ARI channel.id (Asterisk Uniqueid). */
  async hangup(channelId: string, reason: "busy" | "rejected" | "normal" = "rejected"): Promise<void> {
    await this.rest("DELETE", `/channels/${encodeURIComponent(channelId)}`, { reason });
  }

  /** One ARI GET — PJSIP endpoints only. Body is not dumped to the ARI log. */
  async listPjsipEndpoints(): Promise<{
    ok: boolean;
    endpoints: Array<{ resource: string; state: string; channelIds: string[] }>;
  }> {
    const res = await this.rest("GET", "/endpoints/PJSIP", undefined, { quiet: true });
    if (!res.ok) return { ok: false, endpoints: [] };
    try {
      const parsed = JSON.parse(res.text) as Array<{
        resource?: string;
        state?: string;
        channel_ids?: string[];
      }>;
      if (!Array.isArray(parsed)) return { ok: false, endpoints: [] };
      return {
        ok: true,
        endpoints: parsed.map((row) => ({
          resource: String(row.resource ?? ""),
          state: String(row.state ?? "unknown"),
          channelIds: Array.isArray(row.channel_ids) ? row.channel_ids.map(String) : [],
        })),
      };
    } catch {
      this.log.warn({ component: "ari" }, "PJSIP endpoint list was not JSON");
      return { ok: false, endpoints: [] };
    }
  }

  async play(channelId: string, sound: string): Promise<string | null> {
    const media = toAriMedia(sound);
    const res = await this.rest("POST", `/channels/${encodeURIComponent(channelId)}/play`, { media });
    if (!res.ok) return null;
    try {
      const parsed = JSON.parse(res.text) as { id?: string };
      return parsed.id ?? null;
    } catch {
      return null;
    }
  }

  async stopPlayback(playbackId: string): Promise<void> {
    if (!playbackId) return;
    await this.rest("DELETE", `/playbacks/${encodeURIComponent(playbackId)}`);
  }

  private async rest(
    method: string,
    path: string,
    query?: Record<string, string>,
    opts?: { quiet?: boolean },
  ): Promise<{ ok: boolean; status: number; text: string }> {
    if (!this.target) return { ok: false, status: 0, text: "no target" };
    const url = this.restUrl(this.target, path);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const q = url.search ? url.search : "";
    try {
      writeAriLog("out", `REST ${method} ${url.pathname}${q}\nAuthorization: Basic ***\n`);
      const res = await fetch(url, {
        method,
        headers: { Authorization: this.authHeader(this.target) },
        signal: AbortSignal.timeout(this.connectTimeoutMs),
      });
      const text = await res.text();
      if (opts?.quiet) {
        writeAriLog("in", `REST ${res.status} ${method} ${url.pathname} (${text.length} bytes, body omitted)`);
      } else {
        writeAriLog("in", `REST ${res.status} ${method} ${url.pathname}\n${text}`);
      }
      if (!res.ok && res.status !== 404) {
        this.log.warn({ component: "ari", method, path, status: res.status }, "ari rest call failed");
      }
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn({ component: "ari", err: message, method, path }, "ari rest error");
      writeAriLog("meta", `REST ${method} ${path} error ${message}`);
      return { ok: false, status: 0, text: message };
    }
  }

  private authHeader(target: AsteriskTarget): string {
    const token = Buffer.from(`${target.ariUser}:${target.ariPassword}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  private restUrl(target: AsteriskTarget, path: string): URL {
    const root = ariRoot(target.ariBaseUrl);
    return new URL(`${root}${path.startsWith("/") ? path : `/${path}`}`);
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

    try {
      const wasDown = this.status.restState !== "connected";
      const res = await this.rest("GET", "/asterisk/info", undefined, { quiet: true });
      if (this.stopped || ac.signal.aborted) return;
      if (!res.ok) {
        throw new Error(`ari rest ${res.status}`);
      }
      this.restAttempt = 0;
      this.status.restState = "connected";
      this.status.lastError = this.status.wsState === "disconnected" ? this.status.lastError : null;
      this.recompute();
      this.log.debug({ component: "ari" }, "ari rest ok");
      if (wasDown) this.emit("journal", { level: "info", message: "REST /asterisk/info ok" });
    } catch (err) {
      if (ac.signal.aborted && this.stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      this.status.restState = "disconnected";
      this.status.lastError = message;
      this.recompute();
      this.log.warn({ component: "ari", err: message }, "ari rest failed");
      writeAriLog("meta", `REST error ${message}`);
      this.emit("journal", { level: "warn", message: `REST ${message}` });
    }

    this.scheduleRest();
  }

  private connectWs(): void {
    if (this.stopped || !this.target) return;
    this.teardownWs();
    this.status.wsState = "connecting";
    const url = this.wsUrl(this.target);
    this.log.info({ component: "ari", url: redactWs(url) }, "ari websocket connecting");
    writeAriLog("meta", `WS connecting ${redactWs(url)}`);

    const ws = new WebSocket(url, { handshakeTimeout: this.connectTimeoutMs });
    this.ws = ws;

    ws.on("open", () => {
      this.wsAttempt = 0;
      this.status.wsState = "connected";
      this.status.lastConnectedAt = new Date().toISOString();
      this.recompute();
      this.log.info({ component: "ari", app: this.target?.stasisApp }, "ari websocket connected");
      writeAriLog("meta", "WS open");
      this.emit("journal", { level: "info", message: `WebSocket open (app ${this.target?.stasisApp ?? ""})` });
      this.emit("connected");
    });

    ws.on("message", (data) => {
      try {
        this.status.lastEventAt = new Date().toISOString();
        const text = typeof data === "string" ? data : data.toString("utf8");
        writeAriLog("in", `WS ${text}`);
        const event = JSON.parse(text) as { type?: string };
        this.emit("event", event);
      } catch (err) {
        this.log.error({ component: "ari", err }, "ari event handler error");
        writeAriLog("meta", `WS handler error ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    ws.on("error", (err) => {
      this.status.lastError = err.message;
      this.log.warn({ component: "ari", err: err.message }, "ari websocket error");
      writeAriLog("meta", `WS error ${err.message}`);
      this.emit("journal", { level: "warn", message: `WS ${err.message}` });
      this.scheduleWs();
    });

    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return;
      this.status.wsState = "disconnected";
      this.status.lastError = `ari ws closed ${code} ${reason.toString() || ""}`.trim();
      this.recompute();
      this.log.warn({ component: "ari", code }, "ari websocket closed");
      writeAriLog("meta", `WS close ${code} ${reason.toString()}`);
      this.emit("journal", { level: "warn", message: `WS closed ${code}` });
      this.scheduleWs();
    });
  }

  private scheduleRest(): void {
    if (this.stopped || this.restTimer) return;
    const delay =
      this.status.restState === "connected" ? Math.max(this.retryDelayMs, 20_000) : Math.max(500, this.retryDelayMs);
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      void this.pollRest();
    }, delay);
  }

  private scheduleWs(): void {
    if (this.stopped || this.wsTimer) return;
    this.status.reconnectCount += 1;
    const delay = Math.max(500, this.retryDelayMs);
    this.wsAttempt += 1;
    this.status.nextRetryAt = new Date(Date.now() + delay).toISOString();
    this.log.warn({ component: "ari", delayMs: delay, attempt: this.wsAttempt }, "ari ws reconnect scheduled");
    writeAriLog("meta", `WS auto-reconnect in ${delay}ms attempt ${this.wsAttempt}`);
    this.emit("journal", { level: "warn", message: `WS auto-reconnect in ${delay}ms (attempt ${this.wsAttempt})` });
    this.wsTimer = setTimeout(() => {
      this.wsTimer = null;
      this.status.nextRetryAt = null;
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

function ariRoot(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return /\/ari$/i.test(base) ? base : `${base}/ari`;
}

function toAriMedia(sound: string): string {
  const s = sound.trim();
  if (!s) return "sound:beep";
  if (s.includes(":")) return s;
  return `sound:${s}`;
}

function redactWs(url: URL): string {
  const copy = new URL(url);
  if (copy.searchParams.has("api_key")) copy.searchParams.set("api_key", "***");
  return copy.toString();
}
