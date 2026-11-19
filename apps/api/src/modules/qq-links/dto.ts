import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { YctQqLinkScope } from '@ldpass/contracts';

const qqLinkScopes: YctQqLinkScope[] = ['c2c', 'group'];

export class ConsumeQqLinkCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  openId!: string;

  @IsIn(qqLinkScopes)
  scope!: YctQqLinkScope;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupOpenId?: string | null;
}

export class ResolveQqLinkQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  openId!: string;

  @IsOptional()
  @IsIn(qqLinkScopes)
  scope?: YctQqLinkScope;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupOpenId?: string | null;
}

export class UnlinkQqLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  openId!: string;

  @IsIn(qqLinkScopes)
  scope!: YctQqLinkScope;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupOpenId?: string | null;
}

export class IssueQqLinkTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  openId!: string;

  @IsIn(qqLinkScopes)
  scope!: YctQqLinkScope;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupOpenId?: string | null;
}

export class ConfirmQqLinkTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;
}

export class ClaimGroupQqLinkTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;
}

export class ConfirmGroupQqLinkTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  openId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  groupOpenId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string;
}

export class InspectQqLinkTokenQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;
}
