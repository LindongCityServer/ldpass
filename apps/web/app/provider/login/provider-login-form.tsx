'use client';

import { useState, type FormEvent } from 'react';
import { postJson } from '../../api-client';

interface ProviderLoginResponse {
  providerAccount: {
    displayName: string;
    providerName: string;
  };
}

export function ProviderLoginForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const result = await postJson<ProviderLoginResponse>('/api/providers/auth/login', {
        identifier: String(form.get('identifier') ?? ''),
        providerSlug: String(form.get('providerSlug') ?? '').trim() || undefined,
        password: String(form.get('password') ?? ''),
      });
      setMessage(`已登录 ${result.providerAccount.providerName}，正在进入发卡方后台。`);
      window.location.href = '/provider/dashboard';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发卡方登录失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="stacked-form" onSubmit={handleSubmit} noValidate>
      <label>
        <span>负责人邮箱</span>
        <input type="email" name="identifier" autoComplete="email" required />
      </label>
      <label>
        <span>发卡方标识</span>
        <input type="text" name="providerSlug" autoComplete="organization" placeholder="同邮箱有多个账号时填写" />
      </label>
      <label>
        <span>密码</span>
        <input type="password" name="password" autoComplete="current-password" required />
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
        <a className="secondary-action" href="/provider/register">
          入驻申请
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
