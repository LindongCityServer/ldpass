import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../theme-provider';
import { ActionLinkForm } from './action-link-form';

interface ActionPageProps {
  searchParams?: Promise<{
    token?: string;
  }>;
}

export default async function ActionPage({ searchParams }: ActionPageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <main className="auth-shell add-pass-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="action-link-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">link</span>
        </div>
        <h1 id="action-link-title">确认链接操作</h1>
        <ActionLinkForm initialToken={resolvedSearchParams?.token} />
      </section>
    </main>
  );
}
