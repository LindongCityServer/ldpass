import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../theme-provider';

export default function EditWalletPage() {
  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="edit-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">edit</span>
        </div>
        <h1 id="edit-title">编辑卡包</h1>
        <div className="empty-note">当前没有可编辑的卡券。</div>
        <div className="form-actions">
          <a className="secondary-action" href="/">
            返回
          </a>
          <a className="primary-action" href="/add">
            <span className="material-symbols-rounded" aria-hidden="true">
              add
            </span>
            <span>添加卡券</span>
          </a>
        </div>
      </section>
    </main>
  );
}
