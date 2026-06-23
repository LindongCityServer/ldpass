import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  eventType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  take?: string;
}
