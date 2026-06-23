import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ProviderApiKeyAuthService } from '../providers/provider-api-key-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  AdjustProviderPassBalanceDto,
  ChangeProviderPassStatusDto,
  CreateProviderAddPassTokenBatchDto,
  CreateProviderAddPassTokenDto,
  ProviderAddPassTokenQueryDto,
  ProviderPassesQueryDto,
  ReissueProviderAddPassTokenDto,
  RevokeProviderAddPassTokenDto,
  UpdateProviderPassTicketDto,
} from './dto.js';
import { IssuingService } from './issuing.service.js';

@Controller('open/provider/issuing')
export class OpenProviderIssuingController {
  constructor(
    private readonly issuingService: IssuingService,
    private readonly providerApiKeyAuth: ProviderApiKeyAuthService,
  ) {}

  @Post('add-pass-tokens')
  async createAddPassToken(@Body() dto: CreateProviderAddPassTokenDto, @Req() request: ApiRequestLike) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'add_pass_token:create', (providerActor) =>
      this.issuingService.createAddPassToken(dto, providerActor),
    );
  }

  @Post('add-pass-token-batches')
  async createAddPassTokenBatch(@Body() dto: CreateProviderAddPassTokenBatchDto, @Req() request: ApiRequestLike) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'add_pass_token:batch_create', (providerActor) =>
      this.issuingService.createAddPassTokenBatch(dto, providerActor),
    );
  }

  @Get('add-pass-tokens')
  async listAddPassTokens(@Query() query: ProviderAddPassTokenQueryDto, @Req() request: ApiRequestLike) {
    const providerActor = await this.providerApiKeyAuth.requireScope(request, 'add_pass_token:read');
    return this.issuingService.listAddPassTokens(query, providerActor);
  }

  @Post('add-pass-tokens/:tokenId/revoke')
  async revokeAddPassToken(
    @Param('tokenId') tokenId: string,
    @Body() dto: RevokeProviderAddPassTokenDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'add_pass_token:revoke', (providerActor) =>
      this.issuingService.revokeAddPassToken(tokenId, dto, providerActor),
    );
  }

  @Post('add-pass-tokens/:tokenId/reissue')
  async reissueAddPassToken(
    @Param('tokenId') tokenId: string,
    @Body() dto: ReissueProviderAddPassTokenDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'add_pass_token:reissue', (providerActor) =>
      this.issuingService.reissueAddPassToken(tokenId, dto, providerActor),
    );
  }

  @Get('passes')
  async listPasses(@Query() query: ProviderPassesQueryDto, @Req() request: ApiRequestLike) {
    const providerActor = await this.providerApiKeyAuth.requireScope(request, 'passes:read');
    return this.issuingService.listProviderPasses(query, providerActor);
  }

  @Post('passes/:passId/adjust')
  async adjustPassBalance(
    @Param('passId') passId: string,
    @Body() dto: AdjustProviderPassBalanceDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'ledger:adjust', (providerActor, idempotencyKey) =>
      this.issuingService.adjustPassBalance(passId, { ...dto, idempotencyKey }, providerActor),
    );
  }

  @Post('passes/:passId/freeze')
  async freezePass(
    @Param('passId') passId: string,
    @Body() dto: ChangeProviderPassStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'passes:status_update', (providerActor) =>
      this.issuingService.freezePass(passId, dto, providerActor),
    );
  }

  @Post('passes/:passId/unfreeze')
  async unfreezePass(
    @Param('passId') passId: string,
    @Body() dto: ChangeProviderPassStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'passes:status_update', (providerActor) =>
      this.issuingService.unfreezePass(passId, dto, providerActor),
    );
  }

  @Post('passes/:passId/archive')
  async archivePass(
    @Param('passId') passId: string,
    @Body() dto: ChangeProviderPassStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'passes:status_update', (providerActor) =>
      this.issuingService.archivePass(passId, dto, providerActor),
    );
  }

  @Post('passes/:passId/ticket')
  async updatePassTicket(
    @Param('passId') passId: string,
    @Body() dto: UpdateProviderPassTicketDto,
    @Req() request: ApiRequestLike,
  ) {
    return this.providerApiKeyAuth.executeSignedWrite(request, 'passes:ticket_update', (providerActor) =>
      this.issuingService.updatePassTicket(passId, dto, providerActor),
    );
  }
}
