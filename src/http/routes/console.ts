import type { FastifyInstance } from "fastify";
import { CONSOLE_MAX_LINES, consoleRing, type ConsoleBatch } from "../../logging/consoleRing.js";

const SOCKET_HIGH = 24 * 1024;

function writeSse(raw: NodeJS.WritableStream, payload: unknown): boolean {
  if (!raw.writable) return false;
  const buffered = "writableLength" in raw ? Number(raw.writableLength) : 0;
  if (buffered > SOCKET_HIGH) return false;
  return raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function registerConsoleRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/console/stream",
    {
      schema: {
        tags: ["ops"],
        summary: "Live process stdout (small rolling window, batched). Same lines as the Node terminal.",
      },
    },
    async (req, reply) => {
      if (!consoleRing.canSubscribe()) {
        return reply.code(503).send({ error: "too many live consoles" });
      }

      reply.hijack();
      req.raw.setTimeout(0);
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      writeSse(reply.raw, { t: "snap", cap: CONSOLE_MAX_LINES, lines: consoleRing.snapshot() });

      const send = (batch: ConsoleBatch): boolean => writeSse(reply.raw, batch);
      const unsub = consoleRing.subscribe(send);

      reply.raw.on("drain", () => consoleRing.markWritable(send));

      const ping = setInterval(() => {
        try {
          if (!reply.raw.writable) return;
          reply.raw.write(": ping\n\n");
        } catch {
          cleanup();
        }
      }, 30_000);
      ping.unref();

      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsub();
      };
      req.raw.on("close", cleanup);
      req.raw.on("error", cleanup);
      reply.raw.on("close", cleanup);
      reply.raw.on("error", cleanup);
    },
  );
}
