import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateProviderAddPassTokenDto {
  @IsUUID()
  templateId!: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ticketEventName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ticketVenue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ticketStartsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ticketSeatLabel?: string;

  @IsOptional()
  @IsIn(['not_checked_in', 'checked_in', 'voided'])
  ticketCheckInStatus?: 'not_checked_in' | 'checked_in' | 'voided';

  @IsOptional()
  @IsIn(['none', 'rescheduled', 'cancelled'])
  ticketChangeStatus?: 'none' | 'rescheduled' | 'cancelled';
}

export class CreateProviderAddPassTokenBatchDto extends CreateProviderAddPassTokenDto {
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;
}

export class ProviderAddPassTokenQueryDto {
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

export class ProviderPassesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}

export class RevokeProviderAddPassTokenDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}

export class ReissueProviderAddPassTokenDto {
  @IsString()
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class AdjustProviderPassBalanceDto {
  @IsString()
  @Matches(/^[+-]?\d+(\.\d{1,6})?$/)
  changeValue!: string;

  @IsString()
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class ChangeProviderPassStatusDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}

export class UpdateProviderPassTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  eventName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  venue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  startsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  seatLabel?: string;

  @IsOptional()
  @IsIn(['not_checked_in', 'checked_in', 'voided'])
  checkInStatus?: 'not_checked_in' | 'checked_in' | 'voided';

  @IsOptional()
  @IsIn(['none', 'rescheduled', 'cancelled'])
  changeStatus?: 'none' | 'rescheduled' | 'cancelled';
}
