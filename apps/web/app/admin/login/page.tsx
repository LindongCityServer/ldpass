import { headers } from 'next/headers';
import { brandAssets } from '@ldpass/ui';
import { AdminLoginForm } from './admin-login-form';
import { ThemeSettings } from '../../theme-provider';

export default async function AdminLoginPage() {
  const localDevAdminLoginEnabled = await readLocalDevAdminLoginEnabled();

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
        <AdminLoginForm localDevAdminLoginEnabled={localDevAdminLoginEnabled} />
      </section>
    </main>
  );
}

// 与 apps/api 的 local-dev-admin 守卫保持一致：非生产运行 + 本机回环地址才展示入口。
async function readLocalDevAdminLoginEnabled(): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  const configuredValue = process.env.LDPASS_LOCAL_DEV_ADMIN_LOGIN?.trim().toLowerCase();
  if (configuredValue === '0' || configuredValue === 'false' || configuredValue === 'off') {
    return false;
  }

  const host = (await headers()).get('host');
  if (!host) {
    return false;
  }

  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
}
