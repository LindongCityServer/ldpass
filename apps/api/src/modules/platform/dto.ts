import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PlatformNoticeTone } from '@ldpass/contracts';

const noticeTones = ['info', 'warning', 'critical'] as const satisfies PlatformNoticeTone[];

export class UpdatePlatformStatusDto {
  @IsBoolean()
  announcementEnabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  announcementTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  announcementBody?: string;

  @IsIn(noticeTones)
  announcementTone!: PlatformNoticeTone;

  @IsBoolean()
  maintenanceEnabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  maintenanceTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  maintenanceBody?: string;
}
