import type { FastifyInstance } from "fastify";
import type { CallRegistry } from "../../calls/registry.js";
import type { ConfigStore } from "../../db/sqlite.js";
import type { Supervisor } from "../../asterisk/supervisor.js";
import type { ProcessHealth } from "../../processGuards.js";
import type { CallState } from "../../domain/types.js";
import type { HostSampler } from "../../ops/host.js";
import { isPjsipTrunkName } from "../../calls/match.js";

const STAGES: CallState[] = ["ringing", "screened", "session", "ivr", "queued", "talking", "ended", "rejected"];
const BRIEF_SEC = 15;
const ROLLUP_LIMIT = 12;

type HistoryRow = {
  state: string;
  rejectReason: string | null;
  startedAt: string;
  endedAt: string | null;
  did: string;
  trunk: string;
};

export async function registerReportRoutes(
  app: FastifyInstance,
  opts: {
    store: ConfigStore;
    registry: CallRegistry;
    supervisor: Supervisor;
    processHealth: ProcessHealth;
    host: HostSampler;
  },
): Promise<void> {
  app.get(
    "/v1/reports/dashboard",
    {
      schema: {
        tags: ["calls"],
        summary: "Live dashboard + 24h ops report (sample data if no traffic yet)",
        security: [{ apiKey: [] }],
      },
    },
    async () => buildDashboard(opts),
  );
}

export async function buildDashboard(opts: {
  store: ConfigStore;
  registry: CallRegistry;
  supervisor: Supervisor;
  processHealth: ProcessHealth;
  host: HostSampler;
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

  const stations = await opts.supervisor.stationsBoard();
  const pjsip = await opts.supervisor.pjsipEndpoints();
  const outbound = opts.store.listOutboundRoutes();
  const outboundByTrunk = new Map(outbound.filter((r) => r.enabled).map((r) => [r.trunk, r.name]));
  const liveByDid = countLive(liveCalls, (c) => c.did || "(none)");
  const liveByTrunk = countLive(liveCalls, (c) => c.trunk || "(none)");
  const trunks = (pjsip.endpoints ?? [])
    .filter((ep) => isPjsipTrunkName(ep.resource))
    .map((ep) => {
      const hist = report.byTrunk.find((t) => t.key === ep.resource);
      return {
        name: ep.resource,
        state: ep.state,
        liveChannels: ep.channelIds.length,
        liveCalls: liveByTrunk.get(ep.resource) ?? 0,
        volume24h: hist?.total ?? 0,
        aicb24h: hist?.aicb ?? 0,
        outboundRoute: outboundByTrunk.get(ep.resource) ?? null,
      };
    })
    .sort((a, b) => b.liveChannels - a.liveChannels || b.volume24h - a.volume24h);

  const dids = report.byDid.map((d) => ({
    ...d,
    live: liveByDid.get(d.key) ?? 0,
  }));

  const host = opts.host.snapshot();
  const setupsAtCap = snap.setups.filter((s) => s.maxConcurrent > 0 && s.activeCount >= s.maxConcurrent);
  const criticalCount =
    (opts.processHealth.unhandledErrors ?? 0) +
    (snap.sqlite.ok ? 0 : 1) +
    (snap.telephony.ami.desired === "connect" && snap.ami.state !== "connected" ? 1 : 0) +
    (snap.telephony.ari.desired === "connect" && snap.ari.state !== "connected" ? 1 : 0) +
    host.over.length;

  return {
    generatedAt: new Date().toISOString(),
    usingSample,
    live: {
      activeCount: liveCalls.length,
      byState: liveByState,
      calls: liveCalls.slice(0, 40),
      setups: snap.setups,
      setupsAtCap: setupsAtCap.length,
    },
    history: {
      window: usingSample ? "sample (24h illustration)" : "last 24 hours",
      ...report,
      byDid: dids,
    },
    stations: {
      range: stations.range,
      ariOk: stations.ariOk,
      counts: stations.counts,
      listed: stations.listed,
    },
    trunks: {
      ariOk: pjsip.ok,
      items: trunks,
      online: trunks.filter((t) => t.state === "online").length,
      inUse: trunks.filter((t) => t.liveChannels > 0).length,
    },
    performance: {
      uptimeSeconds: snap.uptimeSeconds,
      processHealthy: opts.processHealth.healthy,
      unhandledErrors: opts.processHealth.unhandledErrors,
      lastUnhandledAt: opts.processHealth.lastUnhandledAt,
      sqlite: snap.sqlite,
      ami: snap.ami,
      ari: snap.ari,
      telephony: snap.telephony,
      criticalNow: criticalCount,
      host,
      linkFlaps: {
        ami: snap.ami.reconnectCount ?? 0,
        ari: snap.ari.reconnectCount ?? 0,
      },
    },
  };
}

function countLive<T extends { did: string; trunk: string }>(calls: T[], key: (c: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of calls) {
    const k = key(c);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function emptyCounts(): Record<string, number> {
  return Object.fromEntries(STAGES.map((s) => [s, 0]));
}

function durationSec(r: HistoryRow): number | null {
  if (!r.endedAt) return null;
  const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 1000;
}

function rollup(rows: HistoryRow[], keyOf: (r: HistoryRow) => string) {
  const map = new Map<
    string,
    { key: string; total: number; ended: number; rejected: number; aicb: number; durationSum: number; durationN: number }
  >();
  for (const r of rows) {
    const key = keyOf(r).trim() || "(none)";
    const slot = map.get(key) ?? { key, total: 0, ended: 0, rejected: 0, aicb: 0, durationSum: 0, durationN: 0 };
    slot.total += 1;
    if (r.state === "ended") slot.ended += 1;
    if (r.state === "rejected") slot.rejected += 1;
    if (r.rejectReason === "aicb") slot.aicb += 1;
    const d = durationSec(r);
    if (d != null) {
      slot.durationSum += d;
      slot.durationN += 1;
    }
    map.set(key, slot);
  }
  return [...map.values()]
    .map((s) => ({
      key: s.key,
      total: s.total,
      ended: s.ended,
      rejected: s.rejected,
      aicb: s.aicb,
      avgDurationSec: s.durationN ? Math.round(s.durationSum / s.durationN) : null,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, ROLLUP_LIMIT);
}

function summarize(rows: HistoryRow[]) {
  const byState = emptyCounts();
  const byReject: Record<string, number> = {};
  let durationSum = 0;
  let durationN = 0;
  let brief = 0;
  const hourlyMap = new Map<string, { hour: string; total: number; ended: number; rejected: number; aicb: number }>();

  for (const r of rows) {
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.rejectReason) byReject[r.rejectReason] = (byReject[r.rejectReason] ?? 0) + 1;
    const d = durationSec(r);
    if (d != null) {
      durationSum += d;
      durationN += 1;
      if (d < BRIEF_SEC) brief += 1;
    }
    const hour = r.startedAt.slice(0, 13) + ":00";
    const slot = hourlyMap.get(hour) ?? { hour, total: 0, ended: 0, rejected: 0, aicb: 0 };
    slot.total += 1;
    if (r.state === "ended") slot.ended += 1;
    if (r.state === "rejected") slot.rejected += 1;
    if (r.rejectReason === "aicb") slot.aicb += 1;
    hourlyMap.set(hour, slot);
  }

  const total = rows.length;
  const rejected = byState.rejected ?? 0;
  const ended = byState.ended ?? 0;
  const aicb = byReject.aicb ?? 0;
  return {
    total,
    ended,
    rejected,
    busy: (byReject.busy ?? 0) + aicb,
    aicb,
    briefCalls: brief,
    briefSec: BRIEF_SEC,
    acceptRate: total ? Math.round(((total - rejected) / total) * 1000) / 10 : 0,
    avgDurationSec: durationN ? Math.round(durationSum / durationN) : null,
    disconnectRate: total ? Math.round(((ended + rejected) / total) * 1000) / 10 : 0,
    byState,
    byReject,
    byDid: rollup(rows, (r) => r.did),
    byTrunk: rollup(rows, (r) => r.trunk),
    hourly: [...hourlyMap.values()].slice(-24),
  };
}

function sampleHistory(): HistoryRow[] {
  const now = Date.now();
  const mix: Array<[string, string | null, string, string, number]> = [
    ["ended", null, "7777", "provider-a", 36],
    ["ended", null, "8001", "provider-a", 18],
    ["rejected", "aicb", "7777", "provider-a", 9],
    ["rejected", "unknown_setup", "8001", "provider-b", 4],
    ["rejected", "pulse_timeout", "7777", "provider-a", 3],
    ["rejected", "maintenance", "8001", "provider-b", 2],
    ["ended", null, "7777", "provider-b", 16],
  ];
  const rows: HistoryRow[] = [];
  let i = 0;
  for (const [state, reason, did, trunk, n] of mix) {
    for (let k = 0; k < n; k += 1) {
      const ago = (i % 20) * 3600_000 + (k % 7) * 60_000;
      const started = new Date(now - ago - (reason ? 8_000 : 45_000)).toISOString();
      const ended = new Date(now - ago).toISOString();
      rows.push({ state, rejectReason: reason, startedAt: started, endedAt: ended, did, trunk });
      i += 1;
    }
  }
  return rows;
}
