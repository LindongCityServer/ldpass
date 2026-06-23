'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getJson } from '../../api-client';

type DisputeStatus = 'Submitted' | 'InReview' | 'NeedMoreInfo' | 'Approved' | 'Rejected' | 'Reversed' | 'Closed';

interface ProviderDispute {
  id: string;
  status: DisputeStatus;
  subjectType: string;
  subjectId: string;
  reason: string;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    username: string;
    email: string;
  } | null;
  pass: {
    id: string;
    providerName: string;
    displayName: string;
    title: string;
    publicNumber: string | null;
    maskedNumber: string | null;
    balanceValue: string;
  } | null;
}

interface ProviderDisputesResponse {
  disputes: ProviderDispute[];
}

export function ProviderDisputesPanel() {
  const [disputes, setDisputes] = useState<ProviderDispute[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '',
    keyword: '',
  });

  const loadDisputes = async (nextFilters = filters) => {
    setIsLoading(true);
    setMessage(null);

    const search = new URLSearchParams();
    search.set('take', '50');
    if (nextFilters.status) {
      search.set('status', nextFilters.status);
    }
    if (nextFilters.keyword.trim()) {
      search.set('keyword', nextFilters.keyword.trim());
    }

    try {
      const result = await getJson<ProviderDisputesResponse>(`/api/provider/disputes?${search.toString()}`);
      setDisputes(result.disputes);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取争议记录失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDisputes();
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadDisputes();
  };

  return (
    <section className="admin-panel" aria-labelledby="provider-disputes-title">
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-disputes-title">争议记录</h1>
        </div>
        <a className="secondary-action" href="/provider/passes">
          卡券权益
        </a>
      </div>

      <form className="audit-filter-grid" onSubmit={submitFilters}>
        <label>
          <span>状态</span>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">全部状态</option>
            <option value="Submitted">已提交</option>
            <option value="InReview">处理中</option>
            <option value="NeedMoreInfo">需要补充</option>
            <option value="Approved">已认可</option>
            <option value="Rejected">已驳回</option>
            <option value="Reversed">已反转</option>
            <option value="Closed">已关闭</option>
          </select>
        </label>
        <label>
          <span>搜索</span>
          <input
            value={filters.keyword}
            onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
            placeholder="用户、卡号、原因"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="secondary-action" type="button" onClick={() => void loadDisputes(filters)}>
            刷新
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

      {isLoading ? <p className="empty-note">正在读取争议记录。</p> : null}
      {!isLoading && disputes.length === 0 ? <p className="empty-note">暂无匹配的争议记录。</p> : null}

      <div className="admin-list">
        {disputes.map((dispute) => (
          <article className="admin-list-item" key={dispute.id}>
            <div>
              <h2>{formatDisputeStatus(dispute.status)}</h2>
              <p>{readDisputePassLabel(dispute)}</p>
              <p>{dispute.user ? `${dispute.user.username} · ${dispute.user.email}` : '用户已删除或不可用'}</p>
              <p>对象：{formatSubjectType(dispute.subjectType)} · {dispute.subjectId}</p>
              <p className="audit-summary">{dispute.reason}</p>
              {dispute.resolutionNote ? <p className="audit-summary">处理备注：{dispute.resolutionNote}</p> : null}
              <p>{formatDate(dispute.updatedAt)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function readDisputePassLabel(dispute: ProviderDispute): string {
  if (!dispute.pass) {
    return '关联卡券不可用';
  }

  return `${dispute.pass.displayName} · ${dispute.pass.maskedNumber ?? dispute.pass.publicNumber ?? dispute.pass.id}`;
}

function formatSubjectType(subjectType: string): string {
  const labels: Record<string, string> = {
    pass: '卡券',
    ledger_entry: '流水',
    redemption_request: '核销请求',
    admin_adjustment: '管理员调整',
    pass_top_up: '额度补充',
  };

  return labels[subjectType] ?? subjectType;
}

function formatDisputeStatus(status: DisputeStatus): string {
  const labels: Record<DisputeStatus, string> = {
    Submitted: '已提交',
    InReview: '处理中',
    NeedMoreInfo: '需要补充',
    Approved: '已认可',
    Rejected: '已驳回',
    Reversed: '已反转',
    Closed: '已关闭',
  };

  return labels[status];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
