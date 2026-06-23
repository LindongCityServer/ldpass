import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class AdminPassesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}

export class AdjustPassBalanceDto {
  @IsString()
  @Matches(/^[+-]?\d+(\.\d{1,6})?$/)
  changeValue!: string;

  @IsString()
  @MaxLength(200)
  reason!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class ChangePassFreezeStatusDto {
  @IsString()
  @MaxLength(200)
  reason!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;
}

export class ReversePassTopUpDto {
  @IsString()
  @MaxLength(200)
  reason!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;
}

export class ReviewPassTicketUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
