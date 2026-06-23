import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { AdminClientApplicationsService } from './admin-client-applications.service.js';
import { CreateClientApplicationDto, UpdateClientApplicationDto } from './dto.js';

@Controller('admin/client-applications')
export class AdminClientApplicationsController {
  constructor(
    private readonly adminClientApplicationsService: AdminClientApplicationsService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get()
  async listClientApplications(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.adminClientApplicationsService.listClientApplications();
  }

  @Post()
  async createClientApplication(@Body() dto: CreateClientApplicationDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminClientApplicationsService.createClientApplication(dto, admin);
  }

  @Post(':applicationId')
  async updateClientApplication(
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateClientApplicationDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.adminClientApplicationsService.updateClientApplication(applicationId, dto, admin);
  }
}
