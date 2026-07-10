import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../theme-provider';
import { AccountVerificationForm } from './account-verification-form';

interface VerifyAccountPageProps {
  searchParams?: Promise<{
    client_id?: string;
    redirect_uri?: string;
    state?: string;
    purpose?: string;
  }>;
}

export default async function VerifyAccountPage({ searchParams }: VerifyAccountPageProps) {
  const resolvedSearchParams = await searchParams;
  const verificationProps = {
    ...(resolvedSearchParams?.client_id ? { initialClientId: resolvedSearchParams.client_id } : {}),
    ...(resolvedSearchParams?.redirect_uri
      ? { initialRedirectUri: resolvedSearchParams.redirect_uri }
      : {}),
    ...(resolvedSearchParams?.state ? { initialState: resolvedSearchParams.state } : {}),
    ...(resolvedSearchParams?.purpose ? { initialPurpose: resolvedSearchParams.purpose } : {}),
  };

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="verify-account-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">verified_user</span>
        </div>
        <h1 id="verify-account-title">账号验证</h1>
        <AccountVerificationForm {...verificationProps} />
      </section>
    </main>
  );
}
