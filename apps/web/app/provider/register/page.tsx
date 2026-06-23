import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../../theme-provider';
import { ProviderRegisterForm } from './provider-register-form';

export default function ProviderRegisterPage() {
  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <ProviderRegisterForm />
    </main>
  );
}
