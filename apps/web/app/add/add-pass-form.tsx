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

interface AddPassFormProps {
  initialClaimCode?: string | undefined;
}

export function AddPassForm({ initialClaimCode }: AddPassFormProps) {
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
    if (isUserSessionLoading) {
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
    isUserSessionLoading,
    loadPreview,
    sessionUser,
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

  if (isUserSessionLoading) {
    return <p className="empty-note">正在读取登录状态。</p>;
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
            setClaimCodeInput(event.target.value.toUpperCase());
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
    return (url.searchParams.get('token') ?? url.searchParams.get('claimCode') ?? trimmedValue).trim().toUpperCase();
  } catch {
    return trimmedValue.toUpperCase();
  }
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

function formatDate(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }

  return new Date(value).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
