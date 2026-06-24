'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

interface AdminProvider {
  id: string;
  name: string;
  slug: string;
  status: string;
  source: string;
  logoUrl: string | null;
  introductionUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  businessInfo: string | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminProvidersResponse {
  providers: AdminProvider[];
}

interface ProviderProfileChangeSnapshot {
  name: string;
  logoUrl: string | null;
  introductionUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  businessInfo: string | null;
}

interface ProviderProfileChangeRequest {
  id: string;
  provider: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  status: string;
  current: ProviderProfileChangeSnapshot;
  proposed: ProviderProfileChangeSnapshot;
  reason: string | null;
  targetApiKeyId: string | null;
  requestedBy: {
    email: string;
    displayName: string;
  } | null;
  createdAt: string;
}

interface ProviderProfileChangeRequestsResponse {
  requests: ProviderProfileChangeRequest[];
}

interface ProviderWebhookChangeRequest {
  id: string;
  provider: {
    id: string;
    name: string;
    slug: string;
    status: string;
  } | null;
  providerId: string;
  status: string;
  kind: string;
  proposed: {
    name: string;
    url: string;
    eventTypes: string[];
    enabled: boolean;
  };
  reason: string | null;
  requestedBy: {
    email: string;
    displayName: string;
  } | null;
  endpointId: string | null;
  createdAt: string;
}

interface ProviderWebhookChangeRequestsResponse {
  requests: ProviderWebhookChangeRequest[];
}

interface ProviderApiKeyChangeRequest {
  id: string;
  provider: {
    id: string;
    name: string;
    slug: string;
    status: string;
  } | null;
  providerId: string;
  status: string;
  kind: string;
  proposed: {
    name: string;
    scopes: string[];
    expiresAt: string | null;
  };
  reason: string | null;
  requestedBy: {
    email: string;
    displayName: string;
  } | null;
  targetApiKeyId: string | null;
  apiKeyId: string | null;
  createdAt: string;
}

interface ProviderApiKeyChangeRequestsResponse {
  requests: ProviderApiKeyChangeRequest[];
}

interface CreateProviderResponse {
  provider: AdminProvider;
  account: {
    email: string;
    displayName: string;
    status: string;
  };
}

interface ProviderGovernanceInput {
  reason: string;
  secondFactor: string;
}

type ProviderGovernanceAction = 'suspend' | 'unsuspend' | 'archive';
type ProviderAdminView = 'providers' | 'profile' | 'api' | 'webhook';
type ProviderDialog =
  | { kind: 'detail'; provider: AdminProvider }
  | { kind: 'governance'; provider: AdminProvider; action: ProviderGovernanceAction };

export function AdminProvidersPanel() {
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [profileChangeRequests, setProfileChangeRequests] = useState<ProviderProfileChangeRequest[]>([]);
  const [webhookChangeRequests, setWebhookChangeRequests] = useState<ProviderWebhookChangeRequest[]>([]);
  const [apiKeyChangeRequests, setApiKeyChangeRequests] = useState<ProviderApiKeyChangeRequest[]>([]);
  const [activeView, setActiveView] = useState<ProviderAdminView>('providers');
  const [keyword, setKeyword] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [activeDialog, setActiveDialog] = useState<ProviderDialog | null>(null);
  const [governanceInputs, setGovernanceInputs] = useState<Record<string, ProviderGovernanceInput>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingProfileChanges, setIsLoadingProfileChanges] = useState(true);
  const [isLoadingWebhookChanges, setIsLoadingWebhookChanges] = useState(true);
  const [isLoadingApiKeyChanges, setIsLoadingApiKeyChanges] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isExportingProviders, setIsExportingProviders] = useState(false);
  const [governanceActionKey, setGovernanceActionKey] = useState<string | null>(null);
  const [profileChangeActionKey, setProfileChangeActionKey] = useState<string | null>(null);
  const [webhookChangeActionKey, setWebhookChangeActionKey] = useState<string | null>(null);
  const [apiKeyChangeActionKey, setApiKeyChangeActionKey] = useState<string | null>(null);

  const loadProviders = async (nextKeyword = keyword) => {
    setIsLoading(true);
    setMessage(null);

    const search = new URLSearchParams();
    search.set('take', '50');
    if (nextKeyword.trim()) {
      search.set('keyword', nextKeyword.trim());
    }

    try {
      const result = await getJson<AdminProvidersResponse>(`/api/admin/providers?${search.toString()}`);
      setProviders(result.providers);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取提供方列表失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadProviders('');
    void loadProfileChangeRequests();
    void loadApiKeyChangeRequests();
    void loadWebhookChangeRequests();
  }, []);

  const loadProfileChangeRequests = async () => {
    setIsLoadingProfileChanges(true);
    setMessage(null);

    try {
      const result = await getJson<ProviderProfileChangeRequestsResponse>('/api/admin/providers/profile-change-requests');
      setProfileChangeRequests(result.requests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取资料变更申请失败。');
    } finally {
      setIsLoadingProfileChanges(false);
    }
  };

  const loadWebhookChangeRequests = async () => {
    setIsLoadingWebhookChanges(true);
    setMessage(null);

    try {
      const result = await getJson<ProviderWebhookChangeRequestsResponse>('/api/admin/providers/webhook-change-requests');
      setWebhookChangeRequests(result.requests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 Webhook 配置申请失败。');
    } finally {
      setIsLoadingWebhookChanges(false);
    }
  };

  const loadApiKeyChangeRequests = async () => {
    setIsLoadingApiKeyChanges(true);
    setMessage(null);

    try {
      const result = await getJson<ProviderApiKeyChangeRequestsResponse>('/api/admin/providers/api-key-change-requests');
      setApiKeyChangeRequests(result.requests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 API 密钥申请失败。');
    } finally {
      setIsLoadingApiKeyChanges(false);
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadProviders(keyword);
  };

  const exportProvidersCsv = async () => {
    const search = new URLSearchParams();
    search.set('take', '1000');
    if (keyword.trim()) {
      search.set('keyword', keyword.trim());
    }

    setIsExportingProviders(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/providers/export.csv?${search.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await readExportError(response));
      }

      const content = await response.text();
      downloadTextFile('ldpass-admin-providers.csv', content, 'text/csv;charset=utf-8');
      setMessage('提供方目录 CSV 已生成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出提供方 CSV 失败。');
    } finally {
      setIsExportingProviders(false);
    }
  };

  const createProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    setIsCreating(true);

    try {
      const result = await postJson<CreateProviderResponse>('/api/admin/providers', {
        name: String(form.get('name') ?? ''),
        slug: String(form.get('slug') ?? ''),
        contactName: String(form.get('contactName') ?? ''),
        contactEmail: String(form.get('contactEmail') ?? ''),
        businessInfo: String(form.get('businessInfo') ?? ''),
        ownerEmail: String(form.get('ownerEmail') ?? ''),
        ownerDisplayName: String(form.get('ownerDisplayName') ?? ''),
        ownerPassword: String(form.get('ownerPassword') ?? ''),
      });
      formElement.reset();
      setIsCreateDialogOpen(false);
      setMessage(`已创建提供方 ${result.provider.name}，负责人账号 ${result.account.email} 可直接登录发卡方后台。`);
      await loadProviders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建提供方失败。');
    } finally {
      setIsCreating(false);
    }
  };

  const approveProvider = async (providerId: string) => {
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/${providerId}/approve`);
      setMessage('已通过提供方入驻申请。');
      await loadProviders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '通过提供方失败。');
    }
  };

  const rejectProvider = async (providerId: string) => {
    const reason = window.prompt('请输入拒绝原因');
    if (!reason) {
      return;
    }

    setMessage(null);

    try {
      await postJson(`/api/admin/providers/${providerId}/reject`, { reason });
      setMessage('已拒绝提供方入驻申请。');
      await loadProviders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝提供方失败。');
    }
  };

  const approveProfileChangeRequest = async (request: ProviderProfileChangeRequest) => {
    if (!window.confirm(`确定通过 ${request.provider.name} 的资料变更申请吗？`)) {
      return;
    }

    setProfileChangeActionKey(`${request.id}:approve`);
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/profile-change-requests/${request.id}/approve`);
      setMessage('已通过提供方资料变更申请。');
      await Promise.all([loadProfileChangeRequests(), loadProviders(keyword)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '通过资料变更失败。');
    } finally {
      setProfileChangeActionKey(null);
    }
  };

  const rejectProfileChangeRequest = async (request: ProviderProfileChangeRequest) => {
    const reason = window.prompt('请输入拒绝原因');
    if (!reason) {
      return;
    }

    setProfileChangeActionKey(`${request.id}:reject`);
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/profile-change-requests/${request.id}/reject`, { reason });
      setMessage('已拒绝提供方资料变更申请。');
      await loadProfileChangeRequests();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝资料变更失败。');
    } finally {
      setProfileChangeActionKey(null);
    }
  };

  const approveWebhookChangeRequest = async (request: ProviderWebhookChangeRequest) => {
    if (!window.confirm(`确定通过 ${request.provider?.name ?? request.providerId} 的 Webhook ${formatWebhookChangeKind(request.kind)}申请吗？`)) {
      return;
    }

    setWebhookChangeActionKey(`${request.id}:approve`);
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/webhook-change-requests/${request.id}/approve`);
      setMessage(`已通过 Webhook 配置申请：${formatWebhookChangeKind(request.kind)}。`);
      await Promise.all([loadWebhookChangeRequests(), loadProviders(keyword)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '通过 Webhook 配置申请失败。');
    } finally {
      setWebhookChangeActionKey(null);
    }
  };

  const rejectWebhookChangeRequest = async (request: ProviderWebhookChangeRequest) => {
    const reason = window.prompt('请输入拒绝原因');
    if (!reason) {
      return;
    }

    setWebhookChangeActionKey(`${request.id}:reject`);
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/webhook-change-requests/${request.id}/reject`, { reason });
      setMessage('已拒绝 Webhook 配置申请。');
      await loadWebhookChangeRequests();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝 Webhook 配置申请失败。');
    } finally {
      setWebhookChangeActionKey(null);
    }
  };

  const approveApiKeyChangeRequest = async (request: ProviderApiKeyChangeRequest) => {
    if (!window.confirm(`确定通过 ${request.provider?.name ?? request.providerId} 的 API 密钥申请吗？`)) {
      return;
    }

    setApiKeyChangeActionKey(`${request.id}:approve`);
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/api-key-change-requests/${request.id}/approve`);
      setMessage(`已通过 API 密钥申请：${formatApiKeyChangeKind(request.kind)}。`);
      await Promise.all([loadApiKeyChangeRequests(), loadProviders(keyword)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '通过 API 密钥申请失败。');
    } finally {
      setApiKeyChangeActionKey(null);
    }
  };

  const rejectApiKeyChangeRequest = async (request: ProviderApiKeyChangeRequest) => {
    const reason = window.prompt('请输入拒绝原因');
    if (!reason) {
      return;
    }

    setApiKeyChangeActionKey(`${request.id}:reject`);
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/api-key-change-requests/${request.id}/reject`, { reason });
      setMessage('已拒绝 API 密钥申请。');
      await loadApiKeyChangeRequests();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝 API 密钥申请失败。');
    } finally {
      setApiKeyChangeActionKey(null);
    }
  };

  const updateGovernanceInput = (providerId: string, patch: Partial<ProviderGovernanceInput>) => {
    setGovernanceInputs((currentInputs) => ({
      ...currentInputs,
      [providerId]: {
        reason: currentInputs[providerId]?.reason ?? '',
        secondFactor: currentInputs[providerId]?.secondFactor ?? '',
        ...patch,
      },
    }));
  };

  const changeProviderGovernance = async (provider: AdminProvider, action: ProviderGovernanceAction) => {
    const input = governanceInputs[provider.id] ?? { reason: '', secondFactor: '' };
    const reason = input.reason.trim();
    const secondFactor = input.secondFactor.trim();
    const actionLabel = formatProviderGovernanceAction(action);

    if (!reason) {
      setMessage(`请输入${actionLabel}原因。`);
      return;
    }

    if (!/^\d{4,12}$/.test(secondFactor)) {
      setMessage('管理员 PIN 需要是 4 到 12 位数字。');
      return;
    }

    const actionKey = `${provider.id}:${action}`;
    setGovernanceActionKey(actionKey);
    setMessage(null);

    try {
      await postJson(`/api/admin/providers/${provider.id}/${action}`, {
        reason,
        secondFactor,
      });
      setGovernanceInputs((currentInputs) => ({
        ...currentInputs,
        [provider.id]: {
          reason: '',
          secondFactor: '',
        },
      }));
      setMessage(`已${actionLabel} ${provider.name}。`);
      setActiveDialog(null);
      await loadProviders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${actionLabel}提供方失败。`);
    } finally {
      setGovernanceActionKey(null);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-providers-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-providers-title">发卡方</h1>
        </div>
        <div className="admin-list-actions">
          <button className="primary-action" type="button" onClick={() => setIsCreateDialogOpen(true)}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add_business
            </span>
            <span>新增发卡方</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => void loadProviders(keyword)}>
            刷新
          </button>
          <a className="secondary-action" href="/provider/register">
            入驻申请
          </a>
          <a className="secondary-action" href="/admin/pass-templates">
            模板审核
          </a>
          <a className="secondary-action" href="/admin/users">
            用户审核
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      <div className="segmented-control" role="tablist" aria-label="发卡方管理视图">
        <button className={activeView === 'providers' ? 'is-selected' : undefined} type="button" onClick={() => setActiveView('providers')}>
          <span className="material-symbols-rounded" aria-hidden="true">
            storefront
          </span>
          <span>发卡方</span>
        </button>
        <button className={activeView === 'profile' ? 'is-selected' : undefined} type="button" onClick={() => setActiveView('profile')}>
          <span className="material-symbols-rounded" aria-hidden="true">
            badge
          </span>
          <span>资料 {profileChangeRequests.length}</span>
        </button>
        <button className={activeView === 'api' ? 'is-selected' : undefined} type="button" onClick={() => setActiveView('api')}>
          <span className="material-symbols-rounded" aria-hidden="true">
            key
          </span>
          <span>API {apiKeyChangeRequests.length}</span>
        </button>
        <button className={activeView === 'webhook' ? 'is-selected' : undefined} type="button" onClick={() => setActiveView('webhook')}>
          <span className="material-symbols-rounded" aria-hidden="true">
            webhook
          </span>
          <span>Webhook {webhookChangeRequests.length}</span>
        </button>
      </div>

      {activeView === 'profile' ? (
      <section className="admin-list-section" aria-labelledby="provider-profile-change-review-title">
        <div className="detail-section-heading">
          <h2 id="provider-profile-change-review-title">资料变更待审</h2>
          <button className="secondary-action" type="button" onClick={() => void loadProfileChangeRequests()}>
            刷新待审
          </button>
        </div>
        {isLoadingProfileChanges ? <p className="empty-note">正在读取资料变更申请。</p> : null}
        {!isLoadingProfileChanges && profileChangeRequests.length === 0 ? <p className="empty-note">暂无待审核资料变更。</p> : null}
        <div className="admin-list">
          {profileChangeRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>{request.provider.name}</h2>
                <p>
                  标识：{request.provider.slug} · 提交人：
                  {request.requestedBy ? `${request.requestedBy.displayName} <${request.requestedBy.email}>` : '未知'}
                </p>
                <p>提交时间：{formatDateTime(request.createdAt)}</p>
                {request.reason ? <p>申请说明：{request.reason}</p> : null}
                <dl className="profile-change-diff">
                  <div>
                    <dt>名称</dt>
                    <dd>{request.current.name}</dd>
                    <dd>{request.proposed.name}</dd>
                  </div>
                  <div>
                    <dt>头像</dt>
                    <dd>{request.current.logoUrl ?? '空白'}</dd>
                    <dd>{request.proposed.logoUrl ?? '空白'}</dd>
                  </div>
                  <div>
                    <dt>介绍链接</dt>
                    <dd>{request.current.introductionUrl ?? '空白'}</dd>
                    <dd>{request.proposed.introductionUrl ?? '空白'}</dd>
                  </div>
                  <div>
                    <dt>联系人</dt>
                    <dd>{request.current.contactName ?? '未填写'}</dd>
                    <dd>{request.proposed.contactName ?? '未填写'}</dd>
                  </div>
                  <div>
                    <dt>联系邮箱</dt>
                    <dd>{request.current.contactEmail ?? '未填写'}</dd>
                    <dd>{request.proposed.contactEmail ?? '未填写'}</dd>
                  </div>
                  <div>
                    <dt>业务说明</dt>
                    <dd>{request.current.businessInfo ?? '未填写'}</dd>
                    <dd>{request.proposed.businessInfo ?? '未填写'}</dd>
                  </div>
                </dl>
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={profileChangeActionKey === `${request.id}:reject`}
                  onClick={() => void rejectProfileChangeRequest(request)}
                >
                  {profileChangeActionKey === `${request.id}:reject` ? '拒绝中' : '拒绝'}
                </button>
                <button
                  className="primary-action"
                  type="button"
                  disabled={profileChangeActionKey === `${request.id}:approve`}
                  onClick={() => void approveProfileChangeRequest(request)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    check
                  </span>
                  <span>{profileChangeActionKey === `${request.id}:approve` ? '通过中' : '通过并应用'}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      ) : null}

      {activeView === 'api' ? (
      <section className="admin-list-section" aria-labelledby="provider-api-key-change-review-title">
        <div className="detail-section-heading">
          <h2 id="provider-api-key-change-review-title">API 密钥待审</h2>
          <button className="secondary-action" type="button" onClick={() => void loadApiKeyChangeRequests()}>
            刷新待审
          </button>
        </div>
        {isLoadingApiKeyChanges ? <p className="empty-note">正在读取 API 密钥申请。</p> : null}
        {!isLoadingApiKeyChanges && apiKeyChangeRequests.length === 0 ? <p className="empty-note">暂无待审核 API 密钥申请。</p> : null}
        <div className="admin-list">
          {apiKeyChangeRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>{formatApiKeyChangeKind(request.kind)}：{request.proposed.name}</h2>
                <p>
                  提供方：{request.provider ? `${request.provider.name} (${request.provider.slug})` : request.providerId} · 状态：
                  {formatApiKeyChangeStatus(request.status)}
                </p>
                <p>
                  提交人：
                  {request.requestedBy ? `${request.requestedBy.displayName} <${request.requestedBy.email}>` : '未知'} · 提交时间：
                  {formatDateTime(request.createdAt)}
                </p>
                {request.targetApiKeyId ? <p>目标密钥 ID：{request.targetApiKeyId}</p> : null}
                {request.kind === 'RevokeApiKey' ? null : <p>权限：{request.proposed.scopes.map((scope) => formatApiKeyScope(scope)).join('、')}</p>}
                {request.kind === 'RevokeApiKey' ? null : <p>有效期：{request.proposed.expiresAt ? formatDateTime(request.proposed.expiresAt) : '长期有效'}</p>}
                {request.reason ? <p>申请说明：{request.reason}</p> : null}
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={apiKeyChangeActionKey === `${request.id}:reject`}
                  onClick={() => void rejectApiKeyChangeRequest(request)}
                >
                  {apiKeyChangeActionKey === `${request.id}:reject` ? '拒绝中' : '拒绝'}
                </button>
                <button
                  className="primary-action"
                  type="button"
                  disabled={apiKeyChangeActionKey === `${request.id}:approve`}
                  onClick={() => void approveApiKeyChangeRequest(request)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    check
                  </span>
                  <span>{apiKeyChangeActionKey === `${request.id}:approve` ? '通过中' : formatApiKeyApproveAction(request.kind)}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      ) : null}

      {activeView === 'webhook' ? (
      <section className="admin-list-section" aria-labelledby="provider-webhook-change-review-title">
        <div className="detail-section-heading">
          <h2 id="provider-webhook-change-review-title">Webhook 配置待审</h2>
          <button className="secondary-action" type="button" onClick={() => void loadWebhookChangeRequests()}>
            刷新待审
          </button>
        </div>
        {isLoadingWebhookChanges ? <p className="empty-note">正在读取 Webhook 配置申请。</p> : null}
        {!isLoadingWebhookChanges && webhookChangeRequests.length === 0 ? <p className="empty-note">暂无待审核 Webhook 配置。</p> : null}
        <div className="admin-list">
          {webhookChangeRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>{formatWebhookChangeKind(request.kind)}：{request.proposed.name}</h2>
                <p>
                  提供方：{request.provider ? `${request.provider.name} (${request.provider.slug})` : request.providerId} · 状态：
                  {formatWebhookChangeStatus(request.status)}
                </p>
                <p>
                  提交人：
                  {request.requestedBy ? `${request.requestedBy.displayName} <${request.requestedBy.email}>` : '未知'} · 提交时间：
                  {formatDateTime(request.createdAt)}
                </p>
                <p>回调地址：{request.proposed.url}</p>
                <p>事件：{request.proposed.eventTypes.join('、')}</p>
                {request.endpointId ? <p>目标端点 ID：{request.endpointId}</p> : null}
                <p>目标状态：{request.proposed.enabled ? '通过后启用' : '通过后停用'}</p>
                {request.reason ? <p>申请说明：{request.reason}</p> : null}
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={webhookChangeActionKey === `${request.id}:reject`}
                  onClick={() => void rejectWebhookChangeRequest(request)}
                >
                  {webhookChangeActionKey === `${request.id}:reject` ? '拒绝中' : '拒绝'}
                </button>
                <button
                  className="primary-action"
                  type="button"
                  disabled={webhookChangeActionKey === `${request.id}:approve`}
                  onClick={() => void approveWebhookChangeRequest(request)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    check
                  </span>
                  <span>{webhookChangeActionKey === `${request.id}:approve` ? '通过中' : formatWebhookApproveAction(request.kind)}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      ) : null}

      {activeView === 'providers' ? (
      <>
      <form className="audit-filter-grid" onSubmit={submitSearch}>
        <label>
          <span>搜索发卡方</span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="名称、标识、联系人、邮箱、业务说明"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="secondary-action" type="button" onClick={() => void loadProviders(keyword)}>
            刷新列表
          </button>
          <button className="secondary-action" type="button" disabled={isExportingProviders} onClick={() => void exportProvidersCsv()}>
            {isExportingProviders ? '导出中' : '导出 CSV'}
          </button>
          <button className="primary-action" type="submit">
            <span className="material-symbols-rounded" aria-hidden="true">
              manage_search
            </span>
            <span>搜索</span>
          </button>
        </div>
      </form>

      {isLoading ? <p className="empty-note">正在读取提供方列表。</p> : null}
      {!isLoading && providers.length === 0 ? <p className="empty-note">暂无提供方。</p> : null}

      <div className="admin-list">
        {providers.map((provider) => (
          <article className="admin-list-item" key={provider.id}>
            <div>
              <h2>{provider.name}</h2>
              <p>
                标识：{provider.slug} · 状态：{formatProviderStatus(provider.status)} · 来源：{formatProviderSource(provider.source)}
              </p>
              <p>
                联系人：{provider.contactName ?? '未填写'} · 邮箱：{provider.contactEmail ?? '未填写'}
              </p>
            </div>
            <div className="admin-list-actions">
              <button className="secondary-action" type="button" onClick={() => setActiveDialog({ kind: 'detail', provider })}>
                详情
              </button>
              {isReviewableProvider(provider.status) ? (
                <>
                <button className="secondary-action" type="button" onClick={() => void rejectProvider(provider.id)}>
                  拒绝
                </button>
                <button className="primary-action" type="button" onClick={() => void approveProvider(provider.id)}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    check
                  </span>
                  <span>通过</span>
                </button>
                </>
              ) : null}
              {provider.status === 'Active' ? (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    updateGovernanceInput(provider.id, {});
                    setActiveDialog({ kind: 'governance', provider, action: 'suspend' });
                  }}
                >
                  停用
                </button>
              ) : null}
              {provider.status === 'Suspended' ? (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    updateGovernanceInput(provider.id, {});
                    setActiveDialog({ kind: 'governance', provider, action: 'unsuspend' });
                  }}
                >
                  启用
                </button>
              ) : null}
              {provider.status !== 'Archived' ? (
                <button
                  className="danger-action"
                  type="button"
                  onClick={() => {
                    updateGovernanceInput(provider.id, {});
                    setActiveDialog({ kind: 'governance', provider, action: 'archive' });
                  }}
                >
                  归档
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {isCreateDialogOpen ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="新增发卡方">
            <div className="admin-dialog-heading">
              <h2>新增发卡方</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <form className="admin-dialog-form" onSubmit={createProvider} noValidate>
              <label>
                <span>发卡方名称</span>
                <input type="text" name="name" required minLength={2} maxLength={80} />
              </label>
              <label>
                <span>发卡方标识</span>
                <input type="text" name="slug" placeholder="lowercase-slug" required pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]" />
              </label>
              <label>
                <span>联系人</span>
                <input type="text" name="contactName" required maxLength={80} />
              </label>
              <label>
                <span>联系邮箱</span>
                <input type="email" name="contactEmail" required maxLength={160} />
              </label>
              <label>
                <span>负责人邮箱</span>
                <input type="email" name="ownerEmail" required maxLength={160} />
              </label>
              <label>
                <span>负责人显示名</span>
                <input type="text" name="ownerDisplayName" required maxLength={80} />
              </label>
              <label>
                <span>初始密码</span>
                <input type="password" name="ownerPassword" autoComplete="new-password" required minLength={8} maxLength={128} />
              </label>
              <label>
                <span>业务说明</span>
                <textarea name="businessInfo" maxLength={1000} rows={4} />
              </label>
              <div className="admin-dialog-actions">
                <button className="secondary-action" type="button" onClick={() => setIsCreateDialogOpen(false)}>
                  取消
                </button>
                <button className="primary-action" type="submit" disabled={isCreating}>
                  {isCreating ? '创建中' : '创建'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {activeDialog ? (
        <ProviderDialogPanel
          dialog={activeDialog}
          governanceInput={governanceInputs[activeDialog.provider.id] ?? { reason: '', secondFactor: '' }}
          governanceActionKey={governanceActionKey}
          onClose={() => setActiveDialog(null)}
          onGovernanceInputChange={(patch) => updateGovernanceInput(activeDialog.provider.id, patch)}
          onGovernanceSubmit={() => {
            if (activeDialog.kind === 'governance') {
              void changeProviderGovernance(activeDialog.provider, activeDialog.action);
            }
          }}
        />
      ) : null}
      </>
      ) : null}
    </section>
  );
}

interface ProviderDialogPanelProps {
  dialog: ProviderDialog;
  governanceInput: ProviderGovernanceInput;
  governanceActionKey: string | null;
  onClose: () => void;
  onGovernanceInputChange: (patch: Partial<ProviderGovernanceInput>) => void;
  onGovernanceSubmit: () => void;
}

function ProviderDialogPanel({
  dialog,
  governanceInput,
  governanceActionKey,
  onClose,
  onGovernanceInputChange,
  onGovernanceSubmit,
}: ProviderDialogPanelProps) {
  const title = dialog.kind === 'detail' ? '发卡方详情' : formatProviderGovernanceAction(dialog.action);

  return (
    <div className="admin-dialog-layer">
      <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={onClose} />
      <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="admin-dialog-heading">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={onClose}>
            <span className="material-symbols-rounded" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {dialog.kind === 'detail' ? (
          <ProviderDetail provider={dialog.provider} />
        ) : (
          <form
            className="admin-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              onGovernanceSubmit();
            }}
          >
            <ProviderDetail provider={dialog.provider} compact />
            <label>
              <span>处置原因</span>
              <textarea
                value={governanceInput.reason}
                onChange={(event) => onGovernanceInputChange({ reason: event.target.value })}
                rows={5}
              />
            </label>
            <label>
              <span>管理员 PIN</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4,12}"
                value={governanceInput.secondFactor}
                onChange={(event) => onGovernanceInputChange({ secondFactor: event.target.value })}
              />
            </label>
            <div className="admin-dialog-actions">
              <button className="secondary-action" type="button" onClick={onClose}>
                取消
              </button>
              <button
                className={dialog.action === 'archive' ? 'danger-action' : 'primary-action'}
                type="submit"
                disabled={governanceActionKey === `${dialog.provider.id}:${dialog.action}`}
              >
                {governanceActionKey === `${dialog.provider.id}:${dialog.action}` ? '处理中' : formatProviderGovernanceAction(dialog.action)}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function ProviderDetail({ provider, compact = false }: { provider: AdminProvider; compact?: boolean }) {
  const details = [
    ['名称', provider.name],
    ['标识', provider.slug],
    ['状态', formatProviderStatus(provider.status)],
    ['来源', formatProviderSource(provider.source)],
    ['联系人', provider.contactName ?? '未填写'],
    ['联系邮箱', provider.contactEmail ?? '未填写'],
    ['头像', provider.logoUrl ?? '未设置'],
    ['介绍链接', provider.introductionUrl ?? '未设置'],
    ['创建时间', formatDateTime(provider.createdAt)],
    ['最近更新', formatDateTime(provider.updatedAt)],
  ];

  return (
    <dl className={`admin-detail-list${compact ? ' is-compact' : ''}`}>
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      {provider.businessInfo ? (
        <div>
          <dt>业务说明</dt>
          <dd>{provider.businessInfo}</dd>
        </div>
      ) : null}
      {provider.reviewReason ? (
        <div>
          <dt>审核反馈</dt>
          <dd>{provider.reviewReason}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function isReviewableProvider(status: string): boolean {
  return status === 'PendingReview' || status === 'Rejected';
}

function formatProviderGovernanceAction(action: ProviderGovernanceAction): string {
  const labels: Record<ProviderGovernanceAction, string> = {
    suspend: '停用',
    unsuspend: '启用',
    archive: '归档',
  };

  return labels[action];
}

function formatProviderStatus(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '待审核',
    Active: '已启用',
    Rejected: '已拒绝',
    Suspended: '已停用',
    Archived: '已归档',
  };

  return labels[status] ?? status;
}

function formatProviderSource(source: string): string {
  const labels: Record<string, string> = {
    open_registration: '开放入驻',
    admin_created: '管理员创建',
  };

  return labels[source] ?? source;
}

function formatWebhookChangeStatus(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '待审核',
    Approved: '已通过',
    Rejected: '已拒绝',
  };

  return labels[status] ?? status;
}

function formatWebhookChangeKind(kind: string): string {
  const labels: Record<string, string> = {
    CreateEndpoint: '新增端点',
    UpdateEndpoint: '修改端点',
    RotateSecret: '轮换密钥',
    DeleteEndpoint: '删除端点',
  };

  return labels[kind] ?? kind;
}

function formatWebhookApproveAction(kind: string): string {
  const labels: Record<string, string> = {
    CreateEndpoint: '通过并创建端点',
    UpdateEndpoint: '通过并应用修改',
    RotateSecret: '通过并轮换密钥',
    DeleteEndpoint: '通过并删除端点',
  };

  return labels[kind] ?? '通过';
}

function formatApiKeyChangeStatus(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '待审核',
    Approved: '已通过',
    Rejected: '已拒绝',
  };

  return labels[status] ?? status;
}

function formatApiKeyChangeKind(kind: string): string {
  const labels: Record<string, string> = {
    CreateApiKey: '创建密钥',
    RotateApiKey: '轮换密钥',
    RevokeApiKey: '停用密钥',
  };

  return labels[kind] ?? kind;
}

function formatApiKeyApproveAction(kind: string): string {
  const labels: Record<string, string> = {
    CreateApiKey: '通过并创建密钥',
    RotateApiKey: '通过并轮换密钥',
    RevokeApiKey: '通过并停用密钥',
  };

  return labels[kind] ?? '通过';
}

function formatApiKeyScope(scope: string): string {
  const labels: Record<string, string> = {
    'add_pass_token:create': '生成单个领取码',
    'add_pass_token:batch_create': '批量生成领取码',
    'add_pass_token:read': '读取领取码',
    'add_pass_token:revoke': '撤销领取码',
    'add_pass_token:reissue': '作废并重发领取码',
    'action_links:create': '生成操作链接',
    'action_links:read': '读取操作链接',
    'action_links:revoke': '撤销操作链接',
    'passes:read': '读取卡券',
    'passes:status_update': '冻结/取消卡券',
    'passes:ticket_update': '更新票券字段',
    'ledger:adjust': '调整权益',
    'redemptions:create': '发起核销',
    'redemptions:cancel': '取消核销',
    'redemptions:reverse': '冲正核销',
    'redemptions:read': '读取核销记录',
  };

  return labels[scope] ?? scope;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function readExportError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message === 'string') {
      return payload.message;
    }
  }

  return `导出失败，HTTP ${response.status}`;
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
