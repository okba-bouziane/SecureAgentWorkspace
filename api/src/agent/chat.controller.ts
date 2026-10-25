import { BadRequestException, Body, Controller, Get, HttpException, Inject, Param, ParseUUIDPipe, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/jwt-verifier.js";
import { RateLimitGuard } from "../ratelimit/rate-limit.guard.js";
import { AgentService } from "./agent.service.js";
import type { AgentEvent } from "./events.js";
import { errorMessage } from "../common/errors.js";

const messageSchema = z.object({ message: z.string().trim().min(1).max(4000) });
const decisionSchema = z.object({ approved: z.boolean() });

function openStream(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  return (event: AgentEvent) => {
    if (!res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
}

@Controller("chat/threads")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { threads: await this.agent.listThreads(user) };
  }

  @Get(":id")
  history(@CurrentUser() user: AuthUser, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.agent.history(id, user);
  }

  /** Server-sent events: each agent step is pushed as it happens. */
  @Post(":id/messages")
  @UseGuards(RateLimitGuard)
  async message(
    @CurrentUser() user: AuthUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("message is required (max 4000 characters)");
    await this.stream(res, (emit) => this.agent.sendMessage(user, id, parsed.data.message, emit));
  }

  @Post(":id/approval")
  @UseGuards(RateLimitGuard)
  async approval(
    @CurrentUser() user: AuthUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("approved (boolean) is required");
    await this.stream(res, (emit) => this.agent.decide(user, id, parsed.data.approved, emit));
  }

  private async stream(res: Response, run: (emit: (e: AgentEvent) => void) => Promise<void>) {
    // Preconditions (ownership, pending state) fail before the stream opens so the client gets a real status code.
    let emit: ((e: AgentEvent) => void) | null = null;
    const lazyEmit = (e: AgentEvent) => {
      if (!emit) emit = openStream(res);
      emit(e);
    };
    try {
      await run(lazyEmit);
    } catch (err) {
      if (emit || res.headersSent) {
        (emit ?? openStream(res))({ type: "error", message: errorMessage(err) });
      } else if (err instanceof HttpException) {
        res.status(err.getStatus()).json(err.getResponse());
        return;
      } else {
        throw err;
      }
    }
    res.end();
  }
}
