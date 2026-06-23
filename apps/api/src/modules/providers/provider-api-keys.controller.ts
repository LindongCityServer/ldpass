import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  CreateProviderApiKeyDto,
  RejectProviderApiKeyChangeRequestDto,
  RequestProviderApiKeyLifecycleChangeDto,
} from './api-key.dto.js';
import { ProviderApiKeysService } from './provider-api-keys.service.js';

@Controller('providers/api-keys')
export class ProviderApiKeysController {
  constructor(
    private readonly providerApiKeysService: ProviderApiKeysService,
    private readonly providerAuth: ProviderAuthService,
  ) {}

  @Get()
  async listApiKeys(@Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerApiKeysService.listApiKeys(providerAccount);
  }

  @Post()
  async createApiKey(@Body() dto: CreateProviderApiKeyDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerApiKeysService.createApiKey(dto, providerAccount);
  }

  @Post('change-requests/:requestId/claim-secret')
  async claimApprovedSecret(@Param('requestId') requestId: string, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerApiKeysService.claimApprovedApiKeySecret(requestId, providerAccount);
  }

  @Post(':apiKeyId/revoke')
  async revokeApiKey(
    @Param('apiKeyId') apiKeyId: string,
    @Body() dto: RequestProviderApiKeyLifecycleChangeDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerApiKeysService.revokeApiKey(apiKeyId, dto.reason, providerAccount);
  }

  @Post(':apiKeyId/rotate')
  async rotateApiKey(
    @Param('apiKeyId') apiKeyId: string,
    @Body() dto: RequestProviderApiKeyLifecycleChangeDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerApiKeysService.rotateApiKey(apiKeyId, dto.reason, providerAccount);
  }
}

@Controller('admin/providers/api-key-change-requests')
export class AdminProviderApiKeyChangeRequestsController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly providerApiKeysService: ProviderApiKeysService,
  ) {}

  @Get()
  async listRequests(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.providerApiKeysService.listAdminApiKeyChangeRequests();
  }

  @Post(':requestId/approve')
  async approveRequest(@Param('requestId') requestId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.providerApiKeysService.approveApiKeyChangeRequest(requestId, admin);
  }

  @Post(':requestId/reject')
  async rejectRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RejectProviderApiKeyChangeRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.providerApiKeysService.rejectApiKeyChangeRequest(requestId, dto.reason, admin);
  }
}
