'use client';

import { useEffect, useState, type FormEvent } from 'react';
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
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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
    setIsCreating(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name') ?? ''),
      clientId: String(form.get('clientId') ?? ''),
      allowedRedirects: splitLines(String(form.get('allowedRedirects') ?? '')),
      allowedOrigins: splitLines(String(form.get('allowedOrigins') ?? '')),
      enabled: form.get('enabled') === 'on',
    };

    try {
      await postJson<ClientApplicationResponse>('/api/admin/client-applications', payload);
      event.currentTarget.reset();
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
          <button className="secondary-action" type="button" onClick={() => void loadApplications()}>
            刷新
          </button>
          <a className="secondary-action" href="/admin/users">
            用户审核
          </a>
          <a className="secondary-action" href="/admin/audit">
            审计日志
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      <form className="stacked-form account-security-zone" onSubmit={createApplication} noValidate>
        <div>
          <h2>登记新应用</h2>
          <p>外部项目必须先登记 `client_id` 和精确回跳地址，登录页才允许回跳。</p>
        </div>
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
        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={isCreating}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add_link
            </span>
            <span>{isCreating ? '创建中' : '创建应用'}</span>
          </button>
        </div>
      </form>

      {isLoading ? <p className="empty-note">正在读取客户端应用。</p> : null}
      {!isLoading && applications.length === 0 ? <p className="empty-note">暂无客户端应用。</p> : null}

      <div className="admin-list">
        {applications.map((application) => (
          <form
            className="admin-list-item admin-edit-card"
            key={application.id}
            onSubmit={(event) => void updateApplication(event, application)}
          >
            <div className="stacked-form">
              <div>
                <h2>{application.name}</h2>
                <p>
                  client_id：{application.clientId} · 状态：{application.enabled ? '已启用' : '已停用'} · 最近更新：
                  {new Date(application.updatedAt).toLocaleString('zh-CN')}
                </p>
                <p>登录入口：{buildLoginExample(application)}</p>
                <p>会话校验：{buildSessionCheckEndpoint(application)}</p>
              </div>
              <label>
                <span>应用名称</span>
                <input type="text" name="name" defaultValue={application.name} maxLength={80} required />
              </label>
              <label>
                <span>允许回跳地址</span>
                <textarea name="allowedRedirects" rows={3} defaultValue={joinLines(application.allowedRedirects)} required />
              </label>
              <label>
                <span>允许来源</span>
                <textarea name="allowedOrigins" rows={3} defaultValue={joinLines(application.allowedOrigins)} required />
              </label>
              <label className="inline-toggle">
                <input type="checkbox" name="enabled" defaultChecked={application.enabled} />
                <span>启用</span>
              </label>
            </div>
            <div className="admin-list-actions">
              <button className="primary-action" type="submit" disabled={updatingId === application.id}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  save
                </span>
                <span>{updatingId === application.id ? '保存中' : '保存'}</span>
              </button>
            </div>
          </form>
        ))}
      </div>
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
