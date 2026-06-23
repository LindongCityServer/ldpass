import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePassTemplateDto {
  @IsIn(['account', 'identity_key', 'ticket'])
  category!: 'account' | 'identity_key' | 'ticket';

  @IsIn(['amount', 'points', 'times'])
  benefitType!: 'amount' | 'points' | 'times';

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  variantKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardColor?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  backgroundImageUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  transferable?: boolean;

  @IsOptional()
  @IsBoolean()
  shareable?: boolean;

  @IsOptional()
  @IsBoolean()
  allowOverdraft?: boolean;

  @IsOptional()
  @IsBoolean()
  allowFrozenBalance?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTopUpIn?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTopUpOut?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  allowedRedemptionProviderIdentifiers?: string;

  @IsOptional()
  @IsBoolean()
  hideTitle?: boolean;

  @IsOptional()
  @IsBoolean()
  requireServerVerifiedUser?: boolean;

  @IsOptional()
  @IsBoolean()
  requireLocationVerification?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  locationRuleLabel?: string;

  @IsOptional()
  @IsIn(['circle', 'rectangle'])
  locationRuleKind?: 'circle' | 'rectangle';

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,3})?$/)
  locationCenterX?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,3})?$/)
  locationCenterZ?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,3})?$/)
  locationRadius?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,3})?$/)
  locationMinX?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,3})?$/)
  locationMaxX?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,3})?$/)
  locationMinZ?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,3})?$/)
  locationMaxZ?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  locationRulesJson?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  locationExpiresAfterSeconds?: number;
}

export class UpdatePassTemplateDto extends CreatePassTemplateDto {}

export class RejectPassTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
