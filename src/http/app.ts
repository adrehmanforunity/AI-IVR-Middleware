import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Env } from "../config/env.js";
import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging.js";
import type { ProcessHealth } from "../processGuards.js";
import type { Supervisor } from "../asterisk/supervisor.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerTelephonyRoutes } from "./routes/telephony.js";
import { registerSetupRoutes } from "./routes/setups.js";
import { registerPulseRoutes } from "./routes/pulse.js";
import { registerCallRoutes } from "./routes/calls.js";

export async function buildApp(opts: {
  env: Env;
  log: Logger;
  store: ConfigStore;
  supervisor: Supervisor;
  processHealth: ProcessHealth;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: false,
  });

  app.addHook("onResponse", (req, reply, done) => {
    opts.log.info(
      { component: "http", method: req.method, url: req.url, statusCode: reply.statusCode },
      "request",
    );
    done();
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Intelligent IVR Middleware",
        description: "Unattended Asterisk AMI/ARI control plane",
        version: "0.1.0",
      },
      tags: [
        { name: "ops", description: "Health and readiness" },
        { name: "config", description: "Persistent configuration" },
        { name: "asterisk", description: "AMI/ARI status and reconnect" },
        { name: "telephony", description: "Connect/disconnect Asterisk (not setup drain)" },
        { name: "setups", description: "DID/trunk channel caps and new-call enable" },
        { name: "pulse", description: "PULSE CX REST slots" },
        { name: "calls", description: "Live call progress" },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: "apiKey",
            name: "X-API-Key",
            in: "header",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    if (
      path === "/health" ||
      path === "/ready" ||
      path === "/docs" ||
      path.startsWith("/docs/")
    ) {
      return;
    }
    const key = req.headers["x-api-key"];
    if (key !== opts.env.API_KEY) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  await registerHealthRoutes(app, opts.processHealth, opts.supervisor);
  await registerStatusRoutes(app, opts.supervisor);
  await registerTelephonyRoutes(app, opts.supervisor);
  await registerSetupRoutes(app, opts.store, opts.supervisor.registry);
  await registerPulseRoutes(app, opts.store);
  await registerCallRoutes(app, opts.supervisor.registry, opts.store);
  await registerConfigRoutes(app, opts.store);

  return app;
}
