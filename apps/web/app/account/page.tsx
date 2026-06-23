import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../theme-provider';
import { AccountPanel } from './account-panel';

export default function AccountPage() {
  return (
    <main className="wallet-shell account-shell">
      <header className="topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <nav className="topbar-actions" aria-label="账户页面操作">
          <a className="icon-button" href="/" aria-label="返回钱包" title="返回钱包">
            <span className="material-symbols-rounded" aria-hidden="true">
              home
            </span>
          </a>
          <ThemeSettings />
        </nav>
      </header>

      <AccountPanel />
    </main>
  );
}
