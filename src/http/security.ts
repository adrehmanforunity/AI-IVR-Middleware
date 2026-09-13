import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../config/env.js";

export const SESSION_COOKIE = "iim_sid";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;

export function cookieOpts(env: Env) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.COOKIE_SECURE,
    signed: true,
  };
}

export function sessionTokenFromRequest(req: FastifyRequest): string | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return unsigned.value;
}

export function csrfTokenForSession(env: Env, sessionToken: string): string {
  return createHmac("sha256", env.API_KEY).update(sessionToken).digest("hex");
}

export function csrfMatches(env: Env, sessionToken: string, header: unknown): boolean {
  if (typeof header !== "string" || header.length === 0) return false;
  const expected = csrfTokenForSession(env, sessionToken);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function originAllowed(req: FastifyRequest): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

export function isMutatingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export function wantsHtml(req: FastifyRequest): boolean {
  const accept = req.headers.accept ?? "";
  return accept.includes("text/html");
}

export function applySecurityHeaders(req: FastifyRequest, reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "same-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const path = requestPath(req);
  if (!path.startsWith("/docs")) {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  if (isUiHtmlPath(path) || path === "/") {
    reply.header("Cache-Control", "no-store");
  }
}

export function requestPath(req: FastifyRequest): string {
  return (req.url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
}

export function isUiHtmlPath(path: string): boolean {
  return (
    path === "/app" ||
    path === "/setups" ||
    path === "/outbound" ||
    path === "/ivrs" ||
    path === "/ivrs/flow" ||
    path === "/functions" ||
    path === "/pulse" ||
    path === "/telephony" ||
    path === "/stations" ||
    path === "/alerts" ||
    path === "/logs"
  );
}

export function isDocsPath(path: string): boolean {
  return path === "/docs" || path.startsWith("/docs/");
}

export function isPublicPath(method: string, path: string): boolean {
  if (path === "/health" || path === "/ready") return true;
  if (path.startsWith("/css/") || path.startsWith("/js/") || path.startsWith("/vendor/")) return true;
  if (method === "GET" || method === "HEAD") {
    if (path === "/") return true;
  }
  if (method === "POST" && path === "/auth/login") return true;
  return false;
}

export class LoginLimiter {
  private hits = new Map<string, { n: number; reset: number }>();

  tooMany(ip: string, username: string): boolean {
    this.prune();
    const row = this.hits.get(this.key(ip, username));
    if (!row) return false;
    if (Date.now() > row.reset) {
      this.hits.delete(this.key(ip, username));
      return false;
    }
    return row.n >= LOGIN_MAX_FAILS;
  }

  fail(ip: string, username: string): void {
    const k = this.key(ip, username);
    const now = Date.now();
    const row = this.hits.get(k);
    if (!row || now > row.reset) {
      this.hits.set(k, { n: 1, reset: now + LOGIN_WINDOW_MS });
      return;
    }
    row.n += 1;
  }

  ok(ip: string, username: string): void {
    this.hits.delete(this.key(ip, username));
  }

  private key(ip: string, username: string): string {
    return `${ip}\0${username.trim().toLowerCase()}`;
  }

  private prune(): void {
    if (this.hits.size < 500) return;
    const now = Date.now();
    for (const [k, v] of this.hits) {
      if (now > v.reset) this.hits.delete(k);
    }
  }
}
