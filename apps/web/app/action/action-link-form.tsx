'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiClientError, getJson, postJson } from '../api-client';

type ActionKind = 'use' | 'top_up';
type BenefitType = 'amount' | 'points' | 'times';
type VerificationMethod = 'server_account' | 'pin';

interface WalletPassPreview {
  id: string;
  providerName: string;
  displayName: string;
  title: string;
  hideTitle?: boolean;
  category: 'account' | 'identity_key' | 'ticket';
  benefitType: BenefitType;
  status: string;
  publicNumber: string | null;
  maskedNumber: string | null;
  balanceValue: string;
  frozenValue: string;
  overdraftLimit: string;
  expiresAt: string | null;
  backgroundImageUrl: string | null;
  logoUrl: string | null;
}

interface ActionLinkPreviewResponse {
  actionLink: {
    id: string;
    kind: ActionKind;
    status: string;
    providerName: string;
    targetPassId: string;
    requestedValue: string;
    verificationMethod: VerificationMethod;
    note: string | null;
    expiresAt: string;
  };
  targetPass: WalletPassPreview;
  sourcePasses: WalletPassPreview[];
}

interface PinConfirmResponse {
  status: string;
  targetPass: WalletPassPreview;
  sourcePass?: WalletPassPreview;
  actionLink: ActionLinkPreviewResponse['actionLink'];
  redemptionRequest?: {
    id: string;
    status: string;
    requestedValue: string;
  };
  topUp?: {
    id: string;
    value: string;
  };
  ledgerEntry?: {
    id: string;
    beforeValue: string;
    changeValue: string;
    afterValue: string;
  } | null;
}

interface ServerStartResponse {
  mode: 'redemption' | 'top_up';
  actionLink: ActionLinkPreviewResponse['actionLink'];
  targetPass: WalletPassPreview;
  sourcePassId?: string;
  topUpRequest?: TopUpRequestView;
  redemptionRequest?: {
    id: string;
    status: string;
    requestedValue: string;
    expiresAt: string;
  };
  challenge?: ServerChallenge;
}

type TopUpRequestStatus =
  | 'Created'
  | 'WaitingVerification'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'
  | 'Expired'
  | 'Reversed';

interface TopUpRequestView {
  id: string;
  status: TopUpRequestStatus;
  sourcePassId: string;
  targetPassId: string;
  actionLinkId: string | null;
  value: string;
  verificationMethod: VerificationMethod;
  expiresAt: string | null;
}

interface ServerChallenge {
  id: string;
  serverId: string;
  code: string;
  expiresAt: string;
}

interface ServerChallengeResponse {
  status: string;
  redemptionRequest: NonNullable<ServerStartResponse['redemptionRequest']>;
  challenge: ServerChallenge;
}

interface ServerConfirmResponse {
  status: 'verified' | 'waiting' | 'rotated' | 'expired' | 'cancelled' | 'failed';
  challenge?: ServerChallenge;
  actionLink?: ActionLinkPreviewResponse['actionLink'];
  targetPass?: WalletPassPreview;
  sourcePass?: WalletPassPreview;
  topUpRequest?: TopUpRequestView;
  redemptionRequest?: NonNullable<ServerStartResponse['redemptionRequest']>;
  topUp?: {
    id: string;
    value: string;
  };
  ledgerEntry?: {
    id: string;
    beforeValue: string;
    changeValue: string;
    afterValue: string;
  } | null;
  pass?: WalletPassPreview;
}

interface CancelTopUpRequestResponse {
  topUpRequest: TopUpRequestView;
}

interface ActionLinkFormProps {
  initialToken?: string | undefined;
}

export function ActionLinkForm({ initialToken }: ActionLinkFormProps) {
  const [tokenInput, setTokenInput] = useState(initialToken ?? '');
  const [preview, setPreview] = useState<ActionLinkPreviewResponse | null>(null);
  const [loginHref, setLoginHref] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [selectedSourcePassId, setSelectedSourcePassId] = useState('');
  const [serverRedemption, setServerRedemption] = useState<NonNullable<
    ServerStartResponse['redemptionRequest']
  > | null>(null);
  const [topUpRequest, setTopUpRequest] = useState<TopUpRequestView | null>(null);
  const [serverChallenge, setServerChallenge] = useState<ServerChallenge | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSubmittingPin, setIsSubmittingPin] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(false);

  const normalizedToken = useMemo(() => normalizeActionToken(tokenInput), [tokenInput]);

  const loadPreview = useCallback(
    async (rawToken: string, options: { showReadyMessage?: boolean } = {}) => {
      const token = normalizeActionToken(rawToken);

      if (!token) {
        setPreview(null);
        setMessage('请填写操作链接或链接 token。');
        return null;
      }

      setIsPreviewLoading(true);
      setPreview(null);
      setLoginHref(null);
      setMessage(null);
      setServerRedemption(null);
      setTopUpRequest(null);
      setServerChallenge(null);

      try {
        const result = await getJson<ActionLinkPreviewResponse>(
          `/api/wallet/action-links/preview?token=${encodeURIComponent(token)}`,
        );
        setPreview(result);
        setSelectedSourcePassId(result.sourcePasses[0]?.id ?? '');
        if (options.showReadyMessage) {
          setMessage('已读取链接信息，请确认后继续。');
        }

        return result;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          setLoginHref(createLoginHref(token));
          setMessage('请先登录后继续确认这次链接操作。');
          return null;
        }

        setMessage(error instanceof Error ? error.message : '读取操作链接失败。');
        return null;
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const token = normalizeActionToken(initialToken ?? '');
    setTokenInput(initialToken ?? '');
    if (token) {
      void loadPreview(token);
    }
  }, [initialToken, loadPreview]);

  const submitPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadPreview(tokenInput, { showReadyMessage: true });
  };

  const confirmWithPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!preview) {
      setMessage('请先读取链接信息。');
      return;
    }

    if (preview.actionLink.kind === 'top_up' && !selectedSourcePassId) {
      setMessage('请选择用于补充的来源卡。');
      return;
    }

    setIsSubmittingPin(true);
    setMessage(null);

    try {
      const result = await postJson<PinConfirmResponse>('/api/wallet/action-links/confirm-pin', {
        token: normalizedToken,
        pin,
        sourcePassId: preview.actionLink.kind === 'top_up' ? selectedSourcePassId : undefined,
      });
      setPin('');
      setPreview((currentPreview) =>
        currentPreview
          ? {
              ...currentPreview,
              actionLink: result.actionLink,
              targetPass: result.targetPass,
            }
          : currentPreview,
      );
      setMessage(
        preview.actionLink.kind === 'top_up'
          ? `额度补充成功：${formatBenefitValue(preview.actionLink.requestedValue, preview.targetPass.benefitType)}。`
          : `确认使用成功：${formatBenefitValue(preview.actionLink.requestedValue, preview.targetPass.benefitType)}。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '确认失败。');
    } finally {
      setIsSubmittingPin(false);
    }
  };

  const startServerConfirmation = async () => {
    if (!preview) {
      setMessage('请先读取链接信息。');
      return;
    }

    if (preview.actionLink.kind === 'top_up' && !selectedSourcePassId) {
      setMessage('请选择用于补充的来源卡。');
      return;
    }

    setIsStartingServer(true);
    setMessage(null);

    try {
      const startResult = await postJson<ServerStartResponse>(
        '/api/wallet/action-links/server-redemption/start',
        {
          token: normalizedToken,
          sourcePassId: preview.actionLink.kind === 'top_up' ? selectedSourcePassId : undefined,
        },
      );

      if (startResult.mode === 'top_up') {
        setServerRedemption(null);
        setTopUpRequest(startResult.topUpRequest ?? null);
        setServerChallenge(startResult.challenge ?? null);
        setMessage(
          startResult.challenge
            ? `请使用服务器账号 ${startResult.challenge.serverId} 在服务器聊天内发送完整验证码。`
            : '服务器验证码已创建，但返回内容不完整，请重新获取。',
        );
        return;
      }

      if (!startResult.redemptionRequest) {
        setMessage('没有创建可确认的消耗请求，请重新获取验证码。');
        return;
      }

      setServerRedemption(startResult.redemptionRequest);

      const challengeResult = await postJson<ServerChallengeResponse>(
        `/api/wallet/redemption-requests/${startResult.redemptionRequest.id}/server-challenge/start`,
      );
      setServerChallenge(challengeResult.challenge);
      setMessage(
        `请使用服务器账号 ${challengeResult.challenge.serverId} 在服务器聊天内发送完整验证码。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发起服务器确认失败。');
    } finally {
      setIsStartingServer(false);
    }
  };

  const checkServerConfirmation = async () => {
    if (!preview) {
      setMessage('请先读取链接信息。');
      return;
    }

    if (!serverChallenge) {
      setMessage('请先获取服务器验证码。');
      return;
    }

    setIsCheckingServer(true);
    setMessage(null);

    try {
      if (preview.actionLink.kind === 'top_up') {
        if (!selectedSourcePassId) {
          setMessage('请选择用于补充的来源卡。');
          return;
        }

        const result = await postJson<ServerConfirmResponse>(
          '/api/wallet/action-links/server-confirm',
          {
            token: normalizedToken,
            challengeId: serverChallenge.id,
            sourcePassId: selectedSourcePassId,
          },
        );

        if (result.status === 'rotated' && result.challenge) {
          setServerChallenge(result.challenge);
          setTopUpRequest(result.topUpRequest ?? topUpRequest);
          setMessage('检测到服务器账号发送了其他内容，验证码已更新，请发送新的完整验证码。');
          return;
        }

        if (result.status === 'waiting') {
          setTopUpRequest(result.topUpRequest ?? topUpRequest);
          setMessage('还没有检测到对应聊天消息，请发送验证码后再检查。');
          return;
        }

        if (result.status === 'expired') {
          setTopUpRequest(result.topUpRequest ?? topUpRequest);
          setMessage('验证码已失效，请重新获取。');
          setServerChallenge(null);
          return;
        }

        if (result.status === 'cancelled') {
          setTopUpRequest(result.topUpRequest ?? topUpRequest);
          setMessage('这次额度补充链接请求已取消。');
          setServerChallenge(null);
          return;
        }

        if (result.status === 'failed') {
          setTopUpRequest(result.topUpRequest ?? topUpRequest);
          setMessage('这次额度补充链接请求已失败，请重新发起。');
          setServerChallenge(null);
          return;
        }

        if (result.actionLink && result.targetPass) {
          setPreview((currentPreview) =>
            currentPreview
              ? {
                  ...currentPreview,
                  actionLink: result.actionLink ?? currentPreview.actionLink,
                  targetPass: result.targetPass ?? currentPreview.targetPass,
                }
              : currentPreview,
          );
        }
        setTopUpRequest(result.topUpRequest ?? null);
        setServerChallenge(null);
        setMessage(
          `额度补充成功：${formatBenefitValue(preview.actionLink.requestedValue, preview.targetPass.benefitType)}。`,
        );
        return;
      }

      if (!serverRedemption) {
        setMessage('请先获取服务器验证码。');
        return;
      }

      const result = await postJson<ServerConfirmResponse>(
        `/api/wallet/redemption-requests/${serverRedemption.id}/confirm-server`,
        {
          challengeId: serverChallenge.id,
        },
      );

      if (result.status === 'rotated' && result.challenge) {
        setServerChallenge(result.challenge);
        setMessage('检测到服务器账号发送了其他内容，验证码已更新，请发送新的完整验证码。');
        return;
      }

      if (result.status === 'waiting') {
        setMessage('还没有检测到对应聊天消息，请发送验证码后再检查。');
        return;
      }

      if (result.status === 'expired') {
        setMessage('验证码已失效，请重新获取。');
        setServerChallenge(null);
        return;
      }

      const completeResult = await postJson<PinConfirmResponse>(
        '/api/wallet/action-links/server-redemption/complete',
        {
          token: normalizedToken,
          redemptionRequestId: serverRedemption.id,
        },
      );
      setPreview((currentPreview) =>
        currentPreview
          ? {
              ...currentPreview,
              actionLink: completeResult.actionLink,
              targetPass: completeResult.targetPass,
            }
          : currentPreview,
      );
      setMessage(
        `确认使用成功：${formatBenefitValue(preview?.actionLink.requestedValue ?? '0', preview?.targetPass.benefitType ?? 'amount')}。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检查服务器确认失败。');
    } finally {
      setIsCheckingServer(false);
    }
  };

  const cancelTopUpRequest = async () => {
    if (!topUpRequest) {
      setMessage('当前没有可取消的额度补充链接请求。');
      return;
    }

    setIsCheckingServer(true);
    setMessage(null);

    try {
      const result = await postJson<CancelTopUpRequestResponse>(
        `/api/wallet/action-links/top-ups/${encodeURIComponent(topUpRequest.id)}/cancel`,
        {
          reason: '用户取消本次额度补充链接请求',
        },
      );
      setTopUpRequest(result.topUpRequest);
      setServerChallenge(null);
      setMessage('已取消本次额度补充链接请求。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '取消额度补充链接请求失败。');
    } finally {
      setIsCheckingServer(false);
    }
  };

  return (
    <div className="stacked-form">
      <form className="stacked-form" onSubmit={submitPreview} noValidate>
        <label>
          <span>操作链接或 token</span>
          <input
            type="text"
            autoComplete="off"
            value={tokenInput}
            onChange={(event) => {
              setTokenInput(event.target.value);
              setPreview(null);
              setLoginHref(null);
              setMessage(null);
              setServerRedemption(null);
              setTopUpRequest(null);
              setServerChallenge(null);
            }}
            required
          />
        </label>
        <div className="form-actions compact-actions">
          <button className="secondary-action" type="submit" disabled={isPreviewLoading}>
            <span className="material-symbols-rounded" aria-hidden="true">
              visibility
            </span>
            <span>{isPreviewLoading ? '读取中' : '查看信息'}</span>
          </button>
        </div>
      </form>

      {preview ? (
        <ActionPreview
          preview={preview}
          selectedSourcePassId={selectedSourcePassId}
          onSelectSourcePass={(passId) => {
            setSelectedSourcePassId(passId);
            setTopUpRequest(null);
            setServerChallenge(null);
          }}
        />
      ) : null}

      {preview?.actionLink.verificationMethod === 'pin' ? (
        <form className="stacked-form action-confirm-form" onSubmit={confirmWithPin}>
          <label>
            <span>PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="4 到 12 位数字"
              required
            />
          </label>
          <div className="form-actions">
            <button className="primary-action" type="submit" disabled={isSubmittingPin}>
              <span className="material-symbols-rounded" aria-hidden="true">
                verified_user
              </span>
              <span>{isSubmittingPin ? '确认中' : '确认操作'}</span>
            </button>
          </div>
        </form>
      ) : null}

      {preview?.actionLink.verificationMethod === 'server_account' ? (
        <section className="action-server-panel" aria-label="服务器账号确认">
          <div className="form-actions">
            <button
              className="primary-action"
              type="button"
              disabled={isStartingServer}
              onClick={() => void startServerConfirmation()}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                forum
              </span>
              <span>{isStartingServer ? '获取中' : '获取服务器验证码'}</span>
            </button>
          </div>
          {serverChallenge ? (
            <div className="action-server-code">
              <span>请在服务器聊天发送</span>
              <strong>{serverChallenge.code}</strong>
              <small>
                服务器账号：{serverChallenge.serverId} · 有效期至{' '}
                {formatDate(serverChallenge.expiresAt, '未知')}
              </small>
              {topUpRequest ? (
                <small>
                  请求 {topUpRequest.id.slice(0, 8)} ·{' '}
                  {formatTopUpRequestStatus(topUpRequest.status)}
                </small>
              ) : null}
              <button
                className="secondary-action"
                type="button"
                disabled={isCheckingServer}
                onClick={() => void checkServerConfirmation()}
              >
                {isCheckingServer ? '检查中' : '我已发送，检查'}
              </button>
              {preview.actionLink.kind === 'top_up' &&
              topUpRequest?.status === 'WaitingVerification' ? (
                <button
                  className="secondary-action"
                  type="button"
                  disabled={isCheckingServer}
                  onClick={() => void cancelTopUpRequest()}
                >
                  取消本次补充
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
          {loginHref ? (
            <div className="form-actions">
              <a className="primary-action" href={loginHref}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  login
                </span>
                <span>去登录</span>
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="form-actions">
        <a className="secondary-action" href="/">
          返回钱包
        </a>
      </div>
    </div>
  );
}

function ActionPreview({
  preview,
  selectedSourcePassId,
  onSelectSourcePass,
}: {
  preview: ActionLinkPreviewResponse;
  selectedSourcePassId: string;
  onSelectSourcePass: (passId: string) => void;
}) {
  const requirements = [
    preview.actionLink.verificationMethod === 'pin'
      ? '需要输入 PIN 确认'
      : '需要在服务器聊天内发送本次验证码确认',
    preview.actionLink.kind === 'top_up'
      ? '将从你选择的来源卡消耗额度，并补充到目标卡'
      : '将从目标卡消耗额度或权益',
  ];

  return (
    <section className={`add-pass-preview add-pass-preview-${preview.targetPass.category}`} aria-label="链接操作预览">
      <ActionPreviewCardFace pass={preview.targetPass} />
      <div className="add-pass-preview-heading">
        {preview.targetPass.logoUrl ? (
          <img src={preview.targetPass.logoUrl} alt="" width={36} height={36} />
        ) : null}
        <div>
          <span>{preview.targetPass.providerName}</span>
          <strong>{preview.targetPass.displayName}</strong>
          {preview.targetPass.hideTitle === true ? null : <small>{preview.targetPass.title}</small>}
        </div>
      </div>
      <dl>
        <div>
          <dt>操作</dt>
          <dd>{preview.actionLink.kind === 'top_up' ? '额度补充' : '确认使用'}</dd>
        </div>
        <div>
          <dt>{preview.actionLink.kind === 'top_up' ? '补充值' : '消耗值'}</dt>
          <dd>
            {formatBenefitValue(preview.actionLink.requestedValue, preview.targetPass.benefitType)}
          </dd>
        </div>
        <div>
          <dt>当前值</dt>
          <dd>
            {formatBenefitValue(preview.targetPass.balanceValue, preview.targetPass.benefitType)}
          </dd>
        </div>
        <div>
          <dt>链接有效期</dt>
          <dd>{formatDate(preview.actionLink.expiresAt, '未知')}</dd>
        </div>
      </dl>
      {preview.actionLink.note ? <p>{preview.actionLink.note}</p> : null}
      {preview.actionLink.kind === 'top_up' ? (
        <label className="action-source-select">
          <span>来源卡</span>
          <select
            value={selectedSourcePassId}
            onChange={(event) => onSelectSourcePass(event.target.value)}
          >
            {preview.sourcePasses.length ? (
              preview.sourcePasses.map((pass) => (
                <option key={pass.id} value={pass.id}>
                  {pass.displayName} · {formatBenefitValue(pass.balanceValue, pass.benefitType)}
                </option>
              ))
            ) : (
              <option value="">没有可用来源卡</option>
            )}
          </select>
        </label>
      ) : null}
      <ul>
        {requirements.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>
    </section>
  );
}

function ActionPreviewCardFace({ pass }: { pass: WalletPassPreview }) {
  return (
    <div
      className={`add-pass-preview-card add-pass-preview-card-${pass.category}${pass.backgroundImageUrl ? ' has-image' : ''}`}
      style={pass.backgroundImageUrl ? { backgroundImage: `url("${pass.backgroundImageUrl}")` } : undefined}
      aria-hidden="true"
    >
      <small>{formatPassTailNumber(pass.maskedNumber ?? pass.publicNumber) ?? '**** 5678'}</small>
    </div>
  );
}

function normalizeActionToken(value: string): string {
  const trimmedValue = value.trim();

  try {
    const url = new URL(trimmedValue, window.location.origin);
    return url.searchParams.get('token') ?? trimmedValue;
  } catch {
    return trimmedValue;
  }
}

function createLoginHref(token: string): string {
  const next = `/action?token=${encodeURIComponent(token)}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

function formatPassTailNumber(maskedNumber: string | null): string | null {
  if (!maskedNumber) {
    return null;
  }

  const tail = maskedNumber.trim().slice(-4);

  return tail ? '**** ' + tail : maskedNumber;
}

function formatBenefitValue(value: string, benefitType: BenefitType): string {
  const labels: Record<BenefitType, string> = {
    amount: '额度',
    points: '积分',
    times: '次',
  };

  return `${value} ${labels[benefitType]}`;
}

function formatTopUpRequestStatus(status: TopUpRequestStatus): string {
  const labels: Record<TopUpRequestStatus, string> = {
    Created: '已创建',
    WaitingVerification: '等待验证',
    Succeeded: '已完成',
    Failed: '已失败',
    Cancelled: '已取消',
    Expired: '已过期',
    Reversed: '已冲正',
  };

  return labels[status];
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}
