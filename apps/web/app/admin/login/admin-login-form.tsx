'use client';

import { useState, type FormEvent } from 'react';
import { postJson } from '../../api-client';
import { readClientDevice } from '../../device-client';

interface AdminLoginResponse {
  user: {
    username: string;
  };
}

interface LocalDevAdminLoginResponse {
  user: {
    username: string;
  };
  redirectTo: string;
}

export function AdminLoginForm({
  localDevAdminLoginEnabled = false,
}: {
  localDevAdminLoginEnabled?: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocalDevLoggingIn, setIsLocalDevLoggingIn] = useState(false);

  const handleLocalDevLogin = async () => {
    setMessage(null);
    setIsLocalDevLoggingIn(true);

    try {
      const result = await postJson<LocalDevAdminLoginResponse>('/api/auth/dev/local-admin/login');
      setMessage(`已以本地开发管理员 ${result.user.username} 登录，正在进入后台。`);
      window.location.href = result.redirectTo;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '本地管理员登录失败。');
      setIsLocalDevLoggingIn(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const result = await postJson<AdminLoginResponse>('/api/auth/admin/login', {
        identifier: String(form.get('identifier') ?? ''),
        password: String(form.get('password') ?? ''),
        secondFactor: String(form.get('secondFactor') ?? ''),
        ...readClientDevice(),
      });
      setMessage(`已登录为管理员 ${result.user.username}，正在进入后台。`);
      window.location.href = '/admin/users';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '管理员登录失败。');
    } finally {
      setIsSubmitting(false);
    }
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
      <label>
        <span>管理员 PIN</span>
        <input
          type="password"
          name="secondFactor"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{4,12}"
          required
        />
      </label>
      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}
      <div className="form-actions">
        <a className="secondary-action" href="/login">
          用户登录
        </a>
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          <span className="material-symbols-rounded" aria-hidden="true">
            login
          </span>
          <span>{isSubmitting ? '登录中' : '进入后台'}</span>
        </button>
      </div>
      {localDevAdminLoginEnabled ? (
        <div className="flow-notice local-dev-admin-login">
          <strong>本地开发登录</strong>
          <span>
            仅在本机开发环境显示：直接使用数据库中已有的管理员账号建立会话，跳过密码与 PIN。
          </span>
          <button
            className="secondary-action"
            type="button"
            disabled={isLocalDevLoggingIn}
            onClick={() => void handleLocalDevLogin()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              developer_mode
            </span>
            <span>{isLocalDevLoggingIn ? '登录中' : '以本地管理员登录'}</span>
          </button>
        </div>
      ) : null}
    </form>
  );
}
