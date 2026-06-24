'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

interface ClientApplication {
  id: string;
  clientId: string;
  name: string;
  allowedRedirects: string[];
  allowedOrigins: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ClientApplicationsResponse {
  applications: ClientApplication[];
}

interface ClientApplicationResponse {
  application: ClientApplication;
}

export function AdminClientApplicationsPanel() {
  const [applications, setApplications] = useState<ClientApplication[]>([]);
  const [keyword, setKeyword] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState<ClientApplication | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const filteredApplications = useMemo(() => {
    const keywordText = keyword.trim().toLowerCase();
    if (!keywordText) {
      return applications;
    }

    return applications.filter((application) =>
      [
        application.name,
        application.clientId,
        application.enabled ? '启用' : '停用',
        ...application.allowedRedirects,
        ...application.allowedOrigins,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keywordText),
    );
  }, [applications, keyword]);

  const loadApplications = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<ClientApplicationsResponse>('/api/admin/client-applications');
      setApplications(result.applications);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取客户端应用失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadApplications();
  }, []);

  const createApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setIsCreating(true);
    setMessage(null);

    const form = new FormData(formElement);
    const payload = {
      name: String(form.get('name') ?? ''),
      clientId: String(form.get('clientId') ?? ''),
      allowedRedirects: splitLines(String(form.get('allowedRedirects') ?? '')),
      allowedOrigins: splitLines(String(form.get('allowedOrigins') ?? '')),
      enabled: form.get('enabled') === 'on',
    };

    try {
      await postJson<ClientApplicationResponse>('/api/admin/client-applications', payload);
      formElement.reset();
      setIsCreateDialogOpen(false);
      setMessage('客户端应用已创建。');
      await loadApplications();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建客户端应用失败。');
    } finally {
      setIsCreating(false);
    }
  };

  const updateApplication = async (event: FormEvent<HTMLFormElement>, application: ClientApplication) => {
    event.preventDefault();
    setUpdatingId(application.id);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name') ?? ''),
      allowedRedirects: splitLines(String(form.get('allowedRedirects') ?? '')),
      allowedOrigins: splitLines(String(form.get('allowedOrigins') ?? '')),
      enabled: form.get('enabled') === 'on',
    };

    try {
      const result = await postJson<ClientApplicationResponse>(`/api/admin/client-applications/${application.id}`, payload);
      setApplications((currentApplications) =>
        currentApplications.map((item) => (item.id === application.id ? result.application : item)),
      );
      setEditingApplication(null);
      setMessage('客户端应用已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存客户端应用失败。');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="client-applications-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="client-applications-title">客户端应用</h1>
        </div>
        <div className="admin-list-actions">
          <button className="primary-action" type="button" onClick={() => setIsCreateDialogOpen(true)}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add_link
            </span>
            <span>登记新应用</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => void loadApplications()}>
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => exportApplicationsCsv(filteredApplications, setMessage)}>
            <span className="material-symbols-rounded" aria-hidden="true">
              file_save
            </span>
            <span>导出 CSV</span>
          </button>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      <form className="audit-filter-grid" onSubmit={(event) => event.preventDefault()}>
        <label>
          <span>搜索应用</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="名称、client_id、回跳地址、来源"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="secondary-action" type="button" onClick={() => void loadApplications()}>
            刷新
          </button>
          <button className="secondary-action" type="button" onClick={() => setKeyword('')}>
            重置
          </button>
        </div>
      </form>

      {isLoading ? <p className="empty-note">正在读取客户端应用。</p> : null}
      {!isLoading && filteredApplications.length === 0 ? <p className="empty-note">暂无匹配客户端应用。</p> : null}

      <div className="admin-list">
        {filteredApplications.map((application) => (
          <article className="admin-list-item" key={application.id}>
            <div>
              <h2>{application.name}</h2>
              <p>
                client_id：{application.clientId} · 状态：{application.enabled ? '已启用' : '已停用'} · 最近更新：
                {new Date(application.updatedAt).toLocaleString('zh-CN')}
              </p>
              <p>回跳地址：{application.allowedRedirects.length} 个 · 允许来源：{application.allowedOrigins.length} 个</p>
            </div>
            <div className="admin-list-actions">
              <a className="secondary-action" href={buildLoginExample(application)}>
                登录页
              </a>
              <button className="secondary-action" type="button" onClick={() => setEditingApplication(application)}>
                详情/编辑
              </button>
            </div>
          </article>
        ))}
      </div>

      {isCreateDialogOpen ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="登记新应用">
            <div className="admin-dialog-heading">
              <h2>登记新应用</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <form className="admin-dialog-form" onSubmit={createApplication} noValidate>
              <label>
                <span>应用名称</span>
                <input type="text" name="name" maxLength={80} required />
              </label>
              <label>
                <span>client_id</span>
                <input type="text" name="clientId" maxLength={80} required />
              </label>
              <label>
                <span>允许回跳地址（每行一个完整 URL）</span>
                <textarea name="allowedRedirects" rows={3} required />
              </label>
              <label>
                <span>允许来源（每行一个 Origin 或完整 URL）</span>
                <textarea name="allowedOrigins" rows={3} required />
              </label>
              <label className="inline-toggle">
                <input type="checkbox" name="enabled" defaultChecked />
                <span>启用</span>
              </label>
              <div className="admin-dialog-actions">
                <button className="secondary-action" type="button" onClick={() => setIsCreateDialogOpen(false)}>
                  取消
                </button>
                <button className="primary-action" type="submit" disabled={isCreating}>
                  {isCreating ? '创建中' : '创建'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editingApplication ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setEditingApplication(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="客户端应用详情">
            <div className="admin-dialog-heading">
              <h2>{editingApplication.name}</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setEditingApplication(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <form className="admin-dialog-form" onSubmit={(event) => void updateApplication(event, editingApplication)}>
              <div>
                <p>client_id：{editingApplication.clientId}</p>
                <p>登录入口：{buildLoginExample(editingApplication)}</p>
                <p>会话校验：{buildSessionCheckEndpoint(editingApplication)}</p>
              </div>
              <label>
                <span>应用名称</span>
                <input type="text" name="name" defaultValue={editingApplication.name} maxLength={80} required />
              </label>
              <label>
                <span>允许回跳地址</span>
                <textarea name="allowedRedirects" rows={3} defaultValue={joinLines(editingApplication.allowedRedirects)} required />
              </label>
              <label>
                <span>允许来源</span>
                <textarea name="allowedOrigins" rows={3} defaultValue={joinLines(editingApplication.allowedOrigins)} required />
              </label>
              <label className="inline-toggle">
                <input type="checkbox" name="enabled" defaultChecked={editingApplication.enabled} />
                <span>启用</span>
              </label>
              <div className="admin-dialog-actions">
                <button className="secondary-action" type="button" onClick={() => setEditingApplication(null)}>
                  取消
                </button>
                <button className="primary-action" type="submit" disabled={updatingId === editingApplication.id}>
                  {updatingId === editingApplication.id ? '保存中' : '保存'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinLines(values: string[]): string {
  return values.join('\n');
}

function buildLoginExample(application: ClientApplication): string {
  const redirectUri = application.allowedRedirects[0] ?? 'https://example.com/callback';
  return `/login?client_id=${encodeURIComponent(application.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=example-state`;
}

function buildSessionCheckEndpoint(application: ClientApplication): string {
  return `/api/auth/client-session?client_id=${encodeURIComponent(application.clientId)}`;
}

function exportApplicationsCsv(applications: ClientApplication[], onMessage: (message: string) => void): void {
  const rows = applications.map((application) => ({
    id: application.id,
    clientId: application.clientId,
    name: application.name,
    enabled: application.enabled ? '启用' : '停用',
    redirects: application.allowedRedirects.join('\n'),
    origins: application.allowedOrigins.join('\n'),
    updatedAt: application.updatedAt,
  }));

  downloadTextFile('ldpass-admin-client-applications.csv', toCsv(rows), 'text/csv;charset=utf-8');
  onMessage('客户端应用 CSV 已生成。');
}

function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0] ?? {});
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header] ?? '')).join(','))].join('\r\n');
}

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
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
