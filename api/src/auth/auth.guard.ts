import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import type { Request } from "express";
import { JWT_VERIFIER } from "../common/tokens.js";
import { AuthError, type AuthUser, type JwtVerifier } from "./jwt-verifier.js";

export type AuthedRequest = Request & { user?: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(JWT_VERIFIER) private readonly verifier: JwtVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw new UnauthorizedException("Missing Bearer token");
    try {
      req.user = await this.verifier.verify(match[1]);
      return true;
    } catch (err) {
      throw new UnauthorizedException(err instanceof AuthError ? err.message : "Unauthorized");
    }
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new UnauthorizedException();
  return req.user;
});
