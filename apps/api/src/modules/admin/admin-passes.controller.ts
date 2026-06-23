import { Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  AdjustPassBalanceDto,
  AdminPassesQueryDto,
  ChangePassFreezeStatusDto,
  ReviewPassTicketUpdateDto,
  ReversePassTopUpDto,
} from './admin-passes.dto.js';
import { AdminPassesService } from './admin-passes.service.js';

@Controller('admin/passes')
export class AdminPassesController {
  constructor(
    private readonly adminPassesService: AdminPassesService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get()
  async listPasses(@Query() query: AdminPassesQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.listPasses(query);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ldpass-admin-passes.csv"')
  async exportPassesCsv(@Query() query: AdminPassesQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.exportPassesCsv(query);
  }

  @Get('ledger/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ldpass-admin-ledger.csv"')
  async exportLedgerCsv(@Query() query: AdminPassesQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.exportLedgerCsv(query);
  }

  @Post('top-ups/:topUpId/reverse')
  async reverseTopUp(
    @Param('topUpId') topUpId: string,
    @Body() dto: ReversePassTopUpDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.reverseTopUp(topUpId, dto, admin);
  }

  @Get('ticket-update-requests')
  async listPendingTicketUpdateRequests(@Req() request: ApiRequestLike): Promise<unknown> {
    await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.listPendingTicketUpdateRequests();
  }

  @Post('ticket-update-requests/:requestId/approve')
  async approveTicketUpdateRequest(
    @Param('requestId') requestId: string,
    @Body() dto: ReviewPassTicketUpdateDto,
    @Req() request: ApiRequestLike,
  ): Promise<unknown> {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.approveTicketUpdateRequest(requestId, dto, admin);
  }

  @Post('ticket-update-requests/:requestId/reject')
  async rejectTicketUpdateRequest(
    @Param('requestId') requestId: string,
    @Body() dto: ReviewPassTicketUpdateDto,
    @Req() request: ApiRequestLike,
  ): Promise<unknown> {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.rejectTicketUpdateRequest(requestId, dto, admin);
  }

  @Post(':passId/adjust')
  async adjustBalance(
    @Param('passId') passId: string,
    @Body() dto: AdjustPassBalanceDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.adjustBalance(passId, dto, admin);
  }

  @Post(':passId/freeze')
  async freezePass(
    @Param('passId') passId: string,
    @Body() dto: ChangePassFreezeStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.freezePass(passId, dto, admin);
  }

  @Post(':passId/unfreeze')
  async unfreezePass(
    @Param('passId') passId: string,
    @Body() dto: ChangePassFreezeStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminPassesService.unfreezePass(passId, dto, admin);
  }
}
