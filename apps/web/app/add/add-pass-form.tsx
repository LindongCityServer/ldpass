'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError, getJson, postJson } from '../api-client';

interface ClaimResponse {
  pass: {
    id: string;
    displayName: string;
    providerName: string;
    balanceValue: string;
  };
}

interface SessionResponse {
  user: {
    username: string;
  } | null;
}

interface ProviderSessionResponse {
  providerAccount: {
    providerName: string;
    providerSlug: string;
  } | null;
}

interface AddPassPreviewResponse {
  token: {
    status: string;
    expiresAt: string;
    requireServerVerifiedUser: boolean;
  };
  pass: {
    providerName: string;
    displayName: string;
    title: string;
    hideTitle?: boolean;
    description: string | null;
    category: 'account' | 'identity_key' | 'ticket';
    benefitType: 'amount' | 'points' | 'times';
    balanceValue: string;
    expiresAt: string | null;
    logoUrl: string | null;
    backgroundImageUrl: string | null;
    requiresLocationVerification: boolean;
  };
}

interface ProviderRedemptionPreviewResponse {
  pass: {
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
  };
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

interface CreateProviderRedemptionResponse {
  redemptionRequest: {
    id: string;
    status: string;
    verificationMethod: 'server_account' | 'pin';
    requestedValue: string;
    expiresAt: string;
    pass: ProviderRedemptionPreviewResponse['pass'];
    user: ProviderRedemptionPreviewResponse['holder'];
  };
}

interface AddPassFormProps {
  initialClaimCode?: string | undefined;
  initialCardNumber?: string | undefined;
  redemptionMode?: boolean | undefined;
}

export function AddPassForm({ initialClaimCode, initialCardNumber, redemptionMode = false }: AddPassFormProps) {
  const [providerAccount, setProviderAccount] = useState<ProviderSessionResponse['providerAccount']>(null);
  const [isProviderSessionLoading, setIsProviderSessionLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState<SessionResponse['user']>(null);
  const [isUserSessionLoading, setIsUserSessionLoading] = useState(true);
  const [claimCodeInput, setClaimCodeInput] = useState(initialClaimCode ?? '');
  const [preview, setPreview] = useState<AddPassPreviewResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loginHref, setLoginHref] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getJson<ProviderSessionResponse>('/api/providers/auth/session')
      .then((result) => {
        if (isMounted) {
          setProviderAccount(result.providerAccount);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsProviderSessionLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    getJson<SessionResponse>('/api/auth/session')
      .then((result) => {
        if (isMounted) {
          setSessionUser(result.user);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsUserSessionLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const shouldUseProviderRedemption = Boolean(providerAccount) && (redemptionMode || !sessionUser);

  const loadPreview = useCallback(async (rawClaimCode: string, options: { showReadyMessage?: boolean } = {}) => {
    const claimCode = normalizeClaimCode(rawClaimCode);

    if (!claimCode) {
      setPreview(null);
      setMessage('请填写领取码或添加链接。');
      return null;
    }

    setIsPreviewLoading(true);
    setPreview(null);
    setMessage(null);

    try {
      const result = await getJson<AddPassPreviewResponse>(
        `/api/wallet/add-tokens/preview?claimCode=${encodeURIComponent(claimCode)}`,
      );
      setPreview(result);
      if (options.showReadyMessage) {
        setMessage('已读取卡券信息，请确认后添加。');
      }

      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取卡券信息失败。');
      return null;
    } finally {
      setIsPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isProviderSessionLoading || isUserSessionLoading || shouldUseProviderRedemption) {
      return undefined;
    }

    const claimCode = normalizeClaimCode(initialClaimCode ?? '');
    setClaimCodeInput(initialClaimCode ?? '');

    if (!claimCode) {
      return undefined;
    }

    let isMounted = true;
    void loadPreview(claimCode);
    if (!sessionUser) {
      setLoginHref(createLoginHref(claimCode));
      setMessage('请先登录后继续添加这张卡券。');
    }

    return () => {
      isMounted = false;
    };
  }, [
    initialClaimCode,
    isProviderSessionLoading,
    isUserSessionLoading,
    loadPreview,
    sessionUser,
    shouldUseProviderRedemption,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setLoginHref(null);
    setIsSubmitting(true);

    const claimCode = normalizeClaimCode(claimCodeInput);

    if (!claimCode) {
      setMessage('请填写领取码或添加链接。');
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await postJson<ClaimResponse>('/api/wallet/add-tokens/claim', {
        claimCode,
      });
      setMessage(`已添加 ${result.pass.providerName} 的 ${result.pass.displayName}。`);
      window.location.href = `/?pass=${encodeURIComponent(result.pass.id)}`;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setLoginHref(createLoginHref(claimCode));
        setMessage('请先登录后继续添加这张卡券。');
        return;
      }

      setMessage(error instanceof Error ? error.message : '添加卡券失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isProviderSessionLoading || isUserSessionLoading) {
    return <p className="empty-note">正在判断当前入口模式。</p>;
  }

  if (providerAccount && shouldUseProviderRedemption) {
    return <ProviderRedemptionForm initialLookup={initialCardNumber ?? initialClaimCode} providerAccount={providerAccount} />;
  }

  return (
    <form className="stacked-form" onSubmit={handleSubmit} noValidate>
      <label>
        <span>链接或领取码</span>
        <input
          type="text"
          name="claimCode"
          autoComplete="off"
          inputMode="text"
          value={claimCodeInput}
          onChange={(event) => {
            setClaimCodeInput(event.target.value);
            setPreview(null);
            setLoginHref(null);
            setMessage(null);
          }}
          required
        />
      </label>
      <div className="form-actions compact-actions">
        <button className="secondary-action" type="button" disabled={isPreviewLoading} onClick={() => void loadPreview(claimCodeInput, { showReadyMessage: true })}>
          <span className="material-symbols-rounded" aria-hidden="true">
            visibility
          </span>
          <span>{isPreviewLoading ? '读取中' : '查看信息'}</span>
        </button>
      </div>
      {providerAccount ? (
        <div className="flow-notice" role="status">
          <span>当前也已登录发卡方账号，默认按普通用户添加卡券。</span>
          <div className="form-actions">
            <a className="secondary-action" href={createProviderRedemptionHref(claimCodeInput || initialCardNumber || initialClaimCode || '')}>
              切换到核销模式
            </a>
          </div>
        </div>
      ) : null}
      {preview ? <AddPassPreview preview={preview} /> : null}
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
          取消
        </a>
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          <span className="material-symbols-rounded" aria-hidden="true">
            add
          </span>
          <span>{isSubmitting ? '添加中' : '添加'}</span>
        </button>
      </div>
    </form>
  );
}

function ProviderRedemptionForm({
  initialLookup,
  providerAccount,
}: {
  initialLookup?: string | undefined;
  providerAccount: NonNullable<ProviderSessionResponse['providerAccount']>;
}) {
  const [cardNumberInput, setCardNumberInput] = useState(initialLookup ?? '');
  const [requestedValue, setRequestedValue] = useState('1');
  const [verificationMethod, setVerificationMethod] = useState<'pin' | 'server_account'>('pin');
  const [preview, setPreview] = useState<ProviderRedemptionPreviewResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadPreview = useCallback(async (rawCardNumber: string, options: { showReadyMessage?: boolean } = {}) => {
    const cardNumber = normalizeProviderRedemptionLookup(rawCardNumber);
    if (!cardNumber) {
      setPreview(null);
      setMessage('请填写卡号、领取码或添加链接。');
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
      if (options.showReadyMessage) {
        setMessage('已读取卡券信息，可发起核销。');
      }

      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取卡券信息失败。');
      return null;
    } finally {
      setIsPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    const cardNumber = normalizeProviderRedemptionLookup(initialLookup ?? '');
    setCardNumberInput(initialLookup ?? '');
    if (!cardNumber) {
      return;
    }

    void loadPreview(cardNumber);
  }, [initialLookup, loadPreview]);

  const submitRedemption = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cardNumber = normalizeProviderRedemptionLookup(cardNumberInput);
    if (!cardNumber) {
      setMessage('请填写卡号、领取码或添加链接。');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<CreateProviderRedemptionResponse>('/api/provider/redemptions/by-card-number', {
        cardNumber,
        requestedValue,
        verificationMethod,
        idempotencyKey: createClientIdempotencyKey('provider-card-redemption'),
      });
      setPreview({
        pass: result.redemptionRequest.pass,
        holder: result.redemptionRequest.user,
        issuerProvider: preview?.issuerProvider ?? {
          name: result.redemptionRequest.pass.providerName,
          slug: '',
        },
        redeemingProvider: {
          name: providerAccount.providerName,
          slug: providerAccount.providerSlug,
        },
      });
      setMessage(
        `已发起核销 ${formatBenefitValue(result.redemptionRequest.requestedValue, result.redemptionRequest.pass.benefitType)}，请持卡用户完成 ${formatVerificationMethod(result.redemptionRequest.verificationMethod)} 确认。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发起核销失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="stacked-form" onSubmit={submitRedemption} noValidate>
      <div className="flow-notice" role="status">
        <span>当前为发卡方核销模式：{providerAccount.providerName}</span>
      </div>
      <label>
        <span>卡号 / 领取码 / 添加链接</span>
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
          required
        />
      </label>
      <div className="form-actions compact-actions">
        <button className="secondary-action" type="button" disabled={isPreviewLoading} onClick={() => void loadPreview(cardNumberInput, { showReadyMessage: true })}>
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
        <select name="verificationMethod" value={verificationMethod} onChange={(event) => setVerificationMethod(event.target.value as 'pin' | 'server_account')}>
          <option value="pin">用户 PIN</option>
          <option value="server_account">服务器账号验证码</option>
        </select>
      </label>
      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}
      <div className="form-actions">
        <a className="secondary-action" href="/provider/passes">
          返回卡券
        </a>
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          <span className="material-symbols-rounded" aria-hidden="true">
            point_of_sale
          </span>
          <span>{isSubmitting ? '发起中' : '发起核销'}</span>
        </button>
      </div>
    </form>
  );
}

function ProviderRedemptionPreview({ preview }: { preview: ProviderRedemptionPreviewResponse }) {
  return (
    <section className={`add-pass-preview add-pass-preview-${preview.pass.category}`} aria-label="待核销卡券信息">
      <AddPreviewCardFace
        category={preview.pass.category}
        backgroundImageUrl={preview.pass.backgroundImageUrl ?? null}
        maskedNumber={preview.pass.maskedNumber}
        publicNumber={preview.pass.publicNumber}
      />
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
          <dd>{preview.holder ? `${preview.holder.username} · ${preview.holder.email}` : '未领取'}</dd>
        </div>
        <div>
          <dt>当前权益</dt>
          <dd>{formatBenefitValue(preview.pass.balanceValue, preview.pass.benefitType)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{preview.pass.status}</dd>
        </div>
      </dl>
    </section>
  );
}

function AddPassPreview({ preview }: { preview: AddPassPreviewResponse }) {
  const requirements = [
    preview.token.requireServerVerifiedUser ? '需要完成服务器账号验证后领取' : '无需服务器账号验证即可领取',
    preview.pass.requiresLocationVerification ? '使用时可能需要服务器位置核验' : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <section className={`add-pass-preview add-pass-preview-${preview.pass.category}`} aria-label="待添加卡券信息">
      <AddPreviewCardFace
        category={preview.pass.category}
        backgroundImageUrl={preview.pass.backgroundImageUrl}
        maskedNumber={null}
        publicNumber={null}
      />
      <div className="add-pass-preview-heading">
        {preview.pass.logoUrl ? <img src={preview.pass.logoUrl} alt="" width={36} height={36} /> : null}
        <div>
          <span>{preview.pass.providerName}</span>
          <strong>{preview.pass.displayName}</strong>
          {preview.pass.hideTitle === true ? null : <small>{preview.pass.title}</small>}
        </div>
      </div>
      {preview.pass.description ? <p>{preview.pass.description}</p> : null}
      <dl>
        <div>
          <dt>类型</dt>
          <dd>{formatCategory(preview.pass.category)}</dd>
        </div>
        <div>
          <dt>初始权益</dt>
          <dd>{formatBenefitValue(preview.pass.balanceValue, preview.pass.benefitType)}</dd>
        </div>
        <div>
          <dt>领取有效期</dt>
          <dd>{formatDate(preview.token.expiresAt, '未设置')}</dd>
        </div>
        <div>
          <dt>卡券有效期</dt>
          <dd>{formatDate(preview.pass.expiresAt, '长期有效')}</dd>
        </div>
      </dl>
      <ul>
        {requirements.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>
    </section>
  );
}

function AddPreviewCardFace({
  category,
  backgroundImageUrl,
  maskedNumber,
  publicNumber,
}: {
  category: AddPassPreviewResponse['pass']['category'];
  backgroundImageUrl: string | null;
  maskedNumber: string | null;
  publicNumber: string | null;
}) {
  return (
    <div
      className={`add-pass-preview-card add-pass-preview-card-${category}${backgroundImageUrl ? ' has-image' : ''}`}
      style={backgroundImageUrl ? { backgroundImage: `url("${backgroundImageUrl}")` } : undefined}
      aria-hidden="true"
    >
      <small>{formatPassTailNumber(maskedNumber ?? publicNumber) ?? '**** 5678'}</small>
    </div>
  );
}

function normalizeClaimCode(value: string): string {
  const trimmedValue = value.trim();

  try {
    const url = new URL(trimmedValue, window.location.origin);
    return url.searchParams.get('token') ?? url.searchParams.get('claimCode') ?? trimmedValue;
  } catch {
    return trimmedValue;
  }
}

function normalizeCardNumber(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

function normalizeProviderRedemptionLookup(value: string): string {
  const trimmedValue = value.trim();

  try {
    const url = new URL(trimmedValue, window.location.origin);
    const claimCode = url.searchParams.get('token') ?? url.searchParams.get('claimCode');
    if (claimCode) {
      return normalizeCardNumber(claimCode);
    }

    const cardNumber = url.searchParams.get('cardNumber');
    if (cardNumber) {
      return normalizeCardNumber(cardNumber);
    }
  } catch {
    // 解析失败时按原始输入继续处理。
  }

  return normalizeCardNumber(trimmedValue);
}

function formatPassTailNumber(maskedNumber: string | null): string | null {
  if (!maskedNumber) {
    return null;
  }

  const tail = maskedNumber.trim().slice(-4);

  return tail ? '**** ' + tail : maskedNumber;
}

function createLoginHref(claimCode: string): string {
  const nextPath = `/add?token=${encodeURIComponent(claimCode)}`;
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

function createProviderRedemptionHref(lookupValue: string): string {
  const lookup = normalizeProviderRedemptionLookup(lookupValue);
  if (!lookup) {
    return '/add?mode=redeem';
  }

  return `/add?mode=redeem&token=${encodeURIComponent(lookup)}`;
}

function createClientIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function formatCategory(category: AddPassPreviewResponse['pass']['category']): string {
  const labels: Record<AddPassPreviewResponse['pass']['category'], string> = {
    account: '账户/卡',
    identity_key: '证件/钥匙',
    ticket: '票券',
  };

  return labels[category];
}

function formatBenefitValue(value: string, benefitType: AddPassPreviewResponse['pass']['benefitType']): string {
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

function formatVerificationMethod(method: 'pin' | 'server_account'): string {
  return method === 'server_account' ? '服务器账号验证码' : '用户 PIN';
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
