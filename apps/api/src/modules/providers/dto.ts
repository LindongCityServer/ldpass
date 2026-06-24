import { IsEmail, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class RegisterProviderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{2,48}$/)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  contactName!: string;

  @IsEmail()
  @MaxLength(254)
  contactEmail!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  businessInfo!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class ProviderLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,48}$/)
  providerSlug?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class SubmitProviderProfileChangeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(1000)
  logoUrl?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(1000)
  introductionUrl?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  contactName!: string;

  @IsEmail()
  @MaxLength(160)
  contactEmail!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  businessInfo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
