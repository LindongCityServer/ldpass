import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { UpdateLegalDocumentDto } from './dto.js';
import { LegalService } from './legal.service.js';

@Controller()
export class LegalController {
  constructor(
    private readonly legalService: LegalService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('legal/documents')
  async listPublicDocuments() {
    return this.legalService.listDocuments();
  }

  @Get('legal/documents/:key')
  async getPublicDocument(@Param('key') key: string) {
    return this.legalService.getDocument(key);
  }

  @Get('admin/legal/documents')
  async listAdminDocuments(@Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.legalService.listDocuments();
  }

  @Post('admin/legal/documents/:key')
  async updateAdminDocument(
    @Param('key') key: string,
    @Body() dto: UpdateLegalDocumentDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.legalService.updateDocument(key, dto, admin);
  }
}
