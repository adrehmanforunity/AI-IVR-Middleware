import pino from "pino";

export type LogBindings = {
  component?: string;
  amiAction?: string;
  ariEvent?: string;
  callId?: string;
};

export function createLogger(level: string) {
  return pino({
    level,
    base: { service: "iim" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
