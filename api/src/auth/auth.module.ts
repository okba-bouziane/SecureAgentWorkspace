import { Global, Module } from "@nestjs/common";
import { CONFIG, JWT_VERIFIER } from "../common/tokens.js";
import type { Config } from "../config.js";
import { AuthGuard } from "./auth.guard.js";
import { JwtVerifier, remoteJwks } from "./jwt-verifier.js";

@Global()
@Module({
  providers: [
    {
      provide: JWT_VERIFIER,
      inject: [CONFIG],
      useFactory: (cfg: Config) =>
        new JwtVerifier({
          issuer: cfg.OIDC_ISSUER,
          audience: cfg.OIDC_AUDIENCE,
          jwks: remoteJwks(cfg.jwksUrl),
        }),
    },
    AuthGuard,
  ],
  exports: [JWT_VERIFIER, AuthGuard],
})
export class AuthModule {}
