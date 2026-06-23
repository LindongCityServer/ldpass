import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AdminProvidersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}

export class CreateProviderByAdminDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/)
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  contactName!: string;

  @IsEmail()
  @MaxLength(160)
  contactEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  businessInfo?: string;

  @IsEmail()
  @MaxLength(160)
  ownerEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  ownerDisplayName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  ownerPassword!: string;
}

export class RejectProviderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}

export class ProviderSensitiveActionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;
}
