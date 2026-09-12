import { EventEmitter } from "node:events";
import net from "node:net";
import { writeAmiLog, type Logger } from "../logging/index.js";
import {
  emptyLinkStatus,
  type AsteriskTarget,
  type LinkStatus,
} from "./types.js";

type AmiMessage = Record<string, string>;

export class AmiClient extends EventEmitter {
  readonly status: LinkStatus = emptyLinkStatus();
  private socket: net.Socket | null = null;
  private buffer = "";
  private stopped = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private target: AsteriskTarget | null = null;
  private loginSent = false;
  private actionSeq = 1;
  private pingTimer: NodeJS.Timeout | null = null;

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
    this.attempt = 0;
    this.status.nextRetryAt = null;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.teardownSocket();
    this.status.state = "stopped";
    this.emit("journal", { level: "info", message: "Stopped — no retry" });
  }

  updateTarget(target: AsteriskTarget): void {
    this.target = target;
  }

  ping(): void {
    this.sendAction({ Action: "Ping", ActionID: "keepalive" });
  }

  private connect(): void {
    if (this.stopped || !this.target) return;
    this.clearReconnect();
    this.teardownSocket();
    this.status.state = "connecting";
    this.status.nextRetryAt = null;
    const { host, amiPort } = this.target;
    this.log.info({ component: "ami", host, port: amiPort, timeoutMs: this.connectTimeoutMs }, "ami connecting");
    writeAmiLog("meta", `tcp connect ${host}:${amiPort} timeout=${this.connectTimeoutMs}ms`);
    this.emit("journal", { level: "info", message: `Connecting ${host}:${amiPort}` });

    const socket = net.connect({ host, port: amiPort });
    this.socket = socket;
    this.buffer = "";
    this.loginSent = false;

    socket.setKeepAlive(true, 15_000);
    socket.setTimeout(this.connectTimeoutMs);

    socket.on("connect", () => {
      socket.setTimeout(30_000);
      this.log.debug({ component: "ami" }, "ami tcp connected, waiting for banner");
      writeAmiLog("meta", "tcp connected, waiting for banner");
      this.emit("journal", { level: "info", message: `TCP connected ${host}:${amiPort}` });
    });

    socket.on("data", (chunk) => {
      try {
        this.onData(chunk.toString("utf8"));
      } catch (err) {
        this.log.error({ component: "ami", err }, "ami handler error");
      }
    });

    socket.on("timeout", () => {
      this.fail("ami connect/idle timeout");
    });

    socket.on("error", (err) => {
      this.fail(err.message);
    });

    socket.on("close", () => {
      if (this.stopped) return;
      if (this.socket === socket) {
        this.fail(this.status.lastError ?? "ami socket closed");
      }
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    this.buffer = this.buffer.replace(/\r\n/g, "\n");

    if (!this.loginSent && this.buffer.includes("\n")) {
      const firstNl = this.buffer.indexOf("\n");
      const banner = this.buffer.slice(0, firstNl);
      this.buffer = this.buffer.slice(firstNl + 1);
      if (banner.startsWith("Asterisk Call Manager")) {
        writeAmiLog("in", banner);
        this.sendLogin();
      }
    }

    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      if (!raw.trim()) continue;
      const msg = parseAmi(raw);
      if (msg.ActionID !== "keepalive") writeAmiLog("in", raw);
      this.handleMessage(msg);
    }
  }

  private sendLogin(): void {
    if (!this.target) return;
    this.loginSent = true;
    this.sendAction({
      Action: "Login",
      Username: this.target.amiUser,
      Secret: this.target.amiPassword,
      Events: "off",
      ActionID: "login",
    });
  }

  private handleMessage(msg: AmiMessage): void {
    this.status.lastEventAt = new Date().toISOString();
    const response = msg.Response;
    const event = msg.Event;

    if (response) {
      if (msg.ActionID === "keepalive") return;
      if (msg.ActionID === "login" || (this.status.state === "connecting" && response)) {
        if (response === "Success") {
          this.attempt = 0;
          this.status.state = "connected";
          this.status.lastConnectedAt = new Date().toISOString();
          this.status.lastError = null;
          this.log.info({ component: "ami" }, "ami authenticated");
          this.socket?.setTimeout(0);
          this.emit("journal", { level: "info", message: "Authenticated (idle — Events off, not used for calls)" });
          this.emit("connected");
          this.startPing();
        } else {
          this.fail(msg.Message ?? "ami login failed");
        }
      }
      this.emit("response", msg);
      return;
    }

    if (event) {
      this.emit("event", msg);
    }
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => this.ping(), 20_000);
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendAction(fields: AmiMessage): void {
    const sock = this.socket;
    if (!sock || sock.destroyed) return;
    const actionId = fields.ActionID ?? `iim-${this.actionSeq++}`;
    const lines = Object.entries({ ...fields, ActionID: actionId }).map(
      ([k, v]) => `${k}: ${v}`,
    );
    const packet = `${lines.join("\r\n")}\r\n\r\n`;
    if (fields.Action !== "Ping") writeAmiLog("out", lines.join("\n"));
    sock.write(packet);
  }

  private fail(message: string): void {
    if (this.stopped) return;
    const same = this.status.lastError === message && this.status.state === "disconnected" && this.reconnectTimer;
    this.status.lastError = message;
    this.status.state = "disconnected";
    if (!same) {
      this.log.warn({ component: "ami", err: message }, "ami disconnected");
      writeAmiLog("meta", `disconnected ${message}`);
      this.emit("journal", { level: "warn", message });
    }
    this.teardownSocket();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.status.state = "disconnected";
    this.status.reconnectCount += 1;
    const delay = Math.max(500, this.retryDelayMs);
    this.attempt += 1;
    this.status.nextRetryAt = new Date(Date.now() + delay).toISOString();
    this.log.warn({ component: "ami", delayMs: delay, attempt: this.attempt }, "ami reconnect scheduled");
    this.emit("journal", { level: "warn", message: `Auto-reconnect in ${delay}ms (attempt ${this.attempt})` });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.status.nextRetryAt = null;
      this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownSocket(): void {
    this.clearPing();
    const sock = this.socket;
    this.socket = null;
    this.loginSent = false;
    if (!sock) return;
    sock.removeAllListeners();
    try {
      sock.destroy();
    } catch {
      // ignore
    }
  }
}

function parseAmi(block: string): AmiMessage {
  const msg: AmiMessage = {};
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) msg[key] = value;
  }
  return msg;
}
