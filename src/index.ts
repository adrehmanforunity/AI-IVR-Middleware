import { loadEnv } from "./config/env.js";
import { createLogger } from "./logging.js";
import { ConfigStore } from "./db/sqlite.js";
import { Supervisor } from "./asterisk/supervisor.js";
import { buildApp } from "./http/app.js";
import { createProcessHealth, installProcessGuards } from "./processGuards.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL);
  const processHealth = createProcessHealth();
  installProcessGuards(log, processHealth);

  const store = new ConfigStore(env, log);
  store.open();

  const supervisor = new Supervisor(store, log);

  const app = await buildApp({ env, log, store, supervisor, processHealth });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    log.info(
      { component: "http", host: env.HOST, port: env.PORT, docs: `http://${env.HOST}:${env.PORT}/docs` },
      "http listening (asterisk links start next)",
    );
  } catch (err) {
    log.error({ component: "http", err }, "failed to bind http");
    process.exitCode = 1;
    return;
  }

  try {
    supervisor.bootTelephony();
  } catch (err) {
    log.error({ component: "supervisor", err }, "supervisor start failed — http stays up");
  }

  const shutdown = async (signal: string) => {
    log.info({ component: "process", signal }, "shutdown");
    try {
      supervisor.stop();
    } catch (err) {
      log.error({ component: "supervisor", err }, "supervisor stop error");
    }
    try {
      await app.close();
    } catch (err) {
      log.error({ component: "http", err }, "http close error");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
