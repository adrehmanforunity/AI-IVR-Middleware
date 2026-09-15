import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging/index.js";
import type { PulseApiConfig, PulseApiSlot } from "../domain/types.js";
import { pulseAuthHeaders } from "./auth.js";

export type PulseCallResult<T> = {
  ok: boolean;
  status: number | null;
  data: T | null;
  error: string | null;
  timedOut: boolean;
  mocked: boolean;
};

export class PulseClient {
  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger,
  ) {}

  async invoke<T = Record<string, unknown>>(
    slot: PulseApiSlot,
    body: unknown,
    opts?: { minAttempts?: number; ignoreDisabled?: boolean },
  ): Promise<PulseCallResult<T>> {
    const cfg = this.store.getPulseApi(slot);
    if (!cfg) {
      return fail("pulse api not found");
    }
    if (!cfg.enabled && !opts?.ignoreDisabled) {
      return fail("pulse api disabled");
    }
    if (cfg.mockEnabled) {
      return this.mock<T>(cfg);
    }
    if (!cfg.endpoint.trim()) {
      if (cfg.mockJson.trim() || cfg.mockError.trim()) {
        this.log.info({ component: "pulse", slot: cfg.slot }, "no PULSE URL — using stored mock");
        return this.mock<T>(cfg);
      }
      return fail("pulse api endpoint not configured");
    }

    const attempts = Math.max(1 + Math.max(0, cfg.retries), opts?.minAttempts ?? 1);
    let last: PulseCallResult<T> = fail("not attempted");
    for (let i = 0; i < attempts; i += 1) {
      last = await this.once<T>(cfg, body);
      if (last.ok) return last;
      this.log.warn(
        { component: "pulse", slot: cfg.slot, attempt: i + 1, attempts, err: last.error },
        "pulse attempt failed",
      );
    }
    return last;
  }

  private mock<T>(cfg: PulseApiConfig): PulseCallResult<T> {
    const status = cfg.mockStatus;
    if (cfg.mockError.trim()) {
      this.log.warn({ component: "pulse", slot: cfg.slot, mocked: true }, "pulse mock error");
      return {
        ok: false,
        status: status ?? 500,
        data: null,
        error: cfg.mockError.trim(),
        timedOut: false,
        mocked: true,
      };
    }
    let data: T | null = null;
    if (cfg.mockJson.trim()) {
      try {
        data = unwrapPulseBody(JSON.parse(cfg.mockJson)) as T;
      } catch {
        return fail("mock JSON is invalid", true);
      }
    }
    const code = status ?? 200;
    this.log.info({ component: "pulse", slot: cfg.slot, mocked: true, status: code }, "pulse mock response");
    return {
      ok: code >= 200 && code < 400,
      status: code,
      data,
      error: code >= 400 ? `pulse ${cfg.slot} mock http ${code}` : null,
      timedOut: false,
      mocked: true,
    };
  }

  private async once<T>(cfg: PulseApiConfig, body: unknown): Promise<PulseCallResult<T>> {
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        ...pulseAuthHeaders(this.store.getPulseApiKey()),
      };
      const init: RequestInit = {
        method: cfg.method,
        headers,
        signal: AbortSignal.timeout(cfg.timeoutMs),
      };
      if (cfg.method !== "GET") {
        init.body = JSON.stringify(body);
      }
      const url = cfg.method === "GET" ? withQuery(cfg.endpoint, body) : cfg.endpoint;
      const res = await fetch(url, init);
      const text = await res.text();
      let data: T | null = null;
      if (text) {
        try {
          data = unwrapPulseBody(JSON.parse(text)) as T;
        } catch {
          data = { raw: text } as T;
        }
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          data,
          error: `pulse ${cfg.slot} http ${res.status}`,
          timedOut: false,
          mocked: false,
        };
      }
      return { ok: true, status: res.status, data, error: null, timedOut: false, mocked: false };
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { component: "pulse", slot: cfg.slot, err: message, timedOut, auth: Boolean(this.store.getPulseApiKey()) },
        "pulse call failed",
      );
      return { ok: false, status: null, data: null, error: message, timedOut, mocked: false };
    }
  }
}

function unwrapPulseBody(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const rec = data as Record<string, unknown>;
  if (rec.responseBody != null && typeof rec.responseBody === "object") return rec.responseBody;
  return data;
}

function fail(error: string, mocked = false): PulseCallResult<never> {
  return { ok: false, status: null, data: null, error, timedOut: false, mocked };
}

function withQuery(endpoint: string, body: unknown): string {
  if (!body || typeof body !== "object") return endpoint;
  const url = new URL(endpoint);
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (v == null) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}
