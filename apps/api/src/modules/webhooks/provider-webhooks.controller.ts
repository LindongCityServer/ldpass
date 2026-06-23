import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  CreateProviderWebhookEndpointDto,
  ProviderWebhookChangeReasonDto,
  RejectProviderWebhookChangeRequestDto,
  UpdateProviderWebhookEndpointDto,
} from './dto.js';
import { ProviderWebhooksService } from './provider-webhooks.service.js';

@Controller('providers/webhooks')
export class ProviderWebhooksController {
  constructor(
    private readonly providerAuth: ProviderAuthService,
    private readonly providerWebhooksService: ProviderWebhooksService,
  ) {}

  @Get()
  async listEndpoints(@Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.listProviderWebhookEndpoints(providerAccount);
  }

  @Post()
  async createEndpoint(@Body() dto: CreateProviderWebhookEndpointDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.createProviderWebhookEndpoint(dto, providerAccount);
  }

  @Get(':endpointId/deliveries')
  async listDeliveries(@Param('endpointId') endpointId: string, @Query('take') take: string | undefined, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.listProviderWebhookDeliveries(endpointId, take, providerAccount);
  }

  @Post('deliveries/:deliveryId/retry')
  async retryDelivery(@Param('deliveryId') deliveryId: string, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.retryProviderWebhookDelivery(deliveryId, providerAccount);
  }

  @Post('change-requests/:requestId/claim-secret')
  async claimApprovedSecret(@Param('requestId') requestId: string, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.claimApprovedWebhookSecret(requestId, providerAccount);
  }

  @Post(':endpointId')
  async updateEndpoint(
    @Param('endpointId') endpointId: string,
    @Body() dto: UpdateProviderWebhookEndpointDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.updateProviderWebhookEndpoint(endpointId, dto, providerAccount);
  }

  @Post(':endpointId/rotate-secret')
  async rotateSecret(
    @Param('endpointId') endpointId: string,
    @Body() dto: ProviderWebhookChangeReasonDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.rotateProviderWebhookSecret(endpointId, dto, providerAccount);
  }

  @Post(':endpointId/delete')
  async deleteEndpoint(
    @Param('endpointId') endpointId: string,
    @Body() dto: ProviderWebhookChangeReasonDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providerWebhooksService.deleteProviderWebhookEndpoint(endpointId, dto, providerAccount);
  }
}

@Controller('admin/providers/webhook-change-requests')
export class AdminProviderWebhookChangeRequestsController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly providerWebhooksService: ProviderWebhooksService,
  ) {}

  @Get()
  async listRequests(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.providerWebhooksService.listAdminWebhookChangeRequests();
  }

  @Post(':requestId/approve')
  async approveRequest(@Param('requestId') requestId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.providerWebhooksService.approveProviderWebhookChangeRequest(requestId, admin);
  }

  @Post(':requestId/reject')
  async rejectRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RejectProviderWebhookChangeRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.providerWebhooksService.rejectProviderWebhookChangeRequest(requestId, dto.reason, admin);
  }
}
