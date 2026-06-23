import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ldpass/database';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { AuditLogQueryDto } from './audit-query.dto.js';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listLogs(query: AuditLogQueryDto) {
    const take = this.readTake(query.take);

    const logs = await this.prisma.auditLog.findMany({
      where: this.buildAuditLogWhere(query),
      orderBy: {
        createdAt: 'desc',
      },
      take,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        actorType: log.actorType,
        actorId: log.actorId,
        subjectType: log.subjectType,
        subjectId: log.subjectId,
        traceId: log.traceId,
        summary: log.summary,
        retentionPolicy: log.retentionPolicy,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  async exportLogsCsv(query: AuditLogQueryDto): Promise<string> {
    const logs = await this.prisma.auditLog.findMany({
      where: this.buildAuditLogWhere(query),
      orderBy: {
        createdAt: 'desc',
      },
      take: this.readExportTake(query.take),
    });

    const columns: Array<CsvColumn<(typeof logs)[number]>> = [
      { header: '审计ID', value: (log) => log.id },
      { header: '事件类型', value: (log) => log.eventType },
      { header: '操作者类型', value: (log) => log.actorType },
      { header: '操作者ID', value: (log) => log.actorId },
      { header: '对象类型', value: (log) => log.subjectType },
      { header: '对象ID', value: (log) => log.subjectId },
      { header: 'Trace ID', value: (log) => log.traceId },
      { header: '摘要', value: (log) => stringifyJsonForCsv(log.summary) },
      { header: '保留策略', value: (log) => log.retentionPolicy },
      { header: '创建时间', value: (log) => formatCsvDate(log.createdAt) },
    ];

    return createCsv(columns, logs);
  }

  private buildAuditLogWhere(query: AuditLogQueryDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (query.eventType?.trim()) {
      where.eventType = query.eventType.trim();
    }

    if (query.actorId?.trim()) {
      where.actorId = query.actorId.trim();
    }

    if (query.subjectId?.trim()) {
      where.subjectId = query.subjectId.trim();
    }

    return where;
  }

  private readTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '50', 10);

    if (!Number.isFinite(parsedValue)) {
      return 50;
    }

    return Math.min(Math.max(parsedValue, 1), 100);
  }

  private readExportTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '1000', 10);

    if (!Number.isFinite(parsedValue)) {
      return 1000;
    }

    return Math.min(Math.max(parsedValue, 1), 1000);
  }
}

type CsvValue = string | number | boolean | null | undefined;

interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => CsvValue;
  numeric?: boolean;
}

function createCsv<TRow>(columns: Array<CsvColumn<TRow>>, rows: TRow[]): string {
  const headerLine = columns.map((column) => escapeCsvValue(column.header)).join(',');
  const rowLines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(column.value(row), column.numeric === true)).join(','),
  );

  return `\uFEFF${[headerLine, ...rowLines].join('\r\n')}\r\n`;
}

function escapeCsvValue(value: CsvValue, numeric = false): string {
  const rawValue = value === null || value === undefined ? '' : String(value);
  const safeValue = !numeric && startsWithSpreadsheetFormula(rawValue) ? `\t${rawValue}` : rawValue;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function startsWithSpreadsheetFormula(value: string): boolean {
  const trimmedValue = value.trimStart();
  return /^[=+@]/.test(trimmedValue) || /^-(?!\d+(\.\d+)?$)/.test(trimmedValue);
}

function formatCsvDate(value: Date | null | undefined): string {
  return value ? value.toISOString() : '';
}

function stringifyJsonForCsv(value: Prisma.JsonValue): string {
  return JSON.stringify(value);
}
