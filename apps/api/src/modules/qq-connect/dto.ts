import { IsOptional, IsString, MaxLength } from 'class-validator';

export class QqConnectStartQueryDto {
  /** 站内回跳路径，只接受以 / 开头的相对地址。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  redirect?: string;
}

export class QqConnectCallbackQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error_description?: string;
}
