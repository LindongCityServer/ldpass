import { brandAssets } from '@ldpass/ui';
import { AddPassForm } from './add-pass-form';
import { ThemeSettings } from '../theme-provider';

interface AddPassPageProps {
  searchParams?: Promise<{
    token?: string;
    claimCode?: string;
  }>;
}

export default async function AddPassPage({ searchParams }: AddPassPageProps) {
  const resolvedSearchParams = await searchParams;
  const initialClaimCode = resolvedSearchParams?.token ?? resolvedSearchParams?.claimCode;

  return (
    <main className="auth-shell add-pass-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="add-pass-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">add_card</span>
        </div>
        <h1 id="add-pass-title">添加卡券</h1>
        <AddPassForm initialClaimCode={initialClaimCode} />
      </section>
    </main>
  );
}
