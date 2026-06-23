'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

interface ProviderSessionResponse {
  providerAccount: {
    id: string;
    providerId: string;
    providerName: string;
    providerSlug: string;
    providerStatus: string;
    providerLogoUrl: string | null;
    providerIntroductionUrl: string | null;
    providerContactName: string | null;
    providerContactEmail: string | null;
    providerBusinessInfo: string | null;
    email: string;
    displayName: string;
    status: string;
    role: string;
  } | null;
}

function formatProfileChangeStatus(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '资料变更待审核',
    Approved: '资料变更已通过',
    Rejected: '资料变更已拒绝',
  };

  return labels[status] ?? status;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ProviderProfile {
  id: string;
  name: string;
  slug: string;
  status: string;
  logoUrl: string | null;
  introductionUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  businessInfo: string | null;
}

interface ProviderProfileChangeRequest {
  id: string;
  status: string;
  current: ProviderProfileChangeSnapshot;
  proposed: ProviderProfileChangeSnapshot;
  reason: string | null;
  requestedBy: {
    email: string;
    displayName: string;
  } | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface ProviderProfileChangeSnapshot {
  name: string;
  logoUrl: string | null;
  introductionUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  businessInfo: string | null;
}

interface ProviderProfileChangeResponse {
  provider: ProviderProfile;
  requests: ProviderProfileChangeRequest[];
}

export function ProviderDashboardPanel() {
  const [providerAccount, setProviderAccount] = useState<ProviderSessionResponse['providerAccount']>(null);
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(null);
  const [profileChangeRequests, setProfileChangeRequests] = useState<ProviderProfileChangeRequest[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingProfileChange, setIsSubmittingProfileChange] = useState(false);

  useEffect(() => {
    getJson<ProviderSessionResponse>('/api/providers/auth/session')
      .then((result) => {
        setProviderAccount(result.providerAccount);
        if (!result.providerAccount) {
          setMessage('请先登录发卡方后台。');
          return;
        }
        setProviderProfile({
          id: result.providerAccount.providerId,
          name: result.providerAccount.providerName,
          slug: result.providerAccount.providerSlug,
          status: result.providerAccount.providerStatus,
          logoUrl: result.providerAccount.providerLogoUrl,
          introductionUrl: result.providerAccount.providerIntroductionUrl,
          contactName: result.providerAccount.providerContactName,
          contactEmail: result.providerAccount.providerContactEmail,
          businessInfo: result.providerAccount.providerBusinessInfo,
        });
        void loadProfileChangeRequests();
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : '读取发卡方会话失败。');
      })
      .finally(() => setIsLoading(false));
  }, []);

  const logout = async () => {
    await postJson('/api/providers/auth/logout');
    window.location.href = '/provider/login';
  };

  const loadProfileChangeRequests = async () => {
    try {
      const result = await getJson<ProviderProfileChangeResponse>('/api/providers/profile-change-requests');
      setProviderProfile(result.provider);
      setProfileChangeRequests(result.requests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取资料变更记录失败。');
    }
  };

  const submitProfileChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setIsSubmittingProfileChange(true);
    setMessage(null);

    try {
      await postJson('/api/providers/profile-change-requests', {
        name: String(form.get('name') ?? ''),
        logoUrl: String(form.get('logoUrl') ?? ''),
        introductionUrl: String(form.get('introductionUrl') ?? ''),
        contactName: String(form.get('contactName') ?? ''),
        contactEmail: String(form.get('contactEmail') ?? ''),
        businessInfo: String(form.get('businessInfo') ?? ''),
        reason: String(form.get('reason') ?? ''),
      });
      setMessage('资料变更申请已提交，管理员审核通过后才会生效。');
      await loadProfileChangeRequests();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交资料变更申请失败。');
    } finally {
      setIsSubmittingProfileChange(false);
    }
  };

  const effectiveProfile =
    providerProfile ??
    (providerAccount
      ? {
          id: providerAccount.providerId,
          name: providerAccount.providerName,
          slug: providerAccount.providerSlug,
          status: providerAccount.providerStatus,
          logoUrl: providerAccount.providerLogoUrl,
          introductionUrl: providerAccount.providerIntroductionUrl,
          contactName: providerAccount.providerContactName,
          contactEmail: providerAccount.providerContactEmail,
          businessInfo: providerAccount.providerBusinessInfo,
        }
      : null);
  const pendingProfileChange = profileChangeRequests.find((request) => request.status === 'PendingReview');

  return (
    <section className="admin-panel" aria-labelledby="provider-dashboard-title">
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-dashboard-title">工作台</h1>
        </div>
        <div className="admin-list-actions">
          <a className="secondary-action" href="/provider/register">
            入驻申请
          </a>
          {providerAccount ? (
            <button className="secondary-action" type="button" onClick={() => void logout()}>
              退出登录
            </button>
          ) : (
            <a className="primary-action" href="/provider/login">
              登录
            </a>
          )}
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取发卡方状态。</p> : null}

      {providerAccount ? (
        <>
          <div className="account-summary">
            {effectiveProfile?.logoUrl ? <img className="avatar" src={effectiveProfile.logoUrl} alt="" width={48} height={48} /> : null}
            <strong>{providerAccount.providerName}</strong>
            <span>标识：{providerAccount.providerSlug}</span>
            <span>负责人：{providerAccount.displayName} · {providerAccount.email}</span>
            <span>联系人：{effectiveProfile?.contactName ?? '未填写'} · {effectiveProfile?.contactEmail ?? '未填写'}</span>
            <span>提供方状态：{providerAccount.providerStatus}</span>
            <span>账号状态：{providerAccount.status} · 权限：{providerAccount.role}</span>
          </div>

          {effectiveProfile ? (
            <section className="admin-list-section" aria-labelledby="provider-profile-change-title">
              <div className="detail-section-heading">
                <h2 id="provider-profile-change-title">资料变更申请</h2>
                {pendingProfileChange ? <span>已有待审核申请</span> : <span>管理员审核通过后生效</span>}
              </div>
              <form
                className="stacked-form account-summary"
                key={`${effectiveProfile.name}:${effectiveProfile.logoUrl ?? ''}:${effectiveProfile.introductionUrl ?? ''}:${effectiveProfile.contactName ?? ''}:${effectiveProfile.contactEmail ?? ''}:${effectiveProfile.businessInfo ?? ''}`}
                onSubmit={submitProfileChange}
                noValidate
              >
                <div className="admin-adjustment-panel provider-create-form">
                  <label>
                    <span>提供方名称</span>
                    <input name="name" defaultValue={effectiveProfile.name} required minLength={2} maxLength={80} />
                  </label>
                  <label>
                    <span>头像图床链接</span>
                    <input name="logoUrl" type="url" defaultValue={effectiveProfile.logoUrl ?? ''} placeholder="https://example.com/logo.png" maxLength={1000} />
                  </label>
                  <label>
                    <span>介绍链接</span>
                    <input name="introductionUrl" type="url" defaultValue={effectiveProfile.introductionUrl ?? ''} placeholder="https://example.com/about" maxLength={1000} />
                  </label>
                  <label>
                    <span>联系人</span>
                    <input name="contactName" defaultValue={effectiveProfile.contactName ?? ''} required maxLength={80} />
                  </label>
                  <label>
                    <span>联系邮箱</span>
                    <input name="contactEmail" type="email" defaultValue={effectiveProfile.contactEmail ?? ''} required maxLength={160} />
                  </label>
                  <label>
                    <span>变更原因</span>
                    <input name="reason" maxLength={500} placeholder="可选，便于管理员审核" />
                  </label>
                  <label>
                    <span>业务说明</span>
                    <textarea name="businessInfo" defaultValue={effectiveProfile.businessInfo ?? ''} required minLength={10} maxLength={2000} />
                  </label>
                </div>
                <div className="form-actions">
                  <button className="primary-action" type="submit" disabled={isSubmittingProfileChange || Boolean(pendingProfileChange)}>
                    <span className="material-symbols-rounded" aria-hidden="true">
                      approval_delegation
                    </span>
                    <span>
                      {pendingProfileChange
                        ? '等待审核'
                        : isSubmittingProfileChange
                          ? '提交中'
                          : '提交资料变更'}
                    </span>
                  </button>
                </div>
              </form>
              {profileChangeRequests.length === 0 ? <p className="empty-note">暂无资料变更申请。</p> : null}
              <div className="admin-list compact-list">
                {profileChangeRequests.map((request) => (
                  <article className="admin-list-item" key={request.id}>
                    <div>
                      <h2>{formatProfileChangeStatus(request.status)}</h2>
                      <p>
                        {formatDateTime(request.createdAt)} · {request.proposed.name} · {request.proposed.contactEmail ?? '未填写邮箱'}
                      </p>
                      <p>头像：{request.current.logoUrl ?? '空白'} → {request.proposed.logoUrl ?? '空白'}</p>
                      <p>介绍链接：{request.current.introductionUrl ?? '空白'} → {request.proposed.introductionUrl ?? '空白'}</p>
                      {request.reason ? <p>申请说明：{request.reason}</p> : null}
                      {request.reviewReason ? <p>审核意见：{request.reviewReason}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <div className="admin-list">
            <article className="admin-list-item">
              <div>
                <h2>卡券模板</h2>
                <p>创建卡券模板、配置基础样式和规则，并提交管理员审批。</p>
              </div>
              <div className="admin-list-actions">
                <a className="primary-action" href="/provider/templates">
                  <span className="material-symbols-rounded" aria-hidden="true">
                    style
                  </span>
                  <span>管理模板</span>
                </a>
              </div>
            </article>
            <article className="admin-list-item">
              <div>
                <h2>发放与额度调整</h2>
                <p>基于已审核模板生成领取码，查看已发卡券并调整金额/积分/次数。</p>
              </div>
              <div className="admin-list-actions">
                <a className="primary-action" href="/provider/issue">
                  <span className="material-symbols-rounded" aria-hidden="true">
                    add_card
                  </span>
                  <span>生成领取码</span>
                </a>
                <a className="secondary-action" href="/provider/passes">
                  权益调整
                </a>
              </div>
            </article>
            <article className="admin-list-item">
              <div>
                <h2>争议记录</h2>
                <p>查看用户提交的卡券争议和管理员处理进度。</p>
              </div>
              <div className="admin-list-actions">
                <a className="secondary-action" href="/provider/disputes">
                  查看争议
                </a>
              </div>
            </article>
            <article className="admin-list-item">
              <div>
                <h2>开放 API</h2>
                <p>创建 API 密钥并配置 Webhook 回调，让外部系统发放卡券、同步状态并接收异步事件。</p>
              </div>
              <div className="admin-list-actions">
                <a className="secondary-action" href="/provider/api-keys">
                  API 密钥
                </a>
                <a className="secondary-action" href="/provider/webhooks">
                  Webhook 回调
                </a>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
