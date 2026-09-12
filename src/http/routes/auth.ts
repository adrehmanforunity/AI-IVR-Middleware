import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ConfigStore, AuthUser } from "../../db/sqlite.js";
import type { Env } from "../../config/env.js";
import {
  SESSION_COOKIE,
  cookieOpts,
  csrfTokenForSession,
  LoginLimiter,
  originAllowed,
  sessionTokenFromRequest,
} from "../security.js";

export { SESSION_COOKIE };

const loginLimiter = new LoginLimiter();

export async function registerAuthRoutes(
  app: FastifyInstance,
  store: ConfigStore,
  env: Env,
): Promise<void> {
  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Superadmin login — sets httpOnly session cookie",
        body: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string };
      if (req.headers.origin && !originAllowed(req)) {
        return reply.code(403).send({ error: "forbidden origin" });
      }
      const ip = req.ip || "unknown";
      if (loginLimiter.tooMany(ip, username ?? "")) {
        return reply.code(429).send({ error: "too many sign-in attempts" });
      }
      const user = store.authenticateUser(username ?? "", password ?? "");
      if (!user) {
        loginLimiter.fail(ip, username ?? "");
        return reply.code(401).send({ error: "invalid credentials" });
      }
      loginLimiter.ok(ip, username ?? "");
      const token = store.createSession(user.id, env.SESSION_TTL_HOURS);
      reply.setCookie(SESSION_COOKIE, token, cookieOpts(env));
      return { ok: true, user: { username: user.username, role: user.role } };
    },
  );

  app.post("/auth/logout", { schema: { tags: ["auth"], summary: "Clear session cookie" } }, async (req, reply) => {
    const token = sessionTokenFromRequest(req);
    if (token) store.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { schema: { tags: ["auth"], summary: "Current UI session user" } }, async (req, reply) => {
    const user = userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const sid = sessionTokenFromRequest(req);
    return {
      username: user.username,
      role: user.role,
      csrfToken: sid ? csrfTokenForSession(env, sid) : undefined,
    };
  });

  app.put(
    "/auth/password",
    {
      schema: {
        tags: ["auth"],
        summary: "Change superadmin password (stored in SQLite)",
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = userFromRequest(req, store);
      if (!user) return reply.code(401).send({ error: "unauthorized" });
      const body = req.body as { currentPassword: string; newPassword: string };
      if ((body.newPassword ?? "").length < 8) {
        return reply.code(400).send({ error: "password must be at least 8 characters" });
      }
      if (!store.updatePassword(user.id, body.currentPassword, body.newPassword)) {
        return reply.code(400).send({ error: "current password is wrong" });
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    },
  );
}

export function userFromRequest(req: FastifyRequest, store: ConfigStore): AuthUser | null {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  return store.userForSession(token);
}

export function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: "unauthorized" });
}
