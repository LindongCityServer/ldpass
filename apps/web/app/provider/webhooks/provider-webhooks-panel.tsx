'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

type ProviderWebhookEventType =
  | 'PassIssued'
  | 'PassAddedToWallet'
  | 'AddPassTokenRevoked'
  | 'AddPassTokenReissued'
  | 'WalletActionLinkCreated'
  | 'WalletActionLinkConsumed'
  | 'WalletActionLinkExpired'
  | 'WalletActionLinkRevoked'
  | 'PassTopUpRequested'
  | 'PassTopUpSucceeded'
  | 'PassTopUpFailed'
  | 'PassTopUpExpired'
  | 'PassTopUpCancelled'
  | 'PassTopUpReversed'
  | 'PassTransferRequested'
  | 'PassTransferAccepted'
  | 'PassTransferRejected'
  | 'PassTransferCancelled'
  | 'PassBalanceChanged'
  | 'PassTicketStatusUpdated'
  | 'PassTicketUpdateSubmitted'
  | 'PassTicketUpdateApproved'
  | 'PassTicketUpdateRejected'
  | 'PassUseRequested'
  | 'PassUseSucceeded'
  | 'PassUseFailed'
  | 'PassUseCancelled'
  | 'PassFrozen'
  | 'PassUnfrozen'
  | 'PassDeleted'
  | 'DisputeStatusChanged';

interface ProviderWebhookEndpoint {
  id: string;
  name: string;
  url: string;
  eventTypes: ProviderWebhookEventType[];
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderWebhooksResponse {
  endpoints: ProviderWebhookEndpoint[];
  changeRequests: ProviderWebhookChangeRequest[];
  eventTypes: ProviderWebhookEventType[];
}

interface ProviderWebhookMutationResponse {
  endpoint?: ProviderWebhookEndpoint;
  request?: ProviderWebhookChangeRequest;
  signingSecret?: string;
}

interface ProviderWebhookChangeRequest {
  id: string;
  providerId: string;
  status: string;
  kind: string;
  proposed: {
    name: string;
    url: string;
    eventTypes: ProviderWebhookEventType[];
    enabled: boolean;
  };
  reason: string | null;
  requestedBy: {
    email: string;
    displayName: string;
  } | null;
  endpointId: string | null;
  canClaimSigningSecret: boolean;
  signingSecretViewedAt: string | null;
  reviewedById: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderWebhookDelivery {
  id: string;
  endpointId: string;
  outboxEventId: string;
  eventType: ProviderWebhookEventType | string;
  eventCreatedAt: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  responseStatus: number | null;
  error: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderWebhookDeliveriesResponse {
  deliveries: ProviderWebhookDelivery[];
}

interface ProviderWebhookDeliveryMutationResponse {
  delivery: ProviderWebhookDelivery;
}

const eventLabels: Record<ProviderWebhookEventType, string> = {
  PassIssued: '卡券已发放',
  PassAddedToWallet: '卡券已领取',
  AddPassTokenRevoked: '领取码已撤销',
  AddPassTokenReissued: '领取码已重发',
  WalletActionLinkCreated: '操作链接已生成',
  WalletActionLinkConsumed: '操作链接已使用',
  WalletActionLinkExpired: '操作链接已过期',
  WalletActionLinkRevoked: '操作链接已撤销',
  PassTopUpRequested: '额度补充已发起',
  PassTopUpSucceeded: '额度补充成功',
  PassTopUpFailed: '额度补充失败',
  PassTopUpExpired: '额度补充已过期',
  PassTopUpCancelled: '额度补充已取消',
  PassTopUpReversed: '额度补充已冲正',
  PassTransferRequested: '转赠已发起',
  PassTransferAccepted: '转赠已接收',
  PassTransferRejected: '转赠已拒绝',
  PassTransferCancelled: '转赠已取消',
  PassBalanceChanged: '权益已变化',
  PassTicketStatusUpdated: '票券字段已更新',
  PassTicketUpdateSubmitted: '票券变更待审核',
  PassTicketUpdateApproved: '票券变更已通过',
  PassTicketUpdateRejected: '票券变更已拒绝',
  PassUseRequested: '核销已发起',
  PassUseSucceeded: '核销已成功',
  PassUseFailed: '核销已失败',
  PassUseCancelled: '核销已取消',
  PassFrozen: '卡券已冻结',
  PassUnfrozen: '卡券已解冻',
  PassDeleted: '卡券已取消',
  DisputeStatusChanged: '争议状态变化',
};

export function ProviderWebhooksPanel() {
  const [endpoints, setEndpoints] = useState<ProviderWebhookEndpoint[]>([]);
  const [changeRequests, setChangeRequests] = useState<ProviderWebhookChangeRequest[]>([]);
  const [eventTypes, setEventTypes] = useState<ProviderWebhookEventType[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<ProviderWebhookEventType[]>([]);
  const [signingSecret, setSigningSecret] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutatingEndpointId, setMutatingEndpointId] = useState<string | null>(null);
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);
  const [detailEndpoint, setDetailEndpoint] = useState<ProviderWebhookEndpoint | null>(null);
  const [detailChangeRequest, setDetailChangeRequest] = useState<ProviderWebhookChangeRequest | null>(null);
  const [editingEventTypes, setEditingEventTypes] = useState<ProviderWebhookEventType[]>([]);
  const [expandedEndpointId, setExpandedEndpointId] = useState<string | null>(null);
  const [claimingRequestId, setClaimingRequestId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<ProviderWebhookDelivery[]>([]);
  const [isLoadingDeliveries, setIsLoadingDeliveries] = useState(false);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);

  const defaultSelectedEvents = useMemo(() => eventTypes.slice(0, 4), [eventTypes]);
  const editingEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === editingEndpointId) ?? null,
    [editingEndpointId, endpoints],
  );

  const loadEndpoints = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<ProviderWebhooksResponse>('/api/providers/webhooks');
      setEndpoints(result.endpoints);
      setChangeRequests(result.changeRequests);
      setEventTypes(result.eventTypes);
      setSelectedEventTypes((currentTypes) => (currentTypes.length ? currentTypes : result.eventTypes.slice(0, 4)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 Webhook 端点失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadEndpoints();
  }, []);

  const toggleEventType = (eventType: ProviderWebhookEventType, checked: boolean) => {
    setSelectedEventTypes((currentTypes) => {
      if (checked) {
        return Array.from(new Set([...currentTypes, eventType]));
      }

      return currentTypes.filter((currentType) => currentType !== eventType);
    });
  };

  const toggleEditingEventType = (eventType: ProviderWebhookEventType, checked: boolean) => {
    setEditingEventTypes((currentTypes) => {
      if (checked) {
        return Array.from(new Set([...currentTypes, eventType]));
      }

      return currentTypes.filter((currentType) => currentType !== eventType);
    });
  };

  const startEditingEndpoint = (endpoint: ProviderWebhookEndpoint) => {
    setEditingEndpointId(endpoint.id);
    setEditingEventTypes(endpoint.eventTypes);
    setMessage(null);
  };

  const cancelEditingEndpoint = () => {
    setEditingEndpointId(null);
    setEditingEventTypes([]);
  };

  const createEndpoint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') ?? '').trim();
    const url = String(form.get('url') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();

    if (selectedEventTypes.length === 0) {
      setMessage('至少选择一个要回调的事件。');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setSigningSecret(null);

    try {
      const result = await postJson<ProviderWebhookMutationResponse>('/api/providers/webhooks', {
        name,
        url,
        eventTypes: selectedEventTypes,
        enabled: true,
        reason: reason || undefined,
      });
      setSigningSecret(result.signingSecret ?? null);
      formElement.reset();
      setIsCreateDialogOpen(false);
      setSelectedEventTypes(defaultSelectedEvents);
      await loadEndpoints();
      setMessage('Webhook 端点创建申请已提交，等待管理员审核。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建 Webhook 端点失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const claimSigningSecret = async (request: ProviderWebhookChangeRequest) => {
    setClaimingRequestId(request.id);
    setMessage(null);
    setSigningSecret(null);

    try {
      const result = await postJson<ProviderWebhookMutationResponse>(`/api/providers/webhooks/change-requests/${request.id}/claim-secret`);
      setSigningSecret(result.signingSecret ?? null);
      if (result.request) {
        const updatedRequest = result.request;
        setChangeRequests((currentRequests) =>
          currentRequests.map((currentRequest) => (currentRequest.id === updatedRequest.id ? updatedRequest : currentRequest)),
        );
      }
      setMessage('Webhook 签名密钥已显示，请立即复制。');
      await loadEndpoints();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 Webhook 签名密钥失败。');
    } finally {
      setClaimingRequestId(null);
    }
  };

  const updateEndpointEnabled = async (endpoint: ProviderWebhookEndpoint, enabled: boolean) => {
    const reason = window.prompt(`请输入${enabled ? '启用' : '停用'}这个 Webhook 端点的申请说明`, `${enabled ? '启用' : '停用'}回调端点`);
    if (reason === null) {
      return;
    }

    setMutatingEndpointId(endpoint.id);
    setMessage(null);

    try {
      await postJson<ProviderWebhookMutationResponse>(`/api/providers/webhooks/${endpoint.id}`, {
        name: endpoint.name,
        url: endpoint.url,
        eventTypes: endpoint.eventTypes,
        enabled,
        reason: reason.trim() || undefined,
      });
      await loadEndpoints();
      setMessage(enabled ? 'Webhook 端点启用申请已提交，等待管理员审核。' : 'Webhook 端点停用申请已提交，等待管理员审核。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交 Webhook 端点变更申请失败。');
    } finally {
      setMutatingEndpointId(null);
    }
  };

  const submitEndpointUpdate = async (event: FormEvent<HTMLFormElement>, endpoint: ProviderWebhookEndpoint) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const url = String(form.get('url') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();
    const enabled = form.get('enabled') === 'on';

    if (editingEventTypes.length === 0) {
      setMessage('至少选择一个要回调的事件。');
      return;
    }

    setMutatingEndpointId(endpoint.id);
    setMessage(null);

    try {
      await postJson<ProviderWebhookMutationResponse>(`/api/providers/webhooks/${endpoint.id}`, {
        name,
        url,
        eventTypes: editingEventTypes,
        enabled,
        reason: reason || undefined,
      });
      cancelEditingEndpoint();
      await loadEndpoints();
      setMessage('Webhook 端点修改申请已提交，等待管理员审核。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交 Webhook 端点修改申请失败。');
    } finally {
      setMutatingEndpointId(null);
    }
  };

  const rotateSecret = async (endpoint: ProviderWebhookEndpoint) => {
    const reason = window.prompt('请输入轮换这个 Webhook 签名密钥的申请说明', '轮换回调签名密钥');
    if (reason === null) {
      return;
    }

    setMutatingEndpointId(endpoint.id);
    setMessage(null);
    setSigningSecret(null);

    try {
      const result = await postJson<ProviderWebhookMutationResponse>(`/api/providers/webhooks/${endpoint.id}/rotate-secret`, {
        reason: reason.trim() || undefined,
      });
      setSigningSecret(result.signingSecret ?? null);
      await loadEndpoints();
      setMessage('Webhook 签名密钥轮换申请已提交，管理员通过后可一次性查看新密钥。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交 Webhook 签名密钥轮换申请失败。');
    } finally {
      setMutatingEndpointId(null);
    }
  };

  const deleteEndpoint = async (endpoint: ProviderWebhookEndpoint) => {
    const reason = window.prompt(`请输入删除「${endpoint.name}」Webhook 端点的申请说明`, '删除不再使用的回调端点');
    if (reason === null) {
      return;
    }

    setMutatingEndpointId(endpoint.id);
    setMessage(null);
    setSigningSecret(null);

    try {
      await postJson(`/api/providers/webhooks/${endpoint.id}/delete`, {
        reason: reason.trim() || undefined,
      });
      await loadEndpoints();
      setMessage('Webhook 端点删除申请已提交，等待管理员审核。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交 Webhook 端点删除申请失败。');
    } finally {
      setMutatingEndpointId(null);
    }
  };

  const copySigningSecret = async () => {
    if (!signingSecret) {
      return;
    }

    await navigator.clipboard.writeText(signingSecret);
    setMessage('已复制 Webhook 签名密钥。');
  };

  const loadDeliveries = async (endpoint: ProviderWebhookEndpoint) => {
    setExpandedEndpointId(endpoint.id);
    setIsLoadingDeliveries(true);
    setMessage(null);

    try {
      const result = await getJson<ProviderWebhookDeliveriesResponse>(`/api/providers/webhooks/${endpoint.id}/deliveries?take=20`);
      setDeliveries(result.deliveries);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 Webhook 投递记录失败。');
    } finally {
      setIsLoadingDeliveries(false);
    }
  };

  const toggleDeliveries = async (endpoint: ProviderWebhookEndpoint) => {
    if (expandedEndpointId === endpoint.id) {
      setExpandedEndpointId(null);
      setDeliveries([]);
      return;
    }

    await loadDeliveries(endpoint);
  };

  const retryDelivery = async (delivery: ProviderWebhookDelivery) => {
    setRetryingDeliveryId(delivery.id);
    setMessage(null);

    try {
      const result = await postJson<ProviderWebhookDeliveryMutationResponse>(`/api/providers/webhooks/deliveries/${delivery.id}/retry`);
      setDeliveries((currentDeliveries) =>
        currentDeliveries.map((currentDelivery) => (currentDelivery.id === result.delivery.id ? result.delivery : currentDelivery)),
      );
      setMessage('Webhook 投递已重新排队。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重新排队 Webhook 投递失败。');
    } finally {
      setRetryingDeliveryId(null);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="provider-webhooks-title">
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-webhooks-title">Webhook 回调</h1>
        </div>
        <div className="admin-list-actions">
          <button className="primary-action" type="button" onClick={() => setIsCreateDialogOpen(true)}>
            <span className="material-symbols-rounded" aria-hidden="true">
              webhook
            </span>
            <span>提交端点</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => void loadEndpoints()} disabled={isLoading}>
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

      {signingSecret ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setSigningSecret(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="Webhook 签名密钥">
            <div className="admin-dialog-heading">
              <h2>签名密钥只显示一次</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setSigningSecret(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <div className="api-key-secret-panel">
              <code>{signingSecret}</code>
              <div className="form-actions">
                <button className="primary-action" type="button" onClick={() => void copySigningSecret()}>
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

      {detailEndpoint ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setDetailEndpoint(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="Webhook 端点详情">
            <div className="admin-dialog-heading">
              <h2>{detailEndpoint.name}</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setDetailEndpoint(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <WebhookEndpointDetail endpoint={detailEndpoint} />
          </section>
        </div>
      ) : null}

      {detailChangeRequest ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setDetailChangeRequest(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="Webhook 配置申请详情">
            <div className="admin-dialog-heading">
              <h2>{formatWebhookChangeKind(detailChangeRequest.kind)}</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setDetailChangeRequest(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <WebhookChangeRequestDetail request={detailChangeRequest} />
          </section>
        </div>
      ) : null}

      {editingEndpoint ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={cancelEditingEndpoint} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="修改 Webhook 配置">
            <div className="admin-dialog-heading">
              <h2>修改 Webhook 配置</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={cancelEditingEndpoint}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <form className="admin-dialog-form" onSubmit={(event) => void submitEndpointUpdate(event, editingEndpoint)} noValidate>
              <label>
                <span>名称</span>
                <input name="name" defaultValue={editingEndpoint.name} required minLength={2} maxLength={80} />
              </label>
              <label>
                <span>回调地址</span>
                <input name="url" type="url" defaultValue={editingEndpoint.url} required maxLength={1000} />
              </label>
              <label className="inline-toggle">
                <input name="enabled" type="checkbox" defaultChecked={editingEndpoint.enabled} />
                <span>通过后启用端点</span>
              </label>
              <label>
                <span>申请说明</span>
                <textarea name="reason" maxLength={500} placeholder="说明修改原因、接入系统或事件范围变化" />
              </label>
              <div className="api-key-scope-list" aria-label="修改后的回调事件">
                {eventTypes.map((eventType) => (
                  <label className="inline-toggle" key={eventType}>
                    <input
                      type="checkbox"
                      checked={editingEventTypes.includes(eventType)}
                      onChange={(event) => toggleEditingEventType(eventType, event.target.checked)}
                    />
                    <span>{eventLabels[eventType]}</span>
                  </label>
                ))}
              </div>
              <div className="admin-dialog-actions">
                <button className="secondary-action" type="button" onClick={cancelEditingEndpoint}>
                  取消
                </button>
                <button className="primary-action" type="submit" disabled={mutatingEndpointId === editingEndpoint.id}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    edit
                  </span>
                  <span>{mutatingEndpointId === editingEndpoint.id ? '提交中' : '提交修改申请'}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isCreateDialogOpen ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="提交回调端点申请">
            <div className="admin-dialog-heading">
              <h2>提交回调端点申请</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
      <form className="admin-dialog-form" onSubmit={createEndpoint} noValidate>
        <strong>提交回调端点申请</strong>
        <span>管理员通过后才会创建端点；签名密钥只允许查看一次。</span>
        <label>
          <span>名称</span>
          <input name="name" required minLength={2} maxLength={80} placeholder="例如：售票系统事件接收器" />
        </label>
        <label>
          <span>回调地址</span>
          <input name="url" type="url" required maxLength={1000} placeholder="https://example.com/ldpass/webhook" />
        </label>
        <label>
          <span>申请说明</span>
          <textarea name="reason" maxLength={500} placeholder="说明这个端点会接入哪个系统、用于哪些业务场景" />
        </label>
        <div className="api-key-scope-list" aria-label="回调事件">
          {eventTypes.map((eventType) => (
            <label className="inline-toggle" key={eventType}>
              <input
                type="checkbox"
                checked={selectedEventTypes.includes(eventType)}
                onChange={(event) => toggleEventType(eventType, event.target.checked)}
              />
              <span>{eventLabels[eventType]}</span>
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={isSubmitting || isLoading}>
            <span className="material-symbols-rounded" aria-hidden="true">
              webhook
            </span>
            <span>{isSubmitting ? '提交中' : '提交审核'}</span>
          </button>
        </div>
      </form>
          </section>
        </div>
      ) : null}

      <section className="admin-list-section" aria-labelledby="provider-webhook-requests-title">
        <div className="detail-section-heading">
          <h2 id="provider-webhook-requests-title">配置申请</h2>
          <span>管理员通过后端点才会生效</span>
        </div>
        {!isLoading && changeRequests.length === 0 ? <p className="empty-note">暂无 Webhook 配置申请。</p> : null}
        <div className="admin-list">
          {changeRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>{formatWebhookChangeKind(request.kind)}：{request.proposed.name}</h2>
                <p>
                  {formatWebhookChangeStatus(request.status)} · 提交时间：{formatDate(request.createdAt)}
                </p>
              </div>
              <div className="admin-list-actions">
                <button className="secondary-action" type="button" onClick={() => setDetailChangeRequest(request)}>
                  详情
                </button>
                {request.canClaimSigningSecret ? (
                  <button
                    className="primary-action"
                    type="button"
                    disabled={claimingRequestId === request.id}
                    onClick={() => void claimSigningSecret(request)}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">
                      key
                    </span>
                    <span>{claimingRequestId === request.id ? '读取中' : '查看签名密钥'}</span>
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {isLoading ? <p className="empty-note">正在读取 Webhook 端点。</p> : null}
      {!isLoading && endpoints.length === 0 ? <p className="empty-note">暂无 Webhook 端点。</p> : null}

      <div className="admin-list">
        {endpoints.map((endpoint) => (
          <article className="admin-list-item" key={endpoint.id}>
            <div>
              <h2>{endpoint.name}</h2>
              <p>
                {endpoint.enabled ? '启用中' : '已停用'} · 事件 {endpoint.eventTypes.length} 个 · 最近成功：
                {formatDate(endpoint.lastSuccessAt)}
              </p>
            </div>
            <div className="admin-list-actions">
              <button className="secondary-action" type="button" onClick={() => setDetailEndpoint(endpoint)}>
                详情
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={mutatingEndpointId === endpoint.id}
                onClick={() => void toggleDeliveries(endpoint)}
              >
                {expandedEndpointId === endpoint.id ? '收起记录' : '投递记录'}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={mutatingEndpointId === endpoint.id}
                onClick={() => startEditingEndpoint(endpoint)}
              >
                修改配置
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={mutatingEndpointId === endpoint.id}
                onClick={() => void updateEndpointEnabled(endpoint, !endpoint.enabled)}
              >
                {endpoint.enabled ? '停用' : '启用'}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={mutatingEndpointId === endpoint.id}
                onClick={() => void rotateSecret(endpoint)}
              >
                轮换密钥
              </button>
              <button
                className="danger-action"
                type="button"
                disabled={mutatingEndpointId === endpoint.id}
                onClick={() => void deleteEndpoint(endpoint)}
              >
                删除
              </button>
            </div>
            {expandedEndpointId === endpoint.id ? (
              <section className="stacked-form-subsection webhook-delivery-panel" aria-label={`${endpoint.name} 投递记录`}>
                <div className="detail-section-heading">
                  <h3>最近投递</h3>
                  <button className="secondary-action" type="button" disabled={isLoadingDeliveries} onClick={() => void loadDeliveries(endpoint)}>
                    刷新
                  </button>
                </div>
                {isLoadingDeliveries ? <p className="detail-status">正在读取投递记录。</p> : null}
                {!isLoadingDeliveries && deliveries.length === 0 ? <p className="detail-status">暂无投递记录。</p> : null}
                {deliveries.length ? (
                  <ol className="webhook-delivery-list">
                    {deliveries.map((delivery) => {
                      const eventLabel = isKnownEventType(delivery.eventType) ? eventLabels[delivery.eventType] : delivery.eventType;
                      const canRetry = delivery.status !== 'Delivered';

                      return (
                        <li key={delivery.id}>
                          <div>
                            <strong>
                              {eventLabel} · {formatDeliveryStatus(delivery.status)}
                            </strong>
                            <span>
                              尝试 {delivery.attemptCount} 次 · HTTP {delivery.responseStatus ?? '暂无'} · 事件时间：
                              {formatDate(delivery.eventCreatedAt)}
                            </span>
                            <small>
                              最近尝试：{formatDate(delivery.lastAttemptAt)} · 下次尝试：{formatDate(delivery.nextAttemptAt)}
                            </small>
                            {delivery.error ? <small>错误：{delivery.error}</small> : null}
                          </div>
                          {canRetry ? (
                            <button
                              className="secondary-action"
                              type="button"
                              disabled={retryingDeliveryId === delivery.id}
                              onClick={() => void retryDelivery(delivery)}
                            >
                              {retryingDeliveryId === delivery.id ? '排队中' : '重试'}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </section>
            ) : null}
          </article>
        ))}
      </div>

      <div className="account-summary">
        <strong>签名验证</strong>
        <span>
          签名内容为 <code>X-LDPass-Timestamp</code>、换行符和原始 JSON 请求体。
        </span>
        <span>
          使用签名密钥计算 HMAC-SHA256，和 <code>X-LDPass-Signature</code> 的 <code>v1=</code> 后半段比较。
        </span>
      </div>
    </section>
  );
}

function WebhookEndpointDetail({ endpoint }: { endpoint: ProviderWebhookEndpoint }) {
  return (
    <dl className="admin-detail-list">
      <div>
        <dt>状态</dt>
        <dd>{endpoint.enabled ? '启用中' : '已停用'}</dd>
      </div>
      <div>
        <dt>回调地址</dt>
        <dd>{endpoint.url}</dd>
      </div>
      <div>
        <dt>事件</dt>
        <dd>{endpoint.eventTypes.map((eventType) => eventLabels[eventType]).join('、')}</dd>
      </div>
      <div>
        <dt>最近成功</dt>
        <dd>{formatDate(endpoint.lastSuccessAt)}</dd>
      </div>
      <div>
        <dt>最近失败</dt>
        <dd>{formatDate(endpoint.lastFailureAt)}</dd>
      </div>
      <div>
        <dt>最近错误</dt>
        <dd>{endpoint.lastError ?? '暂无'}</dd>
      </div>
      <div>
        <dt>创建时间</dt>
        <dd>{formatDate(endpoint.createdAt)}</dd>
      </div>
      <div>
        <dt>更新时间</dt>
        <dd>{formatDate(endpoint.updatedAt)}</dd>
      </div>
    </dl>
  );
}

function WebhookChangeRequestDetail({ request }: { request: ProviderWebhookChangeRequest }) {
  return (
    <dl className="admin-detail-list">
      <div>
        <dt>名称</dt>
        <dd>{request.proposed.name}</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{formatWebhookChangeStatus(request.status)}</dd>
      </div>
      <div>
        <dt>回调地址</dt>
        <dd>{request.proposed.url}</dd>
      </div>
      <div>
        <dt>事件</dt>
        <dd>{request.proposed.eventTypes.map((eventType) => eventLabels[eventType]).join('、')}</dd>
      </div>
      <div>
        <dt>目标端点</dt>
        <dd>{request.endpointId ?? '新端点'}</dd>
      </div>
      <div>
        <dt>通过后状态</dt>
        <dd>{request.proposed.enabled ? '启用' : '停用'}</dd>
      </div>
      <div>
        <dt>申请说明</dt>
        <dd>{request.reason || '未填写'}</dd>
      </div>
      <div>
        <dt>审核说明</dt>
        <dd>{request.reviewReason || '暂无'}</dd>
      </div>
      <div>
        <dt>签名密钥</dt>
        <dd>{request.signingSecretViewedAt ? `已于 ${formatDate(request.signingSecretViewedAt)} 查看` : '尚未查看或不可查看'}</dd>
      </div>
      <div>
        <dt>提交人</dt>
        <dd>{request.requestedBy ? `${request.requestedBy.displayName}（${request.requestedBy.email}）` : '未知'}</dd>
      </div>
      <div>
        <dt>提交时间</dt>
        <dd>{formatDate(request.createdAt)}</dd>
      </div>
      <div>
        <dt>审核时间</dt>
        <dd>{formatDate(request.reviewedAt)}</dd>
      </div>
      <div>
        <dt>更新时间</dt>
        <dd>{formatDate(request.updatedAt)}</dd>
      </div>
    </dl>
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return '暂无';
  }

  return new Date(value).toLocaleString('zh-CN');
}

function isKnownEventType(value: string): value is ProviderWebhookEventType {
  return value in eventLabels;
}

function formatDeliveryStatus(value: string): string {
  const labels: Record<string, string> = {
    Pending: '等待投递',
    Failed: '投递失败',
    Delivered: '已送达',
    Abandoned: '已放弃',
  };

  return labels[value] ?? value;
}

function formatWebhookChangeStatus(value: string): string {
  const labels: Record<string, string> = {
    PendingReview: '待管理员审核',
    Approved: '已通过',
    Rejected: '已拒绝',
  };

  return labels[value] ?? value;
}

function formatWebhookChangeKind(value: string): string {
  const labels: Record<string, string> = {
    CreateEndpoint: '新增端点',
    UpdateEndpoint: '修改端点',
    RotateSecret: '轮换密钥',
    DeleteEndpoint: '删除端点',
  };

  return labels[value] ?? value;
}
