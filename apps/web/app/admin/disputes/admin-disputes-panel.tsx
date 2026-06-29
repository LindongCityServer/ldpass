'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getJson, postJson } from '../../api-client';

type DisputeStatus =
  | 'Submitted'
  | 'InReview'
  | 'NeedMoreInfo'
  | 'Approved'
  | 'Rejected'
  | 'Reversed'
  | 'Closed';
type AdminNextDisputeStatus = Exclude<DisputeStatus, 'Submitted'>;
type DisputeDialog =
  | { kind: 'detail'; dispute: AdminDispute }
  | { kind: 'status'; dispute: AdminDispute }
  | { kind: 'top_up_reverse'; dispute: AdminDispute }
  | { kind: 'redemption_reverse'; dispute: AdminDispute };

interface AdminDispute {
  id: string;
  status: DisputeStatus;
  subjectType: string;
  subjectId: string;
  reason: string;
  resolutionNote: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
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

interface AdminDisputesResponse {
  disputes: AdminDispute[];
}

interface UpdateDisputeResponse {
  dispute: AdminDispute;
}

interface ReverseTopUpResponse {
  topUp: {
    id: string;
    reversed: boolean;
    alreadyReversed?: boolean;
  };
}

interface ReverseRedemptionResponse {
  redemptionRequest: {
    id: string;
    status: DisputeStatus | string;
  };
}

const nextStatusOptions: Array<{
  value: Exclude<AdminNextDisputeStatus, 'Reversed'>;
  label: string;
}> = [
  { value: 'InReview', label: '处理中' },
  { value: 'NeedMoreInfo', label: '需要补充' },
  { value: 'Approved', label: '已认可' },
  { value: 'Rejected', label: '已驳回' },
  { value: 'Closed', label: '已关闭' },
];

export function AdminDisputesPanel() {
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [reversingTopUpDisputeId, setReversingTopUpDisputeId] = useState<string | null>(null);
  const [reversingRedemptionDisputeId, setReversingRedemptionDisputeId] = useState<string | null>(
    null,
  );
  const [filters, setFilters] = useState({
    status: '',
    keyword: '',
  });
  const [activeDialog, setActiveDialog] = useState<DisputeDialog | null>(null);
  const [statusInputs, setStatusInputs] = useState<Record<string, AdminNextDisputeStatus>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [topUpReverseReasons, setTopUpReverseReasons] = useState<Record<string, string>>({});
  const [topUpReversePins, setTopUpReversePins] = useState<Record<string, string>>({});
  const [redemptionReverseReasons, setRedemptionReverseReasons] = useState<Record<string, string>>(
    {},
  );
  const [redemptionReversePins, setRedemptionReversePins] = useState<Record<string, string>>({});

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
      const result = await getJson<AdminDisputesResponse>(
        `/api/admin/disputes?${search.toString()}`,
      );
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

  const updateStatus = async (event: FormEvent<HTMLFormElement>, dispute: AdminDispute) => {
    event.preventDefault();

    const status = statusInputs[dispute.id];
    if (!status) {
      setMessage('请选择下一步状态。');
      return;
    }

    const resolutionNote = resolutionNotes[dispute.id]?.trim() || '';

    if (status === 'Reversed') {
      setMessage('只有完成实际冲正后才能把争议标记为已反转，请使用对应的“冲正并标记已反转”按钮。');
      return;
    }

    if (['NeedMoreInfo', 'Approved', 'Rejected', 'Closed'].includes(status) && !resolutionNote) {
      setMessage('请填写处理备注，说明本次争议处理结论。');
      return;
    }

    setUpdatingId(dispute.id);
    setMessage(null);

    try {
      const result = await postJson<UpdateDisputeResponse>(
        `/api/admin/disputes/${dispute.id}/status`,
        {
          status,
          resolutionNote: resolutionNote || undefined,
        },
      );
      setDisputes((currentDisputes) =>
        currentDisputes.map((currentDispute) =>
          currentDispute.id === result.dispute.id ? result.dispute : currentDispute,
        ),
      );
      setResolutionNotes((currentNotes) => ({ ...currentNotes, [dispute.id]: '' }));
      setActiveDialog(null);
      setMessage(`争议状态已更新为「${formatDisputeStatus(result.dispute.status)}」。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新争议状态失败。');
    } finally {
      setUpdatingId(null);
    }
  };

  const reverseTopUpDispute = async (event: FormEvent<HTMLFormElement>, dispute: AdminDispute) => {
    event.preventDefault();

    if (dispute.subjectType !== 'pass_top_up') {
      setMessage('只有额度补充争议可以从这里直接冲正。');
      return;
    }

    const reason = topUpReverseReasons[dispute.id]?.trim();
    const secondFactor = topUpReversePins[dispute.id]?.trim();

    if (!reason) {
      setMessage('请输入冲正原因。');
      return;
    }

    if (!secondFactor) {
      setMessage('请输入管理员 PIN。');
      return;
    }

    setReversingTopUpDisputeId(dispute.id);
    setMessage(null);

    try {
      const reverseResult = await postJson<ReverseTopUpResponse>(
        `/api/admin/passes/top-ups/${encodeURIComponent(dispute.subjectId)}/reverse`,
        {
          reason,
          secondFactor,
        },
      );
      let nextDispute = dispute;

      if (dispute.status !== 'Reversed') {
        const statusResult = await postJson<UpdateDisputeResponse>(
          `/api/admin/disputes/${dispute.id}/status`,
          {
            status: 'Reversed',
            resolutionNote: reason,
            reversalConfirmed: true,
          },
        );
        nextDispute = statusResult.dispute;
      }

      setDisputes((currentDisputes) =>
        currentDisputes.map((currentDispute) =>
          currentDispute.id === nextDispute.id ? nextDispute : currentDispute,
        ),
      );
      setTopUpReverseReasons((currentReasons) => ({ ...currentReasons, [dispute.id]: '' }));
      setTopUpReversePins((currentPins) => ({ ...currentPins, [dispute.id]: '' }));
      setResolutionNotes((currentNotes) => ({ ...currentNotes, [dispute.id]: '' }));
      setActiveDialog(null);
      setMessage(
        reverseResult.topUp.alreadyReversed
          ? '这笔额度补充此前已冲正，争议已标记为已反转。'
          : '额度补充已冲正，争议已标记为已反转。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '冲正额度补充失败。');
    } finally {
      setReversingTopUpDisputeId(null);
    }
  };

  const reverseRedemptionDispute = async (
    event: FormEvent<HTMLFormElement>,
    dispute: AdminDispute,
  ) => {
    event.preventDefault();

    if (dispute.subjectType !== 'redemption_request') {
      setMessage('只有消耗请求争议可以从这里直接冲正。');
      return;
    }

    const reason = redemptionReverseReasons[dispute.id]?.trim();
    const secondFactor = redemptionReversePins[dispute.id]?.trim();

    if (!reason) {
      setMessage('请输入冲正原因。');
      return;
    }

    if (!secondFactor) {
      setMessage('请输入管理员 PIN。');
      return;
    }

    setReversingRedemptionDisputeId(dispute.id);
    setMessage(null);

    try {
      await postJson<ReverseRedemptionResponse>(
        `/api/admin/redemptions/${encodeURIComponent(dispute.subjectId)}/reverse`,
        {
          reason,
          secondFactor,
        },
      );
      let nextDispute = dispute;

      if (dispute.status !== 'Reversed') {
        const statusResult = await postJson<UpdateDisputeResponse>(
          `/api/admin/disputes/${dispute.id}/status`,
          {
            status: 'Reversed',
            resolutionNote: reason,
            reversalConfirmed: true,
          },
        );
        nextDispute = statusResult.dispute;
      }

      setDisputes((currentDisputes) =>
        currentDisputes.map((currentDispute) =>
          currentDispute.id === nextDispute.id ? nextDispute : currentDispute,
        ),
      );
      setRedemptionReverseReasons((currentReasons) => ({ ...currentReasons, [dispute.id]: '' }));
      setRedemptionReversePins((currentPins) => ({ ...currentPins, [dispute.id]: '' }));
      setResolutionNotes((currentNotes) => ({ ...currentNotes, [dispute.id]: '' }));
      setActiveDialog(null);
      setMessage('消耗请求已冲正，争议已标记为已反转。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '冲正消耗请求失败。');
    } finally {
      setReversingRedemptionDisputeId(null);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-disputes-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-disputes-title">争议审核</h1>
        </div>
      </div>

      <form className="audit-filter-grid" onSubmit={submitFilters}>
        <label>
          <span>状态</span>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
          >
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
            onChange={(event) =>
              setFilters((current) => ({ ...current, keyword: event.target.value }))
            }
            placeholder="用户、卡号、提供方、原因"
          />
        </label>
        <div className="audit-filter-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadDisputes(filters)}
          >
            刷新
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => exportDisputesCsv(disputes, setMessage)}
          >
            导出 CSV
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
      {!isLoading && disputes.length === 0 ? (
        <p className="empty-note">暂无匹配的争议记录。</p>
      ) : null}

      <div className="admin-list">
        {disputes.map((dispute) => (
          <article className="admin-list-item dispute-list-item" key={dispute.id}>
            <div>
              <h2>{formatDisputeStatus(dispute.status)}</h2>
              <p>{readDisputePassLabel(dispute)}</p>
              <p>
                {dispute.user
                  ? `${dispute.user.username} · ${dispute.user.email}`
                  : '用户已删除或不可用'}
              </p>
              <p>
                对象：{formatSubjectType(dispute.subjectType)} · {dispute.subjectId}
              </p>
              <p className="audit-summary">{dispute.reason}</p>
              {dispute.resolutionNote ? (
                <p className="audit-summary">处理备注：{dispute.resolutionNote}</p>
              ) : null}
              <p>{formatDate(dispute.updatedAt)}</p>
            </div>
            <div className="admin-list-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setActiveDialog({ kind: 'detail', dispute })}
              >
                详情
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setActiveDialog({ kind: 'status', dispute })}
              >
                处理
              </button>
              {dispute.subjectType === 'pass_top_up' && dispute.status !== 'Closed' ? (
                <button
                  className="danger-action"
                  type="button"
                  onClick={() => setActiveDialog({ kind: 'top_up_reverse', dispute })}
                >
                  补充冲正
                </button>
              ) : null}
              {dispute.subjectType === 'redemption_request' && dispute.status !== 'Closed' ? (
                <button
                  className="danger-action"
                  type="button"
                  onClick={() => setActiveDialog({ kind: 'redemption_reverse', dispute })}
                >
                  核销冲正
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {activeDialog ? (
        <div className="admin-dialog-layer">
          <button
            className="admin-dialog-scrim"
            type="button"
            aria-label="关闭弹窗"
            onClick={() => setActiveDialog(null)}
          />
          <section
            className="admin-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="争议详情"
          >
            <div className="admin-dialog-heading">
              <h2>{readDisputeDialogTitle(activeDialog)}</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setActiveDialog(null)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <DisputeDetail dispute={activeDialog.dispute} />
            {activeDialog.kind === 'status' ? (
              <form
                className="dispute-status-form"
                onSubmit={(event) => void updateStatus(event, activeDialog.dispute)}
              >
                <label>
                  <span>下一步状态</span>
                  <select
                    value={statusInputs[activeDialog.dispute.id] ?? ''}
                    onChange={(event) =>
                      setStatusInputs((currentInputs) => ({
                        ...currentInputs,
                        [activeDialog.dispute.id]: event.target.value as AdminNextDisputeStatus,
                      }))
                    }
                  >
                    <option value="">选择状态</option>
                    {nextStatusOptions.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>处理备注</span>
                  <textarea
                    value={resolutionNotes[activeDialog.dispute.id] ?? ''}
                    onChange={(event) =>
                      setResolutionNotes((currentNotes) => ({
                        ...currentNotes,
                        [activeDialog.dispute.id]: event.target.value,
                      }))
                    }
                    rows={4}
                    placeholder="可选，说明处理结论或补充要求"
                  />
                </label>
                <div className="admin-dialog-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => setActiveDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    className="primary-action"
                    type="submit"
                    disabled={updatingId === activeDialog.dispute.id}
                  >
                    {updatingId === activeDialog.dispute.id ? '更新中' : '更新状态'}
                  </button>
                </div>
              </form>
            ) : null}
            {activeDialog.kind === 'top_up_reverse' ? (
              <form
                className="dispute-status-form"
                onSubmit={(event) => void reverseTopUpDispute(event, activeDialog.dispute)}
              >
                <label>
                  <span>冲正原因</span>
                  <input
                    value={topUpReverseReasons[activeDialog.dispute.id] ?? ''}
                    onChange={(event) =>
                      setTopUpReverseReasons((currentReasons) => ({
                        ...currentReasons,
                        [activeDialog.dispute.id]: event.target.value,
                      }))
                    }
                    maxLength={200}
                    placeholder="例如：争议认可，恢复双方卡券额度"
                  />
                </label>
                <label>
                  <span>管理员 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4,12}"
                    value={topUpReversePins[activeDialog.dispute.id] ?? ''}
                    onChange={(event) =>
                      setTopUpReversePins((currentPins) => ({
                        ...currentPins,
                        [activeDialog.dispute.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="admin-dialog-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => setActiveDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    className="danger-action"
                    type="submit"
                    disabled={reversingTopUpDisputeId === activeDialog.dispute.id}
                  >
                    {reversingTopUpDisputeId === activeDialog.dispute.id
                      ? '冲正中'
                      : '冲正并标记已反转'}
                  </button>
                </div>
              </form>
            ) : null}
            {activeDialog.kind === 'redemption_reverse' ? (
              <form
                className="dispute-status-form"
                onSubmit={(event) => void reverseRedemptionDispute(event, activeDialog.dispute)}
              >
                <label>
                  <span>冲正原因</span>
                  <input
                    value={redemptionReverseReasons[activeDialog.dispute.id] ?? ''}
                    onChange={(event) =>
                      setRedemptionReverseReasons((currentReasons) => ({
                        ...currentReasons,
                        [activeDialog.dispute.id]: event.target.value,
                      }))
                    }
                    maxLength={200}
                    placeholder="例如：争议认可，恢复卡券额度"
                  />
                </label>
                <label>
                  <span>管理员 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4,12}"
                    value={redemptionReversePins[activeDialog.dispute.id] ?? ''}
                    onChange={(event) =>
                      setRedemptionReversePins((currentPins) => ({
                        ...currentPins,
                        [activeDialog.dispute.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="admin-dialog-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => setActiveDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    className="danger-action"
                    type="submit"
                    disabled={reversingRedemptionDisputeId === activeDialog.dispute.id}
                  >
                    {reversingRedemptionDisputeId === activeDialog.dispute.id
                      ? '冲正中'
                      : '冲正并标记已反转'}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function readDisputePassLabel(dispute: AdminDispute): string {
  if (!dispute.pass) {
    return '关联卡券不可用';
  }

  return `${dispute.pass.providerName} · ${dispute.pass.displayName} · ${dispute.pass.maskedNumber ?? dispute.pass.publicNumber ?? dispute.pass.id}`;
}

function DisputeDetail({ dispute }: { dispute: AdminDispute }) {
  const details = [
    ['状态', formatDisputeStatus(dispute.status)],
    ['对象', `${formatSubjectType(dispute.subjectType)} · ${dispute.subjectId}`],
    ['卡券', readDisputePassLabel(dispute)],
    [
      '用户',
      dispute.user ? `${dispute.user.username} / ${dispute.user.email}` : '用户已删除或不可用',
    ],
    ['更新时间', formatDate(dispute.updatedAt)],
  ];

  return (
    <dl className="admin-detail-list">
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div>
        <dt>原因</dt>
        <dd>{dispute.reason}</dd>
      </div>
      {dispute.resolutionNote ? (
        <div>
          <dt>处理备注</dt>
          <dd>{dispute.resolutionNote}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function readDisputeDialogTitle(dialog: DisputeDialog): string {
  if (dialog.kind === 'detail') {
    return '争议详情';
  }
  if (dialog.kind === 'status') {
    return '处理争议';
  }
  return '冲正争议';
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

function exportDisputesCsv(disputes: AdminDispute[], onMessage: (message: string) => void): void {
  const rows = disputes.map((dispute) => ({
    id: dispute.id,
    status: formatDisputeStatus(dispute.status),
    subjectType: formatSubjectType(dispute.subjectType),
    subjectId: dispute.subjectId,
    user: dispute.user ? `${dispute.user.username} <${dispute.user.email}>` : '',
    pass: readDisputePassLabel(dispute),
    reason: dispute.reason,
    resolutionNote: dispute.resolutionNote ?? '',
    updatedAt: dispute.updatedAt,
  }));

  downloadTextFile('ldpass-admin-disputes.csv', toCsv(rows), 'text/csv;charset=utf-8');
  onMessage('争议 CSV 已生成。');
}

function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0] ?? {});
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header] ?? '')).join(',')),
  ].join('\r\n');
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
