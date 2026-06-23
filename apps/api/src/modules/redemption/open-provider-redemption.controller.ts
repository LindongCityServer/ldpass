import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ProviderApiKeyAuthService } from '../providers/provider-api-key-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { CancelRedemptionRequestDto, CreateRedemptionRequestDto, RedemptionQueryDto, ReverseRedemptionRequestDto } from './dto.js';
import { RedemptionService } from './redemption.service.js';

@Controller('open/provider/redemptions')
export class OpenProviderRedemptionController {
  constructor(
    private readonly redemptionService: RedemptionService,
    private readonly providerApiKeyAuth: ProviderApiKeyAuthService,
  ) {}

  @Get()
  async listRedemptions(@Query() query: RedemptionQueryDto, @Req() request: ApiRequestLike) {
    const providerActor = await this.providerApiKeyAuth.requireScope(request, 'redemptions:read');
    return this.redemptionService.listProviderRedemptionRequests(query, providerActor);
  }

  @Post()
  async createRedemption(@Body() dto: CreateRedemptionRequestDto, @Req() request: ApiRequestLike) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'redemptions:create', (providerActor, idempotencyKey) =>
      this.redemptionService.createProviderRedemptionRequest({ ...dto, idempotencyKey }, providerActor),
    );
  }

  @Post(':requestId/cancel')
  async cancelRedemption(
    @Param('requestId') requestId: string,
    @Body() dto: CancelRedemptionRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'redemptions:cancel', (providerActor) =>
      this.redemptionService.cancelProviderRedemptionRequest(requestId, dto, providerActor),
    );
  }

  @Post(':requestId/reverse')
  async reverseRedemption(
    @Param('requestId') requestId: string,
    @Body() dto: ReverseRedemptionRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'redemptions:reverse', (providerActor) =>
      this.redemptionService.reverseProviderRedemptionRequest(requestId, dto, providerActor),
    );
  }
}
