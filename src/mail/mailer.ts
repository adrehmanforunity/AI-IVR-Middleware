import nodemailer from "nodemailer";
import type { Logger } from "../logging/index.js";
import type { SmtpConfig } from "./smtp.js";
import { splitEmails } from "./smtp.js";

export class Mailer {
  constructor(private readonly log: Logger) {}

  async send(cfg: SmtpConfig, opts: { to: string[]; subject: string; text: string }): Promise<{ ok: boolean; error: string | null }> {
    if (!cfg.enabled) return { ok: false, error: "SMTP is disabled" };
    if (!cfg.host.trim()) return { ok: false, error: "SMTP host is empty" };
    if (!cfg.from.trim()) return { ok: false, error: "From address is empty" };
    const to = [...new Set(opts.to.flatMap((t) => splitEmails(t)))];
    if (!to.length) return { ok: false, error: "No recipients" };

    const secure = cfg.security === "tls";
    const port = cfg.port;
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port,
      secure,
      name: cfg.helo || undefined,
      auth: cfg.auth === "login" && cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
      connectionTimeout: cfg.timeoutMs,
      greetingTimeout: cfg.timeoutMs,
      socketTimeout: cfg.timeoutMs,
      requireTLS: cfg.security === "starttls",
      ignoreTLS: cfg.security === "none",
      tls: { rejectUnauthorized: cfg.rejectUnauthorized },
    });

    try {
      await transporter.sendMail({
        from: cfg.fromName ? `"${cfg.fromName.replace(/"/g, "")}" <${cfg.from}>` : cfg.from,
        to: to.join(", "),
        replyTo: cfg.replyTo || undefined,
        subject: opts.subject,
        text: opts.text,
      });
      this.log.info({ component: "mail", toCount: to.length, subject: opts.subject }, "SMTP sent");
      return { ok: true, error: null };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.warn({ component: "mail", err: error }, "SMTP send failed");
      return { ok: false, error };
    } finally {
      transporter.close();
    }
  }
}
