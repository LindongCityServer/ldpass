import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateRedemptionRequestDto {
  @IsUUID()
  passId!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,6})?$/)
  requestedValue!: string;

  @IsIn(['server_account', 'pin'])
  verificationMethod!: 'server_account' | 'pin';

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  expiresInSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxVerificationAttempts?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class CreateWalletRedemptionRequestDto {
  @IsUUID()
  passId!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,6})?$/)
  requestedValue!: string;

  @IsIn(['server_account', 'pin'])
  verificationMethod!: 'server_account' | 'pin';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class PreviewProviderRedemptionPassDto {
  @IsString()
  @MaxLength(512)
  cardNumber!: string;
}

export class CreateRedemptionByCardNumberDto {
  @IsString()
  @MaxLength(512)
  cardNumber!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,6})?$/)
  requestedValue!: string;

  @IsIn(['server_account', 'pin'])
  verificationMethod!: 'server_account' | 'pin';

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  expiresInSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxVerificationAttempts?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class RedemptionQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;

  @IsOptional()
  @IsUUID()
  passId?: string;
}

export class ConfirmRedemptionWithPinDto {
  @IsString()
  @Matches(/^\d{4,12}$/)
  pin!: string;
}

export class ConfirmRedemptionWithServerDto {
  @IsUUID()
  challengeId!: string;
}

export class CancelRedemptionRequestDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}

export class ReverseRedemptionRequestDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}

export class AdminReverseRedemptionRequestDto extends ReverseRedemptionRequestDto {
  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;
}
