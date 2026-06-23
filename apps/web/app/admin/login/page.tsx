import { brandAssets } from '@ldpass/ui';
import { AdminLoginForm } from './admin-login-form';
import { ThemeSettings } from '../../theme-provider';

export default function AdminLoginPage() {
  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="admin-login-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">admin_panel_settings</span>
        </div>
        <h1 id="admin-login-title">管理员登录</h1>
        <AdminLoginForm />
      </section>
    </main>
  );
}
