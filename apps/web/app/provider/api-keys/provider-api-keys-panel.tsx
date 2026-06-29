'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';
import { BackofficeTopbarPageActions } from '../../backoffice-shell';

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
  const [selectedScopes, setSelectedScopes] = useState<ProviderApiKeyScope[]>([
    'add_pass_token:create',
  ]);
  const [plainApiKey, setPlainApiKey] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [detailApiKey, setDetailApiKey] = useState<ProviderApiKey | null>(null);
  const [detailChangeRequest, setDetailChangeRequest] =
    useState<ProviderApiKeyChangeRequest | null>(null);
  const [rateLimit, setRateLimit] = useState<ApiKeysResponse['rateLimit'] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [claimingRequestId, setClaimingRequestId] = useState<string | null>(null);

  const activeKeys = useMemo(
    () => apiKeys.filter((apiKey) => apiKey.status === 'active'),
    [apiKeys],
  );

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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
      setIsCreateDialogOpen(false);
      formElement.reset();
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
      const result = await postJson<ApiKeyMutationResponse>(
        `/api/providers/api-keys/change-requests/${request.id}/claim-secret`,
      );
      setPlainApiKey(result.plainApiKey ?? null);
      if (result.request) {
        const updatedRequest = result.request;
        setChangeRequests((currentRequests) =>
          currentRequests.map((currentRequest) =>
            currentRequest.id === updatedRequest.id ? updatedRequest : currentRequest,
          ),
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
      await postJson<ApiKeyMutationResponse>(`/api/providers/api-keys/${apiKeyId}/revoke`, {
        reason: reason.trim() || undefined,
      });
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
      await postJson<ApiKeyMutationResponse>(`/api/providers/api-keys/${apiKeyId}/rotate`, {
        reason: reason.trim() || undefined,
      });
      setMessage(
        'API 密钥轮换申请已提交，等待管理员审核。审核通过后可在申请列表一次性查看新密钥。',
      );
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
      <BackofficeTopbarPageActions>
        <div className="admin-list-actions">
          <button
            className="primary-action"
            type="button"
            title="提交申请"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              key
            </span>
            <span>提交申请</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            title="刷新"
            onClick={() => void loadApiKeys()}
            disabled={isLoading}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
        </div>
      </BackofficeTopbarPageActions>
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-api-keys-title">API 密钥</h1>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {plainApiKey ? (
        <div className="admin-dialog-layer">
          <button
            className="admin-dialog-scrim"
            type="button"
            aria-label="关闭弹窗"
            onClick={() => setPlainApiKey(null)}
          />
          <section
            className="admin-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="新 API 密钥"
          >
            <div className="admin-dialog-heading">
              <h2>新密钥只显示一次</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setPlainApiKey(null)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <div className="api-key-secret-panel">
              <code>{plainApiKey}</code>
              <div className="form-actions">
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => void copyPlainApiKey()}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    content_copy
                  </span>
                  <span>复制密钥</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {detailApiKey ? (
        <div className="admin-dialog-layer">
          <button
            className="admin-dialog-scrim"
            type="button"
            aria-label="关闭弹窗"
            onClick={() => setDetailApiKey(null)}
          />
          <section
            className="admin-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="API 密钥详情"
          >
            <div className="admin-dialog-heading">
              <h2>{detailApiKey.name}</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setDetailApiKey(null)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <ApiKeyDetail apiKey={detailApiKey} />
          </section>
        </div>
      ) : null}

      {detailChangeRequest ? (
        <div className="admin-dialog-layer">
          <button
            className="admin-dialog-scrim"
            type="button"
            aria-label="关闭弹窗"
            onClick={() => setDetailChangeRequest(null)}
          />
          <section
            className="admin-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="API 密钥申请详情"
          >
            <div className="admin-dialog-heading">
              <h2>{formatApiKeyChangeKind(detailChangeRequest.kind)}</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setDetailChangeRequest(null)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <ApiKeyChangeRequestDetail request={detailChangeRequest} />
          </section>
        </div>
      ) : null}

      {isCreateDialogOpen ? (
        <div className="admin-dialog-layer">
          <button
            className="admin-dialog-scrim"
            type="button"
            aria-label="关闭弹窗"
            onClick={() => setIsCreateDialogOpen(false)}
          />
          <section
            className="admin-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="提交 API 密钥申请"
          >
            <div className="admin-dialog-heading">
              <h2>提交 API 密钥申请</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setIsCreateDialogOpen(false)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <form className="admin-dialog-form" onSubmit={createApiKey} noValidate>
              <strong>提交 API 密钥申请</strong>
              <span>管理员通过后才会创建密钥；明文密钥只允许查看一次。</span>
              <label>
                <span>密钥名称</span>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="例如：售票系统发放接口"
                />
              </label>
              <label>
                <span>有效天数</span>
                <input
                  name="expiresInDays"
                  type="number"
                  min={1}
                  max={3650}
                  placeholder="留空表示长期有效"
                />
              </label>
              <label>
                <span>申请说明</span>
                <textarea
                  name="reason"
                  maxLength={500}
                  placeholder="说明外部系统名称、用途和为什么需要这些权限"
                />
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
                <button
                  className="primary-action"
                  type="submit"
                  disabled={isSubmitting || isLoading}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    key
                  </span>
                  <span>{isSubmitting ? '提交中' : '提交审核'}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <section className="admin-list-section" aria-labelledby="provider-api-key-requests-title">
        <div className="detail-section-heading">
          <h2 id="provider-api-key-requests-title">密钥变更申请</h2>
          <span>创建、轮换、停用都需要管理员审核</span>
        </div>
        {!isLoading && changeRequests.length === 0 ? (
          <p className="empty-note">暂无 API 密钥变更申请。</p>
        ) : null}
        <div className="admin-list">
          {changeRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>
                  {formatApiKeyChangeKind(request.kind)}：{request.proposed.name}
                </h2>
                <p>
                  状态：{formatApiKeyChangeStatus(request.status)} · 提交时间：
                  {formatDate(request.createdAt)}
                </p>
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setDetailChangeRequest(request)}
                >
                  详情
                </button>
                {request.canClaimPlainApiKey ? (
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
                ) : null}
              </div>
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
                前缀：{apiKey.keyPrefix} · 状态：{formatApiKeyStatus(apiKey.status)} · 最近使用：
                {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : '尚未使用'}
              </p>
            </div>
            <div className="admin-list-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setDetailApiKey(apiKey)}
              >
                详情
              </button>
              {apiKey.status === 'active' ? (
                <>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => void revokeApiKey(apiKey.id)}
                  >
                    申请停用
                  </button>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => void rotateApiKey(apiKey.id)}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">
                      sync
                    </span>
                    <span>申请轮换</span>
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {!isLoading && activeKeys.length > 0 ? (
        <div className="account-summary">
          <strong>开放 API 调用要求</strong>
          <span>
            读取接口使用 Authorization: Bearer 密钥。写接口还需要
            X-LDPass-Timestamp、X-LDPass-Idempotency-Key 和 X-LDPass-Signature。
          </span>
          <span>
            可用接口：生成/查询/撤销/重发领取码、生成操作链接、查询卡券、冻结/解冻/取消卡券、更新票券字段、调整权益、发起核销、取消核销、查询核销记录。
          </span>
          {rateLimit ? (
            <span>
              当前限流：每个密钥、每个权限范围 {rateLimit.windowSeconds} 秒内最多{' '}
              {rateLimit.maxRequests} 次。
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ApiKeyChangeRequestDetail({ request }: { request: ProviderApiKeyChangeRequest }) {
  return (
    <dl className="admin-detail-list">
      <div>
        <dt>名称</dt>
        <dd>{request.proposed.name}</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{formatApiKeyChangeStatus(request.status)}</dd>
      </div>
      <div>
        <dt>目标密钥</dt>
        <dd>{request.targetApiKeyId ?? '新密钥'}</dd>
      </div>
      {request.kind === 'RevokeApiKey' ? null : (
        <>
          <div>
            <dt>权限</dt>
            <dd>{request.proposed.scopes.map((scope) => scopeLabels[scope]).join('、')}</dd>
          </div>
          <div>
            <dt>有效期</dt>
            <dd>
              {request.proposed.expiresAt ? formatDate(request.proposed.expiresAt) : '长期有效'}
            </dd>
          </div>
        </>
      )}
      <div>
        <dt>申请说明</dt>
        <dd>{request.reason || '未填写'}</dd>
      </div>
      <div>
        <dt>审核说明</dt>
        <dd>{request.reviewReason || '暂无'}</dd>
      </div>
      <div>
        <dt>明文查看</dt>
        <dd>
          {request.plainApiKeyViewedAt
            ? formatDate(request.plainApiKeyViewedAt)
            : '尚未查看或不可查看'}
        </dd>
      </div>
      <div>
        <dt>提交人</dt>
        <dd>
          {request.requestedBy
            ? `${request.requestedBy.displayName}（${request.requestedBy.email}）`
            : '未知'}
        </dd>
      </div>
      <div>
        <dt>提交时间</dt>
        <dd>{formatDate(request.createdAt)}</dd>
      </div>
      <div>
        <dt>更新时间</dt>
        <dd>{formatDate(request.updatedAt)}</dd>
      </div>
    </dl>
  );
}

function ApiKeyDetail({ apiKey }: { apiKey: ProviderApiKey }) {
  return (
    <dl className="admin-detail-list">
      <div>
        <dt>前缀</dt>
        <dd>{apiKey.keyPrefix}</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{formatApiKeyStatus(apiKey.status)}</dd>
      </div>
      <div>
        <dt>权限</dt>
        <dd>{apiKey.scopes.map((scope) => scopeLabels[scope]).join('、')}</dd>
      </div>
      <div>
        <dt>有效期</dt>
        <dd>{apiKey.expiresAt ? formatDate(apiKey.expiresAt) : '长期有效'}</dd>
      </div>
      <div>
        <dt>最近使用</dt>
        <dd>{apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : '尚未使用'}</dd>
      </div>
      <div>
        <dt>停用时间</dt>
        <dd>{apiKey.revokedAt ? formatDate(apiKey.revokedAt) : '未停用'}</dd>
      </div>
      <div>
        <dt>创建时间</dt>
        <dd>{formatDate(apiKey.createdAt)}</dd>
      </div>
      <div>
        <dt>更新时间</dt>
        <dd>{formatDate(apiKey.updatedAt)}</dd>
      </div>
    </dl>
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
