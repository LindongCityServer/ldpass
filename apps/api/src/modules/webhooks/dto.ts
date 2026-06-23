import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import type { DomainEventType } from '@ldpass/contracts';

export const providerWebhookEventTypes = [
  'PassIssued',
  'PassAddedToWallet',
  'AddPassTokenRevoked',
  'AddPassTokenReissued',
  'WalletActionLinkCreated',
  'WalletActionLinkConsumed',
  'WalletActionLinkExpired',
  'WalletActionLinkRevoked',
  'PassTopUpRequested',
  'PassTopUpSucceeded',
  'PassTopUpFailed',
  'PassTopUpExpired',
  'PassTopUpCancelled',
  'PassTopUpReversed',
  'PassTransferRequested',
  'PassTransferAccepted',
  'PassTransferRejected',
  'PassTransferCancelled',
  'PassBalanceChanged',
  'PassTicketStatusUpdated',
  'PassTicketUpdateSubmitted',
  'PassTicketUpdateApproved',
  'PassTicketUpdateRejected',
  'PassUseRequested',
  'PassUseSucceeded',
  'PassUseFailed',
  'PassUseCancelled',
  'PassFrozen',
  'PassUnfrozen',
  'PassDeleted',
  'DisputeStatusChanged',
] as const satisfies DomainEventType[];

export type ProviderWebhookEventType = (typeof providerWebhookEventTypes)[number];

export class CreateProviderWebhookEndpointDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(1000)
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(providerWebhookEventTypes.length)
  @IsIn(providerWebhookEventTypes, { each: true })
  eventTypes!: ProviderWebhookEventType[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateProviderWebhookEndpointDto extends CreateProviderWebhookEndpointDto {}

export class ProviderWebhookChangeReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectProviderWebhookChangeRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
