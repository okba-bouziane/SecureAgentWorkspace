import { Global, Module } from "@nestjs/common";
import { GuardrailsService } from "./guardrails.service.js";

@Global()
@Module({ providers: [GuardrailsService], exports: [GuardrailsService] })
export class GuardrailsModule {}
