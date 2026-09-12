import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  API_KEY: z.string().min(1).default("change-me"),
  LOG_DIR: z.string().default("./logs"),
  SQLITE_PATH: z.string().default("./data/iim.db"),
  AMI_PASSWORD: z.string().optional().default(""),
  ARI_PASSWORD: z.string().optional().default(""),
  ASTERISK_HOST: z.string().default("127.0.0.1"),
  AMI_PORT: z.coerce.number().int().min(1).max(65535).default(5038),
  AMI_USER: z.string().default("iim"),
  ARI_BASE_URL: z.string().default("http://127.0.0.1:8088"),
  ARI_USER: z.string().default("iim"),
  STASIS_APP: z.string().default("iim-ivr"),
  IIM_OWNED_EXT_FROM: z.coerce.number().int().min(0).max(999999).optional(),
  IIM_OWNED_EXT_TO: z.coerce.number().int().min(0).max(999999).optional(),
  SUPERADMIN_USER: z.string().default("superadmin"),
  SUPERADMIN_PASSWORD: z.string().min(1).default("changeme"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((s) => s === "true" || s === "1"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
