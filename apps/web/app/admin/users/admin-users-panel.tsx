'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  reviewInfo: string | null;
  reviewRejectedReason: string | null;
  registrationIp: string | null;
  registrationIpRegion: IpRegionLike | null;
  serverAccountName: string | null;
  serverAccountVerified: boolean;
  hasPin: boolean;
  createdAt: string;
  updatedAt: string;
}

interface IpRegionLike {
  country?: string;
  provinceOrState?: string;
  city?: string;
  source: string;
}

interface AdminUsersResponse {
  users: AdminUser[];
}

interface GovernanceInput {
  reason: string;
  secondFactor: string;
}

type GovernanceAction = 'suspend' | 'unsuspend' | 'delete';

export function AdminUsersPanel() {
  const [pendingUsers, setPendingUsers] = useState<AdminUser[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<AdminUser[]>([]);
  const [keyword, setKeyword] = useState('');
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [governanceInputs, setGovernanceInputs] = useState<Record<string, GovernanceInput>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(true);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [governanceActionKey, setGovernanceActionKey] = useState<string | null>(null);
  const [isExportingUsers, setIsExportingUsers] = useState(false);

  const loadPendingUsers = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<AdminUsersResponse>('/api/admin/users/pending');
      setPendingUsers(result.users);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取用户审核列表失败。');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDirectoryUsers = async (nextKeyword = keyword) => {
    setIsDirectoryLoading(true);
    setMessage(null);

    const search = new URLSearchParams();
    search.set('take', '50');
    if (nextKeyword.trim()) {
      search.set('keyword', nextKeyword.trim());
    }

    try {
      const result = await getJson<AdminUsersResponse>(`/api/admin/users?${search.toString()}`);
      setDirectoryUsers(result.users);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取用户目录失败。');
    } finally {
      setIsDirectoryLoading(false);
    }
  };

  useEffect(() => {
    void loadPendingUsers();
    void loadDirectoryUsers('');
  }, []);

  const submitDirectorySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadDirectoryUsers(keyword);
  };

  const exportUsersCsv = async () => {
    const search = new URLSearchParams();
    search.set('take', '1000');
    if (keyword.trim()) {
      search.set('keyword', keyword.trim());
    }

    setIsExportingUsers(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/users/export.csv?${search.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await readExportError(response));
      }

      const content = await response.text();
      downloadTextFile('ldpass-admin-users.csv', content, 'text/csv;charset=utf-8');
      setMessage('用户目录 CSV 已生成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出用户 CSV 失败。');
    } finally {
      setIsExportingUsers(false);
    }
  };

  const approveUser = async (userId: string) => {
    setMessage(null);

    try {
      await postJson(`/api/admin/users/${userId}/approve`);
      setMessage('已通过用户注册。');
      await Promise.all([loadPendingUsers(), loadDirectoryUsers(keyword)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '审核通过失败。');
    }
  };

  const rejectUser = async (userId: string) => {
    const reason = window.prompt('请输入拒绝原因');
    if (!reason) {
      return;
    }

    setMessage(null);

    try {
      await postJson(`/api/admin/users/${userId}/reject`, { reason });
      setMessage('已拒绝用户注册。');
      await Promise.all([loadPendingUsers(), loadDirectoryUsers(keyword)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝注册失败。');
    }
  };

  const resetUserPin = async (user: AdminUser) => {
    const pin = pinInputs[user.id]?.trim() ?? '';

    if (!/^\d{4,12}$/.test(pin)) {
      setMessage('新 PIN 需要是 4 到 12 位数字。');
      return;
    }

    if (!window.confirm(`确定要重置 ${user.username} 的 PIN 吗？`)) {
      return;
    }

    setResettingUserId(user.id);
    setMessage(null);

    try {
      await postJson(`/api/admin/users/${user.id}/pin/reset`, { pin });
      setPinInputs((currentInputs) => ({
        ...currentInputs,
        [user.id]: '',
      }));
      setMessage(`已重置 ${user.username} 的 PIN。`);
      await loadDirectoryUsers(keyword);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重置 PIN 失败。');
    } finally {
      setResettingUserId(null);
    }
  };

  const updateGovernanceInput = (userId: string, patch: Partial<GovernanceInput>) => {
    setGovernanceInputs((currentInputs) => ({
      ...currentInputs,
      [userId]: {
        reason: currentInputs[userId]?.reason ?? '',
        secondFactor: currentInputs[userId]?.secondFactor ?? '',
        ...patch,
      },
    }));
  };

  const changeUserGovernance = async (user: AdminUser, action: GovernanceAction) => {
    const input = governanceInputs[user.id] ?? { reason: '', secondFactor: '' };
    const reason = input.reason.trim();
    const secondFactor = input.secondFactor.trim();
    const actionLabel = formatGovernanceAction(action);

    if (!reason) {
      setMessage(`请输入${actionLabel}原因。`);
      return;
    }

    if (!/^\d{4,12}$/.test(secondFactor)) {
      setMessage('管理员 PIN 需要是 4 到 12 位数字。');
      return;
    }

    if (!window.confirm(`确定要${actionLabel} ${user.username} 吗？`)) {
      return;
    }

    const actionKey = `${user.id}:${action}`;
    setGovernanceActionKey(actionKey);
    setMessage(null);

    try {
      await postJson(`/api/admin/users/${user.id}/${action}`, {
        reason,
        secondFactor,
      });
      setGovernanceInputs((currentInputs) => ({
        ...currentInputs,
        [user.id]: {
          reason: '',
          secondFactor: '',
        },
      }));
      setMessage(`已${actionLabel} ${user.username}。`);
      await Promise.all([loadPendingUsers(), loadDirectoryUsers(keyword)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${actionLabel}失败。`);
    } finally {
      setGovernanceActionKey(null);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-users-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-users-title">用户审核</h1>
        </div>
        <div className="admin-list-actions">
          <button className="secondary-action" type="button" onClick={() => void Promise.all([loadPendingUsers(), loadDirectoryUsers(keyword)])}>
            刷新
          </button>
          <a className="secondary-action" href="/admin/audit">
            审计日志
          </a>
          <a className="secondary-action" href="/admin/passes">
            权益调整
          </a>
          <a className="secondary-action" href="/admin/providers">
            提供方审核
          </a>
          <a className="secondary-action" href="/admin/pass-templates">
            模板审核
          </a>
          <a className="secondary-action" href="/admin/theme">
            主题计划
          </a>
          <a className="secondary-action" href="/admin/storage">
            存储状态
          </a>
          <a className="primary-action" href="/admin/add-pass-token">
            <span className="material-symbols-rounded" aria-hidden="true">
              add_card
            </span>
            <span>生成领取码</span>
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      <form className="audit-filter-grid" onSubmit={submitDirectorySearch}>
        <label>
          <span>搜索用户</span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="用户名、邮箱、服务器 ID"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="secondary-action" type="button" onClick={() => void loadDirectoryUsers(keyword)}>
            刷新目录
          </button>
          <button className="secondary-action" type="button" disabled={isExportingUsers} onClick={() => void exportUsersCsv()}>
            {isExportingUsers ? '导出中' : '导出用户 CSV'}
          </button>
          <button className="primary-action" type="submit">
            <span className="material-symbols-rounded" aria-hidden="true">
              manage_search
            </span>
            <span>搜索用户</span>
          </button>
        </div>
      </form>

      <section className="admin-list-section" aria-labelledby="admin-users-directory-title">
        <div className="detail-section-heading">
          <h2 id="admin-users-directory-title">用户目录</h2>
          <span>{directoryUsers.length}</span>
        </div>
        {isDirectoryLoading ? <p className="empty-note">正在读取用户目录。</p> : null}
        {!isDirectoryLoading && directoryUsers.length === 0 ? <p className="empty-note">没有找到匹配用户。</p> : null}
        <div className="admin-list">
          {directoryUsers.map((user) => (
            <article className="admin-list-item" key={user.id}>
              <div>
                <h2>{user.username}</h2>
                <p>{user.email}</p>
                <p>
                  状态：{formatUserStatus(user.status)} · 角色：{user.role} · PIN：{user.hasPin ? '已设置' : '未设置'}
                  {user.serverAccountName ? ` · 服务器 ID：${user.serverAccountName}` : ''}
                </p>
                <p>
                  注册 IP：{user.registrationIp ?? '未知'} · 属地：{formatIpRegion(user.registrationIpRegion)}
                </p>
                <p>最近更新：{new Date(user.updatedAt).toLocaleString('zh-CN')}</p>
              </div>
              <div className="admin-list-actions">
                <input
                  className="inline-admin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4,12}"
                  value={pinInputs[user.id] ?? ''}
                  onChange={(event) =>
                    setPinInputs((currentInputs) => ({
                      ...currentInputs,
                      [user.id]: event.target.value,
                    }))
                  }
                  placeholder="新 PIN"
                  aria-label={`${user.username} 的新 PIN`}
                />
                <button
                  className="secondary-action"
                  type="button"
                  disabled={resettingUserId === user.id}
                  onClick={() => void resetUserPin(user)}
                >
                  {resettingUserId === user.id ? '重置中' : '重置 PIN'}
                </button>
                {user.role === 'user' ? (
                  <>
                    <input
                      className="inline-admin-input inline-admin-input-wide"
                      value={governanceInputs[user.id]?.reason ?? ''}
                      onChange={(event) => updateGovernanceInput(user.id, { reason: event.target.value })}
                      placeholder="处置原因"
                      aria-label={`${user.username} 的处置原因`}
                    />
                    <input
                      className="inline-admin-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{4,12}"
                      value={governanceInputs[user.id]?.secondFactor ?? ''}
                      onChange={(event) => updateGovernanceInput(user.id, { secondFactor: event.target.value })}
                      placeholder="管理员 PIN"
                      aria-label={`${user.username} 处置所需管理员 PIN`}
                    />
                    {user.status === 'Active' ? (
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={governanceActionKey === `${user.id}:suspend`}
                        onClick={() => void changeUserGovernance(user, 'suspend')}
                      >
                        {governanceActionKey === `${user.id}:suspend` ? '封禁中' : '封禁'}
                      </button>
                    ) : null}
                    {user.status === 'Suspended' ? (
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={governanceActionKey === `${user.id}:unsuspend`}
                        onClick={() => void changeUserGovernance(user, 'unsuspend')}
                      >
                        {governanceActionKey === `${user.id}:unsuspend` ? '解封中' : '解封'}
                      </button>
                    ) : null}
                    {user.status !== 'Deleted' ? (
                      <button
                        className="danger-action"
                        type="button"
                        disabled={governanceActionKey === `${user.id}:delete`}
                        onClick={() => void changeUserGovernance(user, 'delete')}
                      >
                        {governanceActionKey === `${user.id}:delete` ? '删除中' : '删除账户'}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {isLoading ? <p className="empty-note">正在读取用户审核列表。</p> : null}

      {!isLoading && pendingUsers.length === 0 ? <p className="empty-note">暂无需要处理的用户注册申请。</p> : null}

      <div className="admin-list">
        {pendingUsers.map((user) => (
          <article className="admin-list-item" key={user.id}>
            <div>
              <h2>{user.username}</h2>
              <p>{user.email}</p>
              <p>
                状态：{formatUserStatus(user.status)}
                {user.serverAccountName ? ` · 服务器 ID：${user.serverAccountName}` : ''}
              </p>
              <p>注册 IP：{user.registrationIp ?? '未知'}</p>
              <p>IP 属地：{formatIpRegion(user.registrationIpRegion)}</p>
              {user.reviewInfo ? <p>审核信息：{user.reviewInfo}</p> : null}
              {user.reviewRejectedReason ? <p>拒绝原因：{user.reviewRejectedReason}</p> : null}
            </div>
            <div className="admin-list-actions">
              <button className="secondary-action" type="button" onClick={() => void rejectUser(user.id)}>
                拒绝
              </button>
              <button className="primary-action" type="button" onClick={() => void approveUser(user.id)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  check
                </span>
                <span>通过</span>
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatGovernanceAction(action: GovernanceAction): string {
  const labels: Record<GovernanceAction, string> = {
    suspend: '封禁',
    unsuspend: '解封',
    delete: '删除账户',
  };

  return labels[action];
}

function formatUserStatus(status: string): string {
  const labels: Record<string, string> = {
    Active: '可用',
    Approved: '已审核',
    CodeRotated: '验证码已刷新',
    Deleted: '已删除',
    Draft: '草稿',
    Failed: '失败',
    PendingReview: '待审核',
    Rejected: '已拒绝',
    Suspended: '已封禁',
    Verified: '已验证',
    WaitingServerVerification: '等待服务器验证',
  };

  return labels[status] ?? status;
}

function formatIpRegion(region: IpRegionLike | null): string {
  if (!region) {
    return '未知';
  }

  const parts = [region.country, region.provinceOrState, region.city]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' / ') : '未知';
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
