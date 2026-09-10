import type { FastifyInstance } from "fastify";
import type { CallRegistry } from "../../calls/registry.js";
import type { ConfigStore } from "../../db/sqlite.js";

export async function registerCallRoutes(
  app: FastifyInstance,
  registry: CallRegistry,
  store: ConfigStore,
): Promise<void> {
  app.get(
    "/v1/calls",
    {
      schema: {
        tags: ["calls"],
        summary: "Live call sessions (progress + caller snapshot)",
        security: [{ apiKey: [] }],
      },
    },
    async () => ({
      active: registry.listActive(),
      activeCount: registry.listActive().length,
    }),
  );

  app.get(
    "/v1/calls/recent",
    {
      schema: {
        tags: ["calls"],
        summary: "Recent persisted sessions including rejected/ended",
        security: [{ apiKey: [] }],
      },
    },
    async () => store.listRecentSessions(50),
  );
}
