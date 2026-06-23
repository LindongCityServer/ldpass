import { brandAssets } from '@ldpass/ui';
import { LoginForm } from './login-form';
import { ThemeSettings } from '../theme-provider';

interface LoginPageProps {
  searchParams?: Promise<{
    client_id?: string;
    redirect_uri?: string;
    state?: string;
    next?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const loginRedirectProps = {
    ...(resolvedSearchParams?.client_id ? { initialClientId: resolvedSearchParams.client_id } : {}),
    ...(resolvedSearchParams?.redirect_uri
      ? { initialRedirectUri: resolvedSearchParams.redirect_uri }
      : {}),
    ...(resolvedSearchParams?.state ? { initialState: resolvedSearchParams.state } : {}),
    ...(resolvedSearchParams?.next ? { initialNext: resolvedSearchParams.next } : {}),
  };

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="login-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">account_circle</span>
        </div>
        <h1 id="login-title">登录</h1>
        <LoginForm {...loginRedirectProps} />
        <p className="auth-switch">
          还没有账户？
          <a href="/register">注册</a>
        </p>
        <p className="auth-switch">
          平台管理入口
          <a href="/admin/login">管理员登录</a>
        </p>
        <p className="auth-switch">
          发卡方入口
          <a href="/provider/login">发卡方登录</a>
          <a href="/provider/register">入驻申请</a>
        </p>
        <p className="auth-switch auth-legal-links">
          <a href="/legal/terms">服务条款</a>
          <a href="/legal/privacy">隐私政策</a>
        </p>
      </section>
    </main>
  );
}
