import type { Metadata } from 'next';
import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../../../theme-provider';
import { QqLinkConfirm } from './qq-link-confirm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '绑定 QQ · 临东通',
  description: '将 QQ 账号绑定到当前临东通账号',
  robots: {
    index: false,
    follow: false,
  },
  // 绑定 token 只应出现在当前请求里，禁止通过 Referer 带给字体、图片等第三方资源。
  referrer: 'no-referrer',
};

interface QqLinkPageProps {
  searchParams?: Promise<{
    token?: string;
  }>;
}

export default async function QqLinkPage({ searchParams }: QqLinkPageProps) {
  const resolvedSearchParams = await searchParams;
  const rawToken = resolvedSearchParams?.token;
  const initialToken = typeof rawToken === 'string' ? rawToken : undefined;

  return (
    <main className="auth-shell add-pass-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="qq-link-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">forum</span>
        </div>
        <h1 id="qq-link-title">绑定 QQ</h1>
        <QqLinkConfirm initialToken={initialToken} />
      </section>
    </main>
  );
}
