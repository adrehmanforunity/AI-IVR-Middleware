import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import { userFromRequest } from "./auth.js";

export async function registerPulseRoutes(app: FastifyInstance, store: ConfigStore): Promise<void> {
  const who = (req: FastifyRequest) => userFromRequest(req, store)?.username ?? "api-key";

  app.get(
    "/v1/pulse/apis",
    {
      schema: {
        tags: ["pulse"],
        summary: "List PULSE APIs (endpoint, timeout, retries, optional mock)",
        security: [{ apiKey: [] }],
      },
    },
    async () => store.listPulseApis(),
  );

  app.post(
    "/v1/pulse/apis",
    {
      schema: {
        tags: ["pulse"],
        summary: "Create a named PULSE API for a call stage",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          required: ["slot", "name"],
          additionalProperties: false,
          properties: {
            slot: { type: "string", description: "Stable id used in call flow, e.g. preAnswer" },
            name: { type: "string" },
            description: { type: "string" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH"] },
            endpoint: { type: "string" },
            timeoutMs: { type: "number", minimum: 100 },
            retries: { type: "number", minimum: 0 },
            enabled: { type: "boolean" },
            mockEnabled: { type: "boolean" },
            mockJson: { type: "string" },
            mockStatus: { type: ["number", "null"] },
            mockError: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        return store.createPulseApi(req.body as { slot: string; name: string }, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === "CONFLICT" ? 409 : code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    "/v1/pulse/apis/:slot",
    {
      schema: {
        tags: ["pulse"],
        summary: "Update endpoint, timeout, retries, enable, and optional mock",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { slot: { type: "string" } } },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH"] },
            endpoint: { type: "string" },
            timeoutMs: { type: "number", minimum: 100 },
            retries: { type: "number", minimum: 0 },
            mockEnabled: { type: "boolean" },
            mockJson: { type: "string" },
            mockStatus: { type: ["number", "null"] },
            mockError: { type: "string" },
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const slot = (req.params as { slot: string }).slot;
      try {
        return store.putPulseApi(slot, req.body as object, who(req));
      } catch (err) {
        const status = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete(
    "/v1/pulse/apis/:slot",
    {
      schema: {
        tags: ["pulse"],
        summary: "Delete a PULSE API definition",
        security: [{ apiKey: [] }],
      },
    },
    async (req, reply) => {
      const slot = (req.params as { slot: string }).slot;
      try {
        store.deletePulseApi(slot, who(req));
        return { ok: true };
      } catch (err) {
        const status = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
