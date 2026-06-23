'use client';

import { useState, type FormEvent } from 'react';
import { postJson } from '../../api-client';
import { readClientDevice } from '../../device-client';

interface AdminLoginResponse {
  user: {
    username: string;
  };
}

export function AdminLoginForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    </form>
  );
}
