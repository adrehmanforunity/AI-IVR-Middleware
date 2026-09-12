import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Env } from "../config/env.js";
import type { ConfigStore } from "../db/sqlite.js";
import type { Logger } from "../logging/index.js";
import type { ProcessHealth } from "../processGuards.js";
import type { Supervisor } from "../asterisk/supervisor.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerTelephonyRoutes } from "./routes/telephony.js";
import { registerSetupRoutes } from "./routes/setups.js";
import { registerPulseRoutes } from "./routes/pulse.js";
import { registerIvrRoutes } from "./routes/ivrs.js";
import { registerCallRoutes } from "./routes/calls.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerAuthRoutes, userFromRequest } from "./routes/auth.js";
import { registerStationRoutes } from "./routes/stations.js";
import {
  applySecurityHeaders,
  csrfMatches,
  csrfTokenForSession,
  isDocsPath,
  isMutatingMethod,
  isPublicPath,
  isUiHtmlPath,
  originAllowed,
  requestPath,
  sessionTokenFromRequest,
  wantsHtml,
} from "./security.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../../public");

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

  await app.register(cookie, { secret: opts.env.API_KEY });

  app.addHook("onResponse", (req, reply, done) => {
    opts.log.info(
      { component: "http", method: req.method, url: req.url, statusCode: reply.statusCode },
      "request",
    );
    done();
  });

  app.addHook("onRequest", async (req, reply) => {
    applySecurityHeaders(req, reply);
    const path = requestPath(req);
    if (path.endsWith(".html")) {
      return reply.code(404).send({ error: "not found" });
    }
    if (isPublicPath(req.method, path)) return;

    const apiKeyOk = req.headers["x-api-key"] === opts.env.API_KEY;
    const user = userFromRequest(req, opts.store);

    if ((req.method === "GET" || req.method === "HEAD") && isUiHtmlPath(path)) {
      if (user) return;
      return reply.redirect("/");
    }

    if (isDocsPath(path)) {
      if (apiKeyOk || user) return;
      if (wantsHtml(req)) return reply.redirect("/");
      return reply.code(401).send({ error: "unauthorized" });
    }

    if (apiKeyOk) return;
    if (!user) {
      if (wantsHtml(req)) return reply.redirect("/");
      return reply.code(401).send({ error: "unauthorized" });
    }

    if (isMutatingMethod(req.method)) {
      if (!originAllowed(req)) {
        return reply.code(403).send({ error: "forbidden origin" });
      }
      const sid = sessionTokenFromRequest(req);
      const csrf = req.headers["x-csrf-token"];
      if (!sid || !csrfMatches(opts.env, sid, csrf)) {
        return reply.code(403).send({ error: "invalid csrf token" });
      }
    }
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
        { name: "auth", description: "Superadmin UI session" },
        { name: "config", description: "Persistent configuration" },
        { name: "asterisk", description: "AMI/ARI status and reconnect" },
        { name: "telephony", description: "Connect/disconnect Asterisk (not setup drain)" },
        { name: "setups", description: "DID/trunk channel caps and new-call enable" },
        { name: "pulse", description: "PULSE CX REST slots" },
        { name: "ivr", description: "IVR programs and functions" },
        { name: "calls", description: "Live call progress" },
        { name: "stations", description: "IIM-owned PBX extensions" },
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

  app.get("/", async (req, reply) => {
    if (userFromRequest(req, opts.store)) return reply.redirect("/app");
    return sendHtml(reply, "login.html");
  });
  app.get("/app", async (req, reply) => sendProtectedHtml(req, reply, opts, "app.html"));
  app.get("/setups", async (req, reply) => sendProtectedHtml(req, reply, opts, "setups.html"));
  app.get("/ivrs", async (req, reply) => sendProtectedHtml(req, reply, opts, "ivrs.html"));
  app.get("/functions", async (req, reply) => sendProtectedHtml(req, reply, opts, "functions.html"));
  app.get("/pulse", async (req, reply) => sendProtectedHtml(req, reply, opts, "pulse.html"));
  app.get("/telephony", async (req, reply) => sendProtectedHtml(req, reply, opts, "telephony.html"));
  app.get("/stations", async (req, reply) => sendProtectedHtml(req, reply, opts, "stations.html"));

  await app.register(async (scope) => {
    await scope.register(staticFiles, {
      root: join(publicDir, "css"),
      prefix: "/css/",
      wildcard: false,
      decorateReply: false,
    });
  });
  await app.register(async (scope) => {
    await scope.register(staticFiles, {
      root: join(publicDir, "js"),
      prefix: "/js/",
      wildcard: false,
      decorateReply: false,
    });
  });

  await registerAuthRoutes(app, opts.store, opts.env);
  await registerHealthRoutes(app, opts.processHealth, opts.supervisor);
  await registerStatusRoutes(app, opts.supervisor);
  await registerTelephonyRoutes(app, opts.supervisor, opts.store);
  await registerSetupRoutes(app, opts.store, opts.supervisor.registry);
  await registerPulseRoutes(app, opts.store);
  await registerIvrRoutes(app, opts.store);
  await registerCallRoutes(app, opts.supervisor.registry, opts.store);
  await registerStationRoutes(app, opts.supervisor, opts.store);
  await registerReportRoutes(app, {
    store: opts.store,
    registry: opts.supervisor.registry,
    supervisor: opts.supervisor,
    processHealth: opts.processHealth,
  });
  await registerConfigRoutes(app, opts.store);

  return app;
}

async function sendProtectedHtml(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { env: Env; store: ConfigStore },
  file: string,
) {
  const sid = sessionTokenFromRequest(req);
  const csrf = sid ? csrfTokenForSession(opts.env, sid) : "";
  return sendHtml(reply, file, csrf);
}

async function sendHtml(reply: FastifyReply, file: string, csrfToken?: string) {
  let body = (await readFile(join(publicDir, file), "utf8")).toString();
  if (csrfToken) {
    const inject = `    <meta name="csrf-token" content="${csrfToken}" />\n    <script src="/js/csrf.js"></script>\n`;
    body = body.replace("</head>", `${inject}  </head>`);
  }
  return reply
    .type("text/html; charset=utf-8")
    .header("Cache-Control", "no-store")
    .send(body);
}
