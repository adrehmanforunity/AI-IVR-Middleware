import type { FastifyInstance } from "fastify";
import type { ProcessHealth } from "../../processGuards.js";
import type { Supervisor } from "../../asterisk/supervisor.js";
import type { HostSampler } from "../../ops/host.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  processHealth: ProcessHealth,
  supervisor: Supervisor,
  host: HostSampler,
): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        tags: ["ops"],
        summary: "Liveness plus host CPU/memory and every mounted volume. High utilization is flagged; process stays up.",
      },
    },
    async (_req, reply) => {
      const hostSnap = host.snapshot();
      const status = processHealth.healthy ? (hostSnap.critical ? "degraded" : "ok") : "unhealthy";
      return reply.code(200).send({
        status,
        instance: supervisor.snapshot().instance,
        unhandledErrors: processHealth.unhandledErrors,
        lastUnhandledAt: processHealth.lastUnhandledAt,
        host: hostSnap,
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
