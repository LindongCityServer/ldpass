'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

type ProviderApiKeyScope =
  | 'add_pass_token:create'
  | 'add_pass_token:batch_create'
  | 'add_pass_token:read'
  | 'add_pass_token:revoke'
  | 'add_pass_token:reissue'
  | 'action_links:create'
  | 'action_links:read'
  | 'action_links:revoke'
  | 'passes:read'
  | 'passes:status_update'
  | 'passes:ticket_update'
  | 'ledger:adjust'
  | 'redemptions:create'
  | 'redemptions:cancel'
  | 'redemptions:reverse'
  | 'redemptions:read';

interface ProviderApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ProviderApiKeyScope[];
  status: 'active' | 'expired' | 'revoked';
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiKeysResponse {
  apiKeys: ProviderApiKey[];
  changeRequests: ProviderApiKeyChangeRequest[];
  scopes: ProviderApiKeyScope[];
  rateLimit: {
    windowSeconds: number;
    maxRequests: number;
  };
}

interface ApiKeyMutationResponse {
  apiKey?: ProviderApiKey;
  request?: ProviderApiKeyChangeRequest;
  plainApiKey?: string;
}

interface ProviderApiKeyChangeRequest {
  id: string;
  providerId: string;
  status: string;
  kind: string;
  proposed: {
    name: string;
    scopes: ProviderApiKeyScope[];
    expiresAt: string | null;
  };
  reason: string | null;
  targetApiKeyId: string | null;
  requestedBy: {
    email: string;
    displayName: string;
  } | null;
  apiKeyId: string | null;
  canClaimPlainApiKey: boolean;
  plainApiKeyViewedAt: string | null;
  reviewedById: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const scopeLabels: Record<ProviderApiKeyScope, string> = {
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

export function ProviderApiKeysPanel() {
  const [apiKeys, setApiKeys] = useState<ProviderApiKey[]>([]);
  const [changeRequests, setChangeRequests] = useState<ProviderApiKeyChangeRequest[]>([]);
  const [scopes, setScopes] = useState<ProviderApiKeyScope[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<ProviderApiKeyScope[]>(['add_pass_token:create']);
  const [plainApiKey, setPlainApiKey] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<ApiKeysResponse['rateLimit'] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [claimingRequestId, setClaimingRequestId] = useState<string | null>(null);

  const activeKeys = useMemo(() => apiKeys.filter((apiKey) => apiKey.status === 'active'), [apiKeys]);

  const loadApiKeys = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<ApiKeysResponse>('/api/providers/api-keys');
      setApiKeys(result.apiKeys);
      setChangeRequests(result.changeRequests);
      setScopes(result.scopes);
      setRateLimit(result.rateLimit);
      const firstScope = result.scopes[0];
      if (firstScope && selectedScopes.length === 0) {
        setSelectedScopes([firstScope]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 API 密钥失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadApiKeys();
  }, []);

  const toggleScope = (scope: ProviderApiKeyScope, checked: boolean) => {
    setSelectedScopes((currentScopes) => {
      if (checked) {
        return Array.from(new Set([...currentScopes, scope]));
      }

      return currentScopes.filter((currentScope) => currentScope !== scope);
    });
  };

  const createApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '');
    const expiresInDaysRaw = String(form.get('expiresInDays') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();

    if (selectedScopes.length === 0) {
      setMessage('至少需要选择一个 API 权限范围。');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setPlainApiKey(null);

    try {
      const result = await postJson<ApiKeyMutationResponse>('/api/providers/api-keys', {
        name,
        scopes: selectedScopes,
        ...(expiresInDaysRaw ? { expiresInDays: Number.parseInt(expiresInDaysRaw, 10) } : {}),
        reason: reason || undefined,
      });
      setPlainApiKey(result.plainApiKey ?? null);
      setMessage('API 密钥创建申请已提交，等待管理员审核。');
      event.currentTarget.reset();
      setSelectedScopes(['add_pass_token:create']);
      await loadApiKeys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建 API 密钥失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const claimPlainApiKey = async (request: ProviderApiKeyChangeRequest) => {
    setClaimingRequestId(request.id);
    setMessage(null);
    setPlainApiKey(null);

    try {
      const result = await postJson<ApiKeyMutationResponse>(`/api/providers/api-keys/change-requests/${request.id}/claim-secret`);
      setPlainApiKey(result.plainApiKey ?? null);
      if (result.request) {
        const updatedRequest = result.request;
        setChangeRequests((currentRequests) =>
          currentRequests.map((currentRequest) => (currentRequest.id === updatedRequest.id ? updatedRequest : currentRequest)),
        );
      }
      setMessage('API 密钥已显示，请立即复制并保存。');
      await loadApiKeys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 API 密钥失败。');
    } finally {
      setClaimingRequestId(null);
    }
  };

  const revokeApiKey = async (apiKeyId: string) => {
    const reason = window.prompt('请输入停用申请说明，例如外部系统下线或密钥疑似泄露。');
    if (reason === null) {
      return;
    }

    setMessage(null);
    setPlainApiKey(null);

    try {
      await postJson<ApiKeyMutationResponse>(`/api/providers/api-keys/${apiKeyId}/revoke`, { reason: reason.trim() || undefined });
      setMessage('API 密钥停用申请已提交，等待管理员审核。');
      await loadApiKeys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停用 API 密钥失败。');
    }
  };

  const rotateApiKey = async (apiKeyId: string) => {
    const reason = window.prompt('请输入轮换申请说明，例如周期轮换或疑似泄露。');
    if (reason === null) {
      return;
    }

    setMessage(null);
    setPlainApiKey(null);

    try {
      await postJson<ApiKeyMutationResponse>(`/api/providers/api-keys/${apiKeyId}/rotate`, { reason: reason.trim() || undefined });
      setMessage('API 密钥轮换申请已提交，等待管理员审核。审核通过后可在申请列表一次性查看新密钥。');
      await loadApiKeys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '轮换 API 密钥失败。');
    }
  };

  const copyPlainApiKey = async () => {
    if (!plainApiKey) {
      return;
    }

    await navigator.clipboard.writeText(plainApiKey);
    setMessage('已复制 API 密钥。');
  };

  return (
    <section className="admin-panel" aria-labelledby="provider-api-keys-title">
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-api-keys-title">API 密钥</h1>
        </div>
        <div className="admin-list-actions">
          <button className="secondary-action" type="button" onClick={() => void loadApiKeys()} disabled={isLoading}>
            刷新
          </button>
          <a className="secondary-action" href="/provider/dashboard">
            返回工作台
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {plainApiKey ? (
        <div className="account-summary api-key-secret-panel">
          <strong>新密钥只显示一次</strong>
          <code>{plainApiKey}</code>
          <div className="form-actions">
            <button className="primary-action" type="button" onClick={() => void copyPlainApiKey()}>
              <span className="material-symbols-rounded" aria-hidden="true">
                content_copy
              </span>
              <span>复制密钥</span>
            </button>
          </div>
        </div>
      ) : null}

      <form className="stacked-form account-summary" onSubmit={createApiKey} noValidate>
        <strong>提交 API 密钥申请</strong>
        <span>管理员通过后才会创建密钥；明文密钥只允许查看一次。</span>
        <label>
          <span>密钥名称</span>
          <input name="name" required minLength={2} maxLength={80} placeholder="例如：售票系统发放接口" />
        </label>
        <label>
          <span>有效天数</span>
          <input name="expiresInDays" type="number" min={1} max={3650} placeholder="留空表示长期有效" />
        </label>
        <label>
          <span>申请说明</span>
          <textarea name="reason" maxLength={500} placeholder="说明外部系统名称、用途和为什么需要这些权限" />
        </label>
        <div className="api-key-scope-list" aria-label="API 权限范围">
          {scopes.map((scope) => (
            <label className="inline-toggle" key={scope}>
              <input
                type="checkbox"
                checked={selectedScopes.includes(scope)}
                onChange={(event) => toggleScope(scope, event.target.checked)}
              />
              <span>{scopeLabels[scope]}</span>
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={isSubmitting || isLoading}>
            <span className="material-symbols-rounded" aria-hidden="true">
              key
            </span>
            <span>{isSubmitting ? '提交中' : '提交审核'}</span>
          </button>
        </div>
      </form>

      <section className="admin-list-section" aria-labelledby="provider-api-key-requests-title">
        <div className="detail-section-heading">
          <h2 id="provider-api-key-requests-title">密钥变更申请</h2>
          <span>创建、轮换、停用都需要管理员审核</span>
        </div>
        {!isLoading && changeRequests.length === 0 ? <p className="empty-note">暂无 API 密钥变更申请。</p> : null}
        <div className="admin-list">
          {changeRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>{formatApiKeyChangeKind(request.kind)}：{request.proposed.name}</h2>
                <p>
                  状态：{formatApiKeyChangeStatus(request.status)} · 提交时间：{formatDate(request.createdAt)}
                </p>
                {request.targetApiKeyId ? <p>目标密钥：{request.targetApiKeyId}</p> : null}
                {request.kind === 'RevokeApiKey' ? null : <p>权限：{request.proposed.scopes.map((scope) => scopeLabels[scope]).join('、')}</p>}
                {request.kind === 'RevokeApiKey' ? null : <p>有效期：{request.proposed.expiresAt ? formatDate(request.proposed.expiresAt) : '长期有效'}</p>}
                {request.reason ? <p>申请说明：{request.reason}</p> : null}
                {request.reviewReason ? <p>审核说明：{request.reviewReason}</p> : null}
                {request.plainApiKeyViewedAt ? <p>明文密钥已于 {formatDate(request.plainApiKeyViewedAt)} 查看。</p> : null}
              </div>
              {request.canClaimPlainApiKey ? (
                <div className="admin-list-actions">
                  <button
                    className="primary-action"
                    type="button"
                    disabled={claimingRequestId === request.id}
                    onClick={() => void claimPlainApiKey(request)}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">
                      key
                    </span>
                    <span>{claimingRequestId === request.id ? '读取中' : '查看 API 密钥'}</span>
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {isLoading ? <p className="empty-note">正在读取 API 密钥。</p> : null}
      {!isLoading && apiKeys.length === 0 ? <p className="empty-note">暂无 API 密钥。</p> : null}

      <div className="admin-list">
        {apiKeys.map((apiKey) => (
          <article className="admin-list-item" key={apiKey.id}>
            <div>
              <h2>{apiKey.name}</h2>
              <p>
                前缀：{apiKey.keyPrefix} · 状态：{formatApiKeyStatus(apiKey.status)} · 创建时间：
                {new Date(apiKey.createdAt).toLocaleString('zh-CN')}
              </p>
              <p>权限：{apiKey.scopes.map((scope) => scopeLabels[scope]).join('、')}</p>
              <p>
                有效期：{apiKey.expiresAt ? new Date(apiKey.expiresAt).toLocaleString('zh-CN') : '长期有效'} · 最近使用：
                {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString('zh-CN') : '尚未使用'}
              </p>
            </div>
            {apiKey.status === 'active' ? (
              <div className="admin-list-actions">
                <button className="secondary-action" type="button" onClick={() => void revokeApiKey(apiKey.id)}>
                  申请停用
                </button>
                <button className="primary-action" type="button" onClick={() => void rotateApiKey(apiKey.id)}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    sync
                  </span>
                  <span>申请轮换</span>
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {!isLoading && activeKeys.length > 0 ? (
        <div className="account-summary">
          <strong>开放 API 调用要求</strong>
          <span>读取接口使用 Authorization: Bearer 密钥。写接口还需要 X-LDPass-Timestamp、X-LDPass-Idempotency-Key 和 X-LDPass-Signature。</span>
          <span>可用接口：生成/查询/撤销/重发领取码、生成操作链接、查询卡券、冻结/解冻/取消卡券、更新票券字段、调整权益、发起核销、取消核销、查询核销记录。</span>
          {rateLimit ? <span>当前限流：每个密钥、每个权限范围 {rateLimit.windowSeconds} 秒内最多 {rateLimit.maxRequests} 次。</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function formatApiKeyStatus(status: ProviderApiKey['status']): string {
  const labels: Record<ProviderApiKey['status'], string> = {
    active: '启用中',
    expired: '已过期',
    revoked: '已停用',
  };

  return labels[status];
}

function formatApiKeyChangeStatus(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '待管理员审核',
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

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}
