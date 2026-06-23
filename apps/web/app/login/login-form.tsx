'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../api-client';
import { readClientDevice } from '../device-client';

interface LoginResponse {
  user: {
    username: string;
    status: string;
  };
  nextAction: 'authenticated' | 'account_status' | 'verify_new_device';
  challenge?: LoginChallenge;
  approval?: LoginApproval;
}

interface LoginChallenge {
  id: string;
  serverId: string;
  code: string;
  expiresAt: string;
}

interface LoginApproval {
  id: string;
  deviceSystem: string;
  deviceLabel: string | null;
  expiresAt: string;
}

interface LoginPayload {
  identifier: string;
  password: string;
  clientDeviceId: string;
  deviceSystem: string;
  deviceLabel: string;
}

interface LoginRedirectValidation {
  clientApplication: {
    clientId: string;
    name: string;
  };
  redirectUri: string;
  state: string | null;
}

interface LoginFormProps {
  initialClientId?: string;
  initialRedirectUri?: string;
  initialState?: string;
  initialNext?: string;
}

export function LoginForm({ initialClientId, initialRedirectUri, initialState, initialNext }: LoginFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [redirectValidation, setRedirectValidation] = useState<LoginRedirectValidation | null>(null);
  const [isValidatingRedirect, setIsValidatingRedirect] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingDevice, setIsCheckingDevice] = useState(false);
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  const [loginChallenge, setLoginChallenge] = useState<LoginChallenge | null>(null);
  const [loginApproval, setLoginApproval] = useState<LoginApproval | null>(null);
  const [pendingLogin, setPendingLogin] = useState<LoginPayload | null>(null);
  const safeInternalNext = useMemo(() => readSafeInternalNext(initialNext), [initialNext]);

  useEffect(() => {
    if (!initialClientId && !initialRedirectUri) {
      return;
    }

    if (!initialClientId || !initialRedirectUri) {
      setMessage('外部登录回跳参数不完整，登录后将返回钱包。');
      return;
    }

    const query = new URLSearchParams({
      client_id: initialClientId,
      redirect_uri: initialRedirectUri,
    });

    if (initialState) {
      query.set('state', initialState);
    }

    let isMounted = true;
    setIsValidatingRedirect(true);
    getJson<LoginRedirectValidation>(`/api/auth/login/redirect?${query.toString()}`)
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setRedirectValidation(result);
        setMessage(`登录后将返回 ${result.clientApplication.name}。`);
      })
      .catch((error) => {
        if (isMounted) {
          setRedirectValidation(null);
          setMessage(error instanceof Error ? `${error.message} 登录后将返回钱包。` : '外部登录回跳无效，登录后将返回钱包。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsValidatingRedirect(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [initialClientId, initialRedirectUri, initialState]);

  useEffect(() => {
    if (initialClientId || initialRedirectUri || !initialNext) {
      return;
    }

    setMessage(safeInternalNext ? '登录后将继续之前的操作。' : '站内回跳地址无效，登录后将返回钱包。');
  }, [initialClientId, initialRedirectUri, initialNext, safeInternalNext]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const payload = {
        identifier: String(form.get('identifier') ?? ''),
        password: String(form.get('password') ?? ''),
        ...readClientDevice(),
      };
      const result = await postJson<LoginResponse>('/api/auth/login', payload);

      if (result.nextAction === 'verify_new_device') {
        setPendingLogin(payload);
        setLoginChallenge(result.challenge ?? null);
        setLoginApproval(result.approval ?? null);
        setMessage(createNewDeviceMessage(result.challenge, result.approval));
        return;
      }

      finishLogin(result.user.username, result.nextAction === 'account_status');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const checkDeviceVerification = async () => {
    if (!loginChallenge || !pendingLogin) {
      return;
    }

    setIsCheckingDevice(true);
    setMessage(`正在检查服务器聊天中是否由 ${loginChallenge.serverId} 发送了验证码 ${loginChallenge.code}。`);

    try {
      const result = await postJson<LoginResponse>(`/api/auth/login/device/${loginChallenge.id}/check`, pendingLogin);

      if (result.nextAction === 'authenticated') {
        finishLogin(result.user.username, false);
        return;
      }

      if (result.challenge) {
        const nextChallenge = {
          ...result.challenge,
          code: result.challenge.code || loginChallenge.code,
        };
        setLoginChallenge(nextChallenge);
        setLoginApproval(result.approval ?? loginApproval);
        setMessage(
          nextChallenge.code === loginChallenge.code
            ? `还没有检测到验证码。请确认 ${nextChallenge.serverId} 已发送 ${nextChallenge.code}。`
            : `验证码已更新。请改为发送新验证码 ${nextChallenge.code}，有效期至 ${new Date(nextChallenge.expiresAt).toLocaleString('zh-CN')}。`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '新设备验证失败。');
    } finally {
      setIsCheckingDevice(false);
    }
  };

  const checkDeviceApproval = async () => {
    if (!loginApproval || !pendingLogin) {
      return;
    }

    setIsCheckingApproval(true);
    setMessage('正在检查已登录设备是否批准这次新设备登录。');

    try {
      const result = await postJson<LoginResponse>(`/api/auth/login/device-approvals/${loginApproval.id}/check`, pendingLogin);

      if (result.nextAction === 'authenticated') {
        finishLogin(result.user.username, false);
        return;
      }

      setLoginApproval(result.approval ?? loginApproval);
      setLoginChallenge(result.challenge ?? loginChallenge);
      setMessage('还没有检测到批准。请在已登录设备的账户页批准这次新设备登录。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '新设备确认失败。');
    } finally {
      setIsCheckingApproval(false);
    }
  };

  const finishLogin = (username: string, forceAccountPage: boolean) => {
    const redirectTarget = readRedirectTarget(redirectValidation);
    const internalTarget = forceAccountPage ? '/account' : redirectTarget ? null : safeInternalNext;
    const targetText = forceAccountPage
      ? '查看账户状态'
      : redirectTarget
        ? '返回外部项目'
        : internalTarget
          ? '继续之前的操作'
          : '返回钱包';
    setMessage(`已登录为 ${username}，正在${targetText}。`);
    window.location.href = internalTarget ?? redirectTarget ?? '/';
  };

  return (
    <form className="stacked-form" onSubmit={handleSubmit} noValidate>
      <label>
        <span>用户名或邮箱</span>
        <input type="text" name="identifier" autoComplete="username" required />
      </label>
      <label>
        <span>密码</span>
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      {redirectValidation ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>登录后返回：{redirectValidation.clientApplication.name}</span>
        </div>
      ) : null}
      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}
      {loginChallenge ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <strong>{loginChallenge.code}</strong>
          <span>请在服务器聊天中用 {loginChallenge.serverId} 发送上面的验证码。</span>
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={isCheckingDevice} onClick={() => void checkDeviceVerification()}>
              {isCheckingDevice ? '检查中' : '我已发送，检查'}
            </button>
          </div>
        </div>
      ) : null}
      {loginApproval ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <strong>{loginApproval.deviceLabel ?? formatDeviceSystem(loginApproval.deviceSystem)}</strong>
          <span>也可以在已登录设备的账户页批准这次新设备登录，有效期至 {new Date(loginApproval.expiresAt).toLocaleString('zh-CN')}。</span>
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={isCheckingApproval} onClick={() => void checkDeviceApproval()}>
              {isCheckingApproval ? '检查中' : '已批准，检查'}
            </button>
          </div>
        </div>
      ) : null}
      <div className="form-actions">
        <a className="secondary-action" href="/">
          取消
        </a>
        <button className="primary-action" type="submit" disabled={isSubmitting || isValidatingRedirect}>
          <span className="material-symbols-rounded" aria-hidden="true">
            login
          </span>
          <span>{isValidatingRedirect ? '校验中' : isSubmitting ? '登录中' : '继续'}</span>
        </button>
      </div>
    </form>
  );
}

function readRedirectTarget(validation: LoginRedirectValidation | null): string | null {
  if (!validation) {
    return null;
  }

  const url = new URL(validation.redirectUri);
  if (validation.state) {
    url.searchParams.set('state', validation.state);
  }

  return url.toString();
}

function readSafeInternalNext(value?: string): string | null {
  const trimmedValue = value?.trim();

  if (!trimmedValue || !trimmedValue.startsWith('/') || trimmedValue.startsWith('//') || trimmedValue.includes('\\')) {
    return null;
  }

  try {
    const url = new URL(trimmedValue, 'https://ldpass.local');
    const path = `${url.pathname}${url.search}${url.hash}`;
    const blockedPaths = new Set(['/login', '/admin/login', '/provider/login']);

    return blockedPaths.has(url.pathname) ? null : path;
  } catch {
    return null;
  }
}

function createNewDeviceMessage(challenge?: LoginChallenge, approval?: LoginApproval): string {
  if (challenge && approval) {
    return '检测到新设备登录。你可以用服务器聊天验证码验证，也可以在已登录设备的账户页批准。';
  }

  if (challenge) {
    return `检测到新设备登录。请使用服务器 ID ${challenge.serverId} 在服务器聊天中发送验证码 ${challenge.code}，有效期至 ${new Date(challenge.expiresAt).toLocaleString('zh-CN')}。`;
  }

  if (approval) {
    return '检测到新设备登录。请在已登录设备的账户页批准这次登录。';
  }

  return '检测到新设备登录，请选择可用方式完成验证。';
}

function formatDeviceSystem(system: string): string {
  const labels: Record<string, string> = {
    android: 'Android 设备',
    ios: 'iOS 设备',
    windows: 'Windows 设备',
    macos: 'macOS 设备',
    linux: 'Linux 设备',
    other: '其他设备',
  };

  return labels[system] ?? '新设备';
}
