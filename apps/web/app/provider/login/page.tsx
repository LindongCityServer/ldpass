import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../../theme-provider';
import { ProviderLoginForm } from './provider-login-form';

export default function ProviderLoginPage() {
  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="provider-login-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">storefront</span>
        </div>
        <h1 id="provider-login-title">发卡方登录</h1>
        <ProviderLoginForm />
      </section>
    </main>
  );
}
