import { brandAssets } from '@ldpass/ui';
import { RegisterMethodTabs } from './register-method-tabs';
import { ThemeSettings } from '../theme-provider';

interface RegisterPageProps {
  searchParams?: Promise<{
    method?: string;
  }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const resolvedSearchParams = await searchParams;
  const initialMethod = resolvedSearchParams?.method === 'server' ? 'server' : 'review';

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel auth-panel-register" aria-labelledby="register-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">person_add</span>
        </div>
        <h1 id="register-title">注册</h1>

        <RegisterMethodTabs initialMethod={initialMethod} />
        <p className="auth-switch auth-legal-links">
          注册即表示你知晓平台会处理账户、设备、服务器验证和卡券相关信息。
          <a href="/legal/terms">服务条款</a>
          <a href="/legal/privacy">隐私政策</a>
        </p>
      </section>
    </main>
  );
}
