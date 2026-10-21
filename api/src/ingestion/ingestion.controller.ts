import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/jwt-verifier.js";
import { IngestionService } from "./ingestion.service.js";

const uploadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(20).max(200_000),
  source: z.string().max(300).optional(),
});

@Controller("knowledge/documents")
@UseGuards(AuthGuard)
export class IngestionController {
  constructor(@Inject(IngestionService) private readonly ingestion: IngestionService) {}

  @Get()
  async list() {
    return { documents: await this.ingestion.list() };
  }

  /** Only admins may add to the shared knowledge base: indexed text reaches every user's agent. */
  @Post()
  async upload(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (!user.roles.includes("admin")) throw new ForbiddenException("Only admins can add documents");
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return this.ingestion.submit({ ...parsed.data, userSub: user.sub });
  }

  @Get("dead-letters")
  async deadLetters(@CurrentUser() user: AuthUser) {
    if (!user.roles.includes("admin")) throw new ForbiddenException();
    return { deadLetters: await this.ingestion.deadLetters() };
  }
}
