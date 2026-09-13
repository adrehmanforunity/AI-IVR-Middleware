import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { AlertService } from "../../mail/alerts.js";
import type { SmtpAuth, SmtpSecurity } from "../../mail/smtp.js";
import { publicSmtp } from "../../mail/smtp.js";
import { userFromRequest } from "./auth.js";

export async function registerSmtpRoutes(
  app: FastifyInstance,
  store: ConfigStore,
  alerts: AlertService,
): Promise<void> {
  const who = (req: FastifyRequest) => userFromRequest(req, store)?.username ?? "api-key";

  app.get(
    "/v1/smtp",
    {
      schema: {
        tags: ["alerts"],
        summary: "SMTP settings (password masked)",
        security: [{ apiKey: [] }],
      },
    },
    async () => publicSmtp(store.getSmtp()),
  );

  app.put(
    "/v1/smtp",
    {
      schema: {
        tags: ["alerts"],
        summary: "Save SMTP. Empty password keeps the stored one.",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            host: { type: "string" },
            port: { type: "number" },
            security: { type: "string", enum: ["none", "starttls", "tls"] },
            auth: { type: "string", enum: ["none", "login"] },
            user: { type: "string" },
            password: { type: "string" },
            from: { type: "string" },
            fromName: { type: "string" },
            replyTo: { type: "string" },
            helo: { type: "string" },
            timeoutMs: { type: "number" },
            rejectUnauthorized: { type: "boolean" },
            adminTo: { type: "string" },
            businessTo: { type: "string" },
            cooldownSec: { type: "number" },
          },
        },
      },
    },
    async (req) => {
      const body = req.body as {
        enabled?: boolean;
        host?: string;
        port?: number;
        security?: SmtpSecurity;
        auth?: SmtpAuth;
        user?: string;
        password?: string;
        from?: string;
        fromName?: string;
        replyTo?: string;
        helo?: string;
        timeoutMs?: number;
        rejectUnauthorized?: boolean;
        adminTo?: string;
        businessTo?: string;
        cooldownSec?: number;
      };
      return publicSmtp(store.putSmtp(body, who(req)));
    },
  );

  app.post(
    "/v1/smtp/test",
    {
      schema: {
        tags: ["alerts"],
        summary: "Send a test email using the saved SMTP settings",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: { to: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const to = (req.body as { to?: string } | undefined)?.to;
      const result = await alerts.sendTest(to);
      if (!result.ok) return reply.code(400).send(result);
      return result;
    },
  );
}
