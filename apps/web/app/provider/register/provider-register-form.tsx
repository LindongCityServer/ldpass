'use client';

import { FormEvent, useState } from 'react';
import { postJson } from '../../api-client';

interface ProviderRegisterResponse {
  provider: {
    id: string;
    name: string;
    slug: string;
    status: string;
    contactName: string | null;
    contactEmail: string | null;
    createdAt: string;
  };
  account: {
    email: string;
    status: string;
  };
  nextAction: 'wait_for_admin_review';
  resubmitted?: boolean;
}

export function ProviderRegisterForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    if (password !== confirmPassword) {
      setMessage('两次输入的负责人密码不一致。');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<ProviderRegisterResponse>('/api/providers/register', {
        name: String(form.get('name') ?? ''),
        slug: String(form.get('slug') ?? ''),
        contactName: String(form.get('contactName') ?? ''),
        contactEmail: String(form.get('contactEmail') ?? ''),
        businessInfo: String(form.get('businessInfo') ?? ''),
        password,
      });
      setMessage(
        result.resubmitted
          ? `已重新提交「${result.provider.name}」的入驻申请。审核通过后可使用 ${result.account.email} 登录发卡方后台。`
          : `已提交「${result.provider.name}」的入驻申请。审核通过后可使用 ${result.account.email} 登录发卡方后台。`,
      );
      formElement.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交提供方申请失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="auth-panel auth-panel-register" aria-labelledby="provider-register-title">
      <div className="panel-icon" aria-hidden="true">
        <span className="material-symbols-rounded">storefront</span>
      </div>
      <h1 id="provider-register-title">提供方入驻</h1>
      <p className="empty-note">
        通过审核后可创建卡券、发放权益和生成添加链接。被拒后可用原邮箱、原标识和负责人密码修改资料后重新提交。
      </p>

      <form className="stacked-form" onSubmit={submitProvider} noValidate>
        <label>
          <span>提供方名称</span>
          <input name="name" autoComplete="organization" required minLength={2} maxLength={80} />
        </label>
        <label>
          <span>提供方标识</span>
          <input name="slug" placeholder="lowercase-slug" required pattern="[a-z0-9-]{2,48}" />
        </label>
        <label>
          <span>联系人</span>
          <input name="contactName" autoComplete="name" required minLength={2} maxLength={80} />
        </label>
        <label>
          <span>联系邮箱</span>
          <input type="email" name="contactEmail" autoComplete="email" required maxLength={254} />
        </label>
        <label>
          <span>业务说明</span>
          <textarea name="businessInfo" required minLength={10} maxLength={2000} />
        </label>
        <label>
          <span>负责人密码</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
          <small>首次申请用于设置密码；重新提交被拒申请时用于确认负责人身份。</small>
        </label>
        <label>
          <span>确认密码</span>
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
        </label>

        <div className="form-actions">
          <a className="secondary-action" href="/provider/login">
            返回发卡方登录
          </a>
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            <span className="material-symbols-rounded" aria-hidden="true">
              send
            </span>
            <span>{isSubmitting ? '提交中' : '提交申请'}</span>
          </button>
        </div>
      </form>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}
      <p className="auth-switch auth-legal-links">
        提交入驻申请即表示你知晓平台会审核提供方资料和卡券配置。
        <a href="/legal/terms">服务条款</a>
        <a href="/legal/privacy">隐私政策</a>
      </p>
    </section>
  );
}
