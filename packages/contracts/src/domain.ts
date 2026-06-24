export type ActorType = 'user' | 'provider' | 'admin' | 'system';

export type UserStatus =
  | 'Draft'
  | 'PendingReview'
  | 'Rejected'
  | 'WaitingServerVerification'
  | 'CodeRotated'
  | 'Verified'
  | 'Approved'
  | 'Active'
  | 'Failed'
  | 'Suspended'
  | 'Deleted';

export type LoginIdentifierType = 'username' | 'email';

export type UserRole = 'user' | 'admin' | 'super_admin';

export type DeviceSystem = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';

export type ProviderStatus = 'PendingReview' | 'Rejected' | 'Active' | 'Suspended' | 'Archived';

export type ProviderProfileChangeRequestStatus = 'PendingReview' | 'Approved' | 'Rejected';

export type ProviderWebhookChangeRequestStatus = 'PendingReview' | 'Approved' | 'Rejected';

export type ProviderWebhookChangeRequestKind =
  | 'CreateEndpoint'
  | 'UpdateEndpoint'
  | 'RotateSecret'
  | 'DeleteEndpoint';

export type PassCategory = 'account' | 'identity_key' | 'ticket';

export type BenefitType = 'amount' | 'points' | 'times';

export type PassStatus =
  | 'Issued'
  | 'Added'
  | 'Active'
  | 'Frozen'
  | 'Expired'
  | 'UsedUp'
  | 'Archived';

export type TemplateStatus =
  | 'Draft'
  | 'PendingReview'
  | 'Rejected'
  | 'Approved'
  | 'Active'
  | 'Suspended'
  | 'Archived';

export type VerificationMethod = 'server_account' | 'pin';

export type ThemeAccentTone = 'teal' | 'red' | 'gray';

export type LegalDocumentKey = 'terms' | 'privacy' | 'provider_agreement';

export type PlatformNoticeTone = 'info' | 'warning' | 'critical';

export type ProviderApiKeyScope =
  | 'add_pass_token:create'
  | 'add_pass_token:batch_create'
  | 'add_pass_token:read'
  | 'add_pass_token:revoke'
  | 'add_pass_token:reissue'
  | 'action_links:create'
  | 'action_links:read'
  | 'action_links:revoke'
  | 'passes:read'
  | 'passes:status_update'
  | 'passes:ticket_update'
  | 'ledger:adjust'
  | 'redemptions:create'
  | 'redemptions:cancel'
  | 'redemptions:reverse'
  | 'redemptions:read';

export type RedemptionStatus =
  | 'Created'
  | 'WaitingVerification'
  | 'Verified'
  | 'Processing'
  | 'Succeeded'
  | 'Reversed'
  | 'Failed'
  | 'Cancelled'
  | 'Expired';

export type WalletActionLinkKind = 'use' | 'top_up';

export type WalletActionLinkStatus = 'Active' | 'Consumed' | 'Expired' | 'Revoked';

export type PassTopUpStatus =
  | 'Created'
  | 'WaitingVerification'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'
  | 'Expired'
  | 'Reversed';

export type DisputeStatus =
  | 'Submitted'
  | 'InReview'
  | 'NeedMoreInfo'
  | 'Approved'
  | 'Rejected'
  | 'Reversed'
  | 'Closed';

export interface IpRegion {
  country?: string;
  provinceOrState?: string;
  city?: string;
  address?: string;
  source: string;
}

export interface PassTemplateRules {
  transferable: boolean;
  shareable: boolean;
  allowOverdraft: boolean;
  allowFrozenBalance: boolean;
  allowTopUpIn?: boolean;
  allowTopUpOut?: boolean;
  expirationReminderDefaultDays: number;
}

export interface LocationRangeRule {
  id: string;
  kind: 'circle' | 'rectangle';
  label: string;
  centerX?: number;
  centerZ?: number;
  radius?: number;
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  expiresAfterSeconds: number;
}

export interface BdslmChatMessage {
  id: number;
  prefix?: string;
  name?: string;
  text?: string;
  time: [number, number, number, number, number, number];
  content?: string;
  message?: string;
  body?: string;
}

export interface BdslmPlayerMarker {
  x: number;
  z: number;
  image: string;
  imageAnchor: [number, number];
  imageScale: number;
  text: string;
  textColor: string;
  offsetX: number;
  offsetY: number;
  font: string;
}
