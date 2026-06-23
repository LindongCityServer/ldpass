import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import { CreatePassTemplateDto, RejectPassTemplateDto, UpdatePassTemplateDto } from './dto.js';
import { PassTemplatesService } from './pass-templates.service.js';

@Controller()
export class PassTemplatesController {
  constructor(
    private readonly passTemplatesService: PassTemplatesService,
    private readonly providerAuth: ProviderAuthService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('provider/pass-templates')
  async listProviderTemplates(@Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.passTemplatesService.listProviderTemplates(providerAccount);
  }

  @Post('provider/pass-templates')
  async createProviderTemplate(@Body() dto: CreatePassTemplateDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.passTemplatesService.createProviderTemplate(dto, providerAccount);
  }

  @Post('provider/pass-templates/:templateId/versions')
  async submitProviderTemplateVersion(
    @Param('templateId') templateId: string,
    @Body() dto: UpdatePassTemplateDto,
    @Req() request: ApiRequestLike,
  ) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.passTemplatesService.submitProviderTemplateVersion(templateId, dto, providerAccount);
  }

  @Get('admin/pass-templates/pending')
  async listPendingTemplates(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.passTemplatesService.listPendingTemplates();
  }

  @Get('admin/pass-templates/approved')
  async listApprovedTemplates(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.passTemplatesService.listApprovedTemplates();
  }

  @Post('admin/pass-templates/:versionId/approve')
  async approveTemplateVersion(@Param('versionId') versionId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.passTemplatesService.approveTemplateVersion(versionId, admin);
  }

  @Post('admin/pass-templates/:versionId/reject')
  async rejectTemplateVersion(
    @Param('versionId') versionId: string,
    @Body() dto: RejectPassTemplateDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.passTemplatesService.rejectTemplateVersion(versionId, dto.reason, admin);
  }
}
