import { Controller, Get, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(
    private readonly adminDashboardService: AdminDashboardService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('summary')
  async getSummary(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminDashboardService.getSummary();
  }
}
