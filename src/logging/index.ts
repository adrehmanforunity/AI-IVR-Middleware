import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import type { Env } from "../config/env.js";
import { HourlyLogStream } from "./hourlyFile.js";

export type LogBindings = {
  component?: string;
  amiAction?: string;
  ariEvent?: string;
  callId?: string;
  sessionId?: string;
  callsInternalId?: string;
};

export type LogTarget = {
  root: string;
  source: "configured" | "temp";
  fileStream: HourlyLogStream | null;
  amiStream: HourlyLogStream | null;
  ariStream: HourlyLogStream | null;
};

const DEFAULT_LOG_DIR = "./logs";
let fileStream: HourlyLogStream | null = null;
let amiStream: HourlyLogStream | null = null;
let ariStream: HourlyLogStream | null = null;
let resolved: LogTarget | null = null;

export function isWritableDir(dir: string): boolean {
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveLogRoot(configured: string): { root: string; source: "configured" | "temp" } {
  const wanted = configured.trim() || DEFAULT_LOG_DIR;
  const absWanted = path.resolve(wanted);
  if (isWritableDir(absWanted)) {
    return { root: absWanted, source: "configured" };
  }
  const tempRoot = path.join(os.tmpdir(), "iim-logs");
  fs.mkdirSync(tempRoot, { recursive: true });
  if (!isWritableDir(tempRoot)) {
    throw new Error(`log root not writable: ${absWanted} and ${tempRoot}`);
  }
  return { root: tempRoot, source: "temp" };
}

export function getLogTarget(): LogTarget | null {
  return resolved;
}

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "LOG_DIR">) {
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];

  try {
    const { root, source } = resolveLogRoot(env.LOG_DIR);
    fileStream = new HourlyLogStream(root, ".log");
    amiStream = new HourlyLogStream(root, ".AMI");
    ariStream = new HourlyLogStream(root, ".ARI");
    const onFileErr = (kind: string) => (err: Error) => {
      process.stderr.write(`iim ${kind} log error: ${err.message}\n`);
    };
    fileStream.on("error", onFileErr(".log"));
    amiStream.on("error", onFileErr(".AMI"));
    ariStream.on("error", onFileErr(".ARI"));
    resolved = { root, source, fileStream, amiStream, ariStream };
    streams.push({ stream: fileStream });
  } catch (err) {
    resolved = { root: "", source: "temp", fileStream: null, amiStream: null, ariStream: null };
    process.stderr.write(
      `iim file logging disabled: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  const logger = pino(
    {
      level: env.LOG_LEVEL,
      base: { service: "iim" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );

  if (resolved?.fileStream) {
    logger.info(
      { component: "logging", logRoot: resolved.root, logSource: resolved.source },
      "hourly file logging ready (YYYYMMDDHH.log / .AMI / .ARI)",
    );
  }

  return logger;
}

const AMI_SECRET_KEYS = /^(secret|password|passwd|token|authtoken)$/i;

function writeWire(
  stream: HourlyLogStream | null,
  direction: "out" | "in" | "meta",
  body: string,
  redact: (text: string) => string,
): void {
  if (!stream) return;
  const stamp = new Date().toISOString();
  const tag = direction === "out" ? ">>>" : direction === "in" ? "<<<" : "---";
  const text = redact(body).replace(/\r\n/g, "\n").replace(/\n+$/, "");
  stream.write(`${stamp} ${tag}\n${text}\n\n`);
}

export function writeAmiLog(direction: "out" | "in" | "meta", body: string): void {
  writeWire(amiStream, direction, body, redactAmi);
}

export function writeAriLog(direction: "out" | "in" | "meta", body: string): void {
  writeWire(ariStream, direction, body, redactAri);
}

function redactAmi(body: string): string {
  return body
    .split("\n")
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon === -1) return line;
      const key = line.slice(0, colon).trim();
      if (!AMI_SECRET_KEYS.test(key)) return line;
      return `${line.slice(0, colon + 1)} ***`;
    })
    .join("\n");
}

function redactAri(body: string): string {
  return body
    .replace(/api_key=[^&\s"]+/gi, "api_key=***")
    .replace(/Authorization:\s*Basic\s+\S+/gi, "Authorization: Basic ***")
    .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"***"');
}

export async function closeFileLogging(): Promise<void> {
  const streams = [fileStream, amiStream, ariStream].filter((s): s is HourlyLogStream => s != null);
  fileStream = null;
  amiStream = null;
  ariStream = null;
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.end(() => resolve());
        }),
    ),
  );
}

export type Logger = pino.Logger;
