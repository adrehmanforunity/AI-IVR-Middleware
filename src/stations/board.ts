import type { CallSession } from "../domain/types.js";
import { endpointFromChannel } from "../calls/match.js";

export const MAX_STATION_ROWS = 2000;
export const STATIONS_CACHE_MS = 4000;
export const STATION_PAGE_SIZE = 50;
export const STATION_PAGE_SIZE_MAX = 100;

export type AriEndpointHint = {
  resource: string;
  state: string;
  channelIds: string[];
};

export type StationDirectoryRow = {
  extension: string;
  displayName: string;
  agentId: string;
  notes: string;
};

export type StationLive = {
  state: string;
  callerId: string;
  did: string;
  internalId: string;
  agentId: string | null;
};

export type StationRow = {
  extension: string;
  displayName: string;
  agentId: string;
  notes: string;
  pbx: "missing" | "offline" | "online" | "unknown";
  status: "not-on-pbx" | "unregistered" | "idle" | "in-use" | "unknown";
  channelCount: number;
  live: StationLive | null;
};

export type StationsBoard = {
  range: { from: number; to: number };
  listed: number;
  truncated: boolean;
  ariOk: boolean;
  refreshedAt: string;
  counts: { online: number; idle: number; inUse: number; unregistered: number; missing: number };
  stations: StationRow[];
};

export type StationsPage = StationsBoard & {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  status: string;
};

export function paginateStations(
  board: StationsBoard,
  pageRaw: unknown,
  sizeRaw: unknown,
  statusRaw: unknown,
): StationsPage {
  const allowed = new Set(["all", "idle", "in-use", "unregistered", "not-on-pbx", "unknown"]);
  const status = typeof statusRaw === "string" && allowed.has(statusRaw) ? statusRaw : "all";
  const filtered = status === "all" ? board.stations : board.stations.filter((s) => s.status === status);
  const pageSize = clampInt(Number(sizeRaw), STATION_PAGE_SIZE, 10, STATION_PAGE_SIZE_MAX);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const page = clampInt(Number(pageRaw), 1, 1, pages);
  const start = (page - 1) * pageSize;
  return {
    ...board,
    stations: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    pages,
    status,
  };
}

function clampInt(n: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(n) || n < min) return fallback < min ? min : fallback;
  if (n > max) return max;
  return Math.floor(n);
}

export function buildStationsBoard(input: {
  range: { from: number; to: number };
  endpoints: AriEndpointHint[] | null;
  directory: StationDirectoryRow[];
  calls: CallSession[];
}): StationsBoard {
  const { from, to } = input.range;
  const span = to - from + 1;
  const truncated = span > MAX_STATION_ROWS;
  const last = truncated ? from + MAX_STATION_ROWS - 1 : to;
  const byExt = new Map<string, AriEndpointHint>();
  for (const ep of input.endpoints ?? []) {
    const res = String(ep.resource ?? "").trim();
    if (!/^\d+$/.test(res)) continue;
    byExt.set(res, ep);
  }
  const dir = new Map(input.directory.map((d) => [d.extension, d]));
  const callsByExt = new Map<string, CallSession>();
  for (const call of input.calls) {
    const keys = new Set<string>();
    if (call.agentExtension && /^\d+$/.test(call.agentExtension.trim())) {
      keys.add(call.agentExtension.trim());
    }
    const ep = endpointFromChannel(call.channel);
    if (/^\d+$/.test(ep)) keys.add(ep);
    for (const k of keys) {
      if (!callsByExt.has(k)) callsByExt.set(k, call);
    }
  }

  const stations: StationRow[] = [];
  const counts = { online: 0, idle: 0, inUse: 0, unregistered: 0, missing: 0 };
  for (let n = from; n <= last; n++) {
    const extension = String(n);
    const ep = byExt.get(extension);
    const info = dir.get(extension);
    const call = callsByExt.get(extension);
    const pbx = input.endpoints == null ? "unknown" : pbxFromAri(ep);
    const channelCount = ep?.channelIds.length ?? 0;
    const status = statusFrom(pbx, channelCount, Boolean(call));
    if (pbx === "online") counts.online += 1;
    if (status === "idle") counts.idle += 1;
    if (status === "in-use") counts.inUse += 1;
    if (status === "unregistered") counts.unregistered += 1;
    if (status === "not-on-pbx") counts.missing += 1;
    stations.push({
      extension,
      displayName: info?.displayName ?? "",
      agentId: info?.agentId ?? "",
      notes: info?.notes ?? "",
      pbx,
      status,
      channelCount,
      live: call
        ? {
            state: call.state,
            callerId: call.callerId,
            did: call.did,
            internalId: call.internalId,
            agentId: call.agentId,
          }
        : null,
    });
  }

  return {
    range: { from, to },
    listed: stations.length,
    truncated,
    ariOk: input.endpoints != null,
    refreshedAt: new Date().toISOString(),
    counts,
    stations,
  };
}

function pbxFromAri(ep: AriEndpointHint | undefined): StationRow["pbx"] {
  if (!ep) return "missing";
  const s = (ep.state || "").toLowerCase();
  if (s === "online") return "online";
  if (s === "offline") return "offline";
  return "unknown";
}

function statusFrom(pbx: StationRow["pbx"], channelCount: number, iimCall: boolean): StationRow["status"] {
  if (iimCall || channelCount > 0) return "in-use";
  if (pbx === "missing") return "not-on-pbx";
  if (pbx === "offline") return "unregistered";
  if (pbx === "online") return "idle";
  return "unknown";
}
