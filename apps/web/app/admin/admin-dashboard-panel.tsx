'use client';

import { useEffect, useMemo, useState } from 'react';
import { getJson } from '../api-client';
import { BackofficeTopbarPageActions } from '../backoffice-shell';

interface AdminDashboardSummary {
  users: {
    pendingReview: number;
    active: number;
    suspended: number;
    deleted: number;
  };
  providers: {
    pendingReview: number;
    pendingProfileChanges: number;
    pendingApiKeyChanges: number;
    pendingWebhookChanges: number;
    active: number;
    suspended: number;
    archived: number;
  };
  reviews: {
    templateVersionsPending: number;
    ticketUpdatesPending: number;
    disputesOpen: number;
  };
  passes: {
    total: number;
    issued: number;
    added: number;
    active: number;
    frozen: number;
  };
  operations: {
    activeAddPassTokens: number;
    activeActionLinks: number;
    activeStorageAlerts: number;
  };
  generatedAt: string;
}

export function AdminDashboardPanel() {
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSummary = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<AdminDashboardSummary>('/api/admin/dashboard/summary');
      setSummary(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取后台概览失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, []);

  const actionItems = useMemo(() => {
    if (!summary) {
      return [];
    }

    return [
      {
        label: '用户注册审核',
        count: summary.users.pendingReview,
        href: '/admin/users',
        detail: '待审核、等待服务器验证或验证码已刷新',
      },
      {
        label: '提供方入驻审核',
        count: summary.providers.pendingReview,
        href: '/admin/providers',
        detail: '等待管理员处理的发卡方申请',
      },
      {
        label: '提供方资料变更',
        count: summary.providers.pendingProfileChanges,
        href: '/admin/providers',
        detail: '发卡方提交的名称、联系人和业务说明变更',
      },
      {
        label: 'Webhook 配置审核',
        count: summary.providers.pendingWebhookChanges,
        href: '/admin/providers',
        detail: '发卡方提交的外部事件回调端点申请',
      },
      {
        label: 'API 密钥审核',
        count: summary.providers.pendingApiKeyChanges,
        href: '/admin/providers',
        detail: '发卡方提交的开放 API 密钥创建申请',
      },
      {
        label: '模板版本审核',
        count: summary.reviews.templateVersionsPending,
        href: '/admin/pass-templates',
        detail: '发卡方提交的新模板或新版模板',
      },
      {
        label: '票券字段变更',
        count: summary.reviews.ticketUpdatesPending,
        href: '/admin/passes',
        detail: '审核通过后才会写入用户可见票券信息',
      },
      {
        label: '开放争议',
        count: summary.reviews.disputesOpen,
        href: '/admin/disputes',
        detail: '提交中、处理中或需要补充信息的争议',
      },
      {
        label: '存储告警',
        count: summary.operations.activeStorageAlerts,
        href: '/admin/storage',
        detail: '当前仍处于 active 状态的存储空间告警',
      },
    ];
  }, [summary]);
  const pendingActionItems = actionItems.filter((item) => item.count > 0);

  return (
    <>
      <BackofficeTopbarPageActions>
        <div className="admin-list-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadSummary()}
            title="刷新"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
        </div>
      </BackofficeTopbarPageActions>
      <section
        className="admin-panel admin-dashboard-panel"
        aria-labelledby="admin-dashboard-title"
      >
        <div className="admin-panel-heading">
          <div>
            <p>平台管理</p>
            <h1 id="admin-dashboard-title">后台概览</h1>
          </div>
        </div>

        {message ? (
          <div className="flow-notice" role="status" aria-live="polite">
            <span>{message}</span>
          </div>
        ) : null}

        {isLoading ? <p className="empty-note">正在读取后台概览。</p> : null}

        {summary ? (
          <>
            <section className="admin-list-section" aria-labelledby="admin-dashboard-metrics-title">
              <div className="detail-section-heading">
                <h2 id="admin-dashboard-metrics-title">关键数字</h2>
              </div>
              <dl className="storage-stat-grid admin-dashboard-metric-grid">
                <div>
                  <dt>可用用户</dt>
                  <dd>{summary.users.active}</dd>
                </div>
                <div>
                  <dt>封禁用户</dt>
                  <dd>{summary.users.suspended}</dd>
                </div>
                <div>
                  <dt>可用提供方</dt>
                  <dd>{summary.providers.active}</dd>
                </div>
                <div>
                  <dt>停用提供方</dt>
                  <dd>{summary.providers.suspended}</dd>
                </div>
                <div>
                  <dt>卡券总数</dt>
                  <dd>{summary.passes.total}</dd>
                </div>
                <div>
                  <dt>待领取卡券</dt>
                  <dd>{summary.passes.issued}</dd>
                </div>
                <div>
                  <dt>已添加/可用卡券</dt>
                  <dd>{summary.passes.added + summary.passes.active}</dd>
                </div>
                <div>
                  <dt>冻结卡券</dt>
                  <dd>{summary.passes.frozen}</dd>
                </div>
                <div>
                  <dt>有效领取码</dt>
                  <dd>{summary.operations.activeAddPassTokens}</dd>
                </div>
                <div>
                  <dt>有效操作链接</dt>
                  <dd>{summary.operations.activeActionLinks}</dd>
                </div>
              </dl>
            </section>

            <section className="admin-list-section" aria-labelledby="admin-dashboard-actions-title">
              <div className="detail-section-heading">
                <h2 id="admin-dashboard-actions-title">待办</h2>
                <span>更新时间：{formatDateTime(summary.generatedAt)}</span>
              </div>
              {pendingActionItems.length === 0 ? (
                <p className="empty-note">当前没有需要立即处理的待办。</p>
              ) : (
                <>
                  <div className="flow-notice" role="status">
                    <span>
                      有 {pendingActionItems.reduce((total, item) => total + item.count, 0)}{' '}
                      项待办需要处理。
                    </span>
                  </div>
                  <div className="admin-list">
                    {pendingActionItems.map((item) => (
                      <article className="admin-list-item" key={item.label}>
                        <div>
                          <h2>{item.label}</h2>
                          <p>{item.detail}</p>
                        </div>
                        <div className="admin-list-actions">
                          <strong>{item.count}</strong>
                          <a className="primary-action" href={item.href}>
                            处理
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          </>
        ) : null}
      </section>
    </>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
