import { Controller, Get, Post, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { StorageMonitorService } from './storage-monitor.service.js';

@Controller('admin/storage')
export class StorageController {
  constructor(
    private readonly storageMonitorService: StorageMonitorService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('status')
  async getStatus(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.storageMonitorService.checkStorage();
  }

  @Post('check')
  async checkNow(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.storageMonitorService.checkStorage();
  }
}
