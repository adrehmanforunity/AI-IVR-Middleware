import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging/index.js";
import type { Supervisor } from "../asterisk/supervisor.js";
import type { ProcessHealth } from "../processGuards.js";
import type { HostSampler } from "../ops/host.js";
import { HOST_CRITICAL_PCT } from "../ops/host.js";
import { Mailer } from "./mailer.js";
import { splitEmails } from "./smtp.js";

export class AlertService {
  private readonly lastSent = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAmiOk = true;
  private lastAriOk = true;
  private lastSqliteOk = true;

  private lastHostOver = new Set<string>();

  constructor(
    private readonly store: ConfigStore,
    private readonly mailer: Mailer,
    private readonly log: Logger,
    private readonly host: HostSampler,
  ) {}

  startWatch(supervisor: Supervisor, health: ProcessHealth): void {
    this.stopWatch();
    this.timer = setInterval(() => {
      try {
        this.tick(supervisor, health);
      } catch (err) {
        this.log.error({ component: "alerts", err }, "alert watch tick failed");
      }
    }, 30_000);
    this.timer.unref();
  }

  stopWatch(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  notify(event: string, detail: Record<string, unknown> = {}, audience: "admin" | "both" = "admin"): void {
    void this.send(event, detail, audience).catch((err) =>
      this.log.warn({ component: "alerts", err, event }, "alert send threw"),
    );
  }

  async sendTest(toOverride?: string): Promise<{ ok: boolean; error: string | null }> {
    const cfg = this.store.getSmtp();
    const to = toOverride?.trim()
      ? splitEmails(toOverride)
      : [...splitEmails(cfg.adminTo), ...splitEmails(cfg.businessTo)];
    return this.mailer.send(cfg, {
      to,
      subject: "[IIM] Test message",
      text: `This is a test from Intelligent IVR Middleware at ${new Date().toISOString()}.\nHost is unattended; if you received this, SMTP is working.`,
    });
  }

  private tick(supervisor: Supervisor, health: ProcessHealth): void {
    const snap = supervisor.snapshot();
    const amiWanted = snap.telephony.ami.desired === "connect";
    const ariWanted = snap.telephony.ari.desired === "connect";
    const amiOk = !amiWanted || snap.ami.state === "connected";
    const ariOk = !ariWanted || snap.ari.state === "connected";
    const sqliteOk = snap.sqlite.ok;

    if (amiWanted && this.lastAmiOk && !amiOk) {
      this.notify("ami_down", { state: snap.ami.state, error: snap.ami.lastError }, "admin");
    }
    if (ariWanted && this.lastAriOk && !ariOk) {
      this.notify("ari_down", { state: snap.ari.state, error: snap.ari.lastError, rest: snap.ari.restState, ws: snap.ari.wsState }, "admin");
    }
    if (this.lastSqliteOk && !sqliteOk) {
      this.notify("sqlite_down", { error: snap.sqlite.lastError }, "admin");
    }
    if (!health.healthy) {
      this.notify("process_unhealthy", { unhandledErrors: health.unhandledErrors, lastUnhandledAt: health.lastUnhandledAt }, "admin");
    }

    const host = this.host.snapshot();
    const nowKeys = new Set(host.over.map((o) => `${o.resource}:${o.detail}`));
    for (const item of host.over) {
      const key = `${item.resource}:${item.detail}`;
      if (!this.lastHostOver.has(key)) {
        this.log.error(
          { component: "host", resource: item.resource, pct: item.pct, threshold: HOST_CRITICAL_PCT },
          "host utilization over threshold — critical",
        );
      }
      this.notify(`host_${item.resource}_high`, {
        pct: item.pct,
        threshold: HOST_CRITICAL_PCT,
        detail: item.detail,
        hostname: host.hostname,
      }, "admin");
    }
    this.lastHostOver = nowKeys;

    this.lastAmiOk = amiOk;
    this.lastAriOk = ariOk;
    this.lastSqliteOk = sqliteOk;
  }

  private async send(event: string, detail: Record<string, unknown>, audience: "admin" | "both"): Promise<void> {
    const cfg = this.store.getSmtp();
    if (!cfg.enabled) return;
    const now = Date.now();
    const sendKey = event.startsWith("host_") ? `${event}:${String(detail.detail ?? "")}` : event;
    const last = this.lastSent.get(sendKey) ?? 0;
    if (now - last < cfg.cooldownSec * 1000) return;
    this.lastSent.set(sendKey, now);

    const to = audience === "both" ? [...splitEmails(cfg.adminTo), ...splitEmails(cfg.businessTo)] : splitEmails(cfg.adminTo);
    const lines = Object.entries(detail).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    const result = await this.mailer.send(cfg, {
      to,
      subject: `[IIM] ${event.replace(/_/g, " ")}`,
      text: [`Event: ${event}`, `At: ${new Date().toISOString()}`, "", ...lines].join("\n"),
    });
    if (!result.ok) {
      this.log.warn({ component: "alerts", event, err: result.error }, "critical alert email not sent");
    }
  }
}
