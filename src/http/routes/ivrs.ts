import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConfigStore } from "../../db/sqlite.js";
import type { IvrCustomFunctionInput, IvrSaveInput } from "../../domain/types.js";
import { analyzeIvrVoices } from "../../ivr/analyze.js";
import { sanitizeVoiceFolder } from "../../ivr/voice.js";
import { userFromRequest } from "./auth.js";

export async function registerIvrRoutes(app: FastifyInstance, store: ConfigStore): Promise<void> {
  const who = (req: FastifyRequest) => userFromRequest(req, store)?.username ?? "api-key";

  app.get(
    "/v1/ivrs",
    {
      schema: {
        tags: ["ivr"],
        summary: "List IVR programs (steps + When/Do/Then)",
        security: [{ apiKey: [] }],
      },
    },
    async () => store.listIvrs(),
  );

  app.get(
    "/v1/ivrs/functions",
    {
      schema: {
        tags: ["ivr"],
        summary: "Generic plus custom functions the IVR Do list can call",
        security: [{ apiKey: [] }],
      },
    },
    async () => store.listIvrFunctionCatalog(),
  );

  app.get(
    "/v1/ivrs/functions/custom",
    {
      schema: {
        tags: ["ivr"],
        summary: "Custom IVR functions (customer-specific)",
        security: [{ apiKey: [] }],
      },
    },
    async () => store.listCustomIvrFunctions(),
  );

  app.post(
    "/v1/ivrs/functions/custom",
    {
      schema: {
        tags: ["ivr"],
        summary: "Create a custom function wired to a PULSE API",
        security: [{ apiKey: [] }],
      },
    },
    async (req, reply) => {
      try {
        return store.createCustomIvrFunction(req.body as IvrCustomFunctionInput, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === "CONFLICT" ? 409 : code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    "/v1/ivrs/functions/custom/:id",
    {
      schema: {
        tags: ["ivr"],
        summary: "Update a custom function",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        return store.updateCustomIvrFunction(id, req.body as Partial<IvrCustomFunctionInput>, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === "NOT_FOUND" ? 404 : code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete(
    "/v1/ivrs/functions/custom/:id",
    {
      schema: {
        tags: ["ivr"],
        summary: "Delete a custom function",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        store.deleteCustomIvrFunction(id, who(req));
        return { ok: true, id };
      } catch (err) {
        const code = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    "/v1/ivrs/analyze",
    {
      schema: {
        tags: ["ivr"],
        summary: "List voice files this IVR document will play (Asterisk names + place-as paths)",
        security: [{ apiKey: [] }],
      },
    },
    async (req, reply) => {
      const body = req.body as IvrSaveInput & { voiceFolder?: string };
      if (!body?.menus?.length) {
        return reply.code(400).send({ error: "menus are required" });
      }
      try {
        return analyzeIvrVoices(body, store.getSettings(), sanitizeVoiceFolder(body.voiceFolder));
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    "/v1/ivrs/:id/analyze",
    {
      schema: {
        tags: ["ivr"],
        summary: "List voice files a saved IVR will play",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
        querystring: { type: "object", properties: { voiceFolder: { type: "string" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const ivr = store.getIvr(id);
      if (!ivr) return reply.code(404).send({ error: "not found" });
      const q = req.query as { voiceFolder?: string };
      return analyzeIvrVoices(ivr, store.getSettings(), sanitizeVoiceFolder(q.voiceFolder));
    },
  );

  app.get(
    "/v1/ivrs/:id",
    {
      schema: {
        tags: ["ivr"],
        summary: "Get one IVR",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const ivr = store.getIvr(id);
      if (!ivr) return reply.code(404).send({ error: "not found" });
      return ivr;
    },
  );

  app.post(
    "/v1/ivrs",
    {
      schema: {
        tags: ["ivr"],
        summary: "Create an IVR program",
        security: [{ apiKey: [] }],
      },
    },
    async (req, reply) => {
      const body = req.body as IvrSaveInput;
      if (!body?.name?.trim() || !body.menus?.length) {
        return reply.code(400).send({ error: "name and at least one menu are required" });
      }
      try {
        return store.createIvr(body, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    "/v1/ivrs/:id",
    {
      schema: {
        tags: ["ivr"],
        summary: "Replace an IVR program",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const body = req.body as IvrSaveInput;
      if (!body?.name?.trim() || !body.menus?.length) {
        return reply.code(400).send({ error: "name and at least one menu are required" });
      }
      try {
        return store.updateIvr(id, body, who(req));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === "NOT_FOUND" ? 404 : code === "BAD_REQUEST" ? 400 : 503;
        return reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete(
    "/v1/ivrs/:id",
    {
      schema: {
        tags: ["ivr"],
        summary: "Delete an IVR",
        security: [{ apiKey: [] }],
        params: { type: "object", properties: { id: { type: "number" } } },
      },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      try {
        store.deleteIvr(id, who(req));
        return { ok: true, id };
      } catch (err) {
        const code = (err as { code?: string }).code === "NOT_FOUND" ? 404 : 503;
        return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
