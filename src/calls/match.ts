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
