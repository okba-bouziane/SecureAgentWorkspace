import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";
import { lifecycle } from "./health.controller.js";

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["log", "warn", "error"] });
  app.enableCors({ origin: cfg.WEB_ORIGIN.split(","), exposedHeaders: ["Retry-After", "X-RateLimit-Remaining"] });
  app.enableShutdownHooks();
  app.set("trust proxy", 1);
  await app.listen(cfg.PORT, "0.0.0.0");
  const log = new Logger("Bootstrap");
  log.log(`API listening on :${cfg.PORT}`);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    lifecycle.shuttingDown = true; // readiness probe fails first
    log.log(`${signal} received, draining`);
    const force = setTimeout(() => {
      log.error("Forced exit after drain timeout");
      process.exit(1);
    }, 15_000);
    force.unref();
    // Stop accepting new connections, let in-flight requests finish, then close pools and queues.
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void bootstrap();
