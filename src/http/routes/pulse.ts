import type { FastifyInstance } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { PulseApiSlot } from "../../domain/types.js";

function actor(req: { headers: Record<string, unknown> }): string {
  return typeof req.headers["x-api-key"] === "string" ? "api-key" : "unknown";
}

const SLOTS: PulseApiSlot[] = ["preAnswer", "startSession"];

export async function registerPulseRoutes(app: FastifyInstance, store: ConfigStore): Promise<void> {
  app.get(
    "/v1/pulse/apis",
    {
      schema: {
        tags: ["pulse"],
        summary: "Per-stage PULSE REST configs (endpoint, timeout, retries)",
        security: [{ apiKey: [] }],
      },
    },
    async () => store.listPulseApis(),
  );

  app.put(
    "/v1/pulse/apis/:slot",
    {
      schema: {
        tags: ["pulse"],
        summary: "Update one PULSE API slot. Default timeout 5000ms, retries 0.",
        security: [{ apiKey: [] }],
        params: {
          type: "object",
          properties: { slot: { type: "string", enum: SLOTS } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH"] },
            endpoint: { type: "string" },
            timeoutMs: { type: "number", minimum: 100 },
            retries: { type: "number", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const slot = (req.params as { slot: PulseApiSlot }).slot;
      if (!SLOTS.includes(slot)) {
        return reply.code(404).send({ error: "unknown pulse api slot" });
      }
      try {
        return store.putPulseApi(slot, req.body as object, actor(req));
      } catch (err) {
        const code = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
