import { Global, Module } from '@nestjs/common';
import { ProviderAuthService } from './provider-auth.service.js';
import { SecretHashService } from './secret-hash.service.js';
import { SessionAuthService } from './session-auth.service.js';

@Global()
@Module({
  providers: [SecretHashService, SessionAuthService, ProviderAuthService],
  exports: [SecretHashService, SessionAuthService, ProviderAuthService],
})
export class AuthModule {}
