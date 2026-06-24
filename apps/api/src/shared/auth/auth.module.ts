import { Global, Module } from '@nestjs/common';
import { IpRegionService } from './ip-region.service.js';
import { ProviderAuthService } from './provider-auth.service.js';
import { SecretHashService } from './secret-hash.service.js';
import { SessionAuthService } from './session-auth.service.js';

@Global()
@Module({
  providers: [SecretHashService, SessionAuthService, ProviderAuthService, IpRegionService],
  exports: [SecretHashService, SessionAuthService, ProviderAuthService, IpRegionService],
})
export class AuthModule {}
