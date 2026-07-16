import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AdminUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}

export class RejectUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class RejectUserAvatarChangeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class RevertUserAvatarDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ResetUserPinDto {
  @IsString()
  @Matches(/^\d{4,12}$/)
  pin!: string;
}

export class ResetUserPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;
}

export class AdminUserSensitiveActionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;
}

export class CreateClientApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  clientId!: string;

  @IsArray()
  @IsString({ each: true })
  allowedRedirects!: string[];

  @IsArray()
  @IsString({ each: true })
  allowedOrigins!: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsUUID()
  providerId?: string | null;
}

export class UpdateClientApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  allowedRedirects!: string[];

  @IsArray()
  @IsString({ each: true })
  allowedOrigins!: string[];

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsUUID()
  providerId?: string | null;
}

export class CreateProviderClientApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  clientId!: string;

  @IsArray()
  @IsString({ each: true })
  allowedRedirects!: string[];

  @IsArray()
  @IsString({ each: true })
  allowedOrigins!: string[];
}

export class UpdateProviderClientApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  allowedRedirects!: string[];

  @IsArray()
  @IsString({ each: true })
  allowedOrigins!: string[];
}
