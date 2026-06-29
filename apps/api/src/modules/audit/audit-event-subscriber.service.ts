import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ActorType, DomainEvent, DomainEventType } from '@ldpass/contracts';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { PrismaService } from '../../shared/database/prisma.service.js';

const auditedEventTypes: DomainEventType[] = [
  'UserRegistrationSubmitted',
  'UserRegistrationApproved',
  'UserRegistrationRejected',
  'ServerVerificationCodeIssued',
  'ServerVerificationCodeRotated',
  'ServerAccountVerified',
  'DeviceLoginVerified',
  'DeviceLoginApprovalRequested',
  'DeviceLoginApprovalApproved',
  'DeviceLoginApprovalRejected',
  'ServerAccountRebound',
  'DeviceBound',
  'LoginDeviceRecorded',
  'LoginDeviceSignedOut',
  'PinVerificationSucceeded',
  'UserRegistered',
  'UserLoggedIn',
  'UserAccountDeleted',
  'UserSuspended',
  'UserUnsuspended',
  'UserDeletedByAdmin',
  'UserPreferencesUpdated',
  'CredentialChanged',
  'ProviderSubmitted',
  'ProviderCreatedByAdmin',
  'ProviderAccountCreated',
  'ProviderApproved',
  'ProviderRejected',
  'ProviderSuspended',
  'ProviderUnsuspended',
  'ProviderArchived',
  'ProviderLoggedIn',
  'ProviderProfileChangeSubmitted',
  'ProviderProfileChangeApproved',
  'ProviderProfileChangeRejected',
  'ProviderApiKeyCreateSubmitted',
  'ProviderApiKeyCreateApproved',
  'ProviderApiKeyCreateRejected',
  'ProviderApiKeyCreated',
  'ProviderApiKeySecretClaimed',
  'ProviderApiKeyChangeSubmitted',
  'ProviderApiKeyChangeApproved',
  'ProviderApiKeyChangeRejected',
  'ProviderApiKeyRotated',
  'ProviderApiKeyRevoked',
  'ProviderWebhookEndpointCreateSubmitted',
  'ProviderWebhookEndpointCreateApproved',
  'ProviderWebhookEndpointCreateRejected',
  'ProviderWebhookChangeSubmitted',
  'ProviderWebhookChangeApproved',
  'ProviderWebhookChangeRejected',
  'ProviderWebhookEndpointCreated',
  'ProviderWebhookSecretClaimed',
  'ProviderWebhookEndpointUpdated',
  'ProviderWebhookSecretRotated',
  'ProviderWebhookEndpointDeleted',
  'ProviderWebhookDeliveryRetryRequested',
  'ClientApplicationCreated',
  'ClientApplicationUpdated',
  'PassTemplateCreated',
  'PassTemplateUpdateSubmitted',
  'PassTemplateApproved',
  'PassTemplateRejected',
  'CardTemplateVariantCreated',
  'CardTemplateVariantUpdated',
  'CardTemplateVariantDeleted',
  'PassIssued',
  'PassAddedToWallet',
  'PassOrderUpdated',
  'PassTransferRequested',
  'PassTransferAccepted',
  'PassTransferRejected',
  'PassTransferCancelled',
  'PassTopUpRequested',
  'PassTopUpSucceeded',
  'PassTopUpFailed',
  'PassTopUpExpired',
  'PassTopUpCancelled',
  'PassTopUpReversed',
  'WalletActionLinkCreated',
  'WalletActionLinkConsumed',
  'WalletActionLinkExpired',
  'WalletActionLinkRevoked',
  'AddPassTokenRevoked',
  'AddPassTokenReissued',
  'PassBalanceChanged',
  'PassTicketStatusUpdated',
  'PassTicketUpdateSubmitted',
  'PassTicketUpdateApproved',
  'PassTicketUpdateRejected',
  'PassExpirationReminderCreated',
  'UserNotificationRead',
  'AdminBalanceAdjustmentRequested',
  'AdminBalanceAdjustmentApproved',
  'DisputeStatusChanged',
  'ServerLocationVerified',
  'PassUseRequested',
  'PassUseSucceeded',
  'PassUseFailed',
  'PassUseCancelled',
  'PassFrozen',
  'PassUnfrozen',
  'PassDeleted',
  'PlatformThemeScheduleUpdated',
  'LegalDocumentUpdated',
  'PlatformStatusUpdated',
  'StorageAlertRaised',
  'StorageAlertResolved',
];

@Injectable()
export class AuditEventSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly unsubscribeCallbacks: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  onModuleInit(): void {
    for (const eventType of auditedEventTypes) {
      const unsubscribe = this.eventBus.subscribe(eventType, async (event) => {
        await this.persistEvent(event);
      });
      this.unsubscribeCallbacks.push(unsubscribe);
    }
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribeCallbacks.splice(0)) {
      unsubscribe();
    }
  }

  private async persistEvent(event: DomainEvent): Promise<void> {
    const subject = this.readSubject(event);
    const payload = this.toJson(event.payload);
    const summary = this.toJson({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      payload,
    });
    const outboxPayload = this.toJson({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      actorType: event.actorType,
      actorId: event.actorId,
      traceId: event.traceId ?? null,
      payload,
    });

    await this.prisma.$transaction([
      this.prisma.auditLog.create({
        data: {
          eventType: event.type,
          actorType: event.actorType,
          actorId: event.actorId,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          traceId: event.traceId ?? null,
          summary,
          context: this.toJson({ payload }),
          contextHash: event.eventId,
          retentionPolicy: 'permanent',
          createdAt: new Date(event.occurredAt),
        },
      }),
      this.prisma.outboxEvent.create({
        data: {
          type: event.type,
          payload: outboxPayload,
          traceId: event.traceId ?? null,
        },
      }),
    ]);
  }

  private readSubject(event: DomainEvent): {
    subjectType: string;
    subjectId: string;
  } {
    const payload = event.payload as Record<string, unknown>;
    const orderedSubjectKeys = [
      'topUpId',
      'apiKeyChangeRequestId',
      'webhookChangeRequestId',
      'profileChangeRequestId',
      'ticketUpdateRequestId',
      'addPassTokenId',
      'actionLinkId',
      'userId',
      'providerId',
      'providerAccountId',
      'endpointId',
      'deliveryId',
      'apiKeyId',
      'previousApiKeyId',
      'nextApiKeyId',
      'clientApplicationId',
      'templateId',
      'variantId',
      'passId',
      'transferId',
      'requestId',
      'disputeId',
      'adjustmentId',
      'notificationId',
      'alertId',
      'key',
      'verificationId',
      'approvalId',
      'deviceId',
      'updatedBy',
    ];

    for (const key of orderedSubjectKeys) {
      const value = payload[key];
      if (typeof value === 'string' && value.length > 0) {
        return {
          subjectType: this.toSubjectType(key, event.actorType),
          subjectId: value,
        };
      }
    }

    return {
      subjectType: 'event',
      subjectId: event.eventId,
    };
  }

  private toSubjectType(key: string, fallbackActorType: ActorType): string {
    const subjectTypes: Record<string, string> = {
      adjustmentId: 'admin_balance_adjustment',
      alertId: 'storage_alert',
      approvalId: 'device_login_approval',
      clientApplicationId: 'client_application',
      deviceId: 'device',
      disputeId: 'dispute',
      endpointId: 'provider_webhook_endpoint',
      deliveryId: 'provider_webhook_delivery',
      key: 'legal_document',
      passId: 'pass',
      apiKeyChangeRequestId: 'provider_api_key_change_request',
      apiKeyId: 'provider_api_key',
      nextApiKeyId: 'provider_api_key',
      previousApiKeyId: 'provider_api_key',
      providerId: 'provider',
      providerAccountId: 'provider_account',
      webhookChangeRequestId: 'provider_webhook_change_request',
      profileChangeRequestId: 'provider_profile_change_request',
      requestId: 'redemption_request',
      notificationId: 'user_notification',
      templateId: 'pass_template',
      transferId: 'pass_transfer',
      topUpId: 'pass_top_up',
      ticketUpdateRequestId: 'pass_ticket_update_request',
      actionLinkId: 'wallet_action_link',
      addPassTokenId: 'add_pass_token',
      variantId: 'card_template_variant',
      updatedBy: fallbackActorType,
      userId: 'user',
      verificationId: 'server_verification',
    };

    return subjectTypes[key] ?? 'event';
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
