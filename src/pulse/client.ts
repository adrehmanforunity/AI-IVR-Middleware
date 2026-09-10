import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging.js";
import type { PulseApiConfig, PulseApiSlot } from "../domain/types.js";

export type PulseCallResult<T> = {
  ok: boolean;
  status: number | null;
  data: T | null;
  error: string | null;
  timedOut: boolean;
};

export class PulseClient {
  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger,
  ) {}

  async invoke<T = Record<string, unknown>>(
    slot: PulseApiSlot,
    body: unknown,
  ): Promise<PulseCallResult<T>> {
    const cfg = this.store.getPulseApi(slot);
    if (!cfg || !cfg.endpoint.trim()) {
      return {
        ok: false,
        status: null,
        data: null,
        error: "pulse api endpoint not configured",
        timedOut: false,
      };
    }

    const attempts = 1 + Math.max(0, cfg.retries);
    let last: PulseCallResult<T> = {
      ok: false,
      status: null,
      data: null,
      error: "not attempted",
      timedOut: false,
    };

    for (let i = 0; i < attempts; i += 1) {
      last = await this.once<T>(cfg, body);
      if (last.ok) return last;
    }
    return last;
  }

  private async once<T>(cfg: PulseApiConfig, body: unknown): Promise<PulseCallResult<T>> {
    try {
      const init: RequestInit = {
        method: cfg.method,
        headers: { "content-type": "application/json", accept: "application/json" },
        signal: AbortSignal.timeout(cfg.timeoutMs),
      };
      if (cfg.method !== "GET") {
        init.body = JSON.stringify(body);
      }
      const url =
        cfg.method === "GET" ? withQuery(cfg.endpoint, body) : cfg.endpoint;
      const res = await fetch(url, init);
      const text = await res.text();
      let data: T | null = null;
      if (text) {
        try {
          data = JSON.parse(text) as T;
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
        };
      }
      return { ok: true, status: res.status, data, error: null, timedOut: false };
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn({ component: "pulse", slot: cfg.slot, err: message, timedOut }, "pulse call failed");
      return { ok: false, status: null, data: null, error: message, timedOut };
    }
  }
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
