import pino from "pino";
import type { Env } from "../config/env.js";
import { HourlyLogStream, pickLogPlace, type LogPlace } from "./hourlyFile.js";
import { consoleTeeStream } from "./consoleRing.js";

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
  primaryRoot: string;
  fallbackRoot: string;
  source: "configured" | "temp";
  fileStream: HourlyLogStream | null;
  amiStream: HourlyLogStream | null;
  ariStream: HourlyLogStream | null;
};

let fileStream: HourlyLogStream | null = null;
let amiStream: HourlyLogStream | null = null;
let ariStream: HourlyLogStream | null = null;
let resolved: LogTarget | null = null;
let place: LogPlace | null = null;

export function getLogTarget(): LogTarget | null {
  if (!resolved || !place) return resolved;
  resolved.root = place.activeRoot;
  resolved.source = place.source;
  return resolved;
}

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "LOG_DIR">) {
  const streams: pino.StreamEntry[] = [{ stream: consoleTeeStream() }];
  place = pickLogPlace(env.LOG_DIR);

  const syncTarget = () => {
    if (!resolved || !place) return;
    resolved.root = place.activeRoot;
    resolved.source = place.source;
    resolved.primaryRoot = place.primaryRoot;
    resolved.fallbackRoot = place.fallbackRoot;
  };

  const onFileErr = (kind: string) => (err: Error) => {
    process.stderr.write(`iim ${kind} log error: ${err.message}\n`);
  };

  fileStream = new HourlyLogStream(place, ".log", syncTarget);
  amiStream = new HourlyLogStream(place, ".AMI", syncTarget);
  ariStream = new HourlyLogStream(place, ".ARI", syncTarget);
  fileStream.on("error", onFileErr(".log"));
  amiStream.on("error", onFileErr(".AMI"));
  ariStream.on("error", onFileErr(".ARI"));
  fileStream.prime();
  amiStream.prime();
  ariStream.prime();
  resolved = {
    root: place.activeRoot,
    primaryRoot: place.primaryRoot,
    fallbackRoot: place.fallbackRoot,
    source: place.source,
    fileStream,
    amiStream,
    ariStream,
  };
  streams.push({ stream: fileStream });

  const logger = pino(
    {
      level: env.LOG_LEVEL,
      base: { service: "iim" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );

  logger.info(
    {
      component: "logging",
      logRoot: place.activeRoot,
      logPrimary: place.primaryRoot,
      logFallback: place.fallbackRoot,
      logSource: place.source,
    },
    "hourly file logging ready (date folder / YYYYMMDDHH.log .AMI .ARI)",
  );
  if (place.source === "temp") {
    logger.warn(
      { component: "logging", logRoot: place.activeRoot, logPrimary: place.primaryRoot },
      "configured LOG_DIR was not writable — using OS temp iim-logs instead",
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
