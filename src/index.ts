import { loadEnv } from "./config/env.js";
import { closeFileLogging, createLogger } from "./logging/index.js";
import { ConfigStore } from "./db/sqlite.js";
import { Supervisor } from "./asterisk/supervisor.js";
import { buildApp } from "./http/app.js";
import { createProcessHealth, installProcessGuards } from "./processGuards.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env);
  log.info(
    {
      component: "process",
      pid: process.pid,
      node: process.version,
      host: env.HOST,
      port: env.PORT,
    },
    "process startup",
  );
  const processHealth = createProcessHealth();
  installProcessGuards(log, processHealth);

  const store = new ConfigStore(env, log);
  store.open();

  const supervisor = new Supervisor(store, log);

  const app = await buildApp({ env, log, store, supervisor, processHealth });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    log.info(
      { component: "http", host: env.HOST, port: env.PORT, ui: `http://${env.HOST}:${env.PORT}/`, docs: `http://${env.HOST}:${env.PORT}/docs` },
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

  log.info({ component: "process", host: env.HOST, port: env.PORT }, "startup complete");

  const shutdown = async (signal: string) => {
    log.info({ component: "process", signal }, "process shutdown");
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
    try {
      await closeFileLogging();
    } catch (err) {
      log.error({ component: "logging", err }, "log file close error");
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
