import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  AdminReverseRedemptionRequestDto,
  CancelRedemptionRequestDto,
  CreateRedemptionByCardNumberDto,
  ConfirmRedemptionWithPinDto,
  ConfirmRedemptionWithServerDto,
  CreateRedemptionRequestDto,
  CreateWalletRedemptionRequestDto,
  PreviewProviderRedemptionPassDto,
  RedemptionQueryDto,
  ReverseRedemptionRequestDto,
} from './dto.js';
import { RedemptionService } from './redemption.service.js';

@Controller()
export class RedemptionController {
  constructor(
    private readonly redemptionService: RedemptionService,
    private readonly providerAuth: ProviderAuthService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Post('provider/redemptions')
  async createProviderRedemptionRequest(@Body() dto: CreateRedemptionRequestDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.redemptionService.createProviderRedemptionRequest(dto, providerAccount);
  }

  @Get('provider/redemptions')
  async listProviderRedemptionRequests(@Query() query: RedemptionQueryDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.redemptionService.listProviderRedemptionRequests(query, providerAccount);
  }

  @Get('provider/redemptions/pass-preview')
  async previewProviderRedemptionPass(@Query() query: PreviewProviderRedemptionPassDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.redemptionService.previewProviderRedemptionPassByCardNumber(query.cardNumber, providerAccount);
  }

  @Post('provider/redemptions/by-card-number')
  async createProviderRedemptionRequestByCardNumber(
    @Body() dto: CreateRedemptionByCardNumberDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.redemptionService.createProviderRedemptionRequestByCardNumber(dto, providerAccount);
  }

  @Post('provider/redemptions/:requestId/cancel')
  async cancelProviderRedemptionRequest(
    @Param('requestId') requestId: string,
    @Body() dto: CancelRedemptionRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.redemptionService.cancelProviderRedemptionRequest(requestId, dto, providerAccount);
  }

  @Post('provider/redemptions/:requestId/reverse')
  async reverseProviderRedemptionRequest(
    @Param('requestId') requestId: string,
    @Body() dto: ReverseRedemptionRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.redemptionService.reverseProviderRedemptionRequest(requestId, dto, providerAccount);
  }

  @Post('admin/redemptions/:requestId/reverse')
  async reverseAdminRedemptionRequest(
    @Param('requestId') requestId: string,
    @Body() dto: AdminReverseRedemptionRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.redemptionService.reverseAdminRedemptionRequest(requestId, dto, admin);
  }

  @Get('wallet/redemption-requests')
  async listWalletRedemptionRequests(@Query() query: RedemptionQueryDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.redemptionService.listWalletRedemptionRequests(query, user);
  }

  @Post('wallet/redemption-requests')
  async createWalletRedemptionRequest(@Body() dto: CreateWalletRedemptionRequestDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.redemptionService.createWalletRedemptionRequest(dto, user);
  }

  @Post('wallet/redemption-requests/:requestId/confirm-server')
  async confirmWalletRedemptionWithServerAccount(
    @Param('requestId') requestId: string,
    @Body() dto: ConfirmRedemptionWithServerDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.redemptionService.confirmWithServerAccount(requestId, dto.challengeId, user);
  }

  @Post('wallet/redemption-requests/:requestId/server-challenge/start')
  async startWalletRedemptionServerChallenge(@Param('requestId') requestId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.redemptionService.startServerAccountConfirmation(requestId, user);
  }

  @Post('wallet/redemption-requests/:requestId/confirm-pin')
  async confirmWalletRedemptionWithPin(
    @Param('requestId') requestId: string,
    @Body() dto: ConfirmRedemptionWithPinDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.redemptionService.confirmWithPin(requestId, dto.pin, user);
  }
}
