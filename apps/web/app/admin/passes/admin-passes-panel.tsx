'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getJson, postJson } from '../../api-client';

interface AdminPassUser {
  id: string;
  username: string;
  email: string;
}

interface AdminPass {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  title: string;
  category: string;
  benefitType: 'amount' | 'points' | 'times';
  status: string;
  publicNumber: string | null;
  maskedNumber: string | null;
  balanceValue: string;
  frozenValue: string;
  overdraftLimit: string;
  user: AdminPassUser | null;
  updatedAt: string;
}

interface AdminTicketInfo {
  eventName: string | null;
  venue: string | null;
  startsAt: string | null;
  seatLabel: string | null;
  checkInStatus: 'not_checked_in' | 'checked_in' | 'voided';
  changeStatus: 'none' | 'rescheduled' | 'cancelled';
}

interface AdminTicketUpdateRequest {
  id: string;
  passId: string;
  providerId: string;
  providerName: string;
  status: string;
  currentTicketInfo: AdminTicketInfo | null;
  proposedTicketInfo: AdminTicketInfo | null;
  reason: string | null;
  reviewReason: string | null;
  createdAt: string;
  pass: Pick<AdminPass, 'id' | 'displayName' | 'title' | 'category' | 'benefitType' | 'publicNumber' | 'maskedNumber' | 'user'>;
}

interface AdminPassesResponse {
  passes: AdminPass[];
}

interface AdminTicketUpdateRequestsResponse {
  ticketUpdateRequests: AdminTicketUpdateRequest[];
}

interface AdjustPassResponse {
  pass: AdminPass;
  ledgerEntry: {
    id: string;
    beforeValue: string;
    changeValue: string;
    afterValue: string;
    reason: string;
    note: string | null;
    createdAt: string;
  };
}

interface ChangeFreezeResponse {
  pass: AdminPass;
}

interface ReviewTicketUpdateResponse {
  pass?: AdminPass;
  ticketUpdateRequest: AdminTicketUpdateRequest;
}

interface ReverseTopUpResponse {
  topUp: {
    id: string;
    reversed: boolean;
    alreadyReversed: boolean;
    reversedValue?: string;
  };
  sourcePass?: AdminPass;
  targetPass?: AdminPass;
  passes?: AdminPass[];
  ledgerEntries: Array<{
    id: string;
    passId: string;
    changeValue: string;
  }>;
}

export function AdminPassesPanel() {
  const [passes, setPasses] = useState<AdminPass[]>([]);
  const [ticketUpdateRequests, setTicketUpdateRequests] = useState<AdminTicketUpdateRequest[]>([]);
  const [selectedPassId, setSelectedPassId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [changeValue, setChangeValue] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [freezeReason, setFreezeReason] = useState('');
  const [freezePin, setFreezePin] = useState('');
  const [topUpIdToReverse, setTopUpIdToReverse] = useState('');
  const [topUpReverseReason, setTopUpReverseReason] = useState('');
  const [topUpReversePin, setTopUpReversePin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTicketUpdates, setIsLoadingTicketUpdates] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChangingFreezeStatus, setIsChangingFreezeStatus] = useState(false);
  const [isReversingTopUp, setIsReversingTopUp] = useState(false);
  const [reviewingTicketUpdateId, setReviewingTicketUpdateId] = useState<string | null>(null);
  const [exportingType, setExportingType] = useState<'passes' | 'ledger' | null>(null);

  const selectedPass = useMemo(
    () => passes.find((pass) => pass.id === selectedPassId) ?? passes[0] ?? null,
    [passes, selectedPassId],
  );

  const loadPasses = async (nextKeyword = keyword) => {
    setIsLoading(true);
    setMessage(null);

    const search = new URLSearchParams();
    search.set('take', '50');
    if (nextKeyword.trim()) {
      search.set('keyword', nextKeyword.trim());
    }

    try {
      const result = await getJson<AdminPassesResponse>(`/api/admin/passes?${search.toString()}`);
      setPasses(result.passes);
      setSelectedPassId((currentId) => {
        if (currentId && result.passes.some((pass) => pass.id === currentId)) {
          return currentId;
        }

        return result.passes[0]?.id ?? null;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取卡券列表失败。');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTicketUpdateRequests = async () => {
    setIsLoadingTicketUpdates(true);
    setMessage(null);

    try {
      const result = await getJson<AdminTicketUpdateRequestsResponse>(
        '/api/admin/passes/ticket-update-requests',
      );
      setTicketUpdateRequests(result.ticketUpdateRequests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取票券变更审核列表失败。');
    } finally {
      setIsLoadingTicketUpdates(false);
    }
  };

  useEffect(() => {
    void loadPasses('');
    void loadTicketUpdateRequests();
  }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadPasses(keyword);
  };

  const exportCsv = async (type: 'passes' | 'ledger') => {
    const search = new URLSearchParams();
    search.set('take', '1000');
    if (keyword.trim()) {
      search.set('keyword', keyword.trim());
    }

    const endpoint =
      type === 'passes'
        ? `/api/admin/passes/export.csv?${search.toString()}`
        : `/api/admin/passes/ledger/export.csv?${search.toString()}`;
    const filename = type === 'passes' ? 'ldpass-admin-passes.csv' : 'ldpass-admin-ledger.csv';

    setExportingType(type);
    setMessage(null);

    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await readExportError(response));
      }

      const content = await response.text();
      downloadTextFile(filename, content, 'text/csv;charset=utf-8');
      setMessage(type === 'passes' ? '管理员卡券 CSV 已生成。' : '管理员流水 CSV 已生成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出 CSV 失败。');
    } finally {
      setExportingType(null);
    }
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setMessage('请先选择要调整的卡券。');
      return;
    }

    if (!changeValue.trim() || !reason.trim() || !adminPin.trim()) {
      setMessage('请输入调整值、调整原因和管理员 PIN。');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<AdjustPassResponse>(
        `/api/admin/passes/${selectedPass.id}/adjust`,
        {
          changeValue: changeValue.trim(),
          reason: reason.trim(),
          secondFactor: adminPin.trim(),
          note: note.trim() || undefined,
        },
      );
      setPasses((currentPasses) =>
        currentPasses.map((pass) => (pass.id === result.pass.id ? result.pass : pass)),
      );
      setChangeValue('');
      setReason('');
      setNote('');
      setAdminPin('');
      setMessage(
        `已调整权益：${formatSignedValue(result.ledgerEntry.changeValue, result.pass.benefitType)}，当前值 ${formatBenefitValue(result.pass.balanceValue, result.pass.benefitType)}。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '调整权益失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeFreezeStatus = async (nextAction: 'freeze' | 'unfreeze') => {
    if (!selectedPass) {
      setMessage('请先选择要处理的卡券。');
      return;
    }

    if (!freezeReason.trim() || !freezePin.trim()) {
      setMessage('请输入冻结/解冻原因和管理员 PIN。');
      return;
    }

    setIsChangingFreezeStatus(true);
    setMessage(null);

    try {
      const result = await postJson<ChangeFreezeResponse>(
        `/api/admin/passes/${selectedPass.id}/${nextAction}`,
        {
          reason: freezeReason.trim(),
          secondFactor: freezePin.trim(),
        },
      );
      setPasses((currentPasses) =>
        currentPasses.map((pass) => (pass.id === result.pass.id ? result.pass : pass)),
      );
      setFreezeReason('');
      setFreezePin('');
      setMessage(nextAction === 'freeze' ? '卡券已冻结，后续不能发起消耗请求。' : '卡券已解冻。');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : nextAction === 'freeze'
            ? '冻结卡券失败。'
            : '解冻卡券失败。',
      );
    } finally {
      setIsChangingFreezeStatus(false);
    }
  };

  const reviewTicketUpdateRequest = async (
    request: AdminTicketUpdateRequest,
    action: 'approve' | 'reject',
  ) => {
    const reason = window.prompt(
      action === 'approve' ? '请输入审核备注（可留空）' : '请输入拒绝原因',
      '',
    );

    if (reason === null) {
      return;
    }

    if (action === 'reject' && !reason.trim()) {
      setMessage('拒绝票券字段变更时需要填写原因。');
      return;
    }

    setReviewingTicketUpdateId(request.id);
    setMessage(null);

    try {
      const result = await postJson<ReviewTicketUpdateResponse>(
        `/api/admin/passes/ticket-update-requests/${request.id}/${action}`,
        {
          reason: reason.trim() || undefined,
        },
      );

      setTicketUpdateRequests((currentRequests) =>
        currentRequests.filter((currentRequest) => currentRequest.id !== result.ticketUpdateRequest.id),
      );

      if (result.pass) {
        setPasses((currentPasses) =>
          currentPasses.map((pass) => (pass.id === result.pass?.id ? result.pass : pass)),
        );
      }

      setMessage(action === 'approve' ? '票券字段变更已通过并生效。' : '票券字段变更已拒绝。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : action === 'approve' ? '通过票券字段变更失败。' : '拒绝票券字段变更失败。');
    } finally {
      setReviewingTicketUpdateId(null);
    }
  };

  const submitTopUpReversal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!topUpIdToReverse.trim() || !topUpReverseReason.trim() || !topUpReversePin.trim()) {
      setMessage('请输入补充 ID、冲正原因和管理员 PIN。');
      return;
    }

    setIsReversingTopUp(true);
    setMessage(null);

    try {
      const result = await postJson<ReverseTopUpResponse>(
        `/api/admin/passes/top-ups/${encodeURIComponent(topUpIdToReverse.trim())}/reverse`,
        {
          reason: topUpReverseReason.trim(),
          secondFactor: topUpReversePin.trim(),
        },
      );

      const updatedPasses = [result.sourcePass, result.targetPass, ...(result.passes ?? [])].filter(
        (pass): pass is AdminPass => Boolean(pass),
      );
      if (updatedPasses.length > 0) {
        setPasses((currentPasses) =>
          currentPasses.map(
            (pass) => updatedPasses.find((updatedPass) => updatedPass.id === pass.id) ?? pass,
          ),
        );
      }

      setTopUpIdToReverse('');
      setTopUpReverseReason('');
      setTopUpReversePin('');
      setMessage(
        result.topUp.alreadyReversed
          ? '这笔额度补充此前已经冲正，本次没有重复变更余额。'
          : `已冲正额度补充：${formatBenefitValue(
              result.topUp.reversedValue ?? '0',
              result.targetPass?.benefitType ??
                result.sourcePass?.benefitType ??
                selectedPass?.benefitType ??
                'amount',
            )}。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '冲正额度补充失败。');
    } finally {
      setIsReversingTopUp(false);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-passes-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-passes-title">卡券权益调整</h1>
        </div>
        <div className="admin-list-actions">
          <a className="secondary-action" href="/admin/disputes">
            争议处理
          </a>
          <a className="secondary-action" href="/admin/audit">
            审计日志
          </a>
        </div>
      </div>

      <form className="audit-filter-grid" onSubmit={submitSearch}>
        <label>
          <span>搜索卡券</span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="卡号、尾号、提供方、用户名"
          />
        </label>
        <div className="audit-filter-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadPasses(keyword)}
          >
            刷新
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={exportingType !== null}
            onClick={() => void exportCsv('passes')}
          >
            {exportingType === 'passes' ? '导出中' : '导出卡券 CSV'}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={exportingType !== null}
            onClick={() => void exportCsv('ledger')}
          >
            {exportingType === 'ledger' ? '导出中' : '导出流水 CSV'}
          </button>
          <button className="primary-action" type="submit">
            <span className="material-symbols-rounded" aria-hidden="true">
              search
            </span>
            <span>搜索</span>
          </button>
        </div>
      </form>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      <section className="admin-list-section" aria-labelledby="ticket-update-requests-title">
        <div className="detail-section-heading">
          <h2 id="ticket-update-requests-title">待审核票券变更</h2>
          <span>{ticketUpdateRequests.length}</span>
        </div>
        <div className="admin-list-actions">
          <button
            className="secondary-action"
            type="button"
            disabled={isLoadingTicketUpdates}
            onClick={() => void loadTicketUpdateRequests()}
          >
            {isLoadingTicketUpdates ? '刷新中' : '刷新票券变更'}
          </button>
        </div>
        {isLoadingTicketUpdates ? <p className="empty-note">正在读取票券变更审核列表。</p> : null}
        {!isLoadingTicketUpdates && ticketUpdateRequests.length === 0 ? (
          <p className="empty-note">暂无待审核票券变更。</p>
        ) : null}
        <div className="admin-list">
          {ticketUpdateRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>{request.pass.displayName}</h2>
                <p>
                  {request.providerName} · {request.pass.title} ·{' '}
                  {request.pass.maskedNumber ?? request.pass.publicNumber ?? request.pass.id}
                </p>
                <p>当前：{formatTicketSummary(request.currentTicketInfo)}</p>
                <p>拟改：{formatTicketSummary(request.proposedTicketInfo)}</p>
                <p>
                  状态：{formatTicketStatus(request.proposedTicketInfo)} · 提交：
                  {formatDate(request.createdAt)}
                </p>
                {request.reason ? <p>发卡方说明：{request.reason}</p> : null}
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={reviewingTicketUpdateId === request.id}
                  onClick={() => void reviewTicketUpdateRequest(request, 'reject')}
                >
                  拒绝
                </button>
                <button
                  className="primary-action"
                  type="button"
                  disabled={reviewingTicketUpdateId === request.id}
                  onClick={() => void reviewTicketUpdateRequest(request, 'approve')}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    check
                  </span>
                  <span>{reviewingTicketUpdateId === request.id ? '处理中' : '通过'}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {selectedPass ? (
        <section className="stacked-form" aria-label="卡券管理操作">
          <form className="admin-adjustment-panel" onSubmit={submitAdjustment}>
            <div>
              <p>正在调整</p>
              <h2>{selectedPass.displayName}</h2>
              <span>
                {selectedPass.providerName} ·{' '}
                {selectedPass.maskedNumber ?? selectedPass.publicNumber ?? selectedPass.id}
              </span>
            </div>
            <strong>
              {formatBenefitValue(selectedPass.balanceValue, selectedPass.benefitType)}
            </strong>
            <label>
              <span>增减量</span>
              <input
                value={changeValue}
                onChange={(event) => setChangeValue(event.target.value)}
                placeholder="+30 或 -5"
                required
              />
            </label>
            <label>
              <span>原因</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="补发活动权益"
                required
              />
            </label>
            <label>
              <span>备注</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="可选"
              />
            </label>
            <label>
              <span>管理员 PIN</span>
              <input
                type="password"
                value={adminPin}
                onChange={(event) => setAdminPin(event.target.value)}
                inputMode="numeric"
                pattern="[0-9]{4,12}"
                autoComplete="one-time-code"
                required
              />
            </label>
            <button className="primary-action" type="submit" disabled={isSubmitting}>
              <span className="material-symbols-rounded" aria-hidden="true">
                tune
              </span>
              <span>{isSubmitting ? '提交中' : '提交调整'}</span>
            </button>
          </form>

          <div className="admin-adjustment-panel">
            <div>
              <p>状态操作</p>
              <h2>{formatPassStatus(selectedPass.status)}</h2>
              <span>冻结后发卡方不能对该卡券发起消耗请求。</span>
            </div>
            <label>
              <span>原因</span>
              <input
                value={freezeReason}
                onChange={(event) => setFreezeReason(event.target.value)}
                placeholder="异常争议处理中"
              />
            </label>
            <label>
              <span>管理员 PIN</span>
              <input
                type="password"
                value={freezePin}
                onChange={(event) => setFreezePin(event.target.value)}
                inputMode="numeric"
                pattern="[0-9]{4,12}"
                autoComplete="one-time-code"
              />
            </label>
            {selectedPass.status === 'Frozen' ? (
              <button
                className="primary-action"
                type="button"
                disabled={isChangingFreezeStatus}
                onClick={() => void changeFreezeStatus('unfreeze')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  lock_open
                </span>
                <span>{isChangingFreezeStatus ? '处理中' : '解冻卡券'}</span>
              </button>
            ) : (
              <button
                className="danger-action"
                type="button"
                disabled={isChangingFreezeStatus || selectedPass.status === 'Archived'}
                onClick={() => void changeFreezeStatus('freeze')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  lock
                </span>
                <span>{isChangingFreezeStatus ? '处理中' : '冻结卡券'}</span>
              </button>
            )}
          </div>
        </section>
      ) : null}

      <form className="admin-adjustment-panel top-up-reversal-panel" onSubmit={submitTopUpReversal}>
        <div>
          <p>额度补充冲正</p>
          <h2>补充 ID</h2>
          <span>输入用户补充返回的 ID，或已消耗的补充操作链接 ID。</span>
        </div>
        <label>
          <span>补充 ID</span>
          <input
            value={topUpIdToReverse}
            onChange={(event) => setTopUpIdToReverse(event.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            required
          />
        </label>
        <label>
          <span>原因</span>
          <input
            value={topUpReverseReason}
            onChange={(event) => setTopUpReverseReason(event.target.value)}
            placeholder="误补充或争议处理"
            required
          />
        </label>
        <label>
          <span>管理员 PIN</span>
          <input
            type="password"
            value={topUpReversePin}
            onChange={(event) => setTopUpReversePin(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]{4,12}"
            autoComplete="one-time-code"
            required
          />
        </label>
        <button className="danger-action" type="submit" disabled={isReversingTopUp}>
          <span className="material-symbols-rounded" aria-hidden="true">
            undo
          </span>
          <span>{isReversingTopUp ? '处理中' : '冲正补充'}</span>
        </button>
      </form>

      {isLoading ? <p className="empty-note">正在读取卡券列表。</p> : null}
      {!isLoading && passes.length === 0 ? <p className="empty-note">暂无可调整的卡券。</p> : null}

      <div className="admin-list">
        {passes.map((pass) => (
          <article
            className={`admin-list-item${selectedPass?.id === pass.id ? ' is-selected' : ''}`}
            key={pass.id}
          >
            <div>
              <h2>{pass.displayName}</h2>
              <p>
                {pass.providerName} · {pass.title} · {formatPassStatus(pass.status)}
              </p>
              <p>
                持有人：{pass.user ? `${pass.user.username} / ${pass.user.email}` : '尚未领取'} ·
                编号：
                {pass.maskedNumber ?? pass.publicNumber ?? '未设置'}
              </p>
              <p>
                当前值：{formatBenefitValue(pass.balanceValue, pass.benefitType)} · 冻结值：
                {formatBenefitValue(pass.frozenValue, pass.benefitType)}
              </p>
            </div>
            <div className="admin-list-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setSelectedPassId(pass.id)}
              >
                选择
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatBenefitValue(value: string, benefitType: AdminPass['benefitType']): string {
  if (benefitType === 'points') {
    return `${Number(value).toLocaleString('zh-CN')} 积分`;
  }

  if (benefitType === 'times') {
    return `${Number(value).toLocaleString('zh-CN')} 次`;
  }

  return Number(value).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  });
}

function formatSignedValue(value: string, benefitType: AdminPass['benefitType']): string {
  const numericValue = Number(value);
  const sign = numericValue > 0 ? '+' : '';
  return `${sign}${formatBenefitValue(value, benefitType)}`;
}

function formatPassStatus(status: string): string {
  const labels: Record<string, string> = {
    Issued: '已发放',
    Added: '已添加',
    Active: '可用',
    Frozen: '已冻结',
    Expired: '已过期',
    UsedUp: '已用尽',
    Archived: '已归档',
  };

  return labels[status] ?? status;
}

function formatTicketStatus(ticketInfo: AdminTicketInfo | null): string {
  if (!ticketInfo) {
    return '未设置';
  }

  const checkInLabels: Record<AdminTicketInfo['checkInStatus'], string> = {
    not_checked_in: '未检票',
    checked_in: '已检票',
    voided: '已作废',
  };
  const changeLabels: Record<AdminTicketInfo['changeStatus'], string> = {
    none: '无变更',
    rescheduled: '已改签',
    cancelled: '已取消',
  };

  return `${checkInLabels[ticketInfo.checkInStatus]} · ${changeLabels[ticketInfo.changeStatus]}`;
}

function formatTicketSummary(ticketInfo: AdminTicketInfo | null): string {
  if (!ticketInfo) {
    return '未设置票券字段';
  }

  return [
    ticketInfo.eventName || '未设置活动',
    ticketInfo.venue || '未设置场地',
    ticketInfo.startsAt ? formatDate(ticketInfo.startsAt) : '未设置场次',
    ticketInfo.seatLabel || '未设置座位',
  ].join(' · ');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}

async function readExportError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return message.join('；');
    }

    if (typeof message === 'string') {
      return message;
    }
  }

  return `导出失败：${response.status}`;
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], {
    type: mimeType,
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
