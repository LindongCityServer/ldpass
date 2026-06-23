import { Module } from '@nestjs/common';
import { ProviderWebhookDispatcherService } from './provider-webhook-dispatcher.service.js';
import {
  AdminProviderWebhookChangeRequestsController,
  ProviderWebhooksController,
} from './provider-webhooks.controller.js';
import { ProviderWebhooksService } from './provider-webhooks.service.js';
import { WebhookSecretCryptoService } from './webhook-secret-crypto.service.js';

@Module({
  controllers: [ProviderWebhooksController, AdminProviderWebhookChangeRequestsController],
  providers: [ProviderWebhooksService, ProviderWebhookDispatcherService, WebhookSecretCryptoService],
})
export class WebhooksModule {}
