import type { FastifyInstance } from "fastify";
import type { Supervisor } from "../../asterisk/supervisor.js";

const linkSchema = {
  type: "object",
  properties: {
    state: { type: "string" },
    lastConnectedAt: { type: ["string", "null"] },
    lastError: { type: ["string", "null"] },
    reconnectCount: { type: "number" },
    lastEventAt: { type: ["string", "null"] },
    nextRetryAt: { type: ["string", "null"] },
    restState: { type: "string" },
    wsState: { type: "string" },
  },
};

const snapshotSchema = {
  type: "object",
  properties: {
    uptimeSeconds: { type: "number" },
    stasisApp: { type: "string" },
    activeCalls: { type: "number" },
    telephony: { type: "object", additionalProperties: true },
    ami: linkSchema,
    ari: linkSchema,
    sqlite: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        lastError: { type: ["string", "null"] },
        usingSnapshot: { type: "boolean" },
      },
    },
    setups: { type: "array", items: { type: "object", additionalProperties: true } },
  },
};

export async function registerStatusRoutes(app: FastifyInstance, supervisor: Supervisor): Promise<void> {
  app.get(
    "/v1/status",
    {
      schema: {
        tags: ["asterisk"],
        summary: "AMI/ARI, telephony switch, setup occupancy",
        security: [{ apiKey: [] }],
        response: { 200: snapshotSchema },
      },
    },
    async () => supervisor.snapshot(),
  );

  app.post(
    "/v1/asterisk/reconnect",
    {
      schema: {
        tags: ["asterisk"],
        summary: "Reconnect AMI/ARI only if telephony is in connect mode",
        security: [{ apiKey: [] }],
        response: { 200: snapshotSchema },
      },
    },
    async () => supervisor.reconnect(),
  );
}
