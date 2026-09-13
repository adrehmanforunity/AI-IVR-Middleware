export type SmtpSecurity = "none" | "starttls" | "tls";
export type SmtpAuth = "none" | "login";

export type SmtpConfig = {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  auth: SmtpAuth;
  user: string;
  password: string;
  from: string;
  fromName: string;
  replyTo: string;
  helo: string;
  timeoutMs: number;
  rejectUnauthorized: boolean;
  adminTo: string;
  businessTo: string;
  cooldownSec: number;
};

export type PublicSmtpConfig = Omit<SmtpConfig, "password"> & { passwordSet: boolean };

export const SMTP_DEFAULTS: SmtpConfig = {
  enabled: false,
  host: "",
  port: 587,
  security: "starttls",
  auth: "login",
  user: "",
  password: "",
  from: "",
  fromName: "IIM",
  replyTo: "",
  helo: "",
  timeoutMs: 15000,
  rejectUnauthorized: true,
  adminTo: "",
  businessTo: "",
  cooldownSec: 600,
};

export const SMTP_SETTING_KEYS = {
  enabled: "smtp_enabled",
  host: "smtp_host",
  port: "smtp_port",
  security: "smtp_security",
  auth: "smtp_auth",
  user: "smtp_user",
  password: "smtp_password",
  from: "smtp_from",
  fromName: "smtp_from_name",
  replyTo: "smtp_reply_to",
  helo: "smtp_helo",
  timeoutMs: "smtp_timeout_ms",
  rejectUnauthorized: "smtp_reject_unauthorized",
  adminTo: "smtp_admin_to",
  businessTo: "smtp_business_to",
  cooldownSec: "smtp_cooldown_sec",
} as const;

export function parseSmtp(settings: Record<string, string>): SmtpConfig {
  const s = SMTP_SETTING_KEYS;
  const security = settings[s.security];
  const auth = settings[s.auth];
  return {
    enabled: settings[s.enabled] === "1",
    host: (settings[s.host] ?? "").trim(),
    port: clampInt(settings[s.port], SMTP_DEFAULTS.port, 1, 65535),
    security: security === "none" || security === "tls" ? security : "starttls",
    auth: auth === "none" ? "none" : "login",
    user: (settings[s.user] ?? "").trim(),
    password: settings[s.password] ?? "",
    from: (settings[s.from] ?? "").trim(),
    fromName: (settings[s.fromName] ?? SMTP_DEFAULTS.fromName).trim() || "IIM",
    replyTo: (settings[s.replyTo] ?? "").trim(),
    helo: (settings[s.helo] ?? "").trim(),
    timeoutMs: clampInt(settings[s.timeoutMs], SMTP_DEFAULTS.timeoutMs, 1000, 120000),
    rejectUnauthorized: settings[s.rejectUnauthorized] !== "0",
    adminTo: (settings[s.adminTo] ?? "").trim(),
    businessTo: (settings[s.businessTo] ?? "").trim(),
    cooldownSec: clampInt(settings[s.cooldownSec], SMTP_DEFAULTS.cooldownSec, 60, 86400),
  };
}

export function publicSmtp(cfg: SmtpConfig): PublicSmtpConfig {
  const { password, ...rest } = cfg;
  return { ...rest, passwordSet: Boolean(password) };
}

export function splitEmails(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (!e || !e.includes("@") || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
