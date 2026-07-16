import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../theme-provider';
import { AccountPanel } from './account-panel';

interface AccountPageProps {
  searchParams?: Promise<{
    dialog?: string;
  }>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const resolvedSearchParams = await searchParams;
  const initialDialog =
    resolvedSearchParams?.dialog === 'deviceApprovals' ? 'deviceApprovals' : null;

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

      <AccountPanel initialDialog={initialDialog} />
    </main>
  );
}
