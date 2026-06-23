import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { CreateWalletDisputeDto, DisputesQueryDto, UpdateDisputeStatusDto } from './dto.js';
import { DisputesService } from './disputes.service.js';

@Controller()
export class DisputesController {
  constructor(
    private readonly disputesService: DisputesService,
    private readonly sessionAuth: SessionAuthService,
    private readonly providerAuth: ProviderAuthService,
  ) {}

  @Get('wallet/disputes')
  async listWalletDisputes(@Query() query: DisputesQueryDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.disputesService.listWalletDisputes(query, user);
  }

  @Post('wallet/disputes')
  async createWalletDispute(@Body() dto: CreateWalletDisputeDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.disputesService.createWalletDispute(dto, user);
  }

  @Get('provider/disputes')
  async listProviderDisputes(@Query() query: DisputesQueryDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.disputesService.listProviderDisputes(query, providerAccount);
  }

  @Get('admin/disputes')
  async listAdminDisputes(@Query() query: DisputesQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.disputesService.listAdminDisputes(query);
  }

  @Post('admin/disputes/:disputeId/status')
  async updateDisputeStatus(
    @Param('disputeId') disputeId: string,
    @Body() dto: UpdateDisputeStatusDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.disputesService.updateDisputeStatus(disputeId, dto, admin);
  }
}
