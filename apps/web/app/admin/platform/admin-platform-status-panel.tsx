'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';
import { BackofficeTopbarPageActions } from '../../backoffice-shell';
import { ThemeSchedulePanel } from '../theme/theme-schedule-panel';

type PlatformNoticeTone = 'info' | 'warning' | 'critical';

interface PlatformStatusEditable {
  announcementEnabled: boolean;
  announcementTitle: string;
  announcementBody: string;
  announcementTone: PlatformNoticeTone;
  maintenanceEnabled: boolean;
  maintenanceTitle: string;
  maintenanceBody: string;
}

interface PlatformStatusResponse {
  editable: PlatformStatusEditable;
  status: {
    updatedAt: string | null;
  };
}

const toneOptions: Array<{ value: PlatformNoticeTone; label: string }> = [
  { value: 'info', label: '信息' },
  { value: 'warning', label: '提醒' },
  { value: 'critical', label: '重要' },
];

const emptyEditable: PlatformStatusEditable = {
  announcementEnabled: false,
  announcementTitle: '',
  announcementBody: '',
  announcementTone: 'info',
  maintenanceEnabled: false,
  maintenanceTitle: '',
  maintenanceBody: '',
};

type PlatformStatusView = 'announcement' | 'maintenance' | 'theme';

export function AdminPlatformStatusPanel() {
  const [editable, setEditable] = useState<PlatformStatusEditable>(emptyEditable);
  const [activeView, setActiveView] = useState<PlatformStatusView>('announcement');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadStatus = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<PlatformStatusResponse>('/api/admin/platform/status');
      setEditable(result.editable);
      setUpdatedAt(result.status.updatedAt);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取平台状态失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const updateEditable = (patch: Partial<PlatformStatusEditable>) => {
    setEditable((currentEditable) => ({ ...currentEditable, ...patch }));
  };

  const saveStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const result = await postJson<PlatformStatusResponse>('/api/admin/platform/status', editable);
      setEditable(result.editable);
      setUpdatedAt(result.status.updatedAt);
      setMessage('平台公告与维护状态已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存平台状态失败。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-platform-title">
      <BackofficeTopbarPageActions>
        <div className="admin-list-actions">
          <button
            className="secondary-action"
            type="button"
            title="刷新"
            onClick={() => void loadStatus()}
            disabled={isLoading}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
        </div>
      </BackofficeTopbarPageActions>
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-platform-title">平台状态</h1>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取平台状态。</p> : null}

      <div className="segmented-control" role="tablist" aria-label="平台状态设置">
        <button
          className={activeView === 'announcement' ? 'is-selected' : undefined}
          type="button"
          onClick={() => setActiveView('announcement')}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            campaign
          </span>
          <span>公告</span>
        </button>
        <button
          className={activeView === 'maintenance' ? 'is-selected' : undefined}
          type="button"
          onClick={() => setActiveView('maintenance')}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            construction
          </span>
          <span>维护</span>
        </button>
        <button
          className={activeView === 'theme' ? 'is-selected' : undefined}
          type="button"
          onClick={() => setActiveView('theme')}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            palette
          </span>
          <span>主题</span>
        </button>
      </div>

      {activeView !== 'theme' ? (
        <form className="stacked-form platform-status-form" onSubmit={saveStatus} noValidate>
          {activeView === 'announcement' ? (
            <fieldset>
              <legend>全站公告</legend>
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={editable.announcementEnabled}
                  onChange={(event) =>
                    updateEditable({ announcementEnabled: event.target.checked })
                  }
                />
                <span>启用公告横幅</span>
              </label>
              <label>
                <span>公告标题</span>
                <input
                  value={editable.announcementTitle}
                  onChange={(event) => updateEditable({ announcementTitle: event.target.value })}
                  maxLength={80}
                />
              </label>
              <label>
                <span>公告正文</span>
                <textarea
                  value={editable.announcementBody}
                  onChange={(event) => updateEditable({ announcementBody: event.target.value })}
                  maxLength={500}
                />
              </label>
              <label>
                <span>公告级别</span>
                <select
                  value={editable.announcementTone}
                  onChange={(event) =>
                    updateEditable({ announcementTone: event.target.value as PlatformNoticeTone })
                  }
                >
                  {toneOptions.map((tone) => (
                    <option value={tone.value} key={tone.value}>
                      {tone.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ) : null}

          {activeView === 'maintenance' ? (
            <fieldset>
              <legend>维护状态</legend>
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={editable.maintenanceEnabled}
                  onChange={(event) => updateEditable({ maintenanceEnabled: event.target.checked })}
                />
                <span>启用维护提醒</span>
              </label>
              <label>
                <span>维护标题</span>
                <input
                  value={editable.maintenanceTitle}
                  onChange={(event) => updateEditable({ maintenanceTitle: event.target.value })}
                  maxLength={80}
                />
              </label>
              <label>
                <span>维护说明</span>
                <textarea
                  value={editable.maintenanceBody}
                  onChange={(event) => updateEditable({ maintenanceBody: event.target.value })}
                  maxLength={500}
                />
              </label>
            </fieldset>
          ) : null}

          <p className="empty-note">
            {updatedAt
              ? `最后更新：${new Date(updatedAt).toLocaleString('zh-CN')}`
              : '尚未保存平台状态。'}
          </p>

          <div className="form-actions">
            <button className="primary-action" type="submit" disabled={isSaving || isLoading}>
              <span className="material-symbols-rounded" aria-hidden="true">
                campaign
              </span>
              <span>{isSaving ? '保存中' : '保存状态'}</span>
            </button>
          </div>
        </form>
      ) : (
        <ThemeSchedulePanel embedded />
      )}
    </section>
  );
}
