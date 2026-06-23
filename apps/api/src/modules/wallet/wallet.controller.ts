import { Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  CancelTopUpRequestDto,
  ClaimAddPassTokenDto,
  ConfirmTopUpWithServerDto,
  ListWalletPassLedgerQueryDto,
  ListWalletTopUpsQueryDto,
  PreviewAddPassTokenQueryDto,
  ReorderWalletPassesDto,
  ResolvePassTransferDto,
  StartTopUpServerChallengeDto,
  TopUpWalletPassDto,
  TransferWalletPassDto,
} from './dto.js';
import { WalletService } from './wallet.service.js';

@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('passes')
  async listPasses(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.listPasses(user);
  }

  @Get('offline-snapshot')
  @Header('Cache-Control', 'private, no-store')
  async getOfflineSnapshot(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.getOfflineSnapshot(user);
  }

  @Get('passes/:passId/ledger')
  async listPassLedger(
    @Param('passId') passId: string,
    @Query() query: ListWalletPassLedgerQueryDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.listPassLedger(user, passId, query);
  }

  @Get('passes/:passId')
  async getPassDetail(@Param('passId') passId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.getPassDetail(user, passId);
  }

  @Get('add-tokens/preview')
  @Header('Cache-Control', 'no-store')
  async previewAddPassToken(@Query() query: PreviewAddPassTokenQueryDto) {
    return this.walletService.previewAddPassToken(query.claimCode);
  }

  @Post('add-tokens/claim')
  async claimAddPassToken(@Body() dto: ClaimAddPassTokenDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.claimAddPassToken(user, dto.claimCode);
  }

  @Post('passes/reorder')
  async reorderPasses(@Body() dto: ReorderWalletPassesDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.reorderPasses(user, dto.passIds);
  }

  @Post('passes/:passId/archive')
  async archivePass(@Param('passId') passId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.archivePass(user, passId);
  }

  @Post('passes/:passId/top-ups')
  async topUpPass(
    @Param('passId') passId: string,
    @Body() dto: TopUpWalletPassDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.topUpPass(user, passId, dto);
  }

  @Get('top-ups')
  async listTopUpRequests(@Query() query: ListWalletTopUpsQueryDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.listTopUpRequests(user, query);
  }

  @Post('passes/:passId/top-ups/server-challenge/start')
  async startTopUpServerChallenge(
    @Param('passId') passId: string,
    @Body() dto: StartTopUpServerChallengeDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.startTopUpServerChallenge(user, passId, dto);
  }

  @Post('passes/:passId/top-ups/confirm-server')
  async confirmTopUpWithServer(
    @Param('passId') passId: string,
    @Body() dto: ConfirmTopUpWithServerDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.confirmTopUpWithServer(user, passId, dto);
  }

  @Post('top-ups/:topUpId/cancel')
  async cancelTopUpRequest(
    @Param('topUpId') topUpId: string,
    @Body() dto: CancelTopUpRequestDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.cancelTopUpRequest(user, topUpId, dto.reason);
  }

  @Post('passes/:passId/transfer')
  async transferPass(
    @Param('passId') passId: string,
    @Body() dto: TransferWalletPassDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.createPassTransfer(user, passId, dto);
  }

  @Get('transfers')
  async listTransfers(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.listPassTransfers(user);
  }

  @Post('transfers/:transferId/accept')
  async acceptTransfer(@Param('transferId') transferId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.acceptPassTransfer(user, transferId);
  }

  @Post('transfers/:transferId/reject')
  async rejectTransfer(
    @Param('transferId') transferId: string,
    @Body() dto: ResolvePassTransferDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.rejectPassTransfer(user, transferId, dto.reason);
  }

  @Post('transfers/:transferId/cancel')
  async cancelTransfer(
    @Param('transferId') transferId: string,
    @Body() dto: ResolvePassTransferDto,
    @Req() request: ApiRequestLike,
  ) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.cancelPassTransfer(user, transferId, dto.reason);
  }

  @Post('passes/:passId/verify-location')
  async verifyPassLocation(@Param('passId') passId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.walletService.verifyPassLocation(user, passId);
  }
}
