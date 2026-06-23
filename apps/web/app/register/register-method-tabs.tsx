'use client';

import { type FormEvent, type MouseEvent, useState } from 'react';
import { postJson } from '../api-client';

type RegisterMethod = 'review' | 'server';
type FlowTone = 'info' | 'warning';

interface FlowNotice {
  tone: FlowTone;
  title: string;
  body: string;
}

interface RegisterReviewResponse {
  user: {
    username: string;
    status: string;
  };
  nextAction: string;
}

interface RegisterServerStartResponse {
  user: {
    username: string;
    status: string;
  };
  challenge: {
    id: string;
    code: string;
    expiresAt: string;
    serverId: string;
  };
  nextAction: string;
}

interface ServerChallengeState {
  id: string;
  code: string;
  expiresAt: string;
  serverId: string;
}

interface ServerCheckResponse {
  status: 'waiting' | 'verified' | 'rotated' | 'expired';
  user: {
    username: string;
  };
  sessionReady?: boolean;
  challenge?: ServerChallengeState;
}

interface RegisterMethodTabsProps {
  initialMethod: RegisterMethod;
}

const registerMethods: Array<{
  id: RegisterMethod;
  label: string;
  icon: string;
  href: string;
}> = [
  {
    id: 'review',
    label: '管理员审核',
    icon: 'approval',
    href: '/register?method=review',
  },
  {
    id: 'server',
    label: '服务器验证',
    icon: 'verified_user',
    href: '/register?method=server',
  },
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function findRequiredError(fields: Array<[label: string, value: string]>): string | null {
  const emptyField = fields.find(([, value]) => value.trim().length === 0);
  return emptyField ? `请填写${emptyField[0]}` : null;
}

export function RegisterMethodTabs({ initialMethod }: RegisterMethodTabsProps) {
  const [activeMethod, setActiveMethod] = useState<RegisterMethod>(initialMethod);
  const [reviewNotice, setReviewNotice] = useState<FlowNotice | null>(null);
  const [serverNotice, setServerNotice] = useState<FlowNotice | null>(null);
  const [serverChallenge, setServerChallenge] = useState<ServerChallengeState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(false);

  const handleReviewSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const username = String(form.get('username') ?? '');
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const reviewInfo = String(form.get('reviewInfo') ?? '');
    const requiredError = findRequiredError([
      ['用户名', username],
      ['邮箱', email],
      ['登录密码', password],
      ['审核信息', reviewInfo],
    ]);

    if (requiredError) {
      setReviewNotice({
        tone: 'warning',
        title: '信息还没填完整',
        body: requiredError,
      });
      return;
    }

    if (!isValidEmail(email.trim())) {
      setReviewNotice({
        tone: 'warning',
        title: '邮箱格式需要确认',
        body: '请填写可以接收通知的有效邮箱。',
      });
      return;
    }

    if (password.length < 8) {
      setReviewNotice({
        tone: 'warning',
        title: '密码太短',
        body: '登录密码至少需要 8 个字符。',
      });
      return;
    }

    setIsSubmitting(true);
    setReviewNotice({
      tone: 'info',
      title: '正在提交注册申请',
      body: '正在连接服务器，请稍候。',
    });

    try {
      const result = await postJson<RegisterReviewResponse>('/api/auth/register/review', {
        username,
        email,
        password,
        reviewInfo,
      });

      setReviewNotice({
        tone: 'info',
        title: '注册申请已提交',
        body: `${result.user.username} 已进入管理员审核队列。审核通过后即可登录。`,
      });
    } catch (error) {
      setReviewNotice({
        tone: 'warning',
        title: '提交失败',
        body: error instanceof Error ? error.message : '注册申请提交失败。',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMethod = (event: MouseEvent<HTMLAnchorElement>, method: RegisterMethod) => {
    event.preventDefault();
    setActiveMethod(method);
    window.history.replaceState(null, '', method === 'server' ? '/register?method=server' : '/register?method=review');
  };

  const handleServerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const username = String(form.get('serverVerifiedUsername') ?? '');
    const email = String(form.get('serverVerifiedEmail') ?? '');
    const password = String(form.get('serverVerifiedPassword') ?? '');
    const serverId = String(form.get('serverId') ?? '');
    const requiredError = findRequiredError([
      ['用户名', username],
      ['邮箱', email],
      ['登录密码', password],
      ['服务器 ID', serverId],
    ]);

    if (requiredError) {
      setServerNotice({
        tone: 'warning',
        title: '信息还没填完整',
        body: requiredError,
      });
      return;
    }

    if (!isValidEmail(email.trim())) {
      setServerNotice({
        tone: 'warning',
        title: '邮箱格式需要确认',
        body: '即便走服务器验证，也需要提供有效邮箱。',
      });
      return;
    }

    if (password.length < 8) {
      setServerNotice({
        tone: 'warning',
        title: '密码太短',
        body: '登录密码至少需要 8 个字符。',
      });
      return;
    }

    setIsSubmitting(true);
    setServerChallenge(null);
    setServerNotice({
      tone: 'info',
      title: '正在创建验证码',
      body: '正在连接服务器聊天接口并创建验证请求，请稍候。',
    });

    try {
      const result = await postJson<RegisterServerStartResponse>('/api/auth/register/server/start', {
        username,
        email,
        password,
        serverId,
      });
      const expiresAt = new Date(result.challenge.expiresAt).toLocaleString('zh-CN');

      setServerNotice({
        tone: 'info',
        title: '验证码已创建',
        body: `请用服务器 ID ${result.challenge.serverId} 在服务器聊天中发送验证码 ${result.challenge.code}。验证码有效期至 ${expiresAt}。`,
      });
      setServerChallenge(result.challenge);
    } catch (error) {
      setServerNotice({
        tone: 'warning',
        title: '验证流程启动失败',
        body: error instanceof Error ? error.message : '服务器验证流程启动失败。',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const checkServerVerification = async () => {
    if (!serverChallenge) {
      return;
    }

    setIsCheckingServer(true);
    setServerNotice({
      tone: 'info',
      title: '正在检查服务器聊天',
      body: `正在查找 ${serverChallenge.serverId} 是否发送了验证码 ${serverChallenge.code}。`,
    });

    try {
      const result = await postJson<ServerCheckResponse>(`/api/auth/register/server/${serverChallenge.id}/check`);

      if (result.status === 'verified') {
        setServerChallenge(null);
        setServerNotice({
          tone: 'info',
          title: '服务器账号验证通过',
          body: result.sessionReady
            ? `${result.user.username} 已完成注册，正在进入钱包。`
            : `${result.user.username} 已完成注册，请返回登录。`,
        });
        if (result.sessionReady) {
          window.location.href = '/';
        }
        return;
      }

      if (result.status === 'rotated' && result.challenge) {
        const expiresAt = new Date(result.challenge.expiresAt).toLocaleString('zh-CN');
        setServerChallenge(result.challenge);
        setServerNotice({
          tone: 'warning',
          title: '验证码已更新',
          body: `检测到该服务器 ID 发送了其他内容。请改为发送新验证码 ${result.challenge.code}，有效期至 ${expiresAt}。`,
        });
        return;
      }

      if (result.status === 'expired') {
        setServerChallenge(null);
        setServerNotice({
          tone: 'warning',
          title: '验证码已过期',
          body: '请重新提交服务器验证注册信息，获取新的验证码。',
        });
        return;
      }

      setServerNotice({
        tone: 'info',
        title: '还没有检测到验证码',
        body: `请确认服务器聊天中由 ${serverChallenge.serverId} 发送了验证码 ${serverChallenge.code}。`,
      });
    } catch (error) {
      setServerNotice({
        tone: 'warning',
        title: '检查失败',
        body: error instanceof Error ? error.message : '服务器验证状态检查失败。',
      });
    } finally {
      setIsCheckingServer(false);
    }
  };

  return (
    <div className="register-flow">
      <div className="segmented-control register-segments" role="tablist" aria-label="注册方式">
        {registerMethods.map((method) => (
          <a
            className={activeMethod === method.id ? 'is-selected' : ''}
            href={method.href}
            role="tab"
            id={`register-tab-${method.id}`}
            aria-selected={activeMethod === method.id}
            aria-controls={`register-panel-${method.id}`}
            key={method.id}
            onClick={(event) => switchMethod(event, method.id)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              {method.icon}
            </span>
            <span>{method.label}</span>
          </a>
        ))}
      </div>

      {activeMethod === 'review' ? (
        <form
          className="register-method-card"
          role="tabpanel"
          id="register-panel-review"
          aria-labelledby="register-tab-review"
          noValidate
          onSubmit={handleReviewSubmit}
        >
          <label>
            <span>用户名</span>
            <input type="text" name="username" autoComplete="username" required />
          </label>
          <label>
            <span>邮箱</span>
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            <span>登录密码</span>
            <input type="password" name="password" autoComplete="new-password" required />
          </label>
          <label>
            <span>审核信息</span>
            <textarea name="reviewInfo" rows={4} required />
          </label>
          {reviewNotice ? (
            <div className={`flow-notice flow-notice-${reviewNotice.tone}`} role="status" aria-live="polite">
              <strong>{reviewNotice.title}</strong>
              <span>{reviewNotice.body}</span>
            </div>
          ) : null}
          <div className="form-actions">
            <a className="secondary-action" href="/login">
              返回登录
            </a>
            <button className="primary-action" type="submit" disabled={isSubmitting}>
              <span className="material-symbols-rounded" aria-hidden="true">
                arrow_forward
              </span>
              <span>{isSubmitting ? '提交中' : '提交'}</span>
            </button>
          </div>
        </form>
      ) : (
        <form
          className="register-method-card"
          role="tabpanel"
          id="register-panel-server"
          aria-labelledby="register-tab-server"
          noValidate
          onSubmit={handleServerSubmit}
        >
          <label>
            <span>用户名</span>
            <input type="text" name="serverVerifiedUsername" autoComplete="username" required />
          </label>
          <label>
            <span>邮箱</span>
            <input type="email" name="serverVerifiedEmail" autoComplete="email" required />
          </label>
          <label>
            <span>登录密码</span>
            <input type="password" name="serverVerifiedPassword" autoComplete="new-password" required />
          </label>
          <label>
            <span>服务器 ID</span>
            <input type="text" name="serverId" autoComplete="off" required />
          </label>
          {serverNotice ? (
            <div className={`flow-notice flow-notice-${serverNotice.tone}`} role="status" aria-live="polite">
              <strong>{serverNotice.title}</strong>
              <span>{serverNotice.body}</span>
            </div>
          ) : null}
          <div className="form-actions">
            <a className="secondary-action" href="/login">
              返回登录
            </a>
            {serverChallenge ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={isCheckingServer}
                  onClick={() => {
                    setServerChallenge(null);
                    setServerNotice(null);
                  }}
                >
                  重新填写
                </button>
                <button className="primary-action" type="button" disabled={isCheckingServer} onClick={() => void checkServerVerification()}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    sync
                  </span>
                  <span>{isCheckingServer ? '检查中' : '检查验证状态'}</span>
                </button>
              </>
            ) : (
              <button className="primary-action" type="submit" disabled={isSubmitting}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  verified_user
                </span>
                <span>{isSubmitting ? '创建中' : '创建验证码'}</span>
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
