import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { CallRegistry } from "../../calls/registry.js";
import { userFromRequest } from "./auth.js";

const setupBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    enabled: { type: "boolean" },
    matchDid: { type: "string", description: "DID to accept, empty = any trunk DID" },
    matchTrunk: { type: "string", description: "Trunk/endpoint name, empty = any" },
    maxConcurrent: { type: "number", minimum: 1 },
    ivrId: { type: "number", nullable: true, description: "IVR to run after admit" },
    postCallSurveyEnabled: {
      type: "boolean",
      description: "CSAT after the agent hangs up. Reuses the live Pulse interaction/session.",
    },
    postCallSurveyIvrId: { type: "number", nullable: true, description: "IVR used only for post-call CSAT" },
  },
};

export async function registerSetupRoutes(
  app: FastifyInstance,
  store: ConfigStore,
  registry: CallRegistry,
): Promise<void> {
  const who = (req: FastifyRequest) => userFromRequest(req, store)?.username ?? "api-key";

  app.get(
    "/v1/setups",
    {
      schema: {
        tags: ["setups"],
        summary: "Call management setups with live channel counts",
        security: [{ apiKey: [] }],
      },
    },
    async () => registry.setupsWithCounts(),
  );

  app.get(
    "/v1/setups/:id/calls",
    {
      schema: {
        tags: ["setups"],
        summary: "Live calls on this inbound route (caller, DID, interaction, language, menu)",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const setup = store.getSetup(id);
      if (!setup) return reply.code(404).send({ error: "unknown inbound route" });
      const live = registry.setupsWithCounts().find((s) => s.id === id);
      const calls = registry.occupyingOnSetup(id);
      return {
        setup: live ?? { ...setup, activeCount: calls.length, draining: !setup.enabled },
        calls,
      };
    },
  );

  app.post(
    "/v1/setups",
    {
      schema: {
        tags: ["setups"],
        summary: "Create a DID/trunk setup (channel cap + new-call enable)",
        security: [{ apiKey: [] }],
        body: { ...setupBody, required: ["name"] },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        name: string;
        enabled?: boolean;
        matchDid?: string;
        matchTrunk?: string;
        maxConcurrent?: number;
        ivrId?: number | null;
        postCallSurveyEnabled?: boolean;
        postCallSurveyIvrId?: number | null;
      };
      if (!body.matchDid?.trim() && !body.matchTrunk?.trim()) {
        return reply.code(400).send({ error: "matchDid or matchTrunk is required" });
      }
      try {
        return store.createSetup(body, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    "/v1/setups/:id",
    {
      schema: {
        tags: ["setups"],
        summary: "Update a setup (enable=false drains new calls; AMI/ARI stay up)",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
        body: setupBody,
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        return store.updateSetup(id, req.body as object, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === "NOT_FOUND" ? 404 : code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete(
    "/v1/setups/:id",
    {
      schema: {
        tags: ["setups"],
        summary: "Remove a call setup",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        store.deleteSetup(id, who(req));
        return { ok: true, id };
      } catch (err) {
        const code = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
