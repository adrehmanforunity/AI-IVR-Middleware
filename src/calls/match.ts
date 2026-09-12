import type { CallSetup } from "../domain/types.js";

export function matchSetup(did: string, trunk: string, setups: CallSetup[]): CallSetup | null {
  const scored: Array<{ setup: CallSetup; score: number }> = [];
  for (const setup of setups) {
    if (!setup.matchDid && !setup.matchTrunk) continue;
    const didOk = !setup.matchDid || setup.matchDid === did;
    const trunkOk = !setup.matchTrunk || setup.matchTrunk === trunk;
    if (!didOk || !trunkOk) continue;
    const score = (setup.matchDid ? 2 : 0) + (setup.matchTrunk ? 1 : 0);
    scored.push({ setup, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.setup ?? null;
}

const INBOUND_TECH = /^(PJSIP|SIP|IAX2|DAHDI|Zap|DAHDI)\//i;

export function isInboundChannel(channel: string): boolean {
  return INBOUND_TECH.test(channel) && !channel.startsWith("Local/");
}

export function trunkFromChannel(channel: string): string {
  const slash = channel.indexOf("/");
  if (slash === -1) return channel;
  const rest = channel.slice(slash + 1);
  const dash = rest.lastIndexOf("-");
  return dash === -1 ? rest : rest.slice(0, dash);
}

export function usableDid(exten: string | undefined): string {
  const v = (exten ?? "").trim();
  if (!v || v === "s" || v === "h" || v === "i" || v === "t" || v === "hangup") return "";
  return v;
}

export const DEFAULT_OWNED_EXT_FROM = 3001;
export const DEFAULT_OWNED_EXT_TO = 3999;

export function parseOwnedExtensions(fromRaw: unknown, toRaw: unknown): { from: number; to: number } {
  const from = clampExt(fromRaw, DEFAULT_OWNED_EXT_FROM);
  const to = clampExt(toRaw, DEFAULT_OWNED_EXT_TO);
  return from <= to ? { from, to } : { from: to, to: from };
}

function clampExt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < 0 || n > 999999) return fallback;
  return n;
}

/** PBX station number from PJSIP/2098-00000001 → 2098. Trunk names stay non-numeric. */
export function endpointFromChannel(channel: string): string {
  return trunkFromChannel(channel);
}

/** True when the PJSIP/SIP endpoint is an IIM station (default 3001–3999), not a trunk or other phone. */
export function isAppStation(endpoint: string, range: { from: number; to: number }): boolean {
  const v = (endpoint ?? "").trim();
  if (!/^\d+$/.test(v)) return false;
  const n = Number(v);
  return n >= range.from && n <= range.to;
}

/** Other PBX phones (e.g. 2098). Trunks like ptcl-pri are not stations. */
export function isForeignStation(channel: string, range: { from: number; to: number }): boolean {
  const endpoint = endpointFromChannel(channel);
  if (!/^\d+$/.test(endpoint)) return false;
  return !isAppStation(endpoint, range);
}
