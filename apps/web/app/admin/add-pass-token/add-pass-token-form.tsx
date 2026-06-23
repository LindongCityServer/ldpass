'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';
import { ClaimLinkTools } from '../../claim-link-tools';

interface CreateTokenResponse {
  claimCode: string;
  claimPath: string;
  expiresAt: string;
  passExpiresAt: string | null;
  passId: string;
  publicNumber: string | null;
  maskedNumber: string | null;
  templateId: string;
}

interface AddPassTokenSummary {
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

interface AddPassTokensResponse {
  tokens: AddPassTokenSummary[];
}

interface RevokeAddPassTokenResponse {
  token: AddPassTokenSummary;
}

interface ReissueAddPassTokenResponse extends CreateTokenResponse {
  token: AddPassTokenSummary;
  revokedToken: AddPassTokenSummary;
}

type TokenStatusFilter = 'all' | 'Active' | 'Claimed' | 'Expired' | 'Revoked';

const statusLabels: Record<string, string> = {
  Active: '可领取',
  Claimed: '已领取',
  Expired: '已过期',
  Revoked: '已撤销',
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

export function AddPassTokenForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<CreateTokenResponse | null>(null);
  const [tokens, setTokens] = useState<AddPassTokenSummary[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<TokenStatusFilter>('all');
  const [origin, setOrigin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [reissuingTokenId, setReissuingTokenId] = useState<string | null>(null);
  const claimLink = token && origin ? `${origin}${token.claimPath}` : null;

  const loadTokens = async (nextKeyword = keyword, nextStatus = statusFilter) => {
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

      const response = await getJson<AddPassTokensResponse>(`/api/admin/add-pass-tokens?${search.toString()}`);
      setTokens(response.tokens);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取领取码列表失败。');
    } finally {
      setIsLoadingTokens(false);
    }
  };

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadTokens('', 'all');
    // 首屏加载一次，筛选由表单按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setToken(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const passExpiresInDays = String(form.get('passExpiresInDays') ?? '').trim();

    try {
      const result = await postJson<CreateTokenResponse>('/api/admin/add-pass-tokens', {
        providerName: String(form.get('providerName') ?? ''),
        providerSlug: String(form.get('providerSlug') ?? ''),
        category: String(form.get('category') ?? 'account'),
        benefitType: String(form.get('benefitType') ?? 'amount'),
        displayName: String(form.get('displayName') ?? ''),
        title: String(form.get('title') ?? ''),
        initialValue: String(form.get('initialValue') ?? ''),
        requireServerVerifiedUser: form.get('requireServerVerifiedUser') === 'on',
        expiresInDays: Number(form.get('expiresInDays') ?? 30),
        ...(passExpiresInDays ? { passExpiresInDays: Number(passExpiresInDays) } : {}),
      });
      setToken(result);
      setMessage(
        `领取码已生成，领取码有效期至 ${formatDate(result.expiresAt)}，卡券有效期：${result.passExpiresAt ? formatDate(result.passExpiresAt) : '长期有效'}。`,
      );
      void loadTokens();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成领取码失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadTokens(keyword, statusFilter);
  };

  const revokeToken = async (targetToken: AddPassTokenSummary) => {
    const reason = window.prompt(`请输入撤销 ${targetToken.maskedClaimCode ?? '该领取码'} 的原因`);
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return;
    }

    setRevokingTokenId(targetToken.id);
    setMessage(null);

    try {
      const response = await postJson<RevokeAddPassTokenResponse>(`/api/admin/add-pass-tokens/${targetToken.id}/revoke`, {
        reason: trimmedReason,
      });
      setTokens((currentTokens) => currentTokens.map((item) => (item.id === response.token.id ? response.token : item)));
      setMessage('领取码已撤销。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销领取码失败。');
    } finally {
      setRevokingTokenId(null);
    }
  };

  const reissueToken = async (targetToken: AddPassTokenSummary) => {
    const reason = window.prompt(`请输入作废并重发 ${targetToken.maskedClaimCode ?? '该领取码'} 的原因`);
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return;
    }

    setReissuingTokenId(targetToken.id);
    setMessage(null);
    setToken(null);

    try {
      const response = await postJson<ReissueAddPassTokenResponse>(`/api/admin/add-pass-tokens/${targetToken.id}/reissue`, {
        reason: trimmedReason,
      });
      setToken(response);
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
    <>
      <form className="stacked-form" onSubmit={handleSubmit} noValidate>
        <label>
          <span>提供方名称</span>
          <input type="text" name="providerName" required />
        </label>
        <label>
          <span>提供方标识</span>
          <input type="text" name="providerSlug" placeholder="lowercase-slug" required />
        </label>
        <label>
          <span>分类</span>
          <select name="category" defaultValue="account">
            <option value="account">账户/卡</option>
            <option value="identity_key">证件/钥匙</option>
            <option value="ticket">票券</option>
          </select>
        </label>
        <label>
          <span>权益类型</span>
          <select name="benefitType" defaultValue="amount">
            <option value="amount">金额</option>
            <option value="points">积分</option>
            <option value="times">次数</option>
          </select>
        </label>
        <label>
          <span>卡券名称</span>
          <input type="text" name="displayName" required />
        </label>
        <label>
          <span>卡面标题</span>
          <input type="text" name="title" required />
        </label>
        <label>
          <span>初始值</span>
          <input type="text" name="initialValue" inputMode="decimal" required />
        </label>
        <label>
          <span>领取码有效天数</span>
          <input type="number" name="expiresInDays" min={1} max={365} defaultValue={30} required />
        </label>
        <label>
          <span>卡券有效天数</span>
          <input type="number" name="passExpiresInDays" min={1} max={3650} placeholder="留空表示长期有效" />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" name="requireServerVerifiedUser" />
          <span>要求领取用户已完成服务器账号验证</span>
        </label>

        {message ? (
          <div className="flow-notice" role="status" aria-live="polite">
            <span>{message}</span>
            {token ? <strong>{token.claimCode}</strong> : null}
            {token ? <span>对应卡号：{formatPassNumber(token)}</span> : null}
          </div>
        ) : null}
        {token && claimLink ? (
          <ClaimLinkTools claimCode={token.claimCode} claimLink={claimLink} onMessage={setMessage} />
        ) : null}

        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add_card
            </span>
            <span>{isSubmitting ? '生成中' : '生成领取码'}</span>
          </button>
        </div>
      </form>

      <section className="admin-list-section" aria-labelledby="admin-add-pass-token-list-title">
        <div className="admin-panel-heading">
          <div>
            <p>领取码记录</p>
            <h1 id="admin-add-pass-token-list-title">最近生成</h1>
          </div>
        </div>

        <form className="audit-filter-grid" onSubmit={submitFilters}>
          <label>
            <span>搜索</span>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="尾号、提供方、模板、领取人"
            />
          </label>
          <label>
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TokenStatusFilter)}
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
                setKeyword('');
                setStatusFilter('all');
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
                    {item.providerName} · {item.templateName} · {categoryLabels[item.category] ?? item.category} ·{' '}
                    {benefitLabels[item.benefitType] ?? item.benefitType}
                  </p>
                  <p>对应卡号：{formatPassNumber(item)}</p>
                  <p>
                    状态：{statusLabels[item.status] ?? item.status} · 领取码有效期：{formatDate(item.expiresAt)}
                  </p>
                  <p>
                    {item.claimedByUser
                      ? `领取人：${item.claimedByUser.username}（${item.claimedByUser.email}）`
                      : '尚未领取'}
                    {item.requireServerVerifiedUser ? ' · 需要服务器账号验证' : ''}
                  </p>
                </div>
                <div className="admin-list-actions">
                  {item.passId ? (
                    <a className="secondary-action" href={`/admin/passes?keyword=${encodeURIComponent(item.passId)}`}>
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
    </>
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
