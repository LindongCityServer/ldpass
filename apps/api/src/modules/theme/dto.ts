import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

const accentTones = ['teal', 'red', 'gray'] as const;

export class ThemeScheduleEntryDto {
  @IsISO8601()
  effectiveAt!: string;

  @IsIn(accentTones)
  tone!: (typeof accentTones)[number];

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class UpdateThemeScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ThemeScheduleEntryDto)
  entries!: ThemeScheduleEntryDto[];
}
