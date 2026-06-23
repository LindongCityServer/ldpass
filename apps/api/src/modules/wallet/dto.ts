import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ClaimAddPassTokenDto {
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  claimCode!: string;
}

export class PreviewAddPassTokenQueryDto {
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  claimCode!: string;
}

export class ListWalletPassLedgerQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}

export class ListWalletTopUpsQueryDto {
  @IsOptional()
  @IsUUID('4')
  passId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}

export class ReorderWalletPassesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  passIds!: string[];
}

export class TransferWalletPassDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipient!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ResolvePassTransferDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TopUpWalletPassDto {
  @IsUUID('4')
  sourcePassId!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,6})?$/)
  value!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  secondFactor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StartTopUpServerChallengeDto {
  @IsUUID('4')
  sourcePassId!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,6})?$/)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ConfirmTopUpWithServerDto extends StartTopUpServerChallengeDto {
  @IsUUID('4')
  challengeId!: string;
}

export class CancelTopUpRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
