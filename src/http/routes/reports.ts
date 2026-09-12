import type { FastifyInstance } from "fastify";
import type { CallRegistry } from "../../calls/registry.js";
import type { ConfigStore } from "../../db/sqlite.js";
import type { Supervisor } from "../../asterisk/supervisor.js";
import type { ProcessHealth } from "../../processGuards.js";
import type { CallState } from "../../domain/types.js";

const STAGES: CallState[] = ["ringing", "screened", "session", "ivr", "queued", "talking", "ended", "rejected"];

export async function registerReportRoutes(
  app: FastifyInstance,
  opts: {
    store: ConfigStore;
    registry: CallRegistry;
    supervisor: Supervisor;
    processHealth: ProcessHealth;
  },
): Promise<void> {
  app.get(
    "/v1/reports/dashboard",
    {
      schema: {
        tags: ["calls"],
        summary: "Live dashboard + history report (sample data if no traffic yet)",
        security: [{ apiKey: [] }],
      },
    },
    async () => buildDashboard(opts),
  );
}

export function buildDashboard(opts: {
  store: ConfigStore;
  registry: CallRegistry;
  supervisor: Supervisor;
  processHealth: ProcessHealth;
}) {
  const snap = opts.supervisor.snapshot();
  const liveCalls = opts.registry.listActive();
  const liveByState = emptyCounts();
  for (const c of liveCalls) liveByState[c.state] = (liveByState[c.state] ?? 0) + 1;

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = opts.store.sessionHistory(since);
  const usingSample = rows.length === 0;
  const historyRows = usingSample ? sampleHistory() : rows;
  const report = summarize(historyRows);

  return {
    generatedAt: new Date().toISOString(),
    usingSample,
    live: {
      activeCount: liveCalls.length,
      byState: liveByState,
      calls: liveCalls.slice(0, 40),
      setups: snap.setups,
    },
    history: {
      window: usingSample ? "sample (24h illustration)" : "last 24 hours",
      ...report,
    },
    performance: {
      uptimeSeconds: snap.uptimeSeconds,
      processHealthy: opts.processHealth.healthy,
      unhandledErrors: opts.processHealth.unhandledErrors,
      sqlite: snap.sqlite,
      ami: snap.ami,
      ari: snap.ari,
      telephony: snap.telephony,
    },
  };
}

function emptyCounts(): Record<string, number> {
  return Object.fromEntries(STAGES.map((s) => [s, 0]));
}

function summarize(rows: Array<{ state: string; rejectReason: string | null; startedAt: string; endedAt: string | null }>) {
  const byState = emptyCounts();
  const byReject: Record<string, number> = {};
  let durationSum = 0;
  let durationN = 0;
  const hourlyMap = new Map<string, { hour: string; total: number; ended: number; rejected: number }>();

  for (const r of rows) {
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.rejectReason) byReject[r.rejectReason] = (byReject[r.rejectReason] ?? 0) + 1;
    if (r.endedAt) {
      const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt);
      if (Number.isFinite(ms) && ms >= 0) {
        durationSum += ms / 1000;
        durationN += 1;
      }
    }
    const hour = r.startedAt.slice(0, 13) + ":00";
    const slot = hourlyMap.get(hour) ?? { hour, total: 0, ended: 0, rejected: 0 };
    slot.total += 1;
    if (r.state === "ended") slot.ended += 1;
    if (r.state === "rejected") slot.rejected += 1;
    hourlyMap.set(hour, slot);
  }

  const total = rows.length;
  const rejected = byState.rejected ?? 0;
  const ended = byState.ended ?? 0;
  return {
    total,
    ended,
    rejected,
    busy: byReject.busy ?? 0,
    acceptRate: total ? Math.round(((total - rejected) / total) * 1000) / 10 : 0,
    avgDurationSec: durationN ? Math.round(durationSum / durationN) : null,
    byState,
    byReject,
    hourly: [...hourlyMap.values()].slice(-24),
  };
}

function sampleHistory() {
  const now = Date.now();
  const rows: Array<{ state: string; rejectReason: string | null; startedAt: string; endedAt: string | null }> = [];
  const mix: Array<[string, string | null, number]> = [
    ["ended", null, 48],
    ["rejected", "busy", 9],
    ["rejected", "unknown_setup", 4],
    ["rejected", "pulse_timeout", 3],
    ["rejected", "maintenance", 2],
    ["ended", null, 22],
  ];
  let i = 0;
  for (const [state, reason, n] of mix) {
    for (let k = 0; k < n; k += 1) {
      const ago = (i % 20) * 3600_000 + (k % 7) * 60_000;
      const started = new Date(now - ago - 45_000).toISOString();
      const ended = new Date(now - ago).toISOString();
      rows.push({ state, rejectReason: reason, startedAt: started, endedAt: ended });
      i += 1;
    }
  }
  return rows;
}
