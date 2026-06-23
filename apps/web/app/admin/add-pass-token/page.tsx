import { AddPassTokenForm } from './add-pass-token-form';

export default function AdminAddPassTokenPage() {
  return (
    <section className="admin-panel" aria-labelledby="add-pass-token-title">
      <div className="admin-panel-heading">
        <div>
          <p>管理员后台</p>
          <h1 id="add-pass-token-title">领取码</h1>
        </div>
        <div className="admin-list-actions">
          <a className="secondary-action" href="/admin/users">
            用户管理
          </a>
          <a className="secondary-action" href="/admin/passes">
            卡券管理
          </a>
        </div>
      </div>
      <AddPassTokenForm />
    </section>
  );
}
