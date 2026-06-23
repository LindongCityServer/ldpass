import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateWalletDisputeDto {
  @IsUUID()
  passId!: string;

  @IsOptional()
  @IsUUID()
  ledgerEntryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  subjectId?: string;

  @IsString()
  @MaxLength(600)
  reason!: string;
}

export class DisputesQueryDto {
  @IsOptional()
  @IsIn(['Submitted', 'InReview', 'NeedMoreInfo', 'Approved', 'Rejected', 'Reversed', 'Closed'])
  status?: 'Submitted' | 'InReview' | 'NeedMoreInfo' | 'Approved' | 'Rejected' | 'Reversed' | 'Closed';

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

export class UpdateDisputeStatusDto {
  @IsIn(['InReview', 'NeedMoreInfo', 'Approved', 'Rejected', 'Reversed', 'Closed'])
  status!: 'InReview' | 'NeedMoreInfo' | 'Approved' | 'Rejected' | 'Reversed' | 'Closed';

  @IsOptional()
  @IsString()
  @MaxLength(600)
  resolutionNote?: string;

  @IsOptional()
  @IsBoolean()
  reversalConfirmed?: boolean;
}
