import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { UpdatePlatformStatusDto } from './dto.js';
import { PlatformStatusService } from './platform-status.service.js';

@Controller()
export class PlatformStatusController {
  constructor(
    private readonly platformStatusService: PlatformStatusService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('platform/status')
  async getPublicStatus() {
    return this.platformStatusService.getPublicStatus();
  }

  @Get('admin/platform/status')
  async getAdminStatus(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.platformStatusService.getPublicStatus();
  }

  @Post('admin/platform/status')
  async updateStatus(@Body() dto: UpdatePlatformStatusDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.platformStatusService.updateStatus(dto, admin);
  }
}
