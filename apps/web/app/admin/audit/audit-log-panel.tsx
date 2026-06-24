'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getJson } from '../../api-client';

interface AuditLogEntry {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  traceId: string | null;
  summary: unknown;
  retentionPolicy: string;
  createdAt: string;
}

interface AuditLogsResponse {
  logs: AuditLogEntry[];
}

export function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [filters, setFilters] = useState({
    eventType: '',
    actorId: '',
    subjectId: '',
  });

  const loadLogs = async (nextFilters = filters) => {
    setIsLoading(true);
    setMessage(null);

    const search = new URLSearchParams();
    search.set('take', '50');
    for (const [key, value] of Object.entries(nextFilters)) {
      if (value.trim()) {
        search.set(key, value.trim());
      }
    }

    try {
      const result = await getJson<AuditLogsResponse>(`/api/admin/audit/logs?${search.toString()}`);
      setLogs(result.logs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取审计日志失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadLogs();
  };

  const exportLogsCsv = async () => {
    const search = new URLSearchParams();
    search.set('take', '1000');
    for (const [key, value] of Object.entries(filters)) {
      if (value.trim()) {
        search.set(key, value.trim());
      }
    }

    setIsExporting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/audit/logs/export.csv?${search.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await readExportError(response));
      }

      const content = await response.text();
      downloadTextFile('ldpass-admin-audit-logs.csv', content, 'text/csv;charset=utf-8');
      setMessage('审计日志 CSV 已生成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出审计 CSV 失败。');
    } finally {
      setIsExporting(false);
    }
  };

  const clearFilters = () => {
    const emptyFilters = {
      eventType: '',
      actorId: '',
      subjectId: '',
    };
    setFilters(emptyFilters);
    void loadLogs(emptyFilters);
  };

  return (
    <section className="admin-panel" aria-labelledby="audit-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="audit-title">审计日志</h1>
        </div>
        <div className="admin-list-actions">
          <a className="secondary-action" href="/admin/users">
            用户审核
          </a>
          <a className="secondary-action" href="/admin/disputes">
            争议处理
          </a>
        </div>
      </div>

      <form className="audit-filter-grid" onSubmit={submitFilters}>
        <label>
          <span>事件类型</span>
          <input
            value={filters.eventType}
            onChange={(event) => setFilters((current) => ({ ...current, eventType: event.target.value }))}
            placeholder="PassIssued"
          />
        </label>
        <label>
          <span>操作者 ID</span>
          <input
            value={filters.actorId}
            onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value }))}
            placeholder="user/admin id"
          />
        </label>
        <label>
          <span>对象 ID</span>
          <input
            value={filters.subjectId}
            onChange={(event) => setFilters((current) => ({ ...current, subjectId: event.target.value }))}
            placeholder="subject id"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="secondary-action" type="button" onClick={() => void loadLogs(filters)}>
            刷新
          </button>
          <button className="secondary-action" type="button" onClick={clearFilters}>
            清空
          </button>
          <button className="secondary-action" type="button" disabled={isExporting} onClick={() => void exportLogsCsv()}>
            {isExporting ? '导出中' : '导出审计 CSV'}
          </button>
          <button className="primary-action" type="submit">
            <span className="material-symbols-rounded" aria-hidden="true">
              search
            </span>
            <span>筛选</span>
          </button>
        </div>
      </form>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取审计日志。</p> : null}
      {!isLoading && logs.length === 0 ? <p className="empty-note">暂无匹配的审计日志。</p> : null}

      <div className="admin-list">
        {logs.map((log) => (
          <article className="admin-list-item audit-log-item" key={log.id}>
            <div>
              <h2>{log.eventType}</h2>
              <p>
                {log.actorType}
                {log.actorId ? ` · ${log.actorId}` : ''} / {log.subjectType ?? 'event'}
                {log.subjectId ? ` · ${log.subjectId}` : ''}
              </p>
              <p>{formatDate(log.createdAt)} · {log.retentionPolicy}</p>
              <p className="audit-summary">{readSummaryText(log.summary)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readSummaryText(summary: unknown): string {
  if (!summary || typeof summary !== 'object') {
    return '无摘要。';
  }

  const payload = (summary as { payload?: unknown }).payload;
  if (!payload || typeof payload !== 'object') {
    return '无摘要。';
  }

  const entries = Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 8)
    .map(([key, value]) => `${formatPayloadKey(key)}：${formatPayloadValue(value)}`);

  return entries.length > 0 ? entries.join('；') : '无摘要。';
}

function formatPayloadKey(key: string): string {
  const labels: Record<string, string> = {
    userId: '用户 ID',
    providerId: '发卡方 ID',
    passId: '卡券 ID',
    templateId: '模板 ID',
    versionId: '版本 ID',
    status: '状态',
    reason: '原因',
    subjectId: '对象 ID',
    subjectType: '对象类型',
    actorId: '操作者 ID',
    email: '邮箱',
    username: '用户名',
    providerName: '发卡方',
    displayName: '名称',
    publicNumber: '卡号',
    maskedNumber: '掩码卡号',
  };

  return labels[key] ?? key;
}

function formatPayloadValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(formatPayloadValue).join('、') : '空列表';
  }

  if (value && typeof value === 'object') {
    return '包含结构化信息';
  }

  return String(value);
}

async function readExportError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message === 'string') {
      return payload.message;
    }
  }

  return `导出失败，HTTP ${response.status}`;
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
