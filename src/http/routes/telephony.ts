import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Supervisor } from "../../asterisk/supervisor.js";
import type { ConfigStore } from "../../db/sqlite.js";
import { userFromRequest } from "./auth.js";
import { tailLog, type LogKind } from "../../logging/tail.js";

function actor(req: FastifyRequest, store: ConfigStore): string {
  return userFromRequest(req, store)?.username ?? (typeof req.headers["x-api-key"] === "string" ? "api-key" : "unknown");
}

const linkPatch = {
  type: "object",
  additionalProperties: false,
  properties: {
    retryDelayMs: { type: "number", minimum: 500 },
    connectTimeoutMs: { type: "number", minimum: 500 },
  },
};

export async function registerTelephonyRoutes(
  app: FastifyInstance,
  supervisor: Supervisor,
  store: ConfigStore,
): Promise<void> {
  app.addHook("onRequest", async (req) => {
    if (req.method === "POST" && req.url.startsWith("/v1/telephony/") && !req.headers["content-type"]) {
      req.headers["content-type"] = "application/json";
    }
  });
  app.get(
    "/v1/telephony",
    {
      schema: {
        tags: ["telephony"],
        summary: "Independent AMI and ARI desired state, timeouts, and live status",
        security: [{ apiKey: [] }],
      },
    },
    async () => supervisor.snapshot(),
  );

  app.put(
    "/v1/telephony",
    {
      schema: {
        tags: ["telephony"],
        summary: "Update AMI/ARI timeouts and IIM station range (default 3001–3999, not inbound DIDs)",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            ami: linkPatch,
            ari: linkPatch,
            ownedExtensions: {
              type: "object",
              additionalProperties: false,
              properties: {
                from: { type: "integer", minimum: 0, maximum: 999999 },
                to: { type: "integer", minimum: 0, maximum: 999999 },
              },
            },
          },
        },
      },
    },
    async (req) => {
      const body = (req.body ?? {}) as {
        ami?: { retryDelayMs?: number; connectTimeoutMs?: number };
        ari?: { retryDelayMs?: number; connectTimeoutMs?: number };
        ownedExtensions?: { from?: number; to?: number };
      };
      store.putTelephony(body, actor(req, store));
      supervisor.applyLinkSettings();
      return supervisor.snapshot();
    },
  );

  for (const link of ["ami", "ari"] as const) {
    const name = link.toUpperCase();
    app.post(
      `/v1/telephony/${link}/connect`,
      {
        schema: {
          tags: ["telephony"],
          summary: `Enable ${name}: connect and retry if Asterisk is down`,
          security: [{ apiKey: [] }],
        },
      },
      async (req) => supervisor.connectLink(link, actor(req, store)),
    );
    app.post(
      `/v1/telephony/${link}/disconnect`,
      {
        schema: {
          tags: ["telephony"],
          summary: `Disable ${name}: drop the link and do not retry until connect`,
          security: [{ apiKey: [] }],
        },
      },
      async (req) => supervisor.disconnectLink(link, actor(req, store)),
    );
    app.post(
      `/v1/telephony/${link}/reconnect`,
      {
        schema: {
          tags: ["telephony"],
          summary: `Reconnect ${name} only if it is enabled`,
          security: [{ apiKey: [] }],
        },
      },
      async () => supervisor.reconnectLink(link),
    );
  }

  app.post(
    "/v1/telephony/connect",
    {
      schema: {
        tags: ["telephony"],
        summary: "Enable both AMI and ARI",
        security: [{ apiKey: [] }],
      },
    },
    async (req) => supervisor.connectTelephony(actor(req, store)),
  );

  app.post(
    "/v1/telephony/disconnect",
    {
      schema: {
        tags: ["telephony"],
        summary: "Disable both AMI and ARI",
        security: [{ apiKey: [] }],
      },
    },
    async (req) => supervisor.disconnectTelephony(actor(req, store)),
  );

  app.get(
    "/v1/telephony/events",
    {
      schema: {
        tags: ["telephony"],
        summary: "Recent AMI/ARI/supervisor events (in-memory)",
        security: [{ apiKey: [] }],
      },
    },
    async () => ({ events: supervisor.recentEvents() }),
  );

  app.get(
    "/v1/telephony/logs",
    {
      schema: {
        tags: ["telephony"],
        summary: "Tail the current hour AMI, ARI, or app log file",
        security: [{ apiKey: [] }],
        querystring: {
          type: "object",
          properties: {
            source: { type: "string", enum: ["app", "ami", "ari"] },
          },
        },
      },
    },
    async (req) => {
      const source = ((req.query as { source?: string }).source ?? "ami") as LogKind;
      const kind: LogKind = source === "ari" || source === "app" ? source : "ami";
      return { source: kind, ...tailLog(kind) };
    },
  );
}
