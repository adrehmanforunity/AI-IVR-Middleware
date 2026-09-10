import { EventEmitter } from "node:events";
import net from "node:net";
import type { Logger } from "../logging.js";
import {
  backoffDelay,
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

  private retryDelayMs = 5000;

  constructor(private readonly log: Logger) {
    super();
    this.setMaxListeners(50);
  }

  setRetryDelayMs(ms: number): void {
    this.retryDelayMs = Math.max(500, ms);
  }

  hangup(channel: string, cause = "17"): void {
    this.sendAction({ Action: "Hangup", Channel: channel, Cause: cause });
  }

  start(target: AsteriskTarget): void {
    this.target = target;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.teardownSocket();
    this.status.state = "stopped";
  }

  updateTarget(target: AsteriskTarget): void {
    this.target = target;
  }

  ping(): void {
    this.sendAction({ Action: "Ping" });
  }

  private connect(): void {
    if (this.stopped || !this.target) return;
    this.clearReconnect();
    this.teardownSocket();
    this.status.state = "connecting";
    const { host, amiPort } = this.target;
    this.log.info({ component: "ami", host, port: amiPort }, "ami connecting");

    const socket = net.connect({ host, port: amiPort });
    this.socket = socket;
    this.buffer = "";
    this.loginSent = false;

    socket.setKeepAlive(true, 15_000);
    socket.setTimeout(30_000);

    socket.on("connect", () => {
      this.log.debug({ component: "ami" }, "ami tcp connected, waiting for banner");
    });

    socket.on("data", (chunk) => {
      try {
        this.onData(chunk.toString("utf8"));
      } catch (err) {
        this.log.error({ component: "ami", err }, "ami handler error");
      }
    });

    socket.on("timeout", () => {
      this.fail("ami socket idle timeout");
    });

    socket.on("error", (err) => {
      this.fail(err.message);
    });

    socket.on("close", () => {
      if (this.socket !== socket || this.stopped) return;
      if (this.status.state !== "disconnected") {
        this.fail(this.status.lastError ?? "ami socket closed");
      }
      this.scheduleReconnect();
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
        this.sendLogin();
      }
    }

    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      if (!raw.trim()) continue;
      const msg = parseAmi(raw);
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
      Events: "on",
      ActionID: "login",
    });
  }

  private handleMessage(msg: AmiMessage): void {
    this.status.lastEventAt = new Date().toISOString();
    const response = msg.Response;
    const event = msg.Event;

    if (response) {
      if (msg.ActionID === "login" || (this.status.state === "connecting" && response)) {
        if (response === "Success") {
          this.attempt = 0;
          this.status.state = "connected";
          this.status.lastConnectedAt = new Date().toISOString();
          this.status.lastError = null;
          this.log.info({ component: "ami" }, "ami authenticated");
          this.emit("connected");
        } else {
          this.fail(msg.Message ?? "ami login failed");
          this.teardownSocket();
          this.scheduleReconnect();
        }
      }
      this.emit("response", msg);
      return;
    }

    if (event) {
      this.emit("event", msg);
    }
  }

  private sendAction(fields: AmiMessage): void {
    const sock = this.socket;
    if (!sock || sock.destroyed) return;
    const actionId = fields.ActionID ?? `iim-${this.actionSeq++}`;
    const lines = Object.entries({ ...fields, ActionID: actionId }).map(
      ([k, v]) => `${k}: ${v}`,
    );
    sock.write(`${lines.join("\r\n")}\r\n\r\n`);
  }

  private fail(message: string): void {
    this.status.lastError = message;
    if (this.status.state === "connected" || this.status.state === "connecting") {
      this.status.state = "disconnected";
    }
    this.log.warn({ component: "ami", err: message }, "ami disconnected");
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.status.state = "disconnected";
    this.status.reconnectCount += 1;
    const delay = backoffDelay(this.attempt, this.retryDelayMs);
    this.attempt += 1;
    this.log.warn({ component: "ami", delayMs: delay, attempt: this.attempt }, "ami reconnect scheduled");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
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
