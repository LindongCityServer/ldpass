'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiClientError, getJson, postJson } from '../../../api-client';

interface SessionResponse {
  user: {
    username: string;
    status: string;
  } | null;
}

interface TokenInspectResponse {
  ok: true;
  token: {
    scope: 'c2c' | 'group';
    expiresAt: string;
    requiresGroupConfirmation: boolean;
  };
}

interface GroupClaimResponse {
  ok: true;
  scope: 'group';
  confirmCode: string;
  expiresAt: string;
}

interface ConfirmResponse {
  ok: true;
  link: {
    id: string;
    scope: 'c2c' | 'group';
    createdAt: string;
  };
}

type PageState = 'loading' | 'login' | 'ready' | 'submitting' | 'group-ready' | 'success' | 'error';

interface QqLinkConfirmProps {
  initialToken?: string | undefined;
}

export function QqLinkConfirm({ initialToken }: QqLinkConfirmProps) {
  const token = useMemo(() => initialToken?.trim() ?? '', [initialToken]);
  const [state, setState] = useState<PageState>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loginHref, setLoginHref] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (!token) {
        setState('error');
        setMessage('缺少绑定链接参数，请让 QQ 机器人重新发起绑定。');
        return;
      }

      try {
        const [session, tokenInfo] = await Promise.all([
          getJson<SessionResponse>('/api/auth/session').catch(() => ({ user: null })),
          getJson<TokenInspectResponse>(
            `/api/account/qq-link/token?token=${encodeURIComponent(token)}`,
          ),
        ]);

        if (!isMounted) {
          return;
        }

        setExpiresAt(tokenInfo.token.expiresAt);

        if (!session.user) {
          setState('login');
          setLoginHref(
            `/login?next=${encodeURIComponent(`/account/link/qq?token=${encodeURIComponent(token)}`)}`,
          );
          setMessage('请先登录临东通账号，登录后会保留本次绑定链接。');
          return;
        }

        if (session.user.status !== 'Active') {
          setState('error');
          setMessage('当前临东通账号尚未激活，暂时无法完成 QQ 绑定。');
          return;
        }

        setUsername(session.user.username);

        if (tokenInfo.token.scope === 'group') {
          // 群绑定只做“认领 + 展示确认码”，真正的绑定必须回到群里发送 /确认。
          try {
            const claim = await postJson<GroupClaimResponse>('/api/account/qq-link/group/claim', {
              token,
            });

            if (!isMounted) {
              return;
            }

            setConfirmCode(claim.confirmCode);
            setExpiresAt(claim.expiresAt);
            setState('group-ready');
            setMessage(
              '请回到发起绑定的 QQ 群，@机器人 发送下面的确认指令。网页不会直接完成绑定。',
            );
          } catch (error) {
            if (!isMounted) {
              return;
            }

            if (error instanceof ApiClientError && error.status === 401) {
              setState('login');
              setLoginHref(
                `/login?next=${encodeURIComponent(`/account/link/qq?token=${encodeURIComponent(token)}`)}`,
              );
              setMessage('登录状态已失效，请重新登录后再打开绑定链接。');
              return;
            }

            setState('error');
            setMessage(error instanceof Error ? error.message : '群聊绑定链接校验失败。');
          }

          return;
        }

        setState('ready');
        setMessage('确认后会把发起本次链接的 QQ 身份绑定到下面的临东通账号。');
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setState('error');
        setMessage(error instanceof Error ? error.message : '绑定链接校验失败。');
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const confirm = async () => {
    setState('submitting');
    setMessage(null);

    try {
      await postJson<ConfirmResponse>('/api/account/qq-link/confirm', { token });
      setState('success');
      setMessage('QQ 绑定成功，现在可以在 QQ 私聊中使用临东通相关指令。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'QQ 绑定失败。';
      setMessage(errorMessage);

      if (error instanceof ApiClientError && error.status === 429) {
        setState('ready');
        return;
      }

      if (error instanceof ApiClientError && error.status === 401) {
        setState('login');
        setLoginHref(
          `/login?next=${encodeURIComponent(`/account/link/qq?token=${encodeURIComponent(token)}`)}`,
        );
        return;
      }

      setState('error');
    }
  };

  if (state === 'loading') {
    return <p className="empty-note">正在校验绑定链接。</p>;
  }

  return (
    <div className="stacked-form">
      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
          {state === 'ready' && expiresAt ? (
            <span>绑定链接有效期至 {formatDate(expiresAt)}，过期后请让机器人重新发起。</span>
          ) : null}
        </div>
      ) : null}

      {state === 'login' ? (
        <div className="form-actions">
          <a className="secondary-action" href="/">
            返回钱包
          </a>
          {loginHref ? (
            <a className="primary-action" href={loginHref}>
              <span className="material-symbols-rounded" aria-hidden="true">
                login
              </span>
              <span>登录临东通</span>
            </a>
          ) : null}
        </div>
      ) : null}

      {state === 'ready' || state === 'submitting' ? (
        <>
          <section className="flow-notice" aria-label="待确认的绑定">
            <span>将 QQ 账号绑定到当前临东通账号</span>
            <strong>{username}</strong>
            <span>绑定后，QQ 机器人会把当前 QQ 身份识别为这个临东通账号。</span>
          </section>
          <div className="form-actions">
            <a className="secondary-action" href="/account">
              取消
            </a>
            <button
              className="primary-action"
              type="button"
              disabled={state === 'submitting'}
              onClick={() => void confirm()}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                check_circle
              </span>
              <span>{state === 'submitting' ? '绑定中' : '确认绑定'}</span>
            </button>
          </div>
        </>
      ) : null}

      {state === 'group-ready' && confirmCode ? (
        <>
          <section className="flow-notice" aria-label="群聊绑定确认">
            <span>回到发起绑定的 QQ 群，@机器人 发送：</span>
            <strong className="qq-group-confirm-code">/确认 {confirmCode}</strong>
            <span>
              机器人确认后，会把该群里的这个 QQ 成员绑定到临东通账号 <strong>{username}</strong>。
            </span>
            <span>
              确认码 5
              分钟内有效且只能使用一次；网页不会直接完成绑定，其他人打开此链接也无法代替你确认。
            </span>
            {expiresAt ? <span>确认码有效期至 {formatDate(expiresAt)}。</span> : null}
          </section>
          <div className="form-actions">
            <a className="secondary-action" href="/">
              返回钱包
            </a>
            <a className="secondary-action" href="/account">
              前往账户页
            </a>
          </div>
        </>
      ) : null}

      {state === 'success' ? (
        <div className="form-actions">
          <a className="secondary-action" href="/">
            返回钱包
          </a>
          <a className="primary-action" href="/account">
            <span className="material-symbols-rounded" aria-hidden="true">
              manage_accounts
            </span>
            <span>查看账户绑定</span>
          </a>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="form-actions">
          <a className="secondary-action" href="/">
            返回钱包
          </a>
          <a className="secondary-action" href="/account">
            前往账户页
          </a>
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN');
}
