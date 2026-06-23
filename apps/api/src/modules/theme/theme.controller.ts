import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { UpdateThemeScheduleDto } from './dto.js';
import { ThemeScheduleService } from './theme-schedule.service.js';

@Controller()
export class ThemeController {
  constructor(
    private readonly themeScheduleService: ThemeScheduleService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('theme/schedule')
  async getPublicSchedule() {
    return this.themeScheduleService.getPublicSchedule();
  }

  @Get('admin/theme/schedule')
  async getAdminSchedule(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.themeScheduleService.getAdminSchedule();
  }

  @Post('admin/theme/schedule')
  async updateSchedule(@Body() dto: UpdateThemeScheduleDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.themeScheduleService.updateSchedule(dto.entries, admin);
  }
}
