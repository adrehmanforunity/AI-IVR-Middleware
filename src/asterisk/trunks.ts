import type { AriClient } from "./ari.js";
import { isPjsipTrunkName } from "../calls/match.js";

export type AsteriskTrunkHint = {
  name: string;
  state: string;
  channels: number;
};

export async function readAsteriskTrunks(ari: AriClient): Promise<{
  ok: boolean;
  trunks: AsteriskTrunkHint[];
  endpoints: Array<{ resource: string; state: string; channelIds: string[] }>;
}> {
  const listed = await ari.listPjsipEndpoints();
  const endpoints = listed.ok ? listed.endpoints.filter((ep) => ep.resource) : [];
  const trunks = endpoints
    .filter((ep) => isPjsipTrunkName(ep.resource))
    .map((ep) => ({
      name: ep.resource,
      state: ep.state,
      channels: ep.channelIds.length,
    }));
  return { ok: listed.ok, trunks, endpoints };
}
