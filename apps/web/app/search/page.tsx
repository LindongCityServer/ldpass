import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from '../theme-provider';

export default function SearchPage() {
  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <a className="brand auth-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <ThemeSettings />
      </header>

      <section className="auth-panel" aria-labelledby="search-title">
        <div className="panel-icon" aria-hidden="true">
          <span className="material-symbols-rounded">search</span>
        </div>
        <h1 id="search-title">搜索卡券</h1>
        <form className="stacked-form">
          <label>
            <span>关键词</span>
            <input type="search" name="keyword" autoComplete="off" />
          </label>
          <div className="empty-note">当前没有可搜索的卡券。</div>
          <div className="form-actions">
            <a className="secondary-action" href="/">
              返回
            </a>
          </div>
        </form>
      </section>
    </main>
  );
}
