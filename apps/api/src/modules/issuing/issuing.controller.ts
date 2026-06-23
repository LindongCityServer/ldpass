import { Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
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

@Controller('provider/issuing')
export class IssuingController {
  constructor(
    private readonly issuingService: IssuingService,
    private readonly providerAuth: ProviderAuthService,
  ) {}

  @Get('templates')
  async listIssuableTemplates(@Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.listIssuableTemplates(providerAccount);
  }

  @Post('add-pass-tokens')
  async createAddPassToken(@Body() dto: CreateProviderAddPassTokenDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.createAddPassToken(dto, providerAccount);
  }

  @Get('add-pass-tokens')
  async listAddPassTokens(@Query() query: ProviderAddPassTokenQueryDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.listAddPassTokens(query, providerAccount);
  }

  @Post('add-pass-tokens/:tokenId/revoke')
  async revokeAddPassToken(
    @Param('tokenId') tokenId: string,
    @Body() dto: RevokeProviderAddPassTokenDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.revokeAddPassToken(tokenId, dto, providerAccount);
  }

  @Post('add-pass-tokens/:tokenId/reissue')
  async reissueAddPassToken(
    @Param('tokenId') tokenId: string,
    @Body() dto: ReissueProviderAddPassTokenDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.reissueAddPassToken(tokenId, dto, providerAccount);
  }

  @Post('add-pass-token-batches')
  async createAddPassTokenBatch(@Body() dto: CreateProviderAddPassTokenBatchDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.createAddPassTokenBatch(dto, providerAccount);
  }

  @Get('passes/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ldpass-provider-passes.csv"')
  async exportProviderPasses(@Query() query: ProviderPassesQueryDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.exportProviderPassesCsv(query, providerAccount);
  }

  @Get('ledger/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ldpass-provider-ledger.csv"')
  async exportProviderLedger(@Query() query: ProviderPassesQueryDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.exportProviderLedgerCsv(query, providerAccount);
  }

  @Get('passes')
  async listProviderPasses(@Query() query: ProviderPassesQueryDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.listProviderPasses(query, providerAccount);
  }

  @Get('ticket-update-requests')
  async listProviderTicketUpdateRequests(@Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.listProviderTicketUpdateRequests(providerAccount);
  }

  @Post('passes/:passId/adjust')
  async adjustProviderPassBalance(
    @Param('passId') passId: string,
    @Body() dto: AdjustProviderPassBalanceDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.adjustPassBalance(passId, dto, providerAccount);
  }

  @Post('passes/:passId/freeze')
  async freezeProviderPass(
    @Param('passId') passId: string,
    @Body() dto: ChangeProviderPassStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.freezePass(passId, dto, providerAccount);
  }

  @Post('passes/:passId/unfreeze')
  async unfreezeProviderPass(
    @Param('passId') passId: string,
    @Body() dto: ChangeProviderPassStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.unfreezePass(passId, dto, providerAccount);
  }

  @Post('passes/:passId/archive')
  async archiveProviderPass(
    @Param('passId') passId: string,
    @Body() dto: ChangeProviderPassStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.archivePass(passId, dto, providerAccount);
  }

  @Post('passes/:passId/ticket')
  async updateProviderPassTicket(
    @Param('passId') passId: string,
    @Body() dto: UpdateProviderPassTicketDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.issuingService.updatePassTicket(passId, dto, providerAccount);
  }
}
