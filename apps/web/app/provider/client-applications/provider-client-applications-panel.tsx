'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';
import { BackofficeTopbarPageActions } from '../../backoffice-shell';

interface ProviderClientApplication {
  id: string;
  clientId: string;
  name: string;
  providerId: string;
  provider: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  allowedRedirects: string[];
  allowedOrigins: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ClientApplicationsResponse {
  applications: ProviderClientApplication[];
}

interface ClientApplicationResponse {
  application: ProviderClientApplication;
}

export function ProviderClientApplicationsPanel() {
  const [applications, setApplications] = useState<ProviderClientApplication[]>([]);
  const [keyword, setKeyword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState<ProviderClientApplication | null>(
    null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const filteredApplications = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) {
      return applications;
    }

    return applications.filter((application) =>
      [
        application.name,
        application.clientId,
        application.provider.name,
        ...application.allowedRedirects,
        ...application.allowedOrigins,
      ]
        .join(' ')
        .toLowerCase()
        .includes(value),
    );
  }, [applications, keyword]);

  const loadApplications = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<ClientApplicationsResponse>('/api/provider/client-applications');
      setApplications(result.applications);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取回调接入申请失败。');
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
    const form = new FormData(formElement);
    setIsCreating(true);
    setMessage(null);

    try {
      const result = await postJson<ClientApplicationResponse>(
        '/api/provider/client-applications',
        {
          clientId: String(form.get('clientId') ?? ''),
          name: String(form.get('name') ?? ''),
          allowedRedirects: splitLines(String(form.get('allowedRedirects') ?? '')),
          allowedOrigins: splitLines(String(form.get('allowedOrigins') ?? '')),
        },
      );
      setApplications((current) => [result.application, ...current]);
      formElement.reset();
      setIsCreateDialogOpen(false);
      setMessage('回调接入申请已提交，等待平台启用。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交回调接入申请失败。');
    } finally {
      setIsCreating(false);
    }
  };

  const updateApplication = async (
    event: FormEvent<HTMLFormElement>,
    application: ProviderClientApplication,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setUpdatingId(application.id);
    setMessage(null);

    try {
      const result = await postJson<ClientApplicationResponse>(
        `/api/provider/client-applications/${application.id}`,
        {
          name: String(form.get('name') ?? ''),
          allowedRedirects: splitLines(String(form.get('allowedRedirects') ?? '')),
          allowedOrigins: splitLines(String(form.get('allowedOrigins') ?? '')),
        },
      );
      setApplications((current) =>
        current.map((item) => (item.id === application.id ? result.application : item)),
      );
      setEditingApplication(null);
      setMessage('回调接入申请已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存回调接入申请失败。');
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteApplication = async (application: ProviderClientApplication) => {
    if (!window.confirm(`确定删除回调接入申请“${application.name}”吗？`)) {
      return;
    }

    setUpdatingId(application.id);
    setMessage(null);

    try {
      await postJson(`/api/provider/client-applications/${application.id}/delete`);
      setApplications((current) => current.filter((item) => item.id !== application.id));
      setEditingApplication(null);
      setMessage('回调接入申请已删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除回调接入申请失败。');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <>
      <BackofficeTopbarPageActions>
        <div className="admin-list-actions">
          <button
            className="primary-action"
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              add_link
            </span>
            <span>新建申请</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadApplications()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
        </div>
      </BackofficeTopbarPageActions>
      <section className="admin-panel" aria-labelledby="provider-client-applications-title">
        <div className="admin-panel-heading">
          <div>
            <p>发卡方接入</p>
            <h1 id="provider-client-applications-title">回调应用</h1>
          </div>
        </div>

        {message ? (
          <div className="flow-notice" role="status">
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
              placeholder="名称、client_id、回跳地址"
            />
          </label>
          <div className="audit-filter-actions">
            <button className="secondary-action" type="button" onClick={() => setKeyword('')}>
              重置
            </button>
          </div>
        </form>

        {isLoading ? <p className="empty-note">正在读取回调应用。</p> : null}
        {!isLoading && filteredApplications.length === 0 ? (
          <p className="empty-note">暂无回调应用。</p>
        ) : null}
        <div className="admin-list">
          {filteredApplications.map((application) => (
            <article className="admin-list-item" key={application.id}>
              <div>
                <h2>{application.name}</h2>
                <p>
                  client_id：{application.clientId} ·{' '}
                  {application.enabled ? '平台已启用' : '等待平台启用'}
                </p>
                <p>
                  绑定发卡方：{application.provider.name} · 回跳地址：
                  {application.allowedRedirects.length} 个
                </p>
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setEditingApplication(application)}
                >
                  编辑
                </button>
              </div>
            </article>
          ))}
        </div>

        {isCreateDialogOpen ? (
          <ApplicationDialog
            title="新建回调应用"
            submitText={isCreating ? '提交中' : '提交'}
            disabled={isCreating}
            onClose={() => setIsCreateDialogOpen(false)}
            onSubmit={createApplication}
          />
        ) : null}
        {editingApplication ? (
          <ApplicationDialog
            title={editingApplication.name}
            application={editingApplication}
            submitText={updatingId === editingApplication.id ? '保存中' : '保存'}
            disabled={updatingId === editingApplication.id}
            onClose={() => setEditingApplication(null)}
            onSubmit={(event) => void updateApplication(event, editingApplication)}
            onDelete={() => void deleteApplication(editingApplication)}
          />
        ) : null}
      </section>
    </>
  );
}

function ApplicationDialog({
  title,
  application,
  submitText,
  disabled,
  onClose,
  onSubmit,
  onDelete,
}: {
  title: string;
  application?: ProviderClientApplication;
  submitText: string;
  disabled: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="admin-dialog-layer">
      <button
        className="admin-dialog-scrim"
        type="button"
        aria-label="关闭弹窗"
        onClick={onClose}
      />
      <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="admin-dialog-heading">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={onClose}>
            <span className="material-symbols-rounded" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <form className="admin-dialog-form" onSubmit={onSubmit}>
          {application ? (
            <p>
              client_id：{application.clientId} · {application.provider.name}
            </p>
          ) : (
            <label>
              <span>client_id</span>
              <input type="text" name="clientId" maxLength={80} required />
            </label>
          )}
          <label>
            <span>应用名称</span>
            <input
              type="text"
              name="name"
              defaultValue={application?.name}
              maxLength={80}
              required
            />
          </label>
          <label>
            <span>允许回跳地址（每行一个完整 URL）</span>
            <textarea
              name="allowedRedirects"
              rows={3}
              defaultValue={application?.allowedRedirects.join('\n')}
              required
            />
          </label>
          <label>
            <span>允许来源（每行一个 Origin 或完整 URL）</span>
            <textarea
              name="allowedOrigins"
              rows={3}
              defaultValue={application?.allowedOrigins.join('\n')}
              required
            />
          </label>
          <div className="admin-dialog-actions">
            {onDelete ? (
              <button
                className="secondary-action danger-action"
                type="button"
                disabled={disabled}
                onClick={onDelete}
              >
                删除
              </button>
            ) : null}
            <button className="secondary-action" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-action" type="submit" disabled={disabled}>
              {submitText}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
