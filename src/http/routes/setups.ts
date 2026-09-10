import type { FastifyInstance } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { CallRegistry } from "../../calls/registry.js";

function actor(req: { headers: Record<string, unknown> }): string {
  return typeof req.headers["x-api-key"] === "string" ? "api-key" : "unknown";
}

const setupBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    enabled: { type: "boolean" },
    matchDid: { type: "string", description: "DID to accept, empty = any" },
    matchTrunk: { type: "string", description: "Trunk name to accept, empty = any" },
    maxConcurrent: { type: "number", minimum: 1 },
  },
};

export async function registerSetupRoutes(
  app: FastifyInstance,
  store: ConfigStore,
  registry: CallRegistry,
): Promise<void> {
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
      };
      if (!body.matchDid && !body.matchTrunk) {
        return reply.code(400).send({ error: "matchDid or matchTrunk is required" });
      }
      try {
        return store.createSetup(body, actor(req));
      } catch (err) {
        return reply.code(503).send({ error: err instanceof Error ? err.message : String(err) });
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
        return store.updateSetup(id, req.body as object, actor(req));
      } catch (err) {
        const code = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
