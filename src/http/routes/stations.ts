import type { FastifyInstance } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { Supervisor } from "../../asterisk/supervisor.js";
import { userFromRequest } from "./auth.js";
import { isAppStation } from "../../calls/match.js";
import { paginateStations } from "../../stations/board.js";

export async function registerStationRoutes(
  app: FastifyInstance,
  supervisor: Supervisor,
  store: ConfigStore,
): Promise<void> {
  app.get(
    "/v1/stations",
    {
      schema: {
        tags: ["stations"],
        summary: "IIM-owned extensions (paged). Range is Telephony Setup. ARI snapshot cached ~4s.",
        security: [{ apiKey: [] }],
        querystring: {
          type: "object",
          properties: {
            page: { type: "string" },
            pageSize: { type: "string" },
            status: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const q = req.query as { page?: string; pageSize?: string; status?: string };
      const board = await supervisor.stationsBoard();
      return paginateStations(board, q.page, q.pageSize, q.status);
    },
  );

  app.put(
    "/v1/stations/:extension",
    {
      schema: {
        tags: ["stations"],
        summary: "Set display name / agent id / notes for an IIM station (SQLite directory)",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { extension: { type: "string" } } },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            displayName: { type: "string" },
            agentId: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const extension = String((req.params as { extension: string }).extension ?? "").trim();
      const range = store.getTelephony().ownedExtensions;
      if (!isAppStation(extension, range)) {
        return reply.code(400).send({ error: `extension must be in IIM range ${range.from}–${range.to}` });
      }
      const body = req.body as { displayName?: string; agentId?: string; notes?: string };
      const actor = userFromRequest(req, store)?.username ?? "api-key";
      return store.putStation(extension, body, actor);
    },
  );
}
