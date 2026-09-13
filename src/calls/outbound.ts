import type { OutboundAudience, OutboundRoute } from "../domain/types.js";

export function pickOutboundRoute(routes: OutboundRoute[], who: "robo" | "agents"): OutboundRoute | null {
  const enabled = routes.filter((r) => r.enabled);
  const exact = enabled.find((r) => r.audience === who);
  if (exact) return exact;
  return enabled.find((r) => r.audience === "both") ?? null;
}
