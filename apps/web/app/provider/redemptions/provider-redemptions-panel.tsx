'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';
import { BackofficeTopbarPageActions } from '../../backoffice-shell';

interface ProviderSessionResponse {
  providerAccount: {
    providerName: string;
    providerSlug: string;
  } | null;
}

interface ProviderRedemptionPass {
  id: string;
  providerName: string;
  displayName: string;
  title: string;
  category: 'account' | 'identity_key' | 'ticket';
  benefitType: 'amount' | 'points' | 'times';
  status: string;
  hideTitle?: boolean;
  publicNumber: string | null;
  maskedNumber: string | null;
  backgroundImageUrl?: string | null;
  balanceValue: string;
  frozenValue: string;
  expiresAt: string | null;
}

interface ProviderRedemptionPreviewResponse {
  pass: ProviderRedemptionPass;
  holder: {
    username: string;
    email: string;
    serverAccountVerified: boolean;
  } | null;
  issuerProvider: {
    name: string;
    slug: string;
  };
  redeemingProvider: {
    name: string;
    slug: string;
  };
}

interface ProviderRedemptionRequest {
  id: string;
  status: string;
  verificationMethod: 'server_account' | 'pin';
  requestedValue: string;
  expiresAt: string;
  verificationFailureCount: number;
  maxVerificationAttempts: number;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  pass: ProviderRedemptionPass;
  user: ProviderRedemptionPreviewResponse['holder'];
}

interface ProviderRedemptionsResponse {
  redemptionRequests: ProviderRedemptionRequest[];
}

interface CreateProviderRedemptionResponse {
  redemptionRequest: ProviderRedemptionRequest;
}

interface ProviderRedemptionsPanelProps {
  initialCardNumber?: string | undefined;
}

export function ProviderRedemptionsPanel({ initialCardNumber }: ProviderRedemptionsPanelProps) {
  const [providerAccount, setProviderAccount] =
    useState<ProviderSessionResponse['providerAccount']>(null);
  const [cardNumberInput, setCardNumberInput] = useState(initialCardNumber ?? '');
  const [requestedValue, setRequestedValue] = useState('1');
  const [verificationMethod, setVerificationMethod] = useState<'pin' | 'server_account'>('pin');
  const [preview, setPreview] = useState<ProviderRedemptionPreviewResponse | null>(null);
  const [redemptionRequests, setRedemptionRequests] = useState<ProviderRedemptionRequest[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isRedemptionDialogOpen, setIsRedemptionDialogOpen] = useState(Boolean(initialCardNumber));
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);

    try {
      const result = await getJson<ProviderRedemptionsResponse>(
        '/api/provider/redemptions?take=10',
      );
      setRedemptionRequests(result.redemptionRequests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取核销记录失败。');
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const loadPreview = useCallback(
    async (rawCardNumber: string, options: { showReadyMessage?: boolean } = {}) => {
      const cardNumber = normalizeCardNumberLookup(rawCardNumber);
      if (!cardNumber) {
        setPreview(null);
        setMessage('请填写卡号。');
        return null;
      }

      setIsPreviewLoading(true);
      setPreview(null);
      setMessage(null);

      try {
        const result = await getJson<ProviderRedemptionPreviewResponse>(
          `/api/provider/redemptions/pass-preview?cardNumber=${encodeURIComponent(cardNumber)}`,
        );
        setPreview(result);
        setCardNumberInput(cardNumber);
        if (options.showReadyMessage) {
          setMessage('已读取已领取卡券，可发起核销。');
        }

        return result;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '读取卡券信息失败。');
        return null;
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    getJson<ProviderSessionResponse>('/api/providers/auth/session')
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setProviderAccount(result.providerAccount);
        if (!result.providerAccount) {
          setMessage('请先登录发卡方后台。');
          return;
        }

        void loadHistory();
      })
      .catch((error) => {
        if (isMounted) {
          setMessage(error instanceof Error ? error.message : '读取发卡方会话失败。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsSessionLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [loadHistory]);

  useEffect(() => {
    const cardNumber = normalizeCardNumberLookup(initialCardNumber ?? '');
    setCardNumberInput(initialCardNumber ?? '');
    if (!cardNumber) {
      return;
    }

    setIsRedemptionDialogOpen(true);
    void loadPreview(cardNumber);
  }, [initialCardNumber, loadPreview]);

  const submitRedemption = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cardNumber = normalizeCardNumberLookup(cardNumberInput);
    if (!cardNumber) {
      setMessage('请填写卡号。');
      return;
    }

    if (!requestedValue.trim()) {
      setMessage('请填写核销数值。');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<CreateProviderRedemptionResponse>(
        '/api/provider/redemptions/by-card-number',
        {
          cardNumber,
          requestedValue,
          verificationMethod,
          idempotencyKey: createClientIdempotencyKey('provider-card-redemption'),
        },
      );
      setPreview({
        pass: result.redemptionRequest.pass,
        holder: result.redemptionRequest.user,
        issuerProvider: preview?.issuerProvider ?? {
          name: result.redemptionRequest.pass.providerName,
          slug: '',
        },
        redeemingProvider: {
          name: providerAccount?.providerName ?? '',
          slug: providerAccount?.providerSlug ?? '',
        },
      });
      setMessage(
        `已发起核销 ${formatBenefitValue(result.redemptionRequest.requestedValue, result.redemptionRequest.pass.benefitType)}，请持卡用户完成 ${formatVerificationMethod(result.redemptionRequest.verificationMethod)} 确认。`,
      );
      setIsRedemptionDialogOpen(false);
      await loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发起核销失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRedemptionDialog = () => {
    setMessage(null);
    setIsRedemptionDialogOpen(true);
  };

  return (
    <>
      <BackofficeTopbarPageActions>
        <div className="admin-list-actions">
          {providerAccount ? (
            <button
              className="primary-action"
              type="button"
              onClick={openRedemptionDialog}
              title="发起核销"
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                point_of_sale
              </span>
              <span>发起核销</span>
            </button>
          ) : null}
          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadHistory()}
            title="刷新记录"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新记录</span>
          </button>
        </div>
      </BackofficeTopbarPageActions>
      <section className="admin-panel" aria-labelledby="provider-redemptions-title">
        <div className="admin-panel-heading">
          <div>
            <p>发卡方后台</p>
            <h1 id="provider-redemptions-title">核销</h1>
          </div>
        </div>

        {isSessionLoading ? <p className="empty-note">正在读取发卡方状态。</p> : null}

        {message && !isRedemptionDialogOpen ? (
          <div className="flow-notice" role="status" aria-live="polite">
            <span>{message}</span>
          </div>
        ) : null}

        {!isSessionLoading && !providerAccount ? (
          <div className="form-actions">
            <a className="primary-action" href="/provider/login">
              <span className="material-symbols-rounded" aria-hidden="true">
                login
              </span>
              <span>登录发卡方后台</span>
            </a>
          </div>
        ) : null}

        {providerAccount ? (
          <>
            {isRedemptionDialogOpen ? (
              <div className="admin-dialog-layer">
                <button
                  className="admin-dialog-scrim"
                  type="button"
                  aria-label="关闭弹窗"
                  onClick={() => setIsRedemptionDialogOpen(false)}
                />
                <section
                  className="admin-dialog-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-label="发起核销"
                >
                  <div className="admin-dialog-heading">
                    <h2>发起核销</h2>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="关闭弹窗"
                      onClick={() => setIsRedemptionDialogOpen(false)}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">
                        close
                      </span>
                    </button>
                  </div>
                  {message ? (
                    <div className="flow-notice" role="status" aria-live="polite">
                      <span>{message}</span>
                    </div>
                  ) : null}
                  <form className="admin-dialog-form" onSubmit={submitRedemption} noValidate>
                    <label>
                      <span>卡号</span>
                      <input
                        type="text"
                        name="cardNumber"
                        autoComplete="off"
                        inputMode="text"
                        value={cardNumberInput}
                        onChange={(event) => {
                          setCardNumberInput(event.target.value);
                          setPreview(null);
                          setMessage(null);
                        }}
                        placeholder="输入已领取卡片的完整卡号"
                        required
                      />
                    </label>
                    <div className="admin-dialog-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={isPreviewLoading}
                        onClick={() =>
                          void loadPreview(cardNumberInput, { showReadyMessage: true })
                        }
                      >
                        <span className="material-symbols-rounded" aria-hidden="true">
                          visibility
                        </span>
                        <span>{isPreviewLoading ? '读取中' : '读取卡券'}</span>
                      </button>
                    </div>
                    {preview ? <ProviderRedemptionPreview preview={preview} /> : null}
                    <label>
                      <span>核销数值</span>
                      <input
                        type="text"
                        name="requestedValue"
                        inputMode="decimal"
                        value={requestedValue}
                        onChange={(event) => setRequestedValue(event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      <span>确认方式</span>
                      <select
                        name="verificationMethod"
                        value={verificationMethod}
                        onChange={(event) =>
                          setVerificationMethod(event.target.value as 'pin' | 'server_account')
                        }
                      >
                        <option value="pin">用户 PIN</option>
                        <option value="server_account">服务器账号验证码</option>
                      </select>
                    </label>
                    <div className="admin-dialog-actions">
                      <button className="primary-action" type="submit" disabled={isSubmitting}>
                        <span className="material-symbols-rounded" aria-hidden="true">
                          point_of_sale
                        </span>
                        <span>{isSubmitting ? '发起中' : '发起核销'}</span>
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            ) : null}

            <div className="detail-section-heading">
              <h2>最近核销</h2>
              <span>{redemptionRequests.length}</span>
            </div>
            {isHistoryLoading ? <p className="empty-note">正在读取核销记录。</p> : null}
            {!isHistoryLoading && redemptionRequests.length === 0 ? (
              <p className="empty-note">暂无核销记录。</p>
            ) : null}
            <div className="admin-list">
              {redemptionRequests.map((request) => (
                <article className="admin-list-item" key={request.id}>
                  <div>
                    <h2>{request.pass.displayName}</h2>
                    <p>
                      卡号：
                      {request.pass.maskedNumber ?? request.pass.publicNumber ?? request.pass.id} ·
                      持卡用户：
                      {request.user ? `${request.user.username}（${request.user.email}）` : '未知'}
                    </p>
                    <p>
                      {formatRedemptionStatus(request.status)} ·{' '}
                      {formatVerificationMethod(request.verificationMethod)} ·{' '}
                      {formatBenefitValue(request.requestedValue, request.pass.benefitType)}
                    </p>
                    <p>
                      到期：{formatDate(request.expiresAt, '未知')} · 发起：
                      {formatDate(request.createdAt, '未知')}
                    </p>
                    {request.failureMessage ? <p>失败原因：{request.failureMessage}</p> : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

function ProviderRedemptionPreview({ preview }: { preview: ProviderRedemptionPreviewResponse }) {
  return (
    <section
      className={`add-pass-preview add-pass-preview-${preview.pass.category}`}
      aria-label="待核销卡券信息"
    >
      <div
        className={`add-pass-preview-card add-pass-preview-card-${preview.pass.category}${preview.pass.backgroundImageUrl ? ' has-image' : ''}`}
        style={
          preview.pass.backgroundImageUrl
            ? { backgroundImage: `url("${preview.pass.backgroundImageUrl}")` }
            : undefined
        }
        aria-hidden="true"
      >
        <small>
          {formatPassTailNumber(preview.pass.maskedNumber ?? preview.pass.publicNumber) ??
            '**** 5678'}
        </small>
      </div>
      <div className="add-pass-preview-heading">
        <div>
          <span>{preview.issuerProvider.name}</span>
          <strong>{preview.pass.displayName}</strong>
          {preview.pass.hideTitle === true ? null : <small>{preview.pass.title}</small>}
        </div>
      </div>
      <dl>
        <div>
          <dt>卡号</dt>
          <dd>{preview.pass.maskedNumber ?? preview.pass.publicNumber ?? preview.pass.id}</dd>
        </div>
        <div>
          <dt>持卡用户</dt>
          <dd>
            {preview.holder ? `${preview.holder.username} · ${preview.holder.email}` : '未领取'}
          </dd>
        </div>
        <div>
          <dt>当前权益</dt>
          <dd>{formatBenefitValue(preview.pass.balanceValue, preview.pass.benefitType)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{formatPassStatus(preview.pass.status)}</dd>
        </div>
      </dl>
    </section>
  );
}

function normalizeCardNumberLookup(value: string): string {
  const trimmedValue = value.trim();

  try {
    const url = new URL(trimmedValue, window.location.origin);
    return (url.searchParams.get('cardNumber') ?? trimmedValue)
      .replace(/\s+/g, '')
      .trim()
      .toUpperCase();
  } catch {
    return trimmedValue.replace(/\s+/g, '').toUpperCase();
  }
}

function createClientIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function formatPassTailNumber(maskedNumber: string | null): string | null {
  if (!maskedNumber) {
    return null;
  }

  const tail = maskedNumber.trim().slice(-4);
  return tail ? '**** ' + tail : maskedNumber;
}

function formatBenefitValue(
  value: string,
  benefitType: ProviderRedemptionPass['benefitType'],
): string {
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

function formatVerificationMethod(method: ProviderRedemptionRequest['verificationMethod']): string {
  return method === 'server_account' ? '服务器账号验证码' : '用户 PIN';
}

function formatPassStatus(status: string): string {
  const labels: Record<string, string> = {
    Active: '可用',
    Archived: '已归档',
    Expired: '已过期',
    Frozen: '已冻结',
    PendingClaim: '待领取',
    UsedUp: '已用尽',
  };

  return labels[status] ?? status;
}

function formatRedemptionStatus(status: string): string {
  const labels: Record<string, string> = {
    Cancelled: '已取消',
    Expired: '已过期',
    Failed: '失败',
    Reversed: '已撤销',
    Succeeded: '已完成',
    WaitingVerification: '等待用户确认',
  };

  return labels[status] ?? status;
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }

  return new Date(value).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
