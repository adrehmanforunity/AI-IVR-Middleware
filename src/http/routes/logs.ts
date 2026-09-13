import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { listLogFiles, logRoot, resolveLogIds } from "../../logging/catalog.js";
import {
  gzipBuffer,
  MAX_DOWNLOAD_FILES,
  readSelected,
  tarFiles,
  zipFiles,
} from "../../logging/pack.js";

const STAGING_DIR = path.join(os.tmpdir(), "iim-log-downloads");
const STAGING_MAX_AGE_MS = 15 * 60 * 1000;

function stagingExt(filename: string): string {
  if (filename.endsWith(".tar.gz")) return ".tar.gz";
  return path.extname(filename) || ".bin";
}

function sweepStaleArchives(): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(STAGING_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - STAGING_MAX_AGE_MS;
  for (const name of names) {
    if (!name.startsWith("iim-")) continue;
    const full = path.join(STAGING_DIR, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      // ignore
    }
  }
}

function stageArchive(data: Buffer, filename: string): string {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  sweepStaleArchives();
  const file = path.join(STAGING_DIR, `iim-${Date.now()}-${randomBytes(8).toString("hex")}${stagingExt(filename)}`);
  fs.writeFileSync(file, data);
  return file;
}

function removeArchive(file: string): void {
  fs.unlink(file, () => {});
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/logs",
    {
      schema: {
        tags: ["logs"],
        summary: "List hourly app / AMI / ARI log files on this host",
        security: [{ apiKey: [] }],
      },
    },
    async (req, reply) => {
      const root = logRoot();
      if (!root) return reply.code(503).send({ error: "file logging is not available" });
      return { root: root.root, source: root.source, files: listLogFiles() };
    },
  );

  app.post(
    "/v1/logs/download",
    {
      schema: {
        tags: ["logs"],
        summary: "Download selected log files as zip or gzip (gzip of many files is tar.gz)",
        security: [{ apiKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["files", "format"],
          properties: {
            files: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_DOWNLOAD_FILES },
            format: { type: "string", enum: ["zip", "gzip"] },
          },
        },
      },
    },
    async (req, reply) => {
      const root = logRoot();
      if (!root) return reply.code(503).send({ error: "file logging is not available" });
      const body = req.body as { files: string[]; format: "zip" | "gzip" };
      const selected = resolveLogIds(body.files ?? []);
      if (!selected.length) return reply.code(400).send({ error: "no matching log files" });
      if (selected.length > MAX_DOWNLOAD_FILES) {
        return reply.code(400).send({ error: `select at most ${MAX_DOWNLOAD_FILES} files` });
      }
      let packed: Buffer;
      let filename: string;
      let type: string;
      try {
        const payload = readSelected(selected);
        if (body.format === "zip") {
          packed = zipFiles(payload);
          filename = `iim-logs-${stamp()}.zip`;
          type = "application/zip";
        } else if (payload.length === 1) {
          packed = gzipBuffer(payload[0]!.data);
          filename = `${safeName(payload[0]!.id.split("/").pop() || "log")}.gz`;
          type = "application/gzip";
        } else {
          packed = gzipBuffer(tarFiles(payload));
          filename = `iim-logs-${stamp()}.tar.gz`;
          type = "application/gzip";
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        const message = err instanceof Error ? err.message : String(err);
        if (code === "PAYLOAD_TOO_LARGE") return reply.code(413).send({ error: message });
        return reply.code(500).send({ error: message });
      }
      let staged: string;
      try {
        staged = stageArchive(packed, filename);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
      packed = Buffer.alloc(0);
      const stream = fs.createReadStream(staged);
      const drop = () => removeArchive(staged);
      stream.on("close", drop);
      stream.on("error", drop);
      req.raw.on("aborted", drop);
      return reply
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .type(type)
        .send(stream);
    },
  );
}
