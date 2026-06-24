import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RegisterReviewDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  username!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  reviewInfo!: string;
}

export class RegisterServerStartDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  username!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  serverId!: string;
}

export class ResubmitReviewDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  reviewInfo!: string;
}

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  clientDeviceId?: string;

  @IsOptional()
  @IsIn(['android', 'ios', 'windows', 'macos', 'linux', 'other'])
  deviceSystem?: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  deviceLabel?: string;
}

export class LoginRedirectQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  client_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  state?: string;
}

export class ClientSessionQueryDto {
  @IsString()
  @MaxLength(80)
  client_id!: string;
}

export class AdminLoginDto extends LoginDto {
  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;
}

export class DeleteAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class SetPinDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  pin!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  nextPassword!: string;
}

export class StartServerAccountRebindDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  serverId!: string;
}

export class UpdateAccountPreferencesDto {
  @IsInt()
  @Min(1)
  @Max(90)
  expirationReminderDays!: number;
}
