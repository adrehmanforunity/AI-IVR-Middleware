import type { FastifyInstance } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { AsteriskTarget } from "../../asterisk/types.js";
import { userFromRequest } from "./auth.js";

const targetSchema = {
  type: "object",
  properties: {
    host: { type: "string" },
    amiPort: { type: "number" },
    amiUser: { type: "string" },
    amiPasswordSet: { type: "boolean" },
    amiPasswordFromEnv: { type: "boolean" },
    ariBaseUrl: { type: "string" },
    ariUser: { type: "string" },
    ariPasswordSet: { type: "boolean" },
    ariPasswordFromEnv: { type: "boolean" },
    stasisApp: { type: "string" },
    updatedAt: { type: "string" },
  },
};

function publicTarget(t: AsteriskTarget, overrides: { amiFromEnv: boolean; ariFromEnv: boolean }) {
  return {
    host: t.host,
    amiPort: t.amiPort,
    amiUser: t.amiUser,
    amiPasswordSet: Boolean(t.amiPassword),
    amiPasswordFromEnv: overrides.amiFromEnv,
    ariBaseUrl: t.ariBaseUrl,
    ariUser: t.ariUser,
    ariPasswordSet: Boolean(t.ariPassword),
    ariPasswordFromEnv: overrides.ariFromEnv,
    stasisApp: t.stasisApp,
    updatedAt: t.updatedAt,
  };
}

export async function registerConfigRoutes(app: FastifyInstance, store: ConfigStore): Promise<void> {
  app.get(
    "/v1/config/asterisk",
    {
      schema: {
        tags: ["config"],
        summary: "Get Asterisk connection config (secrets masked)",
        security: [{ apiKey: [] }],
        response: { 200: targetSchema },
      },
    },
    async () => publicTarget(store.getTarget(), store.passwordOverrides()),
  );

  app.put(
    "/v1/config/asterisk",
    {
      schema: {
        tags: ["config"],
        summary: "Update Asterisk connection config. Passwords in env still win at runtime.",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            host: { type: "string" },
            amiPort: { type: "number" },
            amiUser: { type: "string" },
            amiPassword: { type: "string" },
            ariBaseUrl: { type: "string" },
            ariUser: { type: "string" },
            ariPassword: { type: "string" },
            stasisApp: { type: "string" },
          },
        },
        response: {
          200: targetSchema,
          503: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const body = req.body as Partial<AsteriskTarget>;
        const actor = userFromRequest(req, store)?.username ?? (typeof req.headers["x-api-key"] === "string" ? "api-key" : "unknown");
        const saved = store.putTarget(body, actor);
        return publicTarget(saved, store.passwordOverrides());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(503).send({ error: message });
      }
    },
  );

  app.get(
    "/v1/config/settings",
    {
      schema: {
        tags: ["config"],
        summary: "Get key/value settings",
        security: [{ apiKey: [] }],
        response: {
          200: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
      },
    },
    async () => {
      const raw = store.getSettings();
      const { smtp_password: _smtp, pulse_api_key: _pulse, ...rest } = raw;
      return rest;
    },
  );

  app.put(
    "/v1/config/settings",
    {
      schema: {
        tags: ["config"],
        summary: "Set a single setting key",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: { type: "string" },
            value: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          503: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const { key, value } = req.body as { key: string; value: string };
        const actor = userFromRequest(req, store)?.username ?? (typeof req.headers["x-api-key"] === "string" ? "api-key" : "unknown");
        store.putSetting(key, value, actor);
        return store.getSettings();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = (err as { code?: string }).code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(status).send({ error: message });
      }
    },
  );
}
