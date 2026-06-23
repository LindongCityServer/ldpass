import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const passCategories = ['account', 'identity_key', 'ticket'] as const;
const benefitTypes = ['amount', 'points', 'times'] as const;

export class CreateAddPassTokenDto {
  @IsString()
  @MaxLength(80)
  providerName!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{2,48}$/)
  providerSlug!: string;

  @IsIn(passCategories)
  category!: (typeof passCategories)[number];

  @IsIn(benefitTypes)
  benefitType!: (typeof benefitTypes)[number];

  @IsString()
  @MaxLength(80)
  displayName!: string;

  @IsString()
  @MaxLength(80)
  title!: string;

  @IsString()
  @Matches(/^-?\d+(\.\d{1,6})?$/)
  initialValue!: string;

  @IsOptional()
  @IsBoolean()
  requireServerVerifiedUser?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  passExpiresInDays?: number;
}

export class ListAddPassTokensQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;

  @IsOptional()
  @IsIn(['Active', 'Claimed', 'Expired', 'Revoked'])
  status?: 'Active' | 'Claimed' | 'Expired' | 'Revoked';
}

export class RevokeAddPassTokenDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}

export class ReissueAddPassTokenDto {
  @IsString()
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
