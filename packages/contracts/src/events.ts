import type {
  ActorType,
  BenefitType,
  DeviceSystem,
  DisputeStatus,
  IpRegion,
  LegalDocumentKey,
  LoginIdentifierType,
  PassCategory,
  PassTopUpStatus,
  PlatformNoticeTone,
  ProviderStatus,
  ProviderProfileChangeRequestStatus,
  ProviderWebhookChangeRequestKind,
  ProviderWebhookChangeRequestStatus,
  ProviderApiKeyScope,
  ThemeAccentTone,
  UserStatus,
  VerificationMethod,
  WalletActionLinkKind,
} from './domain.js';

export interface BaseEvent {
  eventId: string;
  occurredAt: string;
  actorType: ActorType;
  actorId: string;
  traceId?: string;
}

export interface UserRegistrationSubmitted extends BaseEvent {
  type: 'UserRegistrationSubmitted';
  payload: {
    userId: string;
    username: string;
    email: string;
    reviewInfo: string;
    registrationIp: string;
    ipRegion?: IpRegion;
    reviewMode: 'admin_review' | 'server_account_verification';
    resubmitted?: boolean;
    previousStatus?: UserStatus;
  };
}

export interface UserRegistrationApproved extends BaseEvent {
  type: 'UserRegistrationApproved';
  payload: {
    userId: string;
    approvedBy: string;
  };
}

export interface UserRegistrationRejected extends BaseEvent {
  type: 'UserRegistrationRejected';
  payload: {
    userId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ServerVerificationCodeIssued extends BaseEvent {
  type: 'ServerVerificationCodeIssued';
  payload: {
    userId: string;
    serverId: string;
    verificationId: string;
    expiresAt: string;
    purpose?:
      | 'registration'
      | 'login_device'
      | 'server_account_rebind'
      | 'pass_use'
      | 'pass_top_up';
  };
}

export interface ServerVerificationCodeRotated extends BaseEvent {
  type: 'ServerVerificationCodeRotated';
  payload: {
    userId: string;
    serverId: string;
    verificationId: string;
    previousVerificationId: string;
    reason: 'chat_mismatch' | 'manual_refresh' | 'expired' | 'rate_limit_retry';
    purpose?:
      | 'registration'
      | 'login_device'
      | 'server_account_rebind'
      | 'pass_use'
      | 'pass_top_up';
  };
}

export interface ServerAccountVerified extends BaseEvent {
  type: 'ServerAccountVerified';
  payload: {
    userId: string;
    serverId: string;
    verificationId: string;
  };
}

export interface DeviceLoginVerified extends BaseEvent {
  type: 'DeviceLoginVerified';
  payload: {
    userId: string;
    deviceId: string;
    serverId: string;
    verificationId: string;
  };
}

export interface DeviceLoginApprovalRequested extends BaseEvent {
  type: 'DeviceLoginApprovalRequested';
  payload: {
    approvalId: string;
    userId: string;
    deviceSystem: DeviceSystem;
    deviceLabel?: string;
    expiresAt: string;
  };
}

export interface DeviceLoginApprovalApproved extends BaseEvent {
  type: 'DeviceLoginApprovalApproved';
  payload: {
    approvalId: string;
    userId: string;
    approvedBy: string;
  };
}

export interface DeviceLoginApprovalRejected extends BaseEvent {
  type: 'DeviceLoginApprovalRejected';
  payload: {
    approvalId: string;
    userId: string;
    rejectedBy: string;
  };
}

export interface ServerAccountRebound extends BaseEvent {
  type: 'ServerAccountRebound';
  payload: {
    userId: string;
    previousServerId: string;
    nextServerId: string;
    revokedDeviceIds: string[];
  };
}

export interface DeviceBound extends BaseEvent {
  type: 'DeviceBound';
  payload: {
    userId: string;
    deviceId: string;
    deviceSystem: DeviceSystem;
    deviceLabel?: string;
    trustedUntil?: string;
  };
}

export interface PinVerificationSucceeded extends BaseEvent {
  type: 'PinVerificationSucceeded';
  payload: {
    userId: string;
    challengeId: string;
    purpose: 'login' | 'sensitive_action' | 'admin_adjustment' | 'pass_use' | 'pass_top_up';
  };
}

export interface UserRegistered extends BaseEvent {
  type: 'UserRegistered';
  payload: {
    userId: string;
    loginIdentifierType: LoginIdentifierType;
    registrationPath: 'admin_approved' | 'server_account_verified';
  };
}

export interface UserLoggedIn extends BaseEvent {
  type: 'UserLoggedIn';
  payload: {
    userId: string;
    deviceId?: string;
    clientId?: string;
    accountStatus?: UserStatus;
    restricted?: boolean;
  };
}

export interface UserAccountDeleted extends BaseEvent {
  type: 'UserAccountDeleted';
  payload: {
    userId: string;
    reason: 'self_requested' | 'admin_removed';
  };
}

export interface UserSuspended extends BaseEvent {
  type: 'UserSuspended';
  payload: {
    userId: string;
    suspendedBy: string;
    reason: string;
  };
}

export interface UserUnsuspended extends BaseEvent {
  type: 'UserUnsuspended';
  payload: {
    userId: string;
    unsuspendedBy: string;
    reason: string;
  };
}

export interface UserDeletedByAdmin extends BaseEvent {
  type: 'UserDeletedByAdmin';
  payload: {
    userId: string;
    deletedBy: string;
    reason: string;
    deletionMode: 'soft_delete' | 'anonymize_and_release';
  };
}

export interface UserPreferencesUpdated extends BaseEvent {
  type: 'UserPreferencesUpdated';
  payload: {
    userId: string;
    expirationReminderDays: number;
    previousExpirationReminderDays: number;
  };
}

export interface CredentialChanged extends BaseEvent {
  type: 'CredentialChanged';
  payload: {
    userId: string;
    credentialType: 'password' | 'pin';
    changedBy: 'self' | 'admin';
  };
}

export interface ProviderSubmitted extends BaseEvent {
  type: 'ProviderSubmitted';
  payload: {
    providerId: string;
    source: 'admin_created' | 'open_registration';
    resubmitted?: boolean;
    previousStatus?: ProviderStatus;
  };
}

export interface ProviderCreatedByAdmin extends BaseEvent {
  type: 'ProviderCreatedByAdmin';
  payload: {
    providerId: string;
    createdBy: string;
  };
}

export interface ProviderAccountCreated extends BaseEvent {
  type: 'ProviderAccountCreated';
  payload: {
    providerId: string;
    providerAccountId: string;
    email: string;
  };
}

export interface ProviderApproved extends BaseEvent {
  type: 'ProviderApproved';
  payload: {
    providerId: string;
    approvedBy: string;
  };
}

export interface ProviderRejected extends BaseEvent {
  type: 'ProviderRejected';
  payload: {
    providerId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ProviderSuspended extends BaseEvent {
  type: 'ProviderSuspended';
  payload: {
    providerId: string;
    suspendedBy: string;
    reason: string;
  };
}

export interface ProviderUnsuspended extends BaseEvent {
  type: 'ProviderUnsuspended';
  payload: {
    providerId: string;
    unsuspendedBy: string;
    reason: string;
  };
}

export interface ProviderArchived extends BaseEvent {
  type: 'ProviderArchived';
  payload: {
    providerId: string;
    archivedBy: string;
    reason: string;
    archivedAccountCount: number;
    revokedApiKeyCount: number;
    disabledWebhookEndpointCount: number;
  };
}

export interface ProviderLoggedIn extends BaseEvent {
  type: 'ProviderLoggedIn';
  payload: {
    providerId: string;
    providerAccountId: string;
  };
}

export interface ProviderProfileChangeSubmitted extends BaseEvent {
  type: 'ProviderProfileChangeSubmitted';
  payload: {
    profileChangeRequestId: string;
    providerId: string;
    requestedBy: string;
    status: Extract<ProviderProfileChangeRequestStatus, 'PendingReview'>;
  };
}

export interface ProviderProfileChangeApproved extends BaseEvent {
  type: 'ProviderProfileChangeApproved';
  payload: {
    profileChangeRequestId: string;
    providerId: string;
    approvedBy: string;
  };
}

export interface ProviderProfileChangeRejected extends BaseEvent {
  type: 'ProviderProfileChangeRejected';
  payload: {
    profileChangeRequestId: string;
    providerId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ProviderApiKeyCreated extends BaseEvent {
  type: 'ProviderApiKeyCreated';
  payload: {
    providerId: string;
    apiKeyId: string;
    createdBy: string;
    scopes: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyRotated extends BaseEvent {
  type: 'ProviderApiKeyRotated';
  payload: {
    providerId: string;
    previousApiKeyId: string;
    nextApiKeyId: string;
    rotatedBy: string;
    scopes: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyRevoked extends BaseEvent {
  type: 'ProviderApiKeyRevoked';
  payload: {
    providerId: string;
    apiKeyId: string;
    revokedBy: string;
  };
}

export interface ProviderApiKeyCreateSubmitted extends BaseEvent {
  type: 'ProviderApiKeyCreateSubmitted';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    requestedBy: string;
    scopes: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyCreateApproved extends BaseEvent {
  type: 'ProviderApiKeyCreateApproved';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    apiKeyId: string;
    approvedBy: string;
    scopes: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyCreateRejected extends BaseEvent {
  type: 'ProviderApiKeyCreateRejected';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ProviderApiKeySecretClaimed extends BaseEvent {
  type: 'ProviderApiKeySecretClaimed';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    apiKeyId: string;
    claimedBy: string;
  };
}

export interface ProviderApiKeyChangeSubmitted extends BaseEvent {
  type: 'ProviderApiKeyChangeSubmitted';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    kind: 'CreateApiKey' | 'RotateApiKey' | 'RevokeApiKey';
    requestedBy: string;
    targetApiKeyId?: string;
    scopes?: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyChangeApproved extends BaseEvent {
  type: 'ProviderApiKeyChangeApproved';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    kind: 'CreateApiKey' | 'RotateApiKey' | 'RevokeApiKey';
    approvedBy: string;
    targetApiKeyId?: string;
    apiKeyId?: string;
    scopes?: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyChangeRejected extends BaseEvent {
  type: 'ProviderApiKeyChangeRejected';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    kind: 'CreateApiKey' | 'RotateApiKey' | 'RevokeApiKey';
    rejectedBy: string;
    reason: string;
    targetApiKeyId?: string;
  };
}

export interface ProviderWebhookEndpointCreated extends BaseEvent {
  type: 'ProviderWebhookEndpointCreated';
  payload: {
    providerId: string;
    endpointId: string;
    createdBy: string;
    eventTypes: string[];
  };
}

export interface ProviderWebhookEndpointCreateSubmitted extends BaseEvent {
  type: 'ProviderWebhookEndpointCreateSubmitted';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    requestedBy: string;
    eventTypes: string[];
  };
}

export interface ProviderWebhookEndpointCreateApproved extends BaseEvent {
  type: 'ProviderWebhookEndpointCreateApproved';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    endpointId: string;
    approvedBy: string;
    eventTypes: string[];
  };
}

export interface ProviderWebhookEndpointCreateRejected extends BaseEvent {
  type: 'ProviderWebhookEndpointCreateRejected';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ProviderWebhookChangeSubmitted extends BaseEvent {
  type: 'ProviderWebhookChangeSubmitted';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    kind: ProviderWebhookChangeRequestKind;
    requestedBy: string;
    status: Extract<ProviderWebhookChangeRequestStatus, 'PendingReview'>;
    endpointId?: string;
    eventTypes?: string[];
    enabled?: boolean;
  };
}

export interface ProviderWebhookChangeApproved extends BaseEvent {
  type: 'ProviderWebhookChangeApproved';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    kind: ProviderWebhookChangeRequestKind;
    approvedBy: string;
    endpointId?: string;
    eventTypes?: string[];
    enabled?: boolean;
  };
}

export interface ProviderWebhookChangeRejected extends BaseEvent {
  type: 'ProviderWebhookChangeRejected';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    kind: ProviderWebhookChangeRequestKind;
    rejectedBy: string;
    reason: string;
    endpointId?: string;
  };
}

export interface ProviderWebhookSecretClaimed extends BaseEvent {
  type: 'ProviderWebhookSecretClaimed';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    endpointId: string;
    claimedBy: string;
  };
}

export interface ProviderWebhookEndpointUpdated extends BaseEvent {
  type: 'ProviderWebhookEndpointUpdated';
  payload: {
    providerId: string;
    endpointId: string;
    updatedBy: string;
    enabled: boolean;
    eventTypes: string[];
  };
}

export interface ProviderWebhookSecretRotated extends BaseEvent {
  type: 'ProviderWebhookSecretRotated';
  payload: {
    providerId: string;
    endpointId: string;
    rotatedBy: string;
  };
}

export interface ProviderWebhookEndpointDeleted extends BaseEvent {
  type: 'ProviderWebhookEndpointDeleted';
  payload: {
    providerId: string;
    endpointId: string;
    deletedBy: string;
  };
}

export interface ProviderWebhookDeliveryRetryRequested extends BaseEvent {
  type: 'ProviderWebhookDeliveryRetryRequested';
  payload: {
    providerId: string;
    endpointId: string;
    deliveryId: string;
    requestedBy: string;
  };
}

export interface ClientApplicationCreated extends BaseEvent {
  type: 'ClientApplicationCreated';
  payload: {
    clientApplicationId: string;
    clientId: string;
    name: string;
    createdBy: string;
  };
}

export interface ClientApplicationUpdated extends BaseEvent {
  type: 'ClientApplicationUpdated';
  payload: {
    clientApplicationId: string;
    clientId: string;
    name: string;
    enabled: boolean;
    updatedBy: string;
  };
}

export interface PassTemplateCreated extends BaseEvent {
  type: 'PassTemplateCreated';
  payload: {
    providerId: string;
    templateId: string;
    category: PassCategory;
    benefitType: BenefitType;
    version: number;
  };
}

export interface PassTemplateUpdateSubmitted extends BaseEvent {
  type: 'PassTemplateUpdateSubmitted';
  payload: {
    providerId: string;
    templateId: string;
    category: PassCategory;
    benefitType: BenefitType;
    version: number;
  };
}

export interface PassTemplateApproved extends BaseEvent {
  type: 'PassTemplateApproved';
  payload: {
    providerId: string;
    templateId: string;
    approvedBy: string;
    version: number;
  };
}

export interface PassTemplateRejected extends BaseEvent {
  type: 'PassTemplateRejected';
  payload: {
    providerId: string;
    templateId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface CardTemplateVariantCreated extends BaseEvent {
  type: 'CardTemplateVariantCreated';
  payload: {
    variantId: string;
    key: string;
    category: PassCategory;
    createdBy: string;
  };
}

export interface CardTemplateVariantUpdated extends BaseEvent {
  type: 'CardTemplateVariantUpdated';
  payload: {
    variantId: string;
    key: string;
    category: PassCategory;
    enabled: boolean;
    updatedBy: string;
  };
}

export interface CardTemplateVariantDeleted extends BaseEvent {
  type: 'CardTemplateVariantDeleted';
  payload: {
    variantId: string;
    key: string;
    deletedBy: string;
  };
}

export interface PassIssued extends BaseEvent {
  type: 'PassIssued';
  payload: {
    providerId: string;
    templateId: string;
    passId: string;
    externalUserId?: string;
    issueBatchId?: string;
  };
}

export interface PassAddedToWallet extends BaseEvent {
  type: 'PassAddedToWallet';
  payload: {
    userId: string;
    passId: string;
    source: 'manual' | 'link' | 'qr_code' | 'api';
  };
}

export interface PassOrderUpdated extends BaseEvent {
  type: 'PassOrderUpdated';
  payload: {
    userId: string;
    passIds: string[];
  };
}

export interface PassTransferRequested extends BaseEvent {
  type: 'PassTransferRequested';
  payload: {
    transferId: string;
    passId: string;
    fromUserId: string;
    toUserId: string;
    expiresAt: string;
  };
}

export interface PassTransferAccepted extends BaseEvent {
  type: 'PassTransferAccepted';
  payload: {
    transferId: string;
    passId: string;
    fromUserId: string;
    toUserId: string;
  };
}

export interface PassTransferRejected extends BaseEvent {
  type: 'PassTransferRejected';
  payload: {
    transferId: string;
    passId: string;
    fromUserId: string;
    toUserId: string;
    reason?: string;
  };
}

export interface PassTransferCancelled extends BaseEvent {
  type: 'PassTransferCancelled';
  payload: {
    transferId: string;
    passId: string;
    fromUserId: string;
    toUserId: string;
    reason?: string;
  };
}

export interface PassBalanceChanged extends BaseEvent {
  type: 'PassBalanceChanged';
  payload: {
    passId: string;
    providerId: string;
    balanceType: BenefitType;
    beforeValue: string;
    afterValue: string;
    changeValue: string;
    reason: 'issue' | 'grant' | 'use' | 'top_up' | 'adjustment' | 'refund' | 'sync';
    referenceId?: string;
  };
}

export interface PassTopUpSucceeded extends BaseEvent {
  type: 'PassTopUpSucceeded';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    providerId: string;
    sourceProviderId: string;
    benefitType: BenefitType;
    value: string;
    sourceLedgerEntryId: string;
    targetLedgerEntryId: string;
  };
}

export interface PassTopUpRequested extends BaseEvent {
  type: 'PassTopUpRequested';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    providerId: string;
    sourceProviderId: string;
    benefitType: BenefitType;
    value: string;
    verificationMethod: VerificationMethod;
    status: PassTopUpStatus;
    expiresAt?: string;
  };
}

export interface PassTopUpFailed extends BaseEvent {
  type: 'PassTopUpFailed';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  };
}

export interface PassTopUpExpired extends BaseEvent {
  type: 'PassTopUpExpired';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    expiredAt: string;
  };
}

export interface PassTopUpCancelled extends BaseEvent {
  type: 'PassTopUpCancelled';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    reason?: string;
  };
}

export interface PassTopUpReversed extends BaseEvent {
  type: 'PassTopUpReversed';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    providerId: string;
    sourceProviderId: string;
    benefitType: BenefitType;
    reversedValue: string;
    sourceLedgerEntryId: string;
    targetLedgerEntryId: string;
    sourceRefundLedgerEntryId: string;
    targetRefundLedgerEntryId: string;
    reversedBy: string;
    reason: string;
  };
}

export interface WalletActionLinkCreated extends BaseEvent {
  type: 'WalletActionLinkCreated';
  payload: {
    actionLinkId: string;
    providerId: string;
    targetPassId: string;
    kind: WalletActionLinkKind;
    value: string;
    verificationMethod: VerificationMethod;
    expiresAt: string;
  };
}

export interface WalletActionLinkConsumed extends BaseEvent {
  type: 'WalletActionLinkConsumed';
  payload: {
    actionLinkId: string;
    providerId: string;
    targetPassId: string;
    userId: string;
    kind: WalletActionLinkKind;
    value: string;
    referenceType: 'redemption_request' | 'pass_top_up';
    referenceId: string;
  };
}

export interface WalletActionLinkExpired extends BaseEvent {
  type: 'WalletActionLinkExpired';
  payload: {
    actionLinkId: string;
    providerId: string;
    targetPassId: string;
    kind: WalletActionLinkKind;
  };
}

export interface WalletActionLinkRevoked extends BaseEvent {
  type: 'WalletActionLinkRevoked';
  payload: {
    actionLinkId: string;
    providerId: string;
    targetPassId: string;
    kind: WalletActionLinkKind;
    reason: string;
  };
}

export interface AddPassTokenRevoked extends BaseEvent {
  type: 'AddPassTokenRevoked';
  payload: {
    addPassTokenId: string;
    providerId: string;
    passId?: string;
    revokedByType: 'admin' | 'provider';
    revokedById: string;
    reason: string;
  };
}

export interface AddPassTokenReissued extends BaseEvent {
  type: 'AddPassTokenReissued';
  payload: {
    oldAddPassTokenId: string;
    newAddPassTokenId: string;
    providerId: string;
    passId: string;
    reissuedByType: 'admin' | 'provider';
    reissuedById: string;
    reason: string;
  };
}

export interface PassTicketStatusUpdated extends BaseEvent {
  type: 'PassTicketStatusUpdated';
  payload: {
    passId: string;
    providerId: string;
    checkInStatus?: 'not_checked_in' | 'checked_in' | 'voided';
    changeStatus?: 'none' | 'rescheduled' | 'cancelled';
    eventName?: string;
    startsAt?: string;
    seatLabel?: string;
  };
}

export interface PassTicketUpdateSubmitted extends BaseEvent {
  type: 'PassTicketUpdateSubmitted';
  payload: {
    ticketUpdateRequestId: string;
    passId: string;
    providerId: string;
    requestedBy: string;
  };
}

export interface PassTicketUpdateApproved extends BaseEvent {
  type: 'PassTicketUpdateApproved';
  payload: {
    ticketUpdateRequestId: string;
    passId: string;
    providerId: string;
    approvedBy: string;
  };
}

export interface PassTicketUpdateRejected extends BaseEvent {
  type: 'PassTicketUpdateRejected';
  payload: {
    ticketUpdateRequestId: string;
    passId: string;
    providerId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface PassExpirationReminderCreated extends BaseEvent {
  type: 'PassExpirationReminderCreated';
  payload: {
    notificationId: string;
    userId: string;
    passId: string;
    benefitType: Extract<BenefitType, 'points' | 'times'>;
    expiresAt: string;
    reminderDays: number;
  };
}

export interface UserNotificationRead extends BaseEvent {
  type: 'UserNotificationRead';
  payload: {
    notificationId: string;
    userId: string;
  };
}

export interface AdminBalanceAdjustmentRequested extends BaseEvent {
  type: 'AdminBalanceAdjustmentRequested';
  payload: {
    adjustmentId: string;
    passId: string;
    requestedBy: string;
    balanceType: BenefitType;
    beforeValue: string;
    afterValue: string;
    reason: string;
  };
}

export interface AdminBalanceAdjustmentApproved extends BaseEvent {
  type: 'AdminBalanceAdjustmentApproved';
  payload: {
    adjustmentId: string;
    approvedBy: string;
    ledgerEntryId: string;
  };
}

export interface DisputeStatusChanged extends BaseEvent {
  type: 'DisputeStatusChanged';
  payload: {
    disputeId: string;
    fromStatus?: DisputeStatus;
    toStatus: DisputeStatus;
    reason?: string;
  };
}

export interface ServerLocationVerified extends BaseEvent {
  type: 'ServerLocationVerified';
  payload: {
    userId: string;
    serverId: string;
    playerName: string;
    ruleId: string;
    x: number;
    z: number;
    verifiedAt: string;
  };
}

export interface PassUseRequested extends BaseEvent {
  type: 'PassUseRequested';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    amount?: string;
    benefitCode?: string;
    verificationMethod: VerificationMethod;
    expiresAt?: string;
    maxVerificationAttempts?: number;
  };
}

export interface PassUseSucceeded extends BaseEvent {
  type: 'PassUseSucceeded';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    recordId: string;
    consumedValue?: string;
    remainingValue?: string;
  };
}

export interface PassUseReversed extends BaseEvent {
  type: 'PassUseReversed';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    recordId: string;
    refundedValue: string;
    remainingValue: string;
    reason: string;
  };
}

export interface PassUseFailed extends BaseEvent {
  type: 'PassUseFailed';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    attemptCount?: number;
    maxAttempts?: number;
    remainingAttempts?: number;
  };
}

export interface PassUseCancelled extends BaseEvent {
  type: 'PassUseCancelled';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    reason: string;
  };
}

export interface PassFrozen extends BaseEvent {
  type: 'PassFrozen';
  payload: {
    passId: string;
    reason: string;
  };
}

export interface PassUnfrozen extends BaseEvent {
  type: 'PassUnfrozen';
  payload: {
    passId: string;
    reason: string;
  };
}

export interface PassDeleted extends BaseEvent {
  type: 'PassDeleted';
  payload: {
    passId: string;
    userId: string | null;
    reason?: string;
  };
}

export interface PlatformThemeScheduleUpdated extends BaseEvent {
  type: 'PlatformThemeScheduleUpdated';
  payload: {
    updatedBy: string;
    entries: Array<{
      effectiveAt: string;
      tone: ThemeAccentTone;
      enabled: boolean;
      note?: string;
    }>;
  };
}

export interface LegalDocumentUpdated extends BaseEvent {
  type: 'LegalDocumentUpdated';
  payload: {
    key: LegalDocumentKey;
    updatedBy: string;
  };
}

export interface PlatformStatusUpdated extends BaseEvent {
  type: 'PlatformStatusUpdated';
  payload: {
    updatedBy: string;
    announcementEnabled: boolean;
    announcementTone: PlatformNoticeTone;
    maintenanceEnabled: boolean;
  };
}

export interface StorageAlertRaised extends BaseEvent {
  type: 'StorageAlertRaised';
  payload: {
    alertId: string;
    drive: string;
    freeBytes: string;
    totalBytes: string;
    projectUsedBytes?: string;
    thresholdBytes?: string;
    thresholdRatio?: string;
  };
}

export interface StorageAlertResolved extends BaseEvent {
  type: 'StorageAlertResolved';
  payload: {
    alertId: string;
    drive: string;
    freeBytes: string;
    totalBytes: string;
  };
}

export type DomainEvent =
  | UserRegistrationSubmitted
  | UserRegistrationApproved
  | UserRegistrationRejected
  | ServerVerificationCodeIssued
  | ServerVerificationCodeRotated
  | ServerAccountVerified
  | DeviceLoginVerified
  | DeviceLoginApprovalRequested
  | DeviceLoginApprovalApproved
  | DeviceLoginApprovalRejected
  | ServerAccountRebound
  | DeviceBound
  | PinVerificationSucceeded
  | UserRegistered
  | UserLoggedIn
  | UserAccountDeleted
  | UserSuspended
  | UserUnsuspended
  | UserDeletedByAdmin
  | UserPreferencesUpdated
  | CredentialChanged
  | ProviderSubmitted
  | ProviderCreatedByAdmin
  | ProviderAccountCreated
  | ProviderApproved
  | ProviderRejected
  | ProviderSuspended
  | ProviderUnsuspended
  | ProviderArchived
  | ProviderLoggedIn
  | ProviderProfileChangeSubmitted
  | ProviderProfileChangeApproved
  | ProviderProfileChangeRejected
  | ProviderApiKeyCreateSubmitted
  | ProviderApiKeyCreateApproved
  | ProviderApiKeyCreateRejected
  | ProviderApiKeyCreated
  | ProviderApiKeySecretClaimed
  | ProviderApiKeyChangeSubmitted
  | ProviderApiKeyChangeApproved
  | ProviderApiKeyChangeRejected
  | ProviderApiKeyRotated
  | ProviderApiKeyRevoked
  | ProviderWebhookEndpointCreateSubmitted
  | ProviderWebhookEndpointCreateApproved
  | ProviderWebhookEndpointCreateRejected
  | ProviderWebhookChangeSubmitted
  | ProviderWebhookChangeApproved
  | ProviderWebhookChangeRejected
  | ProviderWebhookEndpointCreated
  | ProviderWebhookSecretClaimed
  | ProviderWebhookEndpointUpdated
  | ProviderWebhookSecretRotated
  | ProviderWebhookEndpointDeleted
  | ProviderWebhookDeliveryRetryRequested
  | ClientApplicationCreated
  | ClientApplicationUpdated
  | PassTemplateCreated
  | PassTemplateUpdateSubmitted
  | PassTemplateApproved
  | PassTemplateRejected
  | CardTemplateVariantCreated
  | CardTemplateVariantUpdated
  | CardTemplateVariantDeleted
  | PassIssued
  | PassAddedToWallet
  | PassOrderUpdated
  | PassTransferRequested
  | PassTransferAccepted
  | PassTransferRejected
  | PassTransferCancelled
  | PassTopUpRequested
  | PassTopUpSucceeded
  | PassTopUpFailed
  | PassTopUpExpired
  | PassTopUpCancelled
  | PassTopUpReversed
  | WalletActionLinkCreated
  | WalletActionLinkConsumed
  | WalletActionLinkExpired
  | WalletActionLinkRevoked
  | AddPassTokenRevoked
  | AddPassTokenReissued
  | PassBalanceChanged
  | PassTicketStatusUpdated
  | PassTicketUpdateSubmitted
  | PassTicketUpdateApproved
  | PassTicketUpdateRejected
  | PassExpirationReminderCreated
  | UserNotificationRead
  | AdminBalanceAdjustmentRequested
  | AdminBalanceAdjustmentApproved
  | DisputeStatusChanged
  | ServerLocationVerified
  | PassUseRequested
  | PassUseSucceeded
  | PassUseReversed
  | PassUseFailed
  | PassUseCancelled
  | PassFrozen
  | PassUnfrozen
  | PassDeleted
  | PlatformThemeScheduleUpdated
  | LegalDocumentUpdated
  | PlatformStatusUpdated
  | StorageAlertRaised
  | StorageAlertResolved;

export type DomainEventType = DomainEvent['type'];
