import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get()
  async listNotifications(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.notificationsService.listUserNotifications(user);
  }

  @Post(':notificationId/read')
  async markNotificationRead(@Param('notificationId') notificationId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.notificationsService.markNotificationRead(user, notificationId);
  }
}
