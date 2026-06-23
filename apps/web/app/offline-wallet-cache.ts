'use client';

const latestSnapshotKey = 'ldpass.wallet.offline.latest';
const snapshotKeyPrefix = 'ldpass.wallet.offline.snapshot.';
const maxCachedPasses = 80;

export interface OfflineWalletPass {
  id: string;
  providerName: string;
  displayName: string;
  title: string;
  hideTitle?: boolean;
  allowTopUpIn?: boolean;
  allowTopUpOut?: boolean;
  category: 'account' | 'identity_key' | 'ticket';
  benefitType: 'amount' | 'points' | 'times';
  status: string;
  maskedNumber: string | null;
  backgroundImageUrl?: string | null;
  balanceValue: string;
  frozenValue: string;
  overdraftLimit: string;
  expiresAt: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface OfflineWalletSnapshot {
  generatedAt: string;
  user: {
    id?: string;
    username: string;
  };
  passes: OfflineWalletPass[];
}

export function saveOfflineWalletSnapshot(snapshot: OfflineWalletSnapshot) {
  const safeSnapshot = sanitizeSnapshot(snapshot);

  if (!safeSnapshot) {
    return;
  }

  try {
    window.localStorage.setItem(getSnapshotKey(safeSnapshot.user.username), JSON.stringify(safeSnapshot));
    window.localStorage.setItem(latestSnapshotKey, safeSnapshot.user.username);
  } catch {
    // 存储空间不足或隐私模式下不可写时，离线缓存自动降级为不可用。
  }
}

export function loadOfflineWalletSnapshot(username?: string | null): OfflineWalletSnapshot | null {
  try {
    const targetUsername = username ?? window.localStorage.getItem(latestSnapshotKey);

    if (!targetUsername) {
      return null;
    }

    const payload = window.localStorage.getItem(getSnapshotKey(targetUsername));
    if (!payload) {
      return null;
    }

    return sanitizeSnapshot(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

function getSnapshotKey(username: string) {
  return `${snapshotKeyPrefix}${encodeURIComponent(username)}`;
}

function sanitizeSnapshot(value: unknown): OfflineWalletSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<OfflineWalletSnapshot>;
  const username = snapshot.user?.username;

  if (typeof snapshot.generatedAt !== 'string' || typeof username !== 'string' || !Array.isArray(snapshot.passes)) {
    return null;
  }

  return {
    generatedAt: snapshot.generatedAt,
    user: {
      ...(typeof snapshot.user?.id === 'string' ? { id: snapshot.user.id } : {}),
      username,
    },
    passes: snapshot.passes.slice(0, maxCachedPasses).flatMap((pass) => {
      const safePass = sanitizePass(pass);
      return safePass ? [safePass] : [];
    }),
  };
}

function sanitizePass(value: unknown): OfflineWalletPass | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const pass = value as Partial<OfflineWalletPass>;

  if (
    typeof pass.id !== 'string' ||
    typeof pass.providerName !== 'string' ||
    typeof pass.displayName !== 'string' ||
    typeof pass.title !== 'string' ||
    !isCategory(pass.category) ||
    !isBenefitType(pass.benefitType) ||
    typeof pass.status !== 'string' ||
    typeof pass.balanceValue !== 'string' ||
    typeof pass.frozenValue !== 'string' ||
    typeof pass.overdraftLimit !== 'string' ||
    typeof pass.sortOrder !== 'number' ||
    typeof pass.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: pass.id,
    providerName: pass.providerName,
    displayName: pass.displayName,
    title: pass.title,
    hideTitle: pass.hideTitle === true,
    allowTopUpIn: pass.allowTopUpIn === true,
    allowTopUpOut: pass.allowTopUpOut === true,
    category: pass.category,
    benefitType: pass.benefitType,
    status: pass.status,
    maskedNumber: typeof pass.maskedNumber === 'string' ? pass.maskedNumber : null,
    backgroundImageUrl:
      typeof pass.backgroundImageUrl === 'string' ? pass.backgroundImageUrl : null,
    balanceValue: pass.balanceValue,
    frozenValue: pass.frozenValue,
    overdraftLimit: pass.overdraftLimit,
    expiresAt: typeof pass.expiresAt === 'string' ? pass.expiresAt : null,
    sortOrder: pass.sortOrder,
    updatedAt: pass.updatedAt,
  };
}

function isCategory(value: unknown): value is OfflineWalletPass['category'] {
  return value === 'account' || value === 'identity_key' || value === 'ticket';
}

function isBenefitType(value: unknown): value is OfflineWalletPass['benefitType'] {
  return value === 'amount' || value === 'points' || value === 'times';
}
