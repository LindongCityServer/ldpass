'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';
import { ClaimLinkTools } from '../../claim-link-tools';

interface IssuableTemplate {
  id: string;
  displayName: string;
  category: string;
  benefitType: string;
  activeVersionId: string;
  title: string;
  rules: unknown;
  updatedAt: string;
}

interface IssuableTemplatesResponse {
  templates: IssuableTemplate[];
}

interface CreateProviderTokenResponse {
  claimCode: string;
  claimPath: string;
  expiresAt: string;
  passExpiresAt: string | null;
  passId: string;
  publicNumber: string | null;
  maskedNumber: string | null;
  templateId: string;
}

interface CreateProviderTokenBatchResponse {
  issueBatchId: string;
  total: number;
  tokens: CreateProviderTokenResponse[];
}

interface ProviderAddPassTokenSummary {
  id: string;
  maskedClaimCode: string | null;
  providerName: string;
  templateName: string;
  category: string;
  benefitType: string;
  passId: string | null;
  publicNumber: string | null;
  maskedNumber: string | null;
  status: string;
  requireServerVerifiedUser: boolean;
  expiresAt: string;
  claimedAt: string | null;
  claimedByUser: {
    id: string;
    username: string;
    email: string;
  } | null;
  createdAt: string;
}

interface ProviderAddPassTokensResponse {
  tokens: ProviderAddPassTokenSummary[];
}

interface RevokeProviderAddPassTokenResponse {
  token: ProviderAddPassTokenSummary;
}

interface ReissueProviderAddPassTokenResponse extends CreateProviderTokenResponse {
  token: ProviderAddPassTokenSummary;
  revokedToken: ProviderAddPassTokenSummary;
}

type IssueMode = 'single' | 'batch';
type TokenStatusFilter = 'all' | 'Active' | 'Claimed' | 'Expired' | 'Revoked';

type IssueResult =
  | {
      mode: 'single';
      token: CreateProviderTokenResponse;
    }
  | {
      mode: 'batch';
      issueBatchId: string;
      total: number;
      tokens: CreateProviderTokenResponse[];
    };

const categoryLabels: Record<string, string> = {
  account: '账户/卡',
  identity_key: '证件/钥匙',
  ticket: '票券',
};

const benefitLabels: Record<string, string> = {
  amount: '金额',
  points: '积分',
  times: '次数',
};

const statusLabels: Record<string, string> = {
  Active: '可领取',
  Claimed: '已领取',
  Expired: '已过期',
  Revoked: '已撤销',
};

export function ProviderIssuePanel() {
  const [templates, setTemplates] = useState<IssuableTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [issueMode, setIssueMode] = useState<IssueMode>('single');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<IssueResult | null>(null);
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [detailToken, setDetailToken] = useState<ProviderAddPassTokenSummary | null>(null);
  const [tokens, setTokens] = useState<ProviderAddPassTokenSummary[]>([]);
  const [tokenKeyword, setTokenKeyword] = useState('');
  const [tokenStatusFilter, setTokenStatusFilter] = useState<TokenStatusFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [reissuingTokenId, setReissuingTokenId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  const selectedTemplate = useMemo(() => {
    return templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null;
  }, [selectedTemplateId, templates]);

  const claimLink = result?.mode === 'single' && origin ? `${origin}${result.token.claimPath}` : null;

  const loadTemplates = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await getJson<IssuableTemplatesResponse>('/api/provider/issuing/templates');
      setTemplates(response.templates);
      setSelectedTemplateId((currentTemplateId) => {
        if (response.templates.some((template) => template.id === currentTemplateId)) {
          return currentTemplateId;
        }

        return response.templates[0]?.id ?? '';
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取可发放模板失败。');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTokens = async (nextKeyword = tokenKeyword, nextStatus = tokenStatusFilter) => {
    setIsLoadingTokens(true);

    try {
      const search = new URLSearchParams({
        take: '50',
      });
      const trimmedKeyword = nextKeyword.trim();
      if (trimmedKeyword) {
        search.set('keyword', trimmedKeyword);
      }
      if (nextStatus !== 'all') {
        search.set('status', nextStatus);
      }

      const response = await getJson<ProviderAddPassTokensResponse>(`/api/provider/issuing/add-pass-tokens?${search.toString()}`);
      setTokens(response.tokens);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取领取码列表失败。');
    } finally {
      setIsLoadingTokens(false);
    }
  };

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadTemplates();
    void loadTokens('', 'all');
    // 首屏加载一次，筛选由表单按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    setResult(null);
    setIsSubmitting(true);

    try {
      const passExpiresInDays = String(form.get('passExpiresInDays') ?? '').trim();
      const payload = {
        templateId: String(form.get('templateId') ?? ''),
        initialValue: String(form.get('initialValue') ?? ''),
        expiresInDays: Number(form.get('expiresInDays') ?? 30),
        ...(passExpiresInDays ? { passExpiresInDays: Number(passExpiresInDays) } : {}),
        requireServerVerifiedUser: form.get('requireServerVerifiedUser') === 'on',
        ...(selectedTemplate?.category === 'ticket'
          ? {
              ticketEventName: String(form.get('ticketEventName') ?? ''),
              ticketVenue: String(form.get('ticketVenue') ?? ''),
              ticketStartsAt: String(form.get('ticketStartsAt') ?? ''),
              ticketSeatLabel: String(form.get('ticketSeatLabel') ?? ''),
              ticketCheckInStatus: String(form.get('ticketCheckInStatus') ?? 'not_checked_in'),
              ticketChangeStatus: String(form.get('ticketChangeStatus') ?? 'none'),
            }
          : {}),
      };

      if (issueMode === 'batch') {
        const response = await postJson<CreateProviderTokenBatchResponse>('/api/provider/issuing/add-pass-token-batches', {
          ...payload,
          count: Number(form.get('count') ?? 1),
        });
        setResult({
          mode: 'batch',
          issueBatchId: response.issueBatchId,
          total: response.total,
          tokens: response.tokens,
        });
        const firstExpiresAt = response.tokens[0]?.expiresAt;
        const firstPassExpiresAt = response.tokens[0]?.passExpiresAt ?? null;
      setMessage(
        firstExpiresAt
            ? `已生成 ${response.total} 个领取码，领取码有效期至 ${formatDate(firstExpiresAt)}，卡券有效期：${firstPassExpiresAt ? formatDate(firstPassExpiresAt) : '长期有效'}。`
            : '批量发放已提交，但没有返回领取码。',
      );
      setIsIssueDialogOpen(false);
      void loadTokens();
      return;
      }

      const response = await postJson<CreateProviderTokenResponse>('/api/provider/issuing/add-pass-tokens', payload);
      setResult({
        mode: 'single',
        token: response,
      });
      setMessage(
        `领取码已生成，领取码有效期至 ${formatDate(response.expiresAt)}，卡券有效期：${response.passExpiresAt ? formatDate(response.passExpiresAt) : '长期有效'}。`,
      );
      setIsIssueDialogOpen(false);
      void loadTokens();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成领取码失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitTokenFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadTokens(tokenKeyword, tokenStatusFilter);
  };

  const copyBatchLinks = async () => {
    if (result?.mode !== 'batch' || typeof window === 'undefined') {
      return;
    }

    const content = result.tokens
      .map((token) => `${token.publicNumber ?? ''}\t${token.maskedNumber ?? ''}\t${token.claimCode}\t${origin}${token.claimPath}`)
      .join('\n');

    try {
      await window.navigator.clipboard.writeText(content);
      setMessage('批量领取码和添加链接已复制。');
    } catch {
      setMessage('当前浏览器无法自动复制，请手动选择页面中的链接复制。');
    }
  };

  const revokeToken = async (targetToken: ProviderAddPassTokenSummary) => {
    const reason = window.prompt(`请输入撤销 ${targetToken.maskedClaimCode ?? '该领取码'} 的原因`);
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return;
    }

    setRevokingTokenId(targetToken.id);
    setMessage(null);

    try {
      const response = await postJson<RevokeProviderAddPassTokenResponse>(
        `/api/provider/issuing/add-pass-tokens/${targetToken.id}/revoke`,
        {
          reason: trimmedReason,
        },
      );
      setTokens((currentTokens) => currentTokens.map((item) => (item.id === response.token.id ? response.token : item)));
      setMessage('领取码已撤销。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销领取码失败。');
    } finally {
      setRevokingTokenId(null);
    }
  };

  const reissueToken = async (targetToken: ProviderAddPassTokenSummary) => {
    const reason = window.prompt(`请输入作废并重发 ${targetToken.maskedClaimCode ?? '该领取码'} 的原因`);
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return;
    }

    setReissuingTokenId(targetToken.id);
    setMessage(null);
    setResult(null);

    try {
      const response = await postJson<ReissueProviderAddPassTokenResponse>(
        `/api/provider/issuing/add-pass-tokens/${targetToken.id}/reissue`,
        {
          reason: trimmedReason,
        },
      );
      setResult({
        mode: 'single',
        token: response,
      });
      setMessage(
        `旧领取码已作废，新领取码已生成，有效期至 ${formatDate(response.expiresAt)}，卡券有效期：${response.passExpiresAt ? formatDate(response.passExpiresAt) : '长期有效'}。`,
      );
      void loadTokens();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '作废并重发领取码失败。');
    } finally {
      setReissuingTokenId(null);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="provider-issue-title">
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-issue-title">生成领取码</h1>
        </div>
        <div className="admin-list-actions">
          <button className="primary-action" type="button" onClick={() => setIsIssueDialogOpen(true)} disabled={templates.length === 0}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add_card
            </span>
            <span>发放领取码</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              void loadTemplates();
              void loadTokens();
            }}
          >
            刷新
          </button>
          <a className="secondary-action" href="/provider/templates">
            模板管理
          </a>
          <a className="secondary-action" href="/provider/dashboard">
            工作台
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {result ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setResult(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="完整领取码">
            <div className="admin-dialog-heading">
              <h2>{result.mode === 'single' ? '完整领取码' : '批量发放结果'}</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setResult(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            {result.mode === 'single' && claimLink ? (
              <>
                <div className="flow-notice flow-notice-warning" role="status">
                  <span>完整领取码只能在本弹窗中查看一次，关闭后列表只保留尾号。</span>
                  <strong>{result.token.claimCode}</strong>
                  <span>对应卡号：{formatPassNumber(result.token)}</span>
                </div>
                <ClaimLinkTools claimCode={result.token.claimCode} claimLink={claimLink} onMessage={setMessage} />
              </>
            ) : null}
            {result.mode === 'batch' ? (
              <div className="account-summary">
                <div className="flow-notice flow-notice-warning" role="status">
                  <span>完整领取码只能在本弹窗中查看一次，关闭后列表只保留尾号。</span>
                </div>
                <strong>{result.total} 个领取码</strong>
                <span>批次：{result.issueBatchId}</span>
                <div className="form-actions">
                  <button className="secondary-action" type="button" onClick={() => void copyBatchLinks()}>
                    复制全部链接
                  </button>
                  <a className="primary-action" href="/provider/passes">
                    查看卡券
                  </a>
                </div>
                <div className="admin-list compact-list">
                  {result.tokens.map((item) => (
                    <article className="admin-list-item" key={item.passId}>
                      <div>
                        <h2>{item.claimCode}</h2>
                        <p>{origin ? `${origin}${item.claimPath}` : item.claimPath}</p>
                        <p>对应卡号：{formatPassNumber(item)}</p>
                        <p>领取码有效期至：{formatDate(item.expiresAt)}</p>
                        <p>卡券有效期：{item.passExpiresAt ? formatDate(item.passExpiresAt) : '长期有效'}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {detailToken ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setDetailToken(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="领取码详情">
            <div className="admin-dialog-heading">
              <h2>{detailToken.maskedClaimCode ?? '旧领取码（无尾号）'}</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setDetailToken(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <ProviderTokenDetail token={detailToken} />
          </section>
        </div>
      ) : null}

      <section className="admin-list-section" aria-labelledby="provider-add-pass-token-list-title">
        <div className="admin-panel-heading">
          <div>
            <p>领取码记录</p>
            <h1 id="provider-add-pass-token-list-title">最近生成</h1>
          </div>
        </div>

        <form className="audit-filter-grid" onSubmit={submitTokenFilters}>
          <label>
            <span>搜索</span>
            <input
              type="search"
              value={tokenKeyword}
              onChange={(event) => setTokenKeyword(event.target.value)}
              placeholder="尾号、模板、领取人"
            />
          </label>
          <label>
            <span>状态</span>
            <select
              value={tokenStatusFilter}
              onChange={(event) => setTokenStatusFilter(event.target.value as TokenStatusFilter)}
            >
              <option value="all">全部</option>
              <option value="Active">可领取</option>
              <option value="Claimed">已领取</option>
              <option value="Expired">已过期</option>
              <option value="Revoked">已撤销</option>
            </select>
          </label>
          <div className="audit-filter-actions">
            <button className="secondary-action" type="submit" disabled={isLoadingTokens}>
              {isLoadingTokens ? '读取中' : '筛选'}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setTokenKeyword('');
                setTokenStatusFilter('all');
                void loadTokens('', 'all');
              }}
            >
              重置
            </button>
          </div>
        </form>

        {tokens.length === 0 ? (
          <p className="empty-note">{isLoadingTokens ? '正在读取领取码。' : '暂无领取码记录。'}</p>
        ) : (
          <div className="admin-list compact-list">
            {tokens.map((item) => (
              <article className="admin-list-item" key={item.id}>
                <div>
                  <h2>{item.maskedClaimCode ?? '旧领取码（无尾号）'}</h2>
                  <p>
                    {item.templateName} · {statusLabels[item.status] ?? item.status}
                  </p>
                </div>
                <div className="admin-list-actions">
                  <button className="secondary-action" type="button" onClick={() => setDetailToken(item)}>
                    详情
                  </button>
                  {item.passId ? (
                    <a className="secondary-action" href={`/provider/passes?keyword=${encodeURIComponent(item.passId)}`}>
                      查看卡券
                    </a>
                  ) : null}
                  <button
                    className="secondary-action danger-action"
                    type="button"
                    disabled={item.status !== 'Active' || revokingTokenId === item.id}
                    onClick={() => void revokeToken(item)}
                  >
                    {revokingTokenId === item.id ? '撤销中' : '撤销'}
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={item.status === 'Claimed' || !item.passId || reissuingTokenId === item.id}
                    onClick={() => void reissueToken(item)}
                  >
                    {reissuingTokenId === item.id ? '重发中' : '作废并重发'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {isLoading ? <p className="empty-note">正在读取已审核模板。</p> : null}
      {!isLoading && templates.length === 0 ? (
        <p className="empty-note">还没有可发放的模板。请先创建模板并等待管理员审核通过。</p>
      ) : null}

      {isIssueDialogOpen ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setIsIssueDialogOpen(false)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="发放领取码">
            <div className="admin-dialog-heading">
              <h2>发放领取码</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setIsIssueDialogOpen(false)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
      <form className="admin-dialog-form" onSubmit={createToken} noValidate>
        <div className="segmented-control" aria-label="发放方式">
          <button
            className={issueMode === 'single' ? 'is-selected' : ''}
            type="button"
            onClick={() => {
              setIssueMode('single');
              setResult(null);
              setMessage(null);
            }}
          >
            单个领取码
          </button>
          <button
            className={issueMode === 'batch' ? 'is-selected' : ''}
            type="button"
            onClick={() => {
              setIssueMode('batch');
              setResult(null);
              setMessage(null);
            }}
          >
            批量发放
          </button>
        </div>

        <label>
          <span>选择模板</span>
          <select
            name="templateId"
            value={selectedTemplate?.id ?? ''}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            required
            disabled={templates.length === 0}
          >
            {templates.map((template) => (
              <option value={template.id} key={template.id}>
                {template.displayName} · {template.title}
              </option>
            ))}
          </select>
        </label>

        {selectedTemplate ? (
          <div className="account-summary">
            <strong>{selectedTemplate.displayName}</strong>
            <span>{selectedTemplate.title}</span>
            <span>
              {categoryLabels[selectedTemplate.category] ?? selectedTemplate.category} ·{' '}
              {benefitLabels[selectedTemplate.benefitType] ?? selectedTemplate.benefitType}
            </span>
          </div>
        ) : null}

        <div className="admin-adjustment-panel provider-issue-form">
          <label>
            <span>初始值</span>
            <input type="text" name="initialValue" inputMode="decimal" placeholder="例如：100" required />
          </label>
          <label>
            <span>领取码有效天数</span>
            <input type="number" name="expiresInDays" min={1} max={365} defaultValue={30} required />
          </label>
          <label>
            <span>卡券有效天数</span>
            <input type="number" name="passExpiresInDays" min={1} max={3650} placeholder="留空表示长期有效" />
          </label>
          {issueMode === 'batch' ? (
            <label>
              <span>发放数量</span>
              <input type="number" name="count" min={1} max={50} defaultValue={10} required />
            </label>
          ) : null}
          <label className="checkbox-row">
            <input type="checkbox" name="requireServerVerifiedUser" />
            <span>要求领取用户已完成服务器账号验证</span>
          </label>
        </div>

        {selectedTemplate?.category === 'ticket' ? (
          <div className="admin-adjustment-panel provider-issue-form provider-ticket-form">
            <label>
              <span>活动名称</span>
              <input type="text" name="ticketEventName" placeholder="例如：临东都市圈足球联赛" />
            </label>
            <label>
              <span>场地</span>
              <input type="text" name="ticketVenue" placeholder="例如：普兰普二层看台 C2 区" />
            </label>
            <label>
              <span>场次时间</span>
              <input type="datetime-local" name="ticketStartsAt" />
            </label>
            <label>
              <span>座位</span>
              <input type="text" name="ticketSeatLabel" placeholder="例如：C2-12-49" />
            </label>
            <label>
              <span>检票状态</span>
              <select name="ticketCheckInStatus" defaultValue="not_checked_in">
                <option value="not_checked_in">未检票</option>
                <option value="checked_in">已检票</option>
                <option value="voided">已作废</option>
              </select>
            </label>
            <label>
              <span>改签/取消</span>
              <select name="ticketChangeStatus" defaultValue="none">
                <option value="none">无变更</option>
                <option value="rescheduled">已改签</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
          </div>
        ) : null}

        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={templates.length === 0 || isSubmitting}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add_card
            </span>
            <span>{isSubmitting ? '生成中' : issueMode === 'batch' ? '批量生成' : '生成领取码'}</span>
          </button>
        </div>
      </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ProviderTokenDetail({ token }: { token: ProviderAddPassTokenSummary }) {
  return (
    <dl className="admin-detail-list">
      <div>
        <dt>模板</dt>
        <dd>{token.templateName}</dd>
      </div>
      <div>
        <dt>分类</dt>
        <dd>{categoryLabels[token.category] ?? token.category}</dd>
      </div>
      <div>
        <dt>权益类型</dt>
        <dd>{benefitLabels[token.benefitType] ?? token.benefitType}</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{statusLabels[token.status] ?? token.status}</dd>
      </div>
      <div>
        <dt>对应卡号</dt>
        <dd>{formatPassNumber(token)}</dd>
      </div>
      <div>
        <dt>领取人</dt>
        <dd>{token.claimedByUser ? `${token.claimedByUser.username}（${token.claimedByUser.email}）` : '尚未领取'}</dd>
      </div>
      <div>
        <dt>服务器验证</dt>
        <dd>{token.requireServerVerifiedUser ? '需要' : '不需要'}</dd>
      </div>
      <div>
        <dt>领取码有效期</dt>
        <dd>{formatDate(token.expiresAt)}</dd>
      </div>
      <div>
        <dt>领取时间</dt>
        <dd>{token.claimedAt ? formatDate(token.claimedAt) : '尚未领取'}</dd>
      </div>
      <div>
        <dt>创建时间</dt>
        <dd>{formatDate(token.createdAt)}</dd>
      </div>
    </dl>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

function formatPassNumber(pass: { publicNumber: string | null; maskedNumber: string | null }): string {
  if (pass.publicNumber && pass.maskedNumber) {
    return `${pass.maskedNumber}（${pass.publicNumber}）`;
  }

  return pass.maskedNumber ?? pass.publicNumber ?? '未生成';
}
