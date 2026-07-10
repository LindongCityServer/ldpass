'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiClientError, getJson, postJson } from '../api-client';

type VerificationMethod = 'pin' | 'server_account';

interface LoginRedirectValidation {
  clientApplication: {
    clientId: string;
    name: string;
  };
  redirectUri: string;
  state: string | null;
}

interface SessionResponse {
  user: {
    id: string;
    username: string;
    email: string;
    status: string;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
  } | null;
}

interface VerificationUser {
  username: string;
  status: string;
  serverAccountName: string | null;
  serverAccountVerified: boolean;
}

interface ServerChallenge {
  id: string;
  serverId: string;
  code: string;
  expiresAt: string;
}

interface AccountVerificationSuccessResponse {
  verified: true;
  method: VerificationMethod;
  user: VerificationUser;
  callbackUrl: string | null;
}

interface ServerStartResponse {
  user: VerificationUser;
  challenge: ServerChallenge;
  callbackUrl?: string | null;
}

interface ServerCheckResponse {
  status: 'waiting' | 'verified' | 'rotated' | 'expired';
  method: 'server_account';
  user: VerificationUser;
  callbackUrl: string | null;
  challenge?: ServerChallenge;
}

interface AccountVerificationFormProps {
  initialClientId?: string;
  initialRedirectUri?: string;
  initialState?: string;
  initialPurpose?: string;
}

export function AccountVerificationForm({
  initialClientId,
  initialRedirectUri,
  initialState,
  initialPurpose,
}: AccountVerificationFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [redirectValidation, setRedirectValidation] = useState<LoginRedirectValidation | null>(
    null,
  );
  const [sessionUser, setSessionUser] = useState<SessionResponse['user']>(null);
  const [loginHref, setLoginHref] = useState<string | null>(null);
  const [method, setMethod] = useState<VerificationMethod>('pin');
  const [pin, setPin] = useState('');
  const [serverChallenge, setServerChallenge] = useState<ServerChallenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingPin, setIsSubmittingPin] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(false);

  const verificationContext = useMemo(
    () => ({
      ...(initialClientId ? { client_id: initialClientId } : {}),
      ...(initialRedirectUri ? { redirect_uri: initialRedirectUri } : {}),
      ...(initialState ? { state: initialState } : {}),
      ...(initialPurpose ? { purpose: initialPurpose } : {}),
    }),
    [initialClientId, initialRedirectUri, initialState, initialPurpose],
  );

  useEffect(() => {
    let isMounted = true;

    const loadVerificationContext = async () => {
      setIsLoading(true);
      setMessage(null);
      setLoginHref(null);
      setRedirectValidation(null);
      setSessionUser(null);

      try {
        if (initialClientId || initialRedirectUri) {
          if (!initialClientId || !initialRedirectUri) {
            setMessage('外部账号验证回跳参数不完整。');
          } else {
            const query = new URLSearchParams({
              client_id: initialClientId,
              redirect_uri: initialRedirectUri,
            });
            if (initialState) {
              query.set('state', initialState);
            }

            const validation = await getJson<LoginRedirectValidation>(
              `/api/auth/login/redirect?${query.toString()}`,
            );
            if (!isMounted) {
              return;
            }

            setRedirectValidation(validation);
            setMessage(`验证成功后将返回 ${validation.clientApplication.name}。`);
          }
        }

        const session = await getJson<SessionResponse>('/api/auth/session');
        if (!isMounted) {
          return;
        }

        setSessionUser(session.user);
        if (!session.user) {
          setLoginHref(createLoginHref(verificationContext));
          setMessage('请先登录后再完成账号验证。');
          return;
        }

        if (session.user.status !== 'Active') {
          setMessage('当前账户尚未激活，暂不能完成账号验证。');
          return;
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (error instanceof ApiClientError && error.status === 401) {
          setLoginHref(createLoginHref(verificationContext));
          setMessage('请先登录后再完成账号验证。');
          return;
        }

        setMessage(error instanceof Error ? error.message : '读取账号验证信息失败。');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadVerificationContext();

    return () => {
      isMounted = false;
    };
  }, [initialClientId, initialRedirectUri, initialState, verificationContext]);

  const canVerify = Boolean(sessionUser && sessionUser.status === 'Active');

  const verifyWithPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmittingPin(true);
    setMessage(null);

    try {
      const result = await postJson<AccountVerificationSuccessResponse>(
        '/api/auth/account/verification/pin',
        {
          ...verificationContext,
          pin,
        },
      );
      setPin('');
      finishVerification(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PIN 验证失败。');
    } finally {
      setIsSubmittingPin(false);
    }
  };

  const startServerVerification = async () => {
    setIsStartingServer(true);
    setMessage(null);
    setServerChallenge(null);

    try {
      const result = await postJson<ServerStartResponse>(
        '/api/auth/account/verification/server/start',
        verificationContext,
      );
      setServerChallenge(result.challenge);
      setMessage(`请使用服务器账号 ${result.challenge.serverId} 在服务器聊天内发送完整验证码。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '获取服务器验证码失败。');
    } finally {
      setIsStartingServer(false);
    }
  };

  const checkServerVerification = async () => {
    if (!serverChallenge) {
      setMessage('请先获取服务器验证码。');
      return;
    }

    setIsCheckingServer(true);
    setMessage(null);

    try {
      const result = await postJson<ServerCheckResponse>(
        `/api/auth/account/verification/server/${serverChallenge.id}/check`,
        verificationContext,
      );

      if (result.status === 'verified') {
        finishVerification({
          verified: true,
          method: 'server_account',
          user: result.user,
          callbackUrl: result.callbackUrl,
        });
        return;
      }

      if (result.status === 'rotated' && result.challenge) {
        setServerChallenge(result.challenge);
        setMessage('检测到服务器账号发送了其他内容，验证码已更新，请发送新的完整验证码。');
        return;
      }

      if (result.status === 'expired') {
        setServerChallenge(null);
        setMessage('验证码已过期，请重新获取。');
        return;
      }

      setMessage('还没有检测到对应聊天消息，请发送验证码后再检查。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检查服务器验证码失败。');
    } finally {
      setIsCheckingServer(false);
    }
  };

  const finishVerification = (result: AccountVerificationSuccessResponse) => {
    const callbackLabel = redirectValidation
      ? `返回 ${redirectValidation.clientApplication.name}`
      : '返回账户页';
    setMessage(`已完成 ${formatMethod(result.method)}，正在${callbackLabel}。`);
    window.location.href = result.callbackUrl ?? '/account';
  };

  return (
    <div className="stacked-form">
      {sessionUser ? (
        <div className="flow-notice flow-notice-muted" role="status" aria-live="polite">
          <span>当前账号：{sessionUser.username}</span>
          {redirectValidation ? (
            <span>验证后返回：{redirectValidation.clientApplication.name}</span>
          ) : null}
        </div>
      ) : null}

      <div
        className="segmented-control account-verification-methods"
        role="group"
        aria-label="验证方式"
      >
        <button
          className={method === 'pin' ? 'is-selected' : undefined}
          type="button"
          disabled={!canVerify}
          onClick={() => {
            setMethod('pin');
            setServerChallenge(null);
          }}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            password
          </span>
          <span>PIN</span>
        </button>
        <button
          className={method === 'server_account' ? 'is-selected' : undefined}
          type="button"
          disabled={!canVerify}
          onClick={() => setMethod('server_account')}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            forum
          </span>
          <span>服务器账号</span>
        </button>
      </div>

      {method === 'pin' ? (
        <form className="stacked-form" onSubmit={verifyWithPin} noValidate>
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
              disabled={!canVerify || isLoading}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary-action"
              type="submit"
              disabled={!canVerify || isLoading || isSubmittingPin}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                verified
              </span>
              <span>{isSubmittingPin ? '验证中' : '验证'}</span>
            </button>
          </div>
        </form>
      ) : null}

      {method === 'server_account' ? (
        <section className="stacked-form" aria-label="服务器账号验证">
          <div className="form-actions">
            <button
              className="primary-action"
              type="button"
              disabled={!canVerify || isLoading || isStartingServer}
              onClick={() => void startServerVerification()}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                forum
              </span>
              <span>{isStartingServer ? '获取中' : '获取验证码'}</span>
            </button>
          </div>
          {serverChallenge ? (
            <div className="flow-notice" role="status" aria-live="polite">
              <strong>{serverChallenge.code}</strong>
              <span>请在服务器聊天中用 {serverChallenge.serverId} 发送上面的验证码。</span>
              <span>有效期至 {new Date(serverChallenge.expiresAt).toLocaleString('zh-CN')}。</span>
              <div className="form-actions compact-actions">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={isCheckingServer}
                  onClick={() => void checkServerVerification()}
                >
                  {isCheckingServer ? '检查中' : '我已发送，检查'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
          {loginHref ? (
            <div className="form-actions compact-actions">
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
        <a className="secondary-action" href="/account">
          返回账户
        </a>
      </div>
    </div>
  );
}

function createLoginHref(context: Record<string, string | undefined>): string {
  const query = new URLSearchParams(
    Object.entries(context).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const next = query.size > 0 ? `/verify-account?${query.toString()}` : '/verify-account';

  return `/login?next=${encodeURIComponent(next)}`;
}

function formatMethod(method: VerificationMethod): string {
  const labels: Record<VerificationMethod, string> = {
    pin: 'PIN 验证',
    server_account: '服务器账号验证',
  };

  return labels[method];
}
