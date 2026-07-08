import { Body, Controller, Get, Header, Param, Post, Query, Req } from '../../framework.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  AdminUserSensitiveActionDto,
  AdminUsersQueryDto,
  RejectUserAvatarChangeDto,
  RejectUserDto,
  ResetUserPasswordDto,
  RevertUserAvatarDto,
} from './dto.js';

@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('pending')
  async listPendingUsers(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.listPendingUsers();
  }

  @Get()
  async listUsers(@Query() query: AdminUsersQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.listUsers(query);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ldpass-admin-users.csv"')
  async exportUsersCsv(@Query() query: AdminUsersQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.exportUsersCsv(query);
  }

  @Get('avatar-requests')
  async listPendingAvatarChangeRequests(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.listPendingAvatarChangeRequests();
  }

  @Post('avatar-requests/:requestId/approve')
  async approveAvatarChangeRequest(@Param('requestId') requestId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.approveAvatarChangeRequest(requestId, admin);
  }

  @Post('avatar-requests/:requestId/reject')
  async rejectAvatarChangeRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RejectUserAvatarChangeDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.rejectAvatarChangeRequest(requestId, dto.reason, admin);
  }

  @Post(':userId/approve')
  async approveUser(@Param('userId') userId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.approveUser(userId, admin);
  }

  @Post(':userId/reject')
  async rejectUser(@Param('userId') userId: string, @Body() dto: RejectUserDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.rejectUser(userId, dto.reason, admin);
  }

  @Post(':userId/suspend')
  async suspendUser(@Param('userId') userId: string, @Body() dto: AdminUserSensitiveActionDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.suspendUser(userId, dto, admin);
  }

  @Post(':userId/unsuspend')
  async unsuspendUser(@Param('userId') userId: string, @Body() dto: AdminUserSensitiveActionDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.unsuspendUser(userId, dto, admin);
  }

  @Post(':userId/password/reset')
  async resetUserPassword(@Param('userId') userId: string, @Body() dto: ResetUserPasswordDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.resetUserPassword(userId, dto, admin);
  }

  @Post(':userId/avatar/revert')
  async revertUserAvatar(@Param('userId') userId: string, @Body() dto: RevertUserAvatarDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.revertUserAvatar(userId, dto.reason, admin);
  }

  @Post(':userId/delete')
  async deleteUser(@Param('userId') userId: string, @Body() dto: AdminUserSensitiveActionDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminUsersService.deleteUser(userId, dto, admin);
  }
}
