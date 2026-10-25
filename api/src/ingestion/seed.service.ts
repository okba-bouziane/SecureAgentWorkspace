import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { CONFIG } from "../common/tokens.js";
import type { Config } from "../config.js";
import { IngestionService } from "./ingestion.service.js";
import { errorMessage } from "../common/errors.js";

/** Queues the bundled sample documents on startup. Idempotent thanks to the content hash. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger(SeedService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(IngestionService) private readonly ingestion: IngestionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.SEED_ON_START) return;
    try {
      const files = (await readdir(this.cfg.SEED_DIR)).filter((f) => f.endsWith(".md")).sort();
      for (const file of files) {
        const content = await readFile(join(this.cfg.SEED_DIR, file), "utf8");
        const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.replace(/\.md$/, "");
        const res = await this.ingestion.submit({ title, content, source: `seed/${file}`, userSub: "system" });
        this.log.log(`seed ${file}: ${res.duplicate ? "already indexed" : "queued"}`);
      }
    } catch (err) {
      this.log.warn(`Seeding skipped: ${errorMessage(err)}`);
    }
  }
}
