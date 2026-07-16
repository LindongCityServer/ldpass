import { Body, Controller, Get, Param, Post, Req } from '../../framework.js';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { AdminClientApplicationsService } from './admin-client-applications.service.js';
import { CreateProviderClientApplicationDto, UpdateProviderClientApplicationDto } from './dto.js';

@Controller('provider/client-applications')
export class ProviderClientApplicationsController {
  constructor(
    private readonly clientApplicationsService: AdminClientApplicationsService,
    private readonly providerAuth: ProviderAuthService,
  ) {}

  @Get()
  async listClientApplications(@Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.clientApplicationsService.listProviderClientApplications(providerAccount);
  }

  @Post()
  async createClientApplication(
    @Body() dto: CreateProviderClientApplicationDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.clientApplicationsService.createProviderClientApplication(dto, providerAccount);
  }

  @Post(':applicationId')
  async updateClientApplication(
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateProviderClientApplicationDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.clientApplicationsService.updateProviderClientApplication(
      applicationId,
      dto,
      providerAccount,
    );
  }

  @Post(':applicationId/delete')
  async deleteClientApplication(
    @Param('applicationId') applicationId: string,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.clientApplicationsService.deleteProviderClientApplication(
      applicationId,
      providerAccount,
    );
  }
}
