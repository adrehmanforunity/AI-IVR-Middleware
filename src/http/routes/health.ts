import type { FastifyInstance } from "fastify";
import type { ProcessHealth } from "../../processGuards.js";
import type { Supervisor } from "../../asterisk/supervisor.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  processHealth: ProcessHealth,
  supervisor: Supervisor,
): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        tags: ["ops"],
        summary: "Liveness — process is up",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              unhandledErrors: { type: "number" },
              lastUnhandledAt: { type: ["string", "null"] },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const status = processHealth.healthy ? "ok" : "unhealthy";
      return reply.code(200).send({
        status,
        unhandledErrors: processHealth.unhandledErrors,
        lastUnhandledAt: processHealth.lastUnhandledAt,
      });
    },
  );

  app.get(
    "/ready",
    {
      schema: {
        tags: ["ops"],
        summary: "Readiness — SQLite plus each enabled AMI/ARI link. Disabled links and setup drain do not fail ready.",
        response: {
          200: {
            type: "object",
            properties: {
              ready: { type: "boolean" },
              reasons: { type: "array", items: { type: "string" } },
            },
          },
          503: {
            type: "object",
            properties: {
              ready: { type: "boolean" },
              reasons: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const result = supervisor.ready();
      return reply.code(result.ready ? 200 : 503).send(result);
    },
  );
}
