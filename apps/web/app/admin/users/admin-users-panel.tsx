'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';
import { BackofficeTopbarPageActions } from '../../backoffice-shell';

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
  newPassword: string;
}

type GovernanceAction = 'suspend' | 'unsuspend' | 'delete';
type ReviewAction = 'approve' | 'reject';
type UserStatusFilter =
  | 'all'
  | 'PendingReview'
  | 'Active'
  | 'Suspended'
  | 'Deleted'
  | 'Rejected'
  | 'WaitingServerVerification';

type UserDialog =
  | { kind: 'detail'; user: AdminUser }
  | { kind: 'review'; user: AdminUser; action: ReviewAction }
  | { kind: 'reset-password'; user: AdminUser }
  | { kind: 'governance'; user: AdminUser; action: GovernanceAction };

const userStatusFilters: Array<{ value: UserStatusFilter; label: string }> = [
  { value: 'all', label: '全部用户' },
  { value: 'PendingReview', label: '待审核' },
  { value: 'Active', label: '可用' },
  { value: 'Suspended', label: '已封禁' },
  { value: 'Deleted', label: '已删除' },
  { value: 'Rejected', label: '已拒绝' },
  { value: 'WaitingServerVerification', label: '待服务器验证' },
];

export function AdminUsersPanel() {
  const [pendingUsers, setPendingUsers] = useState<AdminUser[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<AdminUser[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all');
  const [governanceInputs, setGovernanceInputs] = useState<Record<string, GovernanceInput>>({});
  const [activeDialog, setActiveDialog] = useState<UserDialog | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(true);
  const [governanceActionKey, setGovernanceActionKey] = useState<string | null>(null);
  const [isExportingUsers, setIsExportingUsers] = useState(false);

  const allUsers = useMemo(
    () => mergeUsers(pendingUsers, directoryUsers),
    [pendingUsers, directoryUsers],
  );
  const filteredUsers = useMemo(
    () => allUsers.filter((user) => statusFilter === 'all' || user.status === statusFilter),
    [allUsers, statusFilter],
  );

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

  const refreshUsers = async () => {
    await Promise.all([loadPendingUsers(), loadDirectoryUsers(keyword)]);
  };

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

  const submitReview = async (user: AdminUser, action: ReviewAction) => {
    const reason = reviewReason.trim();
    if (action === 'reject' && !reason) {
      setMessage('请输入驳回原因。');
      return;
    }

    setMessage(null);

    try {
      if (action === 'approve') {
        await postJson(`/api/admin/users/${user.id}/approve`);
        setMessage('已通过用户注册。');
      } else {
        await postJson(`/api/admin/users/${user.id}/reject`, { reason });
        setMessage('已驳回用户注册。');
      }

      setActiveDialog(null);
      setReviewReason('');
      await refreshUsers();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : action === 'approve'
            ? '审核通过失败。'
            : '驳回注册失败。',
      );
    }
  };

  const updateGovernanceInput = (userId: string, patch: Partial<GovernanceInput>) => {
    setGovernanceInputs((currentInputs) => ({
      ...currentInputs,
      [userId]: {
        reason: currentInputs[userId]?.reason ?? '',
        secondFactor: currentInputs[userId]?.secondFactor ?? '',
        newPassword: currentInputs[userId]?.newPassword ?? '',
        ...patch,
      },
    }));
  };

  const openGovernanceDialog = (user: AdminUser, action: GovernanceAction) => {
    updateGovernanceInput(user.id, {});
    setActiveDialog({ kind: 'governance', user, action });
  };

  const openPasswordDialog = (user: AdminUser) => {
    updateGovernanceInput(user.id, {});
    setActiveDialog({ kind: 'reset-password', user });
  };

  const changeUserGovernance = async (user: AdminUser, action: GovernanceAction) => {
    const input = governanceInputs[user.id] ?? { reason: '', secondFactor: '', newPassword: '' };
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

    const actionKey = `${user.id}:${action}`;
    setGovernanceActionKey(actionKey);
    setMessage(null);

    try {
      await postJson(`/api/admin/users/${user.id}/${action}`, {
        reason,
        secondFactor,
      });
      clearGovernanceInput(user.id);
      setActiveDialog(null);
      setMessage(`已${actionLabel} ${user.username}。`);
      await refreshUsers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${actionLabel}失败。`);
    } finally {
      setGovernanceActionKey(null);
    }
  };

  const resetUserPassword = async (user: AdminUser) => {
    const input = governanceInputs[user.id] ?? { reason: '', secondFactor: '', newPassword: '' };
    const reason = input.reason.trim();
    const secondFactor = input.secondFactor.trim();

    if (!reason) {
      setMessage('请输入重置密码原因。');
      return;
    }

    if (input.newPassword.length < 8 || input.newPassword.length > 128) {
      setMessage('新密码需要是 8 到 128 个字符。');
      return;
    }

    if (!/^\d{4,12}$/.test(secondFactor)) {
      setMessage('管理员 PIN 需要是 4 到 12 位数字。');
      return;
    }

    const actionKey = `${user.id}:password`;
    setGovernanceActionKey(actionKey);
    setMessage(null);

    try {
      await postJson(`/api/admin/users/${user.id}/password/reset`, {
        password: input.newPassword,
        reason,
        secondFactor,
      });
      clearGovernanceInput(user.id);
      setActiveDialog(null);
      setMessage(`已重置 ${user.username} 的密码。`);
      await refreshUsers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重置密码失败。');
    } finally {
      setGovernanceActionKey(null);
    }
  };

  const clearGovernanceInput = (userId: string) => {
    setGovernanceInputs((currentInputs) => ({
      ...currentInputs,
      [userId]: {
        reason: '',
        secondFactor: '',
        newPassword: '',
      },
    }));
  };

  return (
    <>
      <BackofficeTopbarPageActions>
        <div className="admin-list-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() => void refreshUsers()}
            title="刷新"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isExportingUsers}
            onClick={() => void exportUsersCsv()}
            title={isExportingUsers ? '导出中' : '导出 CSV'}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              file_save
            </span>
            <span>{isExportingUsers ? '导出中' : '导出 CSV'}</span>
          </button>
        </div>
      </BackofficeTopbarPageActions>
      <section className="admin-panel" aria-labelledby="admin-users-title">
        <div className="admin-panel-heading">
          <div>
            <p>平台管理</p>
            <h1 id="admin-users-title">用户</h1>
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
          <label>
            <span>分类</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as UserStatusFilter)}
            >
              {userStatusFilters.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="audit-filter-actions">
            <button className="primary-action" type="submit">
              <span className="material-symbols-rounded" aria-hidden="true">
                manage_search
              </span>
              <span>搜索</span>
            </button>
          </div>
        </form>

        <section className="admin-list-section" aria-labelledby="admin-users-directory-title">
          <div className="detail-section-heading">
            <h2 id="admin-users-directory-title">用户列表</h2>
            <span>{filteredUsers.length}</span>
          </div>
          {isLoading || isDirectoryLoading ? (
            <p className="empty-note">正在读取用户列表。</p>
          ) : null}
          {!isLoading && !isDirectoryLoading && filteredUsers.length === 0 ? (
            <p className="empty-note">没有找到匹配用户。</p>
          ) : null}
          <div className="admin-list">
            {filteredUsers.map((user) => (
              <article
                className={`admin-list-item admin-user-row${activeDialog?.user.id === user.id ? ' is-selected' : ''}`}
                key={user.id}
              >
                <div className="admin-user-main">
                  <span className="admin-user-avatar" aria-hidden="true">
                    {readUserInitial(user)}
                  </span>
                  <div>
                    <h2>
                      {user.username}
                      <span className="admin-status-pill">{formatUserStatus(user.status)}</span>
                    </h2>
                    <p>{user.email}</p>
                    <p>
                      ID：{formatShortId(user.id)} · 角色：{user.role}
                      {user.serverAccountName ? ` · 服务器 ID：${user.serverAccountName}` : ''}
                    </p>
                  </div>
                </div>
                <div className="admin-list-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => setActiveDialog({ kind: 'detail', user })}
                  >
                    详情
                  </button>
                  {user.status === 'PendingReview' ? (
                    <>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => {
                          setReviewReason('');
                          setActiveDialog({ kind: 'review', user, action: 'reject' });
                        }}
                      >
                        驳回
                      </button>
                      <button
                        className="primary-action"
                        type="button"
                        onClick={() => {
                          setReviewReason('');
                          setActiveDialog({ kind: 'review', user, action: 'approve' });
                        }}
                      >
                        <span className="material-symbols-rounded" aria-hidden="true">
                          check
                        </span>
                        <span>通过</span>
                      </button>
                    </>
                  ) : null}
                  {user.role === 'user' && user.status !== 'Deleted' ? (
                    <>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => openPasswordDialog(user)}
                      >
                        重置密码
                      </button>
                      {user.status === 'Suspended' ? (
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => openGovernanceDialog(user, 'unsuspend')}
                        >
                          解除封禁
                        </button>
                      ) : (
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => openGovernanceDialog(user, 'suspend')}
                        >
                          封禁
                        </button>
                      )}
                      <button
                        className="danger-action"
                        type="button"
                        onClick={() => openGovernanceDialog(user, 'delete')}
                      >
                        注销
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        {activeDialog ? (
          <AdminUserDialog
            dialog={activeDialog}
            governanceInput={
              governanceInputs[activeDialog.user.id] ?? {
                reason: '',
                secondFactor: '',
                newPassword: '',
              }
            }
            governanceActionKey={governanceActionKey}
            reviewReason={reviewReason}
            onClose={() => setActiveDialog(null)}
            onGovernanceInputChange={(patch) => updateGovernanceInput(activeDialog.user.id, patch)}
            onReviewReasonChange={setReviewReason}
            onReviewSubmit={() => {
              if (activeDialog.kind === 'review') {
                void submitReview(activeDialog.user, activeDialog.action);
              }
            }}
            onPasswordSubmit={() => {
              if (activeDialog.kind === 'reset-password') {
                void resetUserPassword(activeDialog.user);
              }
            }}
            onGovernanceSubmit={() => {
              if (activeDialog.kind === 'governance') {
                void changeUserGovernance(activeDialog.user, activeDialog.action);
              }
            }}
          />
        ) : null}
      </section>
    </>
  );
}

interface AdminUserDialogProps {
  dialog: UserDialog;
  governanceInput: GovernanceInput;
  governanceActionKey: string | null;
  reviewReason: string;
  onClose: () => void;
  onGovernanceInputChange: (patch: Partial<GovernanceInput>) => void;
  onReviewReasonChange: (reason: string) => void;
  onReviewSubmit: () => void;
  onPasswordSubmit: () => void;
  onGovernanceSubmit: () => void;
}

function AdminUserDialog({
  dialog,
  governanceInput,
  governanceActionKey,
  reviewReason,
  onClose,
  onGovernanceInputChange,
  onReviewReasonChange,
  onReviewSubmit,
  onPasswordSubmit,
  onGovernanceSubmit,
}: AdminUserDialogProps) {
  const title = readDialogTitle(dialog);

  return (
    <div className="admin-dialog-layer">
      <button
        className="admin-dialog-scrim"
        type="button"
        aria-label="关闭弹窗"
        onClick={onClose}
      />
      <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="admin-dialog-heading">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={onClose}>
            <span className="material-symbols-rounded" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {dialog.kind === 'detail' ? <UserDetail user={dialog.user} /> : null}

        {dialog.kind === 'review' ? (
          <form
            className="admin-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              onReviewSubmit();
            }}
          >
            <UserDetail user={dialog.user} compact />
            {dialog.action === 'reject' ? (
              <label>
                <span>驳回原因</span>
                <textarea
                  value={reviewReason}
                  onChange={(event) => onReviewReasonChange(event.target.value)}
                  rows={4}
                />
              </label>
            ) : null}
            <div className="admin-dialog-actions">
              <button className="secondary-action" type="button" onClick={onClose}>
                取消
              </button>
              <button
                className={dialog.action === 'approve' ? 'primary-action' : 'danger-action'}
                type="submit"
              >
                {dialog.action === 'approve' ? '通过' : '驳回'}
              </button>
            </div>
          </form>
        ) : null}

        {dialog.kind === 'reset-password' ? (
          <form
            className="admin-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              onPasswordSubmit();
            }}
          >
            <label>
              <span>新密码</span>
              <input
                type="password"
                value={governanceInput.newPassword}
                onChange={(event) => onGovernanceInputChange({ newPassword: event.target.value })}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>原因</span>
              <input
                value={governanceInput.reason}
                onChange={(event) => onGovernanceInputChange({ reason: event.target.value })}
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
                className="primary-action"
                type="submit"
                disabled={governanceActionKey === `${dialog.user.id}:password`}
              >
                {governanceActionKey === `${dialog.user.id}:password` ? '重置中' : '确认'}
              </button>
            </div>
          </form>
        ) : null}

        {dialog.kind === 'governance' ? (
          <form
            className="admin-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              onGovernanceSubmit();
            }}
          >
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
                className={dialog.action === 'delete' ? 'danger-action' : 'primary-action'}
                type="submit"
                disabled={governanceActionKey === `${dialog.user.id}:${dialog.action}`}
              >
                {governanceActionKey === `${dialog.user.id}:${dialog.action}`
                  ? '处理中'
                  : formatGovernanceAction(dialog.action)}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function UserDetail({ user, compact = false }: { user: AdminUser; compact?: boolean }) {
  const details = [
    ['邮箱', user.email],
    ['服务端 ID', user.serverAccountName ?? '未绑定'],
    ['服务器验证', user.serverAccountVerified ? '已验证' : '未验证'],
    ['状态', formatUserStatus(user.status)],
    ['角色', user.role],
    ['PIN', user.hasPin ? '已设置' : '未设置'],
    ['注册 IP', user.registrationIp ?? '未知'],
    ['IP 属地', formatIpRegion(user.registrationIpRegion)],
    ['创建时间', new Date(user.createdAt).toLocaleString('zh-CN')],
    ['最近更新', new Date(user.updatedAt).toLocaleString('zh-CN')],
  ];

  return (
    <dl className={`admin-detail-list${compact ? ' is-compact' : ''}`}>
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      {user.reviewInfo ? (
        <div>
          <dt>审核信息</dt>
          <dd>{user.reviewInfo}</dd>
        </div>
      ) : null}
      {user.reviewRejectedReason ? (
        <div>
          <dt>驳回原因</dt>
          <dd>{user.reviewRejectedReason}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function mergeUsers(firstGroup: AdminUser[], secondGroup: AdminUser[]): AdminUser[] {
  const seen = new Set<string>();
  const users: AdminUser[] = [];

  for (const user of [...firstGroup, ...secondGroup]) {
    if (seen.has(user.id)) {
      continue;
    }
    seen.add(user.id);
    users.push(user);
  }

  return users;
}

function readDialogTitle(dialog: UserDialog): string {
  if (dialog.kind === 'detail') {
    return dialog.user.status === 'PendingReview' ? '申请用户详情' : '用户详情';
  }
  if (dialog.kind === 'review') {
    return dialog.action === 'approve' ? '通过申请' : '驳回申请';
  }
  if (dialog.kind === 'reset-password') {
    return '重置密码';
  }
  return formatGovernanceAction(dialog.action);
}

function readUserInitial(user: AdminUser): string {
  return (user.username.trim().charAt(0) || user.email.trim().charAt(0) || '?').toUpperCase();
}

function formatShortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatGovernanceAction(action: GovernanceAction): string {
  const labels: Record<GovernanceAction, string> = {
    suspend: '封禁',
    unsuspend: '解除封禁',
    delete: '注销',
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
