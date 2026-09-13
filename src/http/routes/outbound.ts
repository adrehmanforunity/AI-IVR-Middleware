import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { Supervisor } from "../../asterisk/supervisor.js";
import type { OutboundRouteInput } from "../../domain/types.js";
import { userFromRequest } from "./auth.js";
import { readAsteriskTrunks } from "../../asterisk/trunks.js";

const bodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    trunk: { type: "string" },
    audience: { type: "string", enum: ["robo", "agents", "both"] },
    enabled: { type: "boolean" },
  },
};

export async function registerOutboundRoutes(
  app: FastifyInstance,
  store: ConfigStore,
  supervisor: Supervisor,
): Promise<void> {
  const who = (req: FastifyRequest) => userFromRequest(req, store)?.username ?? "api-key";

  app.get(
    "/v1/outbound-routes",
    {
      schema: {
        tags: ["outbound"],
        summary: "Outbound trunks for robo, agents, or both. Asterisk list is reference only.",
        security: [{ apiKey: [] }],
      },
    },
    async () => {
      const listed = await readAsteriskTrunks(supervisor.ari);
      const byName = new Map(listed.endpoints.map((ep) => [ep.resource, ep]));
      const routes = store.listOutboundRoutes().map((r) => {
        const live = byName.get(r.trunk);
        return {
          ...r,
          trunkStatus: live ? live.state : listed.ok ? "not on Asterisk" : "unknown",
        };
      });
      return {
        routes,
        asteriskOk: listed.ok,
        asteriskTrunks: listed.trunks,
      };
    },
  );

  app.post(
    "/v1/outbound-routes",
    {
      schema: {
        tags: ["outbound"],
        summary: "Create an outbound route",
        security: [{ apiKey: [] }],
        body: { ...bodySchema, required: ["name", "trunk"] },
      },
    },
    async (req, reply) => {
      try {
        return store.createOutboundRoute(req.body as OutboundRouteInput, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    "/v1/outbound-routes/:id",
    {
      schema: {
        tags: ["outbound"],
        summary: "Update an outbound route",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
        body: bodySchema,
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        return store.updateOutboundRoute(id, req.body as Partial<OutboundRouteInput>, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === "NOT_FOUND" ? 404 : code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete(
    "/v1/outbound-routes/:id",
    {
      schema: {
        tags: ["outbound"],
        summary: "Delete an outbound route",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        store.deleteOutboundRoute(id, who(req));
        return { ok: true, id };
      } catch (err) {
        const code = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}

