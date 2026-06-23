import { brandAssets } from '@ldpass/ui';
import { notFound } from 'next/navigation';
import { ThemeSettings } from '../../theme-provider';
import { LegalDocumentViewer } from './legal-document-viewer';

interface LegalDocumentPageProps {
  params: Promise<{
    key: string;
  }>;
}

export default async function LegalDocumentPage({ params }: LegalDocumentPageProps) {
  const resolvedParams = await params;

  if (resolvedParams.key !== 'terms' && resolvedParams.key !== 'privacy') {
    notFound();
  }

  return (
    <main className="auth-shell legal-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <LegalDocumentViewer documentKey={resolvedParams.key} />
    </main>
  );
}
