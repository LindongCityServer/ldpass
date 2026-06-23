import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import { ProviderApiKeyAuthService } from '../providers/provider-api-key-auth.service.js';
import { ActionLinksService } from './action-links.service.js';
import {
  BatchRevokeWalletActionLinksDto,
  CancelWalletActionLinkTopUpRequestDto,
  CompleteWalletActionLinkServerRedemptionDto,
  ConfirmWalletActionLinkWithPinDto,
  ConfirmWalletActionLinkWithServerDto,
  CreateWalletActionLinkDto,
  PreviewWalletActionLinkQueryDto,
  RevokeWalletActionLinkDto,
  StartWalletActionLinkServerRedemptionDto,
  WalletActionLinkQueryDto,
} from './dto.js';

@Controller()
export class ActionLinksController {
  constructor(
    private readonly actionLinksService: ActionLinksService,
    private readonly providerAuth: ProviderAuthService,
    private readonly providerApiKeyAuth: ProviderApiKeyAuthService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Post('provider/action-links')
  async createProviderActionLink(
    @Body() dto: CreateWalletActionLinkDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.actionLinksService.createProviderActionLink(dto, providerAccount);
  }

  @Get('provider/action-links')
  async listProviderActionLinks(
    @Query() query: WalletActionLinkQueryDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.actionLinksService.listProviderActionLinks(query, providerAccount);
  }

  @Post('provider/action-links/:actionLinkId/revoke')
  async revokeProviderActionLink(
    @Param('actionLinkId') actionLinkId: string,
    @Body() dto: RevokeWalletActionLinkDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.actionLinksService.revokeProviderActionLink(actionLinkId, dto, providerAccount);
  }

  @Post('provider/action-links/revoke-batch')
  async batchRevokeProviderActionLinks(
    @Body() dto: BatchRevokeWalletActionLinksDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.actionLinksService.batchRevokeProviderActionLinks(dto, providerAccount);
  }

  @Post('open/provider/action-links')
  async createOpenProviderActionLink(
    @Body() dto: CreateWalletActionLinkDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(
      request,
      'action_links:create',
      (providerActor) => this.actionLinksService.createProviderActionLink(dto, providerActor),
    );
  }

  @Get('open/provider/action-links')
  async listOpenProviderActionLinks(
    @Query() query: WalletActionLinkQueryDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerActor = await this.providerApiKeyAuth.requireScope(request, 'action_links:read');
    return this.actionLinksService.listProviderActionLinks(query, providerActor);
  }

  @Post('open/provider/action-links/:actionLinkId/revoke')
  async revokeOpenProviderActionLink(
    @Param('actionLinkId') actionLinkId: string,
    @Body() dto: RevokeWalletActionLinkDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(
      request,
      'action_links:revoke',
      (providerActor) => this.actionLinksService.revokeProviderActionLink(actionLinkId, dto, providerActor),
    );
  }

  @Post('open/provider/action-links/revoke-batch')
  async batchRevokeOpenProviderActionLinks(
    @Body() dto: BatchRevokeWalletActionLinksDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(
      request,
      'action_links:revoke',
      (providerActor) => this.actionLinksService.batchRevokeProviderActionLinks(dto, providerActor),
    );
  }

  @Get('wallet/action-links/preview')
  async previewWalletActionLink(
    @Query() query: PreviewWalletActionLinkQueryDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.actionLinksService.previewWalletActionLink(query.token, user);
  }

  @Post('wallet/action-links/confirm-pin')
  async confirmWalletActionLinkWithPin(
    @Body() dto: ConfirmWalletActionLinkWithPinDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.actionLinksService.confirmWalletActionLinkWithPin(dto, user);
  }

  @Post('wallet/action-links/server-redemption/start')
  async startWalletActionLinkServerRedemption(
    @Body() dto: StartWalletActionLinkServerRedemptionDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.actionLinksService.startServerConfirmationForActionLink(dto, user);
  }

  @Post('wallet/action-links/server-redemption/complete')
  async completeWalletActionLinkServerRedemption(
    @Body() dto: CompleteWalletActionLinkServerRedemptionDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.actionLinksService.completeServerRedemptionForActionLink(
      dto.token,
      dto.redemptionRequestId,
      user,
    );
  }

  @Post('wallet/action-links/server-confirm')
  async confirmWalletActionLinkWithServer(
    @Body() dto: ConfirmWalletActionLinkWithServerDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.actionLinksService.confirmTopUpActionLinkWithServer(dto, user);
  }

  @Post('wallet/action-links/top-ups/:topUpId/cancel')
  async cancelWalletActionLinkTopUpRequest(
    @Param('topUpId') topUpId: string,
    @Body() dto: CancelWalletActionLinkTopUpRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.actionLinksService.cancelTopUpActionLinkRequest(user, topUpId, dto.reason);
  }
}
