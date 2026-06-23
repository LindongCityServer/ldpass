'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../api-client';

interface SessionResponse {
  user: {
    username: string;
    email: string;
    status: string;
    reviewInfo: string | null;
    reviewRejectedReason: string | null;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
    avatarUrl: string | null;
    avatarFallbackUrl: string | null;
    expirationReminderDays: number;
  } | null;
}

interface AccountDevice {
  id: string;
  system: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';
  label: string | null;
  trustedUntil: string | null;
  revokedAt: string | null;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AccountDevicesResponse {
  devices: AccountDevice[];
}

interface DeviceLoginApproval {
  id: string;
  deviceSystem: AccountDevice['system'];
  deviceLabel: string | null;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
}

interface DeviceLoginApprovalsResponse {
  approvals: DeviceLoginApproval[];
}

interface AccountPreferencesResponse {
  user: NonNullable<SessionResponse['user']>;
}

interface ResubmitReviewResponse {
  user: NonNullable<SessionResponse['user']>;
}

interface ServerAccountChallenge {
  id: string;
  serverId: string;
  code: string;
  expiresAt: string;
}

interface ServerAccountRebindStartResponse {
  user: NonNullable<SessionResponse['user']>;
  challenge: ServerAccountChallenge;
}

interface ServerAccountRebindCheckResponse {
  status: 'waiting' | 'verified' | 'rotated' | 'expired';
  user: NonNullable<SessionResponse['user']>;
  challenge?: ServerAccountChallenge;
}

type AccountDialog =
  | 'preferences'
  | 'pin'
  | 'server'
  | 'deviceApprovals'
  | 'devices'
  | 'review'
  | 'delete';

function UserAvatar({ avatarUrl, fallbackUrl }: { avatarUrl: string | null; fallbackUrl: string | null }) {
  const [currentUrl, setCurrentUrl] = useState(avatarUrl);

  if (!currentUrl) {
    return <span className="avatar" aria-hidden="true" />;
  }

  return (
    <img
      className="avatar"
      src={currentUrl}
      alt=""
      width={28}
      height={28}
      onError={() => setCurrentUrl(currentUrl === fallbackUrl ? null : fallbackUrl)}
    />
  );
}

export function AccountPanel() {
  const [session, setSession] = useState<SessionResponse['user']>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [deviceApprovals, setDeviceApprovals] = useState<DeviceLoginApproval[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDevicesLoading, setIsDevicesLoading] = useState(false);
  const [isDeviceApprovalsLoading, setIsDeviceApprovalsLoading] = useState(false);
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isStartingServerRebind, setIsStartingServerRebind] = useState(false);
  const [isCheckingServerRebind, setIsCheckingServerRebind] = useState(false);
  const [isResubmittingReview, setIsResubmittingReview] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [serverRebindChallenge, setServerRebindChallenge] = useState<ServerAccountChallenge | null>(null);
  const [activeDialog, setActiveDialog] = useState<AccountDialog | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadAccount = async () => {
      try {
        const result = await getJson<SessionResponse>('/api/auth/session');
        if (!isMounted) {
          return;
        }

        setSession(result.user);
        if (!result.user) {
          setMessage('请先登录后再管理账户。');
          return;
        }

        if (result.user.status !== 'Active') {
          setDevices([]);
          setDeviceApprovals([]);
          setMessage(formatInactiveAccountMessage(result.user.status));
          return;
        }

        setIsDevicesLoading(true);
        setIsDeviceApprovalsLoading(true);
        const [devicesResult, approvalsResult] = await Promise.all([
          getJson<AccountDevicesResponse>('/api/auth/account/devices'),
          getJson<DeviceLoginApprovalsResponse>('/api/auth/account/device-login-approvals'),
        ]);

        if (!isMounted) {
          return;
        }

        setDevices(devicesResult.devices);
        setDeviceApprovals(approvalsResult.approvals);
      } catch (error) {
        if (isMounted) {
          setMessage(error instanceof Error ? error.message : '读取会话失败。');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsDevicesLoading(false);
          setIsDeviceApprovalsLoading(false);
        }
      }
    };

    void loadAccount();

    return () => {
      isMounted = false;
    };
  }, []);

  const logout = async () => {
    await postJson('/api/auth/logout');
    window.location.href = '/login';
  };

  const deleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');

    if (!password) {
      setMessage('请输入当前密码后再注销账户。');
      return;
    }

    if (!window.confirm('注销账户会删除当前账户并退出登录，确定继续吗？')) {
      return;
    }

    setIsDeleting(true);
    setMessage(null);

    try {
      await postJson('/api/auth/account/delete', { password });
      setMessage('账户已注销，正在返回注册页面。');
      window.location.href = '/register';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '注销账户失败。');
    } finally {
      setIsDeleting(false);
    }
  };

  const setPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const password = String(form.get('pinPassword') ?? '');
    const pin = String(form.get('pin') ?? '');

    if (!password || !pin) {
      setMessage('请输入当前密码和 PIN。');
      return;
    }

    setIsSettingPin(true);
    setMessage(null);

    try {
      await postJson('/api/auth/account/pin', {
        password,
        pin,
      });
      event.currentTarget.reset();
      setMessage('PIN 已设置，可用于确认卡券消耗等敏感操作。');
      setActiveDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '设置 PIN 失败。');
    } finally {
      setIsSettingPin(false);
    }
  };

  const resubmitReviewInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const reviewInfo = String(form.get('reviewInfo') ?? '').trim();

    if (reviewInfo.length < 2) {
      setMessage('审核信息至少需要 2 个字符。');
      return;
    }

    setIsResubmittingReview(true);
    setMessage(null);

    try {
      const result = await postJson<ResubmitReviewResponse>('/api/auth/account/review/resubmit', {
        reviewInfo,
      });
      setSession(result.user);
      setMessage('审核信息已提交，账户重新进入待审核状态。');
      setActiveDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交审核信息失败。');
    } finally {
      setIsResubmittingReview(false);
    }
  };

  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const expirationReminderDays = Number(form.get('expirationReminderDays'));

    if (!Number.isInteger(expirationReminderDays) || expirationReminderDays < 1 || expirationReminderDays > 90) {
      setMessage('过期提醒时间需要设置为 1 到 90 天之间的整数。');
      return;
    }

    setIsSavingPreferences(true);
    setMessage(null);

    try {
      const result = await postJson<AccountPreferencesResponse>('/api/auth/account/preferences', {
        expirationReminderDays,
      });
      setSession(result.user);
      setMessage('提醒偏好已保存。');
      setActiveDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存提醒偏好失败。');
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const revokeDevice = async (device: AccountDevice) => {
    if (!window.confirm(`撤销「${device.label ?? formatDeviceSystem(device.system)}」吗？该设备上的登录会话会失效。`)) {
      return;
    }

    setRevokingDeviceId(device.id);
    setMessage(null);

    try {
      await postJson(`/api/auth/account/devices/${device.id}/revoke`);
      const revokedAt = new Date().toISOString();
      setDevices((currentDevices) =>
        currentDevices.map((item) =>
          item.id === device.id
            ? {
                ...item,
                revokedAt,
                activeSessionCount: 0,
              }
            : item,
        ),
      );
      setMessage('设备已撤销，该设备上的登录会话会失效。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销设备失败。');
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const startServerRebind = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const serverId = String(form.get('serverId') ?? '').trim();

    if (!serverId) {
      setMessage('请输入要绑定的服务器 ID。');
      return;
    }

    setIsStartingServerRebind(true);
    setMessage(null);

    try {
      const result = await postJson<ServerAccountRebindStartResponse>('/api/auth/account/server-account/rebind/start', {
        serverId,
      });
      setSession(result.user);
      setServerRebindChallenge(result.challenge);
      setMessage(
        `请在服务器聊天中使用 ${result.challenge.serverId} 发送验证码 ${result.challenge.code}，有效期至 ${new Date(result.challenge.expiresAt).toLocaleString('zh-CN')}。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '开始服务器账号换绑失败。');
    } finally {
      setIsStartingServerRebind(false);
    }
  };

  const checkServerRebind = async () => {
    if (!serverRebindChallenge) {
      return;
    }

    setIsCheckingServerRebind(true);
    setMessage(`正在检查 ${serverRebindChallenge.serverId} 是否发送了验证码 ${serverRebindChallenge.code}。`);

    try {
      const result = await postJson<ServerAccountRebindCheckResponse>(
        `/api/auth/account/server-account/rebind/${serverRebindChallenge.id}/check`,
      );
      setSession(result.user);

      if (result.status === 'verified') {
        setServerRebindChallenge(null);
        setMessage('服务器账号已换绑，其余设备会被退出登录。');
        setActiveDialog(null);
        const devicesResult = await getJson<AccountDevicesResponse>('/api/auth/account/devices');
        setDevices(devicesResult.devices);
        return;
      }

      if (result.status === 'expired') {
        setServerRebindChallenge(null);
        setMessage('验证码已过期，请重新开始换绑。');
        return;
      }

      if (result.status === 'rotated' && result.challenge) {
        setServerRebindChallenge(result.challenge);
        setMessage(
          `验证码已更新。请改为发送 ${result.challenge.code}，有效期至 ${new Date(result.challenge.expiresAt).toLocaleString('zh-CN')}。`,
        );
        return;
      }

      setMessage(`还没有检测到验证码。请确认 ${serverRebindChallenge.serverId} 已发送 ${serverRebindChallenge.code}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检查服务器账号换绑失败。');
    } finally {
      setIsCheckingServerRebind(false);
    }
  };

  const resolveDeviceApproval = async (approval: DeviceLoginApproval, action: 'approve' | 'reject') => {
    setResolvingApprovalId(approval.id);
    setMessage(null);

    try {
      await postJson(`/api/auth/account/device-login-approvals/${approval.id}/${action}`);
      setDeviceApprovals((currentApprovals) => currentApprovals.filter((item) => item.id !== approval.id));
      setMessage(action === 'approve' ? '已批准新设备登录，请回到新设备继续检查。' : '已拒绝新设备登录。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '处理新设备确认失败。');
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const canUseAccountSettings = session?.status === 'Active';
  const serverAccountLabel = session
    ? session.serverAccountVerified
      ? session.serverAccountName ?? '已验证'
      : session.serverAccountName
        ? `${session.serverAccountName} · 未验证`
        : '未验证'
    : '未登录';
  const activeDeviceCount = devices.filter((device) => !device.revokedAt).length;
  const activeDialogTitle = activeDialog ? getAccountDialogTitle(activeDialog) : '';

  return (
    <section className="account-page" aria-labelledby="account-title">
      <div className="account-titlebar">
        <div>
          <span className="account-kicker">账户中心</span>
          <h1 id="account-title">账户</h1>
        </div>
        <div className="account-titlebar-actions">
          <a className="secondary-action" href="/">
            返回钱包
          </a>
          <button className="secondary-action" type="button" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取账户信息。</p> : null}

      {session ? (
        <>
          <section className="account-summary" aria-label="账户总览">
            <UserAvatar avatarUrl={session.avatarUrl} fallbackUrl={session.avatarFallbackUrl} />
            <div className="account-summary-main">
              <strong>{session.username}</strong>
              <span>{session.email}</span>
            </div>
            <dl className="account-summary-grid">
              <div>
                <dt>状态</dt>
                <dd>{session.status}</dd>
              </div>
              <div>
                <dt>服务器账号</dt>
                <dd>{serverAccountLabel}</dd>
              </div>
              <div>
                <dt>权益提醒</dt>
                <dd>提前 {session.expirationReminderDays} 天</dd>
              </div>
              <div>
                <dt>绑定设备</dt>
                <dd>{isDevicesLoading ? '读取中' : `${activeDeviceCount} 台`}</dd>
              </div>
            </dl>
            {session.reviewRejectedReason ? (
              <p className="detail-status detail-status-error">拒绝原因：{session.reviewRejectedReason}</p>
            ) : null}
          </section>

          {canUseAccountSettings ? (
            <section className="account-settings-grid" aria-label="账户设置">
              <button className="account-setting-item" type="button" onClick={() => setActiveDialog('preferences')}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  notifications
                </span>
                <div>
                  <strong>提醒偏好</strong>
                  <small>权益过期前 {session.expirationReminderDays} 天提醒</small>
                </div>
                <span className="material-symbols-rounded" aria-hidden="true">
                  chevron_right
                </span>
              </button>
              <button className="account-setting-item" type="button" onClick={() => setActiveDialog('pin')}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  pin
                </span>
                <div>
                  <strong>PIN</strong>
                  <small>用于确认核销、充值等敏感操作</small>
                </div>
                <span className="material-symbols-rounded" aria-hidden="true">
                  chevron_right
                </span>
              </button>
              <button className="account-setting-item" type="button" onClick={() => setActiveDialog('server')}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  verified_user
                </span>
                <div>
                  <strong>服务器账号</strong>
                  <small>{serverAccountLabel}</small>
                </div>
                <span className="material-symbols-rounded" aria-hidden="true">
                  chevron_right
                </span>
              </button>
              <button className="account-setting-item" type="button" onClick={() => setActiveDialog('deviceApprovals')}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  mobile_lock
                </span>
                <div>
                  <strong>新设备确认</strong>
                  <small>{isDeviceApprovalsLoading ? '读取中' : `${deviceApprovals.length} 个待处理`}</small>
                </div>
                <span className="material-symbols-rounded" aria-hidden="true">
                  chevron_right
                </span>
              </button>
              <button className="account-setting-item" type="button" onClick={() => setActiveDialog('devices')}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  devices
                </span>
                <div>
                  <strong>已绑定设备</strong>
                  <small>{isDevicesLoading ? '读取中' : `${devices.length} 条记录`}</small>
                </div>
                <span className="material-symbols-rounded" aria-hidden="true">
                  chevron_right
                </span>
              </button>
              <button className="account-setting-item account-setting-danger" type="button" onClick={() => setActiveDialog('delete')}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  delete
                </span>
                <div>
                  <strong>注销账户</strong>
                  <small>删除当前账户并退出登录</small>
                </div>
                <span className="material-symbols-rounded" aria-hidden="true">
                  chevron_right
                </span>
              </button>
            </section>
          ) : (
            <section className="account-state-panel" aria-labelledby="inactive-account-title">
              <div>
                <h2 id="inactive-account-title">账户暂未激活</h2>
                <p>{formatInactiveAccountMessage(session.status)}</p>
                {session.reviewRejectedReason ? <p>管理员反馈：{session.reviewRejectedReason}</p> : null}
              </div>
              <div className="form-actions compact-actions">
                {session.status === 'Rejected' || session.status === 'PendingReview' ? (
                  <button className="primary-action" type="button" onClick={() => setActiveDialog('review')}>
                    补充审核信息
                  </button>
                ) : null}
                <a className="secondary-action" href="/register">
                  返回注册流程
                </a>
                <button className="secondary-action" type="button" onClick={() => setActiveDialog('delete')}>
                  注销账户
                </button>
              </div>
            </section>
          )}
        </>
      ) : !isLoading ? (
        <div className="form-actions">
          <a className="primary-action" href="/login">
            <span className="material-symbols-rounded" aria-hidden="true">
              login
            </span>
            <span>去登录</span>
          </a>
        </div>
      ) : null}

      {activeDialog && session ? (
        <div className="detail-module-slot account-dialog is-dialog" role="dialog" aria-modal="true" aria-label={activeDialogTitle}>
          <button
            className="detail-module-backdrop"
            type="button"
            aria-label="关闭弹窗"
            onClick={() => setActiveDialog(null)}
          />
          <div className="detail-module-panel account-dialog-panel">
            <div className="detail-module-toolbar">
              <strong>{activeDialogTitle}</strong>
              <button
                className="detail-close-button"
                type="button"
                aria-label="关闭"
                onClick={() => setActiveDialog(null)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            {activeDialog === 'preferences' ? (
              <form className="stacked-form" onSubmit={savePreferences} noValidate>
                <label>
                  <span>过期前提醒天数</span>
                  <input
                    type="number"
                    name="expirationReminderDays"
                    min={1}
                    max={90}
                    step={1}
                    inputMode="numeric"
                    defaultValue={session.expirationReminderDays}
                    required
                  />
                </label>
                <div className="form-actions">
                  <button className="primary-action" type="submit" disabled={isSavingPreferences}>
                    {isSavingPreferences ? '保存中' : '保存'}
                  </button>
                </div>
              </form>
            ) : null}

            {activeDialog === 'pin' ? (
              <form className="stacked-form" onSubmit={setPin} noValidate>
                <label>
                  <span>当前密码</span>
                  <input type="password" name="pinPassword" autoComplete="current-password" required />
                </label>
                <label>
                  <span>PIN</span>
                  <input type="password" name="pin" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="off" required />
                </label>
                <div className="form-actions">
                  <button className="primary-action" type="submit" disabled={isSettingPin}>
                    {isSettingPin ? '保存中' : '保存'}
                  </button>
                </div>
              </form>
            ) : null}

            {activeDialog === 'server' ? (
              <form className="stacked-form" onSubmit={startServerRebind} noValidate>
                <label>
                  <span>新的服务器 ID</span>
                  <input type="text" name="serverId" maxLength={64} defaultValue={session.serverAccountName ?? ''} required />
                </label>
                {serverRebindChallenge ? (
                  <div className="flow-notice" role="status" aria-live="polite">
                    <strong>{serverRebindChallenge.code}</strong>
                    <span>请在服务器聊天中用 {serverRebindChallenge.serverId} 发送上面的验证码。</span>
                    <div className="form-actions">
                      <button className="secondary-action" type="button" disabled={isCheckingServerRebind} onClick={() => void checkServerRebind()}>
                        {isCheckingServerRebind ? '检查中' : '我已发送，检查'}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="form-actions">
                  <button className="primary-action" type="submit" disabled={isStartingServerRebind}>
                    {isStartingServerRebind ? '发送中' : '开始换绑'}
                  </button>
                </div>
              </form>
            ) : null}

            {activeDialog === 'deviceApprovals' ? (
              <section className="stacked-form" aria-label="新设备登录确认">
                {isDeviceApprovalsLoading ? <p className="empty-note">正在读取新设备请求。</p> : null}
                {!isDeviceApprovalsLoading && deviceApprovals.length === 0 ? <p className="empty-note">暂无待确认的新设备登录。</p> : null}
                <div className="account-device-list">
                  {deviceApprovals.map((approval) => (
                    <article className="account-device-item" key={approval.id}>
                      <div>
                        <strong>{approval.deviceLabel ?? formatDeviceSystem(approval.deviceSystem)}</strong>
                        <span>{formatDeviceSystem(approval.deviceSystem)} · IP {approval.ipAddress ?? '未知'}</span>
                        <span>发起时间：{new Date(approval.createdAt).toLocaleString('zh-CN')}</span>
                        <span>有效期至：{new Date(approval.expiresAt).toLocaleString('zh-CN')}</span>
                      </div>
                      <div className="form-actions compact-actions">
                        <button className="secondary-action" type="button" disabled={resolvingApprovalId === approval.id} onClick={() => void resolveDeviceApproval(approval, 'reject')}>
                          拒绝
                        </button>
                        <button className="primary-action" type="button" disabled={resolvingApprovalId === approval.id} onClick={() => void resolveDeviceApproval(approval, 'approve')}>
                          批准
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeDialog === 'devices' ? (
              <section className="stacked-form" aria-label="已绑定设备">
                {isDevicesLoading ? <p className="empty-note">正在读取设备列表。</p> : null}
                <div className="account-device-list">
                  {devices.map((device) => (
                    <article className="account-device-item" key={device.id}>
                      <div>
                        <strong>{device.label ?? formatDeviceSystem(device.system)}</strong>
                        <span>{formatDeviceSystem(device.system)} · {device.revokedAt ? '已撤销' : `${device.activeSessionCount} 个活动会话`}</span>
                        <span>最近更新：{new Date(device.updatedAt).toLocaleString('zh-CN')}</span>
                      </div>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={Boolean(device.revokedAt) || revokingDeviceId === device.id}
                        onClick={() => void revokeDevice(device)}
                      >
                        {revokingDeviceId === device.id ? '撤销中' : device.revokedAt ? '已撤销' : '撤销'}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeDialog === 'review' ? (
              <form className="stacked-form" onSubmit={resubmitReviewInfo} noValidate>
                <label>
                  <span>审核信息</span>
                  <textarea name="reviewInfo" rows={5} maxLength={2000} defaultValue={session.reviewInfo ?? ''} required />
                </label>
                <div className="form-actions">
                  <button className="primary-action" type="submit" disabled={isResubmittingReview}>
                    {isResubmittingReview ? '提交中' : '提交'}
                  </button>
                </div>
              </form>
            ) : null}

            {activeDialog === 'delete' ? (
              <form className="stacked-form danger-zone" onSubmit={deleteAccount} noValidate>
                <p>注销后当前账号将被删除，已有关联记录会按系统规则保留或脱敏用于审计。</p>
                <label>
                  <span>当前密码</span>
                  <input type="password" name="password" autoComplete="current-password" required />
                </label>
                <div className="form-actions">
                  <button className="danger-action" type="submit" disabled={isDeleting}>
                    <span className="material-symbols-rounded" aria-hidden="true">
                      delete
                    </span>
                    <span>{isDeleting ? '注销中' : '注销账户'}</span>
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getAccountDialogTitle(dialog: AccountDialog): string {
  const labels: Record<AccountDialog, string> = {
    preferences: '提醒偏好',
    pin: 'PIN',
    server: '服务器账号',
    deviceApprovals: '新设备确认',
    devices: '已绑定设备',
    review: '审核信息',
    delete: '注销账户',
  };

  return labels[dialog];
}

function formatDeviceSystem(system: AccountDevice['system']): string {
  const labels: Record<AccountDevice['system'], string> = {
    android: 'Android',
    ios: 'iOS',
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    other: '其他系统',
  };

  return labels[system];
}

function formatInactiveAccountMessage(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '账户注册申请正在等待管理员审核，通过后才能使用卡包和账户安全设置。',
    Rejected: '账户注册申请未通过，请根据管理员反馈补充信息后重新提交。',
    WaitingServerVerification: '账户正在等待服务器账号验证，请回到注册流程完成验证。',
    CodeRotated: '服务器验证码已更新，请使用最新验证码完成验证。',
    Verified: '服务器账号已验证，账户正在完成激活，请稍后刷新。',
    Approved: '账户已通过审核，正在完成激活，请稍后刷新。',
    Suspended: '账户已被管理员封禁，暂不能使用卡包、设备设置和敏感操作。你仍可以退出登录或注销账户。',
    Deleted: '账户已被删除，暂不能继续使用。你可以退出登录或联系管理员确认处理结果。',
    Draft: '账户注册信息尚未提交完成。',
    Failed: '账户注册流程失败，请重新提交注册申请或联系管理员。',
  };

  return labels[status] ?? `账户当前状态为 ${status}，暂不能使用卡包和账户安全设置。`;
}
