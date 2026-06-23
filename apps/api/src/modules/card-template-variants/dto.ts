import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CardTemplateVariantsQueryDto {
  @IsOptional()
  @IsIn(['account', 'identity_key', 'ticket'])
  category?: 'account' | 'identity_key' | 'ticket';
}

export class CreateCardTemplateVariantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/)
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn(['account', 'identity_key', 'ticket'])
  category!: 'account' | 'identity_key' | 'ticket';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateCardTemplateVariantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(['account', 'identity_key', 'ticket'])
  category?: 'account' | 'identity_key' | 'ticket';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
