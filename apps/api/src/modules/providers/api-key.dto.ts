import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ProviderApiKeyScope } from '@ldpass/contracts';

export const providerApiKeyScopes = [
  'add_pass_token:create',
  'add_pass_token:batch_create',
  'add_pass_token:read',
  'add_pass_token:revoke',
  'add_pass_token:reissue',
  'action_links:create',
  'action_links:read',
  'action_links:revoke',
  'passes:read',
  'passes:status_update',
  'passes:ticket_update',
  'ledger:adjust',
  'redemptions:create',
  'redemptions:cancel',
  'redemptions:reverse',
  'redemptions:read',
] as const satisfies ProviderApiKeyScope[];

export class CreateProviderApiKeyDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(providerApiKeyScopes.length)
  @IsIn(providerApiKeyScopes, { each: true })
  scopes!: ProviderApiKeyScope[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectProviderApiKeyChangeRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}

export class RequestProviderApiKeyLifecycleChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
