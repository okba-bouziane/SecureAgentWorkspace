import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { RagService } from "./rag.service.js";

@Controller("knowledge/search")
@UseGuards(AuthGuard)
export class RagController {
  constructor(@Inject(RagService) private readonly rag: RagService) {}

  @Get()
  async search(@Query("q") q?: string, @Query("k") k?: string) {
    const query = q?.trim();
    if (!query) throw new BadRequestException("Query parameter q is required");
    if (query.length > 500) throw new BadRequestException("Query too long");
    const hits = await this.rag.search(query, { k: Math.min(Math.max(Number(k) || 5, 1), 20) });
    return { query, hits };
  }
}
