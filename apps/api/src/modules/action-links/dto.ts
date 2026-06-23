import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateWalletActionLinkDto {
  @IsIn(['use', 'top_up'])
  kind!: 'use' | 'top_up';

  @IsUUID()
  targetPassId!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,6})?$/)
  requestedValue!: string;

  @IsIn(['server_account', 'pin'])
  verificationMethod!: 'server_account' | 'pin';

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86_400)
  expiresInSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class WalletActionLinkQueryDto {
  @IsOptional()
  @IsIn(['use', 'top_up'])
  kind?: 'use' | 'top_up';

  @IsOptional()
  @IsIn(['Active', 'Consumed', 'Expired', 'Revoked'])
  status?: 'Active' | 'Consumed' | 'Expired' | 'Revoked';

  @IsOptional()
  @IsUUID()
  targetPassId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}

export class RevokeWalletActionLinkDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}

export class BatchRevokeWalletActionLinksDto extends RevokeWalletActionLinkDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  actionLinkIds!: string[];
}

export class PreviewWalletActionLinkQueryDto {
  @IsString()
  @MinLength(12)
  @MaxLength(160)
  token!: string;
}

export class ConfirmWalletActionLinkWithPinDto {
  @IsString()
  @MinLength(12)
  @MaxLength(160)
  token!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  pin!: string;

  @IsOptional()
  @IsUUID()
  sourcePassId?: string;
}

export class StartWalletActionLinkServerRedemptionDto {
  @IsString()
  @MinLength(12)
  @MaxLength(160)
  token!: string;

  @IsOptional()
  @IsUUID()
  sourcePassId?: string;
}

export class CompleteWalletActionLinkServerRedemptionDto {
  @IsString()
  @MinLength(12)
  @MaxLength(160)
  token!: string;

  @IsUUID()
  redemptionRequestId!: string;
}

export class ConfirmWalletActionLinkWithServerDto {
  @IsString()
  @MinLength(12)
  @MaxLength(160)
  token!: string;

  @IsUUID()
  challengeId!: string;

  @IsUUID()
  sourcePassId!: string;
}

export class CancelWalletActionLinkTopUpRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
