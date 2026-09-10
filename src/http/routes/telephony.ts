import type { FastifyInstance } from "fastify";
import type { Supervisor } from "../../asterisk/supervisor.js";

function actor(req: { headers: Record<string, unknown> }): string {
  return typeof req.headers["x-api-key"] === "string" ? "api-key" : "unknown";
}

export async function registerTelephonyRoutes(app: FastifyInstance, supervisor: Supervisor): Promise<void> {
  app.get(
    "/v1/telephony",
    {
      schema: {
        tags: ["telephony"],
        summary: "AMI/ARI desired state (independent of call-setup enable/disable)",
        security: [{ apiKey: [] }],
      },
    },
    async () => supervisor.snapshot().telephony,
  );

  app.post(
    "/v1/telephony/connect",
    {
      schema: {
        tags: ["telephony"],
        summary: "Connect AMI/ARI and retry with delay if Asterisk is down",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            retryDelayMs: { type: "number", minimum: 500, description: "Base reconnect delay" },
          },
        },
      },
    },
    async (req) => {
      const body = (req.body ?? {}) as { retryDelayMs?: number };
      return supervisor.connectTelephony(actor(req), body.retryDelayMs);
    },
  );

  app.post(
    "/v1/telephony/disconnect",
    {
      schema: {
        tags: ["telephony"],
        summary: "Drop AMI/ARI and do not retry until connect",
        security: [{ apiKey: [] }],
      },
    },
    async (req) => supervisor.disconnectTelephony(actor(req)),
  );
}
