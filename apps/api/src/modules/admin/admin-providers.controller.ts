import { Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  AdminProvidersQueryDto,
  CreateProviderByAdminDto,
  ProviderSensitiveActionDto,
  RejectProviderDto,
} from './admin-providers.dto.js';
import { AdminProvidersService } from './admin-providers.service.js';

@Controller('admin/providers')
export class AdminProvidersController {
  constructor(
    private readonly adminProvidersService: AdminProvidersService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('pending')
  async listPendingProviders(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.listPendingProviders();
  }

  @Get()
  async listProviders(@Query() query: AdminProvidersQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.listProviders(query);
  }

  @Get('profile-change-requests')
  async listProfileChangeRequests(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.listProfileChangeRequests();
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ldpass-admin-providers.csv"')
  async exportProvidersCsv(@Query() query: AdminProvidersQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.exportProvidersCsv(query);
  }

  @Post()
  async createProvider(@Body() dto: CreateProviderByAdminDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.createProvider(dto, admin);
  }

  @Post('profile-change-requests/:requestId/approve')
  async approveProfileChangeRequest(@Param('requestId') requestId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.approveProfileChangeRequest(requestId, admin);
  }

  @Post('profile-change-requests/:requestId/reject')
  async rejectProfileChangeRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RejectProviderDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.rejectProfileChangeRequest(requestId, dto.reason, admin);
  }

  @Post(':providerId/approve')
  async approveProvider(@Param('providerId') providerId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.approveProvider(providerId, admin);
  }

  @Post(':providerId/reject')
  async rejectProvider(@Param('providerId') providerId: string, @Body() dto: RejectProviderDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.rejectProvider(providerId, dto.reason, admin);
  }

  @Post(':providerId/suspend')
  async suspendProvider(
    @Param('providerId') providerId: string,
    @Body() dto: ProviderSensitiveActionDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.suspendProvider(providerId, dto, admin);
  }

  @Post(':providerId/unsuspend')
  async unsuspendProvider(
    @Param('providerId') providerId: string,
    @Body() dto: ProviderSensitiveActionDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.unsuspendProvider(providerId, dto, admin);
  }

  @Post(':providerId/archive')
  async archiveProvider(
    @Param('providerId') providerId: string,
    @Body() dto: ProviderSensitiveActionDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminProvidersService.archiveProvider(providerId, dto, admin);
  }
}
