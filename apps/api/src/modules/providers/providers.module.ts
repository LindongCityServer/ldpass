import { Module } from '@nestjs/common';
import { ProviderApiKeyAuthService } from './provider-api-key-auth.service.js';
import {
  AdminProviderApiKeyChangeRequestsController,
  ProviderApiKeysController,
} from './provider-api-keys.controller.js';
import { ProviderApiKeysService } from './provider-api-keys.service.js';
import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';

@Module({
  controllers: [ProvidersController, ProviderApiKeysController, AdminProviderApiKeyChangeRequestsController],
  providers: [ProvidersService, ProviderApiKeysService, ProviderApiKeyAuthService],
  exports: [ProviderApiKeyAuthService],
})
export class ProvidersModule {}
