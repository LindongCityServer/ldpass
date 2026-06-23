import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { AuditLogQueryDto } from './audit-query.dto.js';
import { AuditQueryService } from './audit-query.service.js';

@Controller('admin/audit')
export class AuditController {
  constructor(
    private readonly auditQueryService: AuditQueryService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('logs')
  async listLogs(@Query() query: AuditLogQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.auditQueryService.listLogs(query);
  }

  @Get('logs/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ldpass-admin-audit-logs.csv"')
  async exportLogsCsv(@Query() query: AuditLogQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.auditQueryService.exportLogsCsv(query);
  }
}
