import { Module } from '@nestjs/common';
import { AdminModule } from './modules/admin/admin.module.js';
import { ActionLinksModule } from './modules/action-links/action-links.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { BdslmModule } from './modules/bdslm/bdslm.module.js';
import { CardTemplateVariantsModule } from './modules/card-template-variants/card-template-variants.module.js';
import { DisputesModule } from './modules/disputes/disputes.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { IssuingModule } from './modules/issuing/issuing.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { LegalModule } from './modules/legal/legal.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PassTemplatesModule } from './modules/pass-templates/pass-templates.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';
import { RedemptionModule } from './modules/redemption/redemption.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { ThemeModule } from './modules/theme/theme.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { AuthModule } from './shared/auth/auth.module.js';
import { DatabaseModule } from './shared/database/database.module.js';
import { EventBusModule } from './shared/event-bus/event-bus.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    EventBusModule,
    HealthModule,
    IdentityModule,
    ActionLinksModule,
    WalletModule,
    ProvidersModule,
    CardTemplateVariantsModule,
    PassTemplatesModule,
    IssuingModule,
    LedgerModule,
    LegalModule,
    NotificationsModule,
    RedemptionModule,
    DisputesModule,
    PlatformModule,
    AdminModule,
    AuditModule,
    BdslmModule,
    StorageModule,
    ThemeModule,
    WebhooksModule,
  ],
})
export class AppModule {}
