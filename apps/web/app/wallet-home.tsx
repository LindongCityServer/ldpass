'use client';

import {
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { brandAssets } from '@ldpass/ui';
import { getJson, postJson } from './api-client';
import {
  loadOfflineWalletSnapshot,
  saveOfflineWalletSnapshot,
  type OfflineWalletSnapshot,
} from './offline-wallet-cache';
import { ThemeSettings } from './theme-provider';

const categories = [
  { key: 'account', label: '账户/卡', icon: 'credit_card', count: 0 },
  { key: 'identity_key', label: '证件/钥匙', icon: 'vpn_key', count: 0 },
  { key: 'ticket', label: '票券', icon: 'confirmation_number', count: 0 },
] as const;
const decimalInputPattern = '[0-9]+(\\.[0-9]{1,6})?';

const detailModuleLabels: Record<DetailModule, string> = {
  passInfo: '卡片详情',
  provider: '发卡方',
  ticket: '票券信息',
  location: '位置核验',
  topUp: '充值',
  topUpSource: '选择来源卡',
  transfer: '转赠',
  use: '发起核销',
  redemptions: '待确认核销',
  disputes: '争议记录',
  createDispute: '提交争议',
  ledger: '交易记录',
};

type CategoryKey = (typeof categories)[number]['key'];
type DisputeSubjectType = 'pass' | 'pass_top_up';

interface WalletHomeProps {
  initialCategory: string | undefined;
  initialPassId?: string | undefined;
}

interface SessionResponse {
  user: {
    username: string;
    status: string;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
    avatarUrl: string | null;
    avatarFallbackUrl: string | null;
  } | null;
}

interface WalletPass {
  id: string;
  providerName: string;
  displayName: string;
  title: string;
  hideTitle?: boolean;
  allowTopUpIn?: boolean;
  allowTopUpOut?: boolean;
  category: CategoryKey;
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

interface ReorderPassesResponse {
  ok: true;
  passes: Array<{
    id: string;
    sortOrder: number;
  }>;
}

interface WalletPassDetail extends WalletPass {
  description: string | null;
  publicNumber: string | null;
  providerIntroductionUrl: string | null;
  addedAt: string | null;
  cardStyle: unknown;
  fields: unknown;
  rules: unknown;
  backgroundImageUrl: string | null;
  logoUrl: string | null;
  ticketInfo: WalletTicketInfo | null;
  locationVerification: WalletLocationVerification | null;
}

interface WalletTicketInfo {
  eventName: string | null;
  venue: string | null;
  startsAt: string | null;
  seatLabel: string | null;
  checkInStatus: 'not_checked_in' | 'checked_in' | 'voided';
  changeStatus: 'none' | 'rescheduled' | 'cancelled';
}

interface WalletLocationVerification {
  required: boolean;
  rules: {
    version: 1;
    rules: WalletLocationRule[];
  } | null;
}

interface WalletLocationRule {
  id: string;
  kind: 'circle' | 'rectangle';
  label: string;
  centerX?: number;
  centerZ?: number;
  radius?: number;
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  expiresAfterSeconds: number;
}

interface WalletLedgerEntry {
  id: string;
  benefitType: WalletPass['benefitType'];
  reason: 'issue' | 'grant' | 'use' | 'top_up' | 'adjustment' | 'refund' | 'sync';
  beforeValue: string;
  changeValue: string;
  afterValue: string;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdByType: 'user' | 'provider' | 'admin' | 'system';
  createdAt: string;
}

interface WalletPassDetailResponse {
  pass: WalletPassDetail;
}

interface WalletPassLedgerResponse {
  ledgerEntries: WalletLedgerEntry[];
}

type DetailModule =
  | 'passInfo'
  | 'provider'
  | 'ticket'
  | 'location'
  | 'topUp'
  | 'topUpSource'
  | 'transfer'
  | 'use'
  | 'redemptions'
  | 'disputes'
  | 'createDispute'
  | 'ledger';

interface WalletRedemptionPass {
  id: string;
  providerName: string;
  displayName: string;
  title: string;
  hideTitle?: boolean;
  allowTopUpIn?: boolean;
  allowTopUpOut?: boolean;
  category: CategoryKey;
  benefitType: WalletPass['benefitType'];
  status: string;
  publicNumber: string | null;
  maskedNumber: string | null;
  backgroundImageUrl?: string | null;
  balanceValue: string;
  frozenValue: string;
  overdraftLimit: string;
  expiresAt: string | null;
  addedAt: string | null;
  sortOrder: number;
  updatedAt: string;
}

interface WalletRedemptionRequest {
  id: string;
  providerName: string;
  status: string;
  verificationMethod: 'server_account' | 'pin';
  requestedValue: string;
  expiresAt: string;
  verificationFailureCount: number;
  maxVerificationAttempts: number;
  failureMessage: string | null;
  pass: WalletRedemptionPass;
}

interface WalletRedemptionsResponse {
  redemptionRequests: WalletRedemptionRequest[];
}

interface CreateWalletRedemptionResponse {
  redemptionRequest: WalletRedemptionRequest;
}

interface ConfirmRedemptionResponse {
  redemptionRequest: WalletRedemptionRequest;
  pass: WalletRedemptionPass;
  ledgerEntry: {
    id: string;
    beforeValue: string;
    changeValue: string;
    afterValue: string;
    reason: WalletLedgerEntry['reason'];
    note: string | null;
    createdAt: string;
  } | null;
}

interface ServerRedemptionChallenge {
  id: string;
  serverId: string;
  code: string;
  expiresAt: string;
}

interface StartServerRedemptionChallengeResponse {
  status: 'challenge_issued';
  redemptionRequest: WalletRedemptionRequest;
  challenge: ServerRedemptionChallenge;
}

interface ConfirmServerRedemptionResponse {
  status: 'waiting' | 'rotated' | 'expired' | 'verified';
  redemptionRequest: WalletRedemptionRequest;
  pass?: WalletRedemptionPass;
  ledgerEntry?: ConfirmRedemptionResponse['ledgerEntry'];
  challenge?: ServerRedemptionChallenge;
}

interface WalletDispute {
  id: string;
  status:
    | 'Submitted'
    | 'InReview'
    | 'NeedMoreInfo'
    | 'Approved'
    | 'Rejected'
    | 'Reversed'
    | 'Closed';
  subjectType: string;
  subjectId: string;
  reason: string;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WalletDisputesResponse {
  disputes: WalletDispute[];
}

interface CreateDisputeResponse {
  dispute: WalletDispute;
}

interface WalletPassTransfer {
  id: string;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Cancelled' | 'Expired';
  note: string | null;
  responseReason: string | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  fromUser: {
    id: string;
    username: string;
    email: string;
  };
  toUser: {
    id: string;
    username: string;
    email: string;
  };
  pass: {
    id: string;
    providerName: string;
    displayName: string;
    title: string;
    hideTitle?: boolean;
    allowTopUpIn?: boolean;
    allowTopUpOut?: boolean;
    category: CategoryKey;
    benefitType: WalletPass['benefitType'];
    status: string;
    maskedNumber: string | null;
    balanceValue: string;
  };
}

interface WalletPassTransfersResponse {
  sentTransfers: WalletPassTransfer[];
  receivedTransfers: WalletPassTransfer[];
}

interface WalletPassTransferResponse {
  transfer: WalletPassTransfer;
}

interface WalletTopUpResponse {
  topUp: {
    id: string;
    status?: TopUpRequestStatus;
    value: string;
    sourceLedgerEntryId: string;
    targetLedgerEntryId: string;
  };
  sourcePass: WalletPass;
  targetPass: WalletPass;
  ledgerEntry: WalletLedgerEntry;
}

interface TopUpServerChallenge {
  id: string;
  serverId: string;
  code: string;
  expiresAt: string;
}

type TopUpRequestStatus =
  | 'Created'
  | 'WaitingVerification'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'
  | 'Expired'
  | 'Reversed';

interface TopUpRequestView {
  id: string;
  status: TopUpRequestStatus;
  sourcePassId: string;
  targetPassId: string;
  value: string;
  verificationMethod: 'pin' | 'server_account';
  expiresAt: string | null;
}

interface DisputableTopUpRequest extends TopUpRequestView {
  targetPassTitle?: string;
  sourcePassTitle?: string;
}

interface WalletTopUpHistoryItem {
  id: string;
  status: TopUpRequestStatus;
  value: string;
  verificationMethod: 'pin' | 'server_account';
  note: string | null;
  actionLinkId: string | null;
  sourceLedgerEntryId: string | null;
  targetLedgerEntryId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  reversedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourcePass: WalletPass;
  targetPass: WalletPass;
}

interface WalletTopUpHistoryResponse {
  topUpRequests: WalletTopUpHistoryItem[];
}

interface StartTopUpServerChallengeResponse {
  status: 'challenge_issued';
  challenge: TopUpServerChallenge;
  topUpRequest: TopUpRequestView;
  topUpPreview: {
    targetPassId: string;
    sourcePassId: string;
    value: string;
    note: string | null;
  };
}

interface ConfirmTopUpWithServerResponse extends Partial<WalletTopUpResponse> {
  status: 'waiting' | 'rotated' | 'expired' | 'verified' | 'cancelled' | 'failed';
  challenge?: TopUpServerChallenge;
  topUpRequest?: TopUpRequestView;
}

interface CancelTopUpRequestResponse {
  topUpRequest: TopUpRequestView;
}

interface WalletNotification {
  id: string;
  kind: 'pass_expiration';
  title: string;
  body: string;
  passId: string | null;
  providerName: string | null;
  displayName: string | null;
  benefitType: WalletPass['benefitType'] | null;
  maskedNumber: string | null;
  expiresAt: string | null;
  readAt: string | null;
  createdAt: string;
}

interface WalletNotificationsResponse {
  notifications: WalletNotification[];
}

interface WalletNotificationResponse {
  notification: WalletNotification;
}

interface VerifyLocationResponse {
  ok: true;
  verifiedAt: string;
  expiresAt: string;
  player: {
    name: string;
    x: number;
    z: number;
  };
  rule: {
    id: string;
    label: string;
    kind: 'circle' | 'rectangle';
    expiresAfterSeconds: number;
  };
}

export function WalletHome({ initialCategory, initialPassId }: WalletHomeProps) {
  const initialCategoryKey = useMemo<CategoryKey>(() => {
    return categories.find((category) => category.key === initialCategory)?.key ?? 'account';
  }, [initialCategory]);
  const hasAppliedInitialPassRef = useRef(false);

  const [selectedCategoryKey, setSelectedCategoryKey] = useState<CategoryKey>(initialCategoryKey);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sessionUser, setSessionUser] = useState<SessionResponse['user']>(null);
  const [passes, setPasses] = useState<WalletPass[]>([]);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [hasLoadedWallet, setHasLoadedWallet] = useState(false);
  const [isUsingOfflineSnapshot, setIsUsingOfflineSnapshot] = useState(false);
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [selectedPassId, setSelectedPassId] = useState<string | null>(null);
  const [isDetailClosing, setIsDetailClosing] = useState(false);
  const detailCloseTimerRef = useRef<number | null>(null);
  const [passDetail, setPassDetail] = useState<WalletPassDetailResponse | null>(null);
  const [activeDetailModule, setActiveDetailModule] = useState<DetailModule | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedgerEntry[]>([]);
  const [redemptionRequests, setRedemptionRequests] = useState<WalletRedemptionRequest[]>([]);
  const [disputes, setDisputes] = useState<WalletDispute[]>([]);
  const [topUpHistory, setTopUpHistory] = useState<WalletTopUpHistoryItem[]>([]);
  const [sentTransfers, setSentTransfers] = useState<WalletPassTransfer[]>([]);
  const [receivedTransfers, setReceivedTransfers] = useState<WalletPassTransfer[]>([]);
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [passDetailMessage, setPassDetailMessage] = useState<string | null>(null);
  const [redemptionMessage, setRedemptionMessage] = useState<string | null>(null);
  const [disputeMessage, setDisputeMessage] = useState<string | null>(null);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [topUpMessage, setTopUpMessage] = useState<string | null>(null);
  const [topUpHistoryMessage, setTopUpHistoryMessage] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [isPassDetailLoading, setIsPassDetailLoading] = useState(false);
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);
  const [isRedemptionsLoading, setIsRedemptionsLoading] = useState(false);
  const [isDisputesLoading, setIsDisputesLoading] = useState(false);
  const [isTopUpHistoryLoading, setIsTopUpHistoryLoading] = useState(false);
  const [isTransfersLoading, setIsTransfersLoading] = useState(false);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
  const [confirmingRedemptionId, setConfirmingRedemptionId] = useState<string | null>(null);
  const [selfRedemptionValue, setSelfRedemptionValue] = useState('');
  const [selfRedemptionMethod, setSelfRedemptionMethod] =
    useState<WalletRedemptionRequest['verificationMethod']>('pin');
  const [isCreatingSelfRedemption, setIsCreatingSelfRedemption] = useState(false);
  const [resolvingTransferId, setResolvingTransferId] = useState<string | null>(null);
  const [readingNotificationId, setReadingNotificationId] = useState<string | null>(null);
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [serverRedemptionChallenges, setServerRedemptionChallenges] = useState<
    Record<string, ServerRedemptionChallenge>
  >({});
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeSubjectType, setDisputeSubjectType] = useState<DisputeSubjectType>('pass');
  const [disputeTopUpId, setDisputeTopUpId] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [transferRecipient, setTransferRecipient] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const [topUpSourcePassId, setTopUpSourcePassId] = useState('');
  const [topUpValue, setTopUpValue] = useState('');
  const [topUpNote, setTopUpNote] = useState('');
  const [topUpVerificationMethod, setTopUpVerificationMethod] = useState<'pin' | 'server_account'>(
    'pin',
  );
  const [topUpPin, setTopUpPin] = useState('');
  const [topUpServerChallenge, setTopUpServerChallenge] = useState<TopUpServerChallenge | null>(
    null,
  );
  const [topUpRequest, setTopUpRequest] = useState<TopUpRequestView | null>(null);
  const [recentTopUpRequest, setRecentTopUpRequest] = useState<DisputableTopUpRequest | null>(null);
  const [isSubmittingTopUp, setIsSubmittingTopUp] = useState(false);
  const [locationVerificationMessage, setLocationVerificationMessage] = useState<string | null>(
    null,
  );
  const [isVerifyingLocation, setIsVerifyingLocation] = useState(false);
  const [ledgerMessage, setLedgerMessage] = useState<string | null>(null);

  const applyPassSelection = (nextPasses: WalletPass[]) => {
    if (!hasAppliedInitialPassRef.current && initialPassId) {
      hasAppliedInitialPassRef.current = true;
      const initialPass = nextPasses.find((pass) => pass.id === initialPassId);

      if (initialPass) {
        setSelectedCategoryKey(initialPass.category);
        setSearchKeyword('');
        setSelectedPassId(initialPass.id);
        return;
      }

      setWalletMessage('链接中的卡券不在当前钱包中，可能已经被移除或不属于当前账户。');
    }

    setSelectedPassId((currentPassId) =>
      currentPassId && nextPasses.some((pass) => pass.id === currentPassId) ? currentPassId : null,
    );
  };

  useEffect(() => {
    let isMounted = true;

    async function loadWallet() {
      try {
        const session = await getJson<SessionResponse>('/api/auth/session');

        if (!isMounted) {
          return;
        }

        setSessionUser(session.user);

        if (!session.user) {
          setPasses([]);
          setSelectedPassId(null);
          setIsUsingOfflineSnapshot(false);
          setOfflineSnapshotAt(null);
          setWalletMessage(null);
          return;
        }

        if (session.user.status !== 'Active') {
          setPasses([]);
          setSelectedPassId(null);
          setIsUsingOfflineSnapshot(false);
          setOfflineSnapshotAt(null);
          setWalletMessage(formatInactiveAccountMessage(session.user.status));
          return;
        }

        const snapshot = await getJson<OfflineWalletSnapshot>('/api/wallet/offline-snapshot');

        if (!isMounted) {
          return;
        }

        saveOfflineWalletSnapshot(snapshot);
        setPasses(snapshot.passes);
        setIsUsingOfflineSnapshot(false);
        setOfflineSnapshotAt(snapshot.generatedAt);
        setWalletMessage(null);
        applyPassSelection(snapshot.passes);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const cachedSnapshot = loadOfflineWalletSnapshot();

        if (cachedSnapshot) {
          setSessionUser({
            username: cachedSnapshot.user.username,
            status: 'Active',
            serverAccountName: null,
            serverAccountVerified: false,
            avatarUrl: null,
            avatarFallbackUrl: null,
          });
          setPasses(cachedSnapshot.passes);
          setIsUsingOfflineSnapshot(true);
          setOfflineSnapshotAt(cachedSnapshot.generatedAt);
          setWalletMessage(
            `当前使用离线卡券数据，更新时间 ${formatDate(cachedSnapshot.generatedAt, '未知')}。连接恢复后会自动同步。`,
          );
          applyPassSelection(cachedSnapshot.passes);
          return;
        }

        setSessionUser(null);
        setPasses([]);
        setSelectedPassId(null);
        setIsUsingOfflineSnapshot(false);
        setOfflineSnapshotAt(null);
        setWalletMessage(error instanceof Error ? error.message : '读取钱包失败。');
      } finally {
        if (isMounted) {
          setHasLoadedWallet(true);
        }
      }
    }

    void loadWallet();

    return () => {
      isMounted = false;
    };
  }, []);

  const refreshWalletSnapshot = async () => {
    const snapshot = await getJson<OfflineWalletSnapshot>('/api/wallet/offline-snapshot');
    saveOfflineWalletSnapshot(snapshot);
    setPasses(snapshot.passes);
    setIsUsingOfflineSnapshot(false);
    setOfflineSnapshotAt(snapshot.generatedAt);
    setWalletMessage(null);
    applyPassSelection(snapshot.passes);
  };

  useEffect(() => {
    if (!isActiveSessionUser(sessionUser)) {
      setSentTransfers([]);
      setReceivedTransfers([]);
      setTransferMessage(null);
      setIsTransfersLoading(false);
      return;
    }

    if (isUsingOfflineSnapshot) {
      setSentTransfers([]);
      setReceivedTransfers([]);
      setTransferMessage('离线模式不能处理转赠请求。');
      setIsTransfersLoading(false);
      return;
    }

    let isMounted = true;
    setIsTransfersLoading(true);
    setTransferMessage(null);

    getJson<WalletPassTransfersResponse>('/api/wallet/transfers')
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setSentTransfers(result.sentTransfers);
        setReceivedTransfers(result.receivedTransfers);
      })
      .catch((error) => {
        if (isMounted) {
          setSentTransfers([]);
          setReceivedTransfers([]);
          setTransferMessage(error instanceof Error ? error.message : '读取转赠请求失败。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsTransfersLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isUsingOfflineSnapshot, sessionUser]);

  useEffect(() => {
    if (!isActiveSessionUser(sessionUser)) {
      setNotifications([]);
      setNotificationMessage(null);
      setIsNotificationsLoading(false);
      return;
    }

    if (isUsingOfflineSnapshot) {
      setNotifications([]);
      setNotificationMessage(null);
      setIsNotificationsLoading(false);
      return;
    }

    let isMounted = true;
    setIsNotificationsLoading(true);
    setNotificationMessage(null);

    getJson<WalletNotificationsResponse>('/api/notifications')
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setNotifications(result.notifications);
      })
      .catch((error) => {
        if (isMounted) {
          setNotifications([]);
          setNotificationMessage(error instanceof Error ? error.message : '读取提醒失败。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsNotificationsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isUsingOfflineSnapshot, sessionUser]);

  const categoryCounts = useMemo(() => {
    return categories.map((category) => ({
      ...category,
      count: passes.filter((pass) => pass.category === category.key).length,
    }));
  }, [passes]);
  const selectedCategory = categoryCounts.find(
    (category) => category.key === selectedCategoryKey,
  ) ?? {
    key: 'account',
    label: '账户/卡',
    icon: 'credit_card',
    count: 0,
  };
  const selectedCategoryPasses = passes.filter((pass) => pass.category === selectedCategory.key);
  const filteredPasses = selectedCategoryPasses.filter((pass) => {
    if (!searchKeyword.trim()) {
      return true;
    }

    const keyword = searchKeyword.trim().toLowerCase();
    return [pass.providerName, pass.displayName, pass.title, pass.maskedNumber ?? '']
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  });
  const selectedPass = filteredPasses.find((pass) => pass.id === selectedPassId) ?? null;
  const isDetailOpen = Boolean(selectedPass);
  const unreadNotifications = notifications.filter((notification) => !notification.readAt);
  const pendingReceivedTransfers = receivedTransfers.filter(
    (transfer) => transfer.status === 'Pending',
  );
  const selectedPassSentTransfers = selectedPass
    ? sentTransfers.filter(
        (transfer) => transfer.pass.id === selectedPass.id && transfer.status === 'Pending',
      )
    : [];
  const selectedPassStatus = passDetail?.pass.status ?? selectedPass?.status ?? '';
  const canUseSelectedPass = selectedPass
    ? selectedPassStatus === 'Added' || selectedPassStatus === 'Active'
    : false;
  const canTransferSelectedPass = selectedPass
    ? readTransferableRule(passDetail?.pass.rules)
    : false;
  const canTopUpSelectedPass = Boolean(
    selectedPass &&
      selectedPassStatus === 'Active' &&
      (passDetail?.pass.allowTopUpIn ?? selectedPass.allowTopUpIn) === true,
  );
  const topUpSourcePasses = useMemo(
    () =>
      selectedPass
        ? passes.filter(
            (pass) =>
              pass.id !== selectedPass.id &&
              pass.status === 'Active' &&
              pass.benefitType === selectedPass.benefitType &&
              pass.allowTopUpOut === true,
          )
        : [],
    [passes, selectedPass],
  );
  const selectedTopUpSourcePass =
    topUpSourcePasses.find((pass) => pass.id === topUpSourcePassId) ??
    topUpSourcePasses[0] ??
    null;
  const disputableTopUpOptions = useMemo(() => {
    if (!selectedPass) {
      return [];
    }

    const sourcePassTitle = topUpRequest
      ? passes.find((pass) => pass.id === topUpRequest.sourcePassId)?.displayName
      : null;
    const targetPassTitle = topUpRequest
      ? passes.find((pass) => pass.id === topUpRequest.targetPassId)?.displayName
      : null;
    const pendingTopUp = topUpRequest
      ? {
          ...topUpRequest,
          ...(sourcePassTitle ? { sourcePassTitle } : {}),
          ...(targetPassTitle ? { targetPassTitle } : {}),
        }
      : null;
    const candidates: DisputableTopUpRequest[] = [
      ...(pendingTopUp ? [pendingTopUp] : []),
      ...(recentTopUpRequest ? [recentTopUpRequest] : []),
      ...topUpHistory.map((request) => ({
        id: request.id,
        status: request.status,
        sourcePassId: request.sourcePass.id,
        targetPassId: request.targetPass.id,
        value: request.value,
        verificationMethod: request.verificationMethod,
        expiresAt: request.expiresAt,
        sourcePassTitle: request.sourcePass.displayName,
        targetPassTitle: request.targetPass.displayName,
      })),
    ];
    const seenIds = new Set<string>();

    return candidates.filter((request) => {
      if (seenIds.has(request.id)) {
        return false;
      }

      seenIds.add(request.id);
      return request.sourcePassId === selectedPass.id || request.targetPassId === selectedPass.id;
    });
  }, [passes, recentTopUpRequest, selectedPass, topUpHistory, topUpRequest]);
  const currentDisputableTopUp =
    disputableTopUpOptions.find((request) => request.id === disputeTopUpId) ??
    disputableTopUpOptions[0] ??
    null;
  const transactionRecords = useMemo(
    () =>
      [
        ...ledgerEntries.map((entry) => ({
          kind: 'ledger' as const,
          id: `ledger:${entry.id}`,
          sortAt: entry.createdAt,
          entry,
        })),
        ...topUpHistory.map((request) => ({
          kind: 'topUp' as const,
          id: `topUp:${request.id}`,
          sortAt: request.completedAt ?? request.cancelledAt ?? request.updatedAt ?? request.createdAt,
          request,
        })),
      ].sort(
        (first, second) =>
          new Date(second.sortAt).getTime() - new Date(first.sortAt).getTime(),
      ),
    [ledgerEntries, topUpHistory],
  );
  const locationVerificationRequired = Boolean(passDetail?.pass.locationVerification?.required);
  const canVerifySelectedLocation = Boolean(
    sessionUser?.serverAccountVerified &&
      sessionUser.serverAccountName &&
      locationVerificationRequired,
  );
  const emptyTitle = isEditing ? '没有可编辑的卡券' : `${selectedCategory.label}暂无卡券`;
  const footerText = isEditing
    ? '添加卡券后可在这里调整顺序或删除。'
    : isSearchOpen && searchKeyword
      ? '没有找到匹配的卡券。'
      : '通过链接或二维码添加到钱包。';
  const canReorder = isEditing && !searchKeyword.trim() && !isUsingOfflineSnapshot;
  const activeDetailModuleLabel = activeDetailModule ? detailModuleLabels[activeDetailModule] : null;
  const isDetailModuleDialog = activeDetailModule
    ? isDialogDetailModule(activeDetailModule)
    : false;

  useEffect(() => {
    if (!selectedPass) {
      setTopUpSourcePassId('');
      setTopUpValue('');
      setTopUpNote('');
      setTopUpPin('');
      setTopUpVerificationMethod('pin');
      setTopUpServerChallenge(null);
      setTopUpRequest(null);
      setTopUpMessage(null);
      return;
    }

    setTopUpSourcePassId((currentSourcePassId) =>
      currentSourcePassId && topUpSourcePasses.some((pass) => pass.id === currentSourcePassId)
        ? currentSourcePassId
        : (topUpSourcePasses[0]?.id ?? ''),
    );
  }, [selectedPass?.id, topUpSourcePasses]);

  useEffect(() => {
    if (disputeSubjectType === 'pass_top_up' && !currentDisputableTopUp) {
      setDisputeSubjectType('pass');
      setDisputeTopUpId('');
      return;
    }

    if (
      disputeSubjectType === 'pass_top_up' &&
      currentDisputableTopUp &&
      disputeTopUpId !== currentDisputableTopUp.id
    ) {
      setDisputeTopUpId(currentDisputableTopUp.id);
    }
  }, [currentDisputableTopUp, disputeSubjectType, disputeTopUpId]);

  const toggleSearch = () => {
    setIsSearchOpen((value) => !value);
  };

  const toggleEditing = () => {
    if (isUsingOfflineSnapshot) {
      setWalletMessage('当前使用离线卡券数据，暂不能调整顺序或删除卡券。');
      return;
    }

    setIsEditing((value) => !value);
  };

  const loadPassLedger = async (passId: string) => {
    if (isUsingOfflineSnapshot) {
      setLedgerMessage('离线模式不能读取最新交易记录。');
      return;
    }

    setIsLedgerLoading(true);
    setLedgerMessage(null);

    try {
      const result = await getJson<WalletPassLedgerResponse>(
        `/api/wallet/passes/${passId}/ledger?take=30`,
      );
      setLedgerEntries(result.ledgerEntries);
    } catch (error) {
      setLedgerMessage(error instanceof Error ? error.message : '读取交易记录失败。');
    } finally {
      setIsLedgerLoading(false);
    }
  };

  const openDetailModule = (module: DetailModule) => {
    setActiveDetailModule(module);

    if (module === 'ledger' && selectedPass) {
      void loadPassLedger(selectedPass.id);
    }
  };

  const switchCategory = (event: MouseEvent<HTMLAnchorElement>, categoryKey: CategoryKey) => {
    event.preventDefault();
    setSelectedCategoryKey(categoryKey);
    setSelectedPassId((currentPassId) => {
      if (
        currentPassId &&
        passes.some((pass) => pass.id === currentPassId && pass.category === categoryKey)
      ) {
        return currentPassId;
      }

      return null;
    });
    window.history.replaceState(null, '', getCategoryHref(categoryKey));
  };

  const clearDetailCloseTimer = () => {
    if (detailCloseTimerRef.current === null) {
      return;
    }

    window.clearTimeout(detailCloseTimerRef.current);
    detailCloseTimerRef.current = null;
  };

  const selectPass = (passId: string) => {
    clearDetailCloseTimer();
    setIsDetailClosing(false);
    setSelectedPassId(passId);
  };

  const closeSelectedPass = () => {
    if (!selectedPassId) {
      return;
    }

    clearDetailCloseTimer();
    setIsDetailClosing(true);
    detailCloseTimerRef.current = window.setTimeout(() => {
      setSelectedPassId(null);
      setIsDetailClosing(false);
      detailCloseTimerRef.current = null;
    }, 180);
  };

  const openNotificationPass = (notification: WalletNotification) => {
    if (!notification.passId) {
      return;
    }

    const pass = passes.find((item) => item.id === notification.passId);
    if (!pass) {
      setNotificationMessage('这张卡券当前不在钱包列表中，可能已经被移除或归档。');
      return;
    }

    setSearchKeyword('');
    setIsSearchOpen(false);
    setSelectedCategoryKey(pass.category);
    selectPass(pass.id);
  };

  const markNotificationRead = async (notification: WalletNotification) => {
    setReadingNotificationId(notification.id);
    setNotificationMessage(null);

    try {
      const result = await postJson<WalletNotificationResponse>(
        `/api/notifications/${notification.id}/read`,
      );
      setNotifications((currentNotifications) =>
        currentNotifications.map((item) =>
          item.id === result.notification.id ? result.notification : item,
        ),
      );
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : '标记提醒失败。');
    } finally {
      setReadingNotificationId(null);
    }
  };

  useEffect(() => {
    return () => {
      clearDetailCloseTimer();
    };
  }, []);

  useEffect(() => {
    if (!isDetailOpen) {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(max-width: 960px)');
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;

    const syncScrollLock = () => {
      if (mediaQuery.matches) {
        document.body.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'contain';
        return;
      }

      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mediaQuery.matches) {
        closeSelectedPass();
      }
    };

    syncScrollLock();
    mediaQuery.addEventListener('change', syncScrollLock);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      mediaQuery.removeEventListener('change', syncScrollLock);
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };
  }, [isDetailOpen]);

  useEffect(() => {
    if (!selectedPass) {
      setPassDetail(null);
      setActiveDetailModule(null);
      setLedgerEntries([]);
      setRedemptionRequests([]);
      setDisputes([]);
      setTopUpHistory([]);
      setPassDetailMessage(null);
      setLedgerMessage(null);
      setRedemptionMessage(null);
      setDisputeMessage(null);
      setTopUpHistoryMessage(null);
      setLocationVerificationMessage(null);
      setIsPassDetailLoading(false);
      setIsLedgerLoading(false);
      setIsRedemptionsLoading(false);
      setIsDisputesLoading(false);
      setIsTopUpHistoryLoading(false);
      setIsVerifyingLocation(false);
      return;
    }

    setLocationVerificationMessage(null);

    if (isUsingOfflineSnapshot) {
      setPassDetail(null);
      setActiveDetailModule(null);
      setLedgerEntries([]);
      setTopUpHistory([]);
      setPassDetailMessage('离线模式仅显示卡券基础信息，连接恢复后可查看详情和流水。');
      setLedgerMessage('离线模式不能读取最新交易记录。');
      setTopUpHistoryMessage('离线模式不能读取额度补充记录。');
      setIsPassDetailLoading(false);
      setIsTopUpHistoryLoading(false);
      return;
    }

    let isMounted = true;
    setActiveDetailModule(null);
    setLedgerEntries([]);
    setIsPassDetailLoading(true);
    setPassDetailMessage(null);
    setLedgerMessage(null);
    setTopUpHistoryMessage(null);

    getJson<WalletPassDetailResponse>(`/api/wallet/passes/${selectedPass.id}`)
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setPassDetail(result);
        setPasses((currentPasses) =>
          currentPasses.map((pass) =>
            pass.id === result.pass.id ? { ...pass, ...toWalletPassSummary(result.pass) } : pass,
          ),
        );
      })
      .catch((error) => {
        if (isMounted) {
          setPassDetail(null);
          setLedgerEntries([]);
          setPassDetailMessage(error instanceof Error ? error.message : '读取卡券详情失败。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsPassDetailLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isUsingOfflineSnapshot, selectedPass?.id]);

  useEffect(() => {
    if (!selectedPass) {
      setRedemptionRequests([]);
      setRedemptionMessage(null);
      setIsRedemptionsLoading(false);
      return;
    }

    if (isUsingOfflineSnapshot) {
      setRedemptionRequests([]);
      setRedemptionMessage('离线模式不能确认消耗请求。');
      setIsRedemptionsLoading(false);
      return;
    }

    let isMounted = true;
    setIsRedemptionsLoading(true);
    setRedemptionMessage(null);

    getJson<WalletRedemptionsResponse>(
      `/api/wallet/redemption-requests?passId=${encodeURIComponent(selectedPass.id)}`,
    )
      .then((result) => {
        if (isMounted) {
          setRedemptionRequests(result.redemptionRequests);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setRedemptionRequests([]);
          setRedemptionMessage(error instanceof Error ? error.message : '读取核销请求失败。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsRedemptionsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isUsingOfflineSnapshot, selectedPass?.id]);

  useEffect(() => {
    if (!selectedPass) {
      setDisputes([]);
      setDisputeMessage(null);
      setIsDisputesLoading(false);
      return;
    }

    if (isUsingOfflineSnapshot) {
      setDisputes([]);
      setDisputeMessage('离线模式不能提交或查看最新争议。');
      setIsDisputesLoading(false);
      return;
    }

    let isMounted = true;
    setIsDisputesLoading(true);
    setDisputeMessage(null);

    getJson<WalletDisputesResponse>(
      `/api/wallet/disputes?passId=${encodeURIComponent(selectedPass.id)}&take=5`,
    )
      .then((result) => {
        if (isMounted) {
          setDisputes(result.disputes);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setDisputes([]);
          setDisputeMessage(error instanceof Error ? error.message : '读取争议记录失败。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsDisputesLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isUsingOfflineSnapshot, selectedPass?.id]);

  useEffect(() => {
    if (!selectedPass) {
      setTopUpHistory([]);
      setTopUpHistoryMessage(null);
      setIsTopUpHistoryLoading(false);
      return;
    }

    if (isUsingOfflineSnapshot) {
      setTopUpHistory([]);
      setTopUpHistoryMessage('离线模式不能读取额度补充记录。');
      setIsTopUpHistoryLoading(false);
      return;
    }

    let isMounted = true;
    setIsTopUpHistoryLoading(true);
    setTopUpHistoryMessage(null);

    getJson<WalletTopUpHistoryResponse>(
      `/api/wallet/top-ups?passId=${encodeURIComponent(selectedPass.id)}&take=10`,
    )
      .then((result) => {
        if (isMounted) {
          setTopUpHistory(result.topUpRequests);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setTopUpHistory([]);
          setTopUpHistoryMessage(error instanceof Error ? error.message : '读取额度补充记录失败。');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsTopUpHistoryLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isUsingOfflineSnapshot, selectedPass?.id]);

  const movePass = async (passId: string, direction: 'up' | 'down') => {
    if (isUsingOfflineSnapshot) {
      setEditMessage('当前使用离线卡券数据，不能调整顺序。');
      return;
    }

    if (!canReorder) {
      setEditMessage('清空搜索后再调整顺序。');
      return;
    }

    const currentOrder = selectedCategoryPasses.map((pass) => pass.id);
    const currentIndex = currentOrder.indexOf(passId);
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) {
      return;
    }

    const nextOrder = [...currentOrder];
    const currentPassId = nextOrder[currentIndex];
    const targetPassId = nextOrder[nextIndex];
    if (!currentPassId || !targetPassId) {
      return;
    }
    nextOrder[currentIndex] = targetPassId;
    nextOrder[nextIndex] = currentPassId;
    const previousPasses = passes;
    const nextPasses = replaceCategoryOrder(previousPasses, selectedCategory.key, nextOrder);

    setPasses(nextPasses);
    setIsSavingEdit(true);
    setEditMessage(null);

    try {
      const result = await postJson<ReorderPassesResponse>('/api/wallet/passes/reorder', {
        passIds: nextOrder,
      });
      const nextSortOrder = new Map(result.passes.map((pass) => [pass.id, pass.sortOrder]));
      setPasses((currentPasses) =>
        currentPasses.map((pass) => {
          const sortOrder = nextSortOrder.get(pass.id);
          return sortOrder === undefined ? pass : { ...pass, sortOrder };
        }),
      );
      setEditMessage('顺序已保存。');
    } catch (error) {
      setPasses(previousPasses);
      setEditMessage(error instanceof Error ? error.message : '保存顺序失败。');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const archivePass = async (pass: WalletPass) => {
    if (isUsingOfflineSnapshot) {
      setEditMessage('当前使用离线卡券数据，不能删除卡券。');
      return;
    }

    if (!window.confirm(`从钱包中移除「${pass.displayName}」吗？历史记录会保留。`)) {
      return;
    }

    const previousPasses = passes;
    const nextPasses = previousPasses.filter((item) => item.id !== pass.id);

    setIsSavingEdit(true);
    setEditMessage(null);

    try {
      await postJson(`/api/wallet/passes/${pass.id}/archive`);
      setPasses(nextPasses);
      setPassDetail((currentDetail) => (currentDetail?.pass.id === pass.id ? null : currentDetail));
      setSelectedPassId((currentPassId) => (currentPassId === pass.id ? null : currentPassId));
      setEditMessage('卡券已从钱包移除。');
    } catch (error) {
      setPasses(previousPasses);
      setEditMessage(error instanceof Error ? error.message : '移除卡券失败。');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const submitTopUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setTopUpMessage('请先选择目标卡。');
      return;
    }

    if (isUsingOfflineSnapshot) {
      setTopUpMessage('当前使用离线卡券数据，不能补充额度。');
      return;
    }

    if (!canTopUpSelectedPass) {
      setTopUpMessage('这张卡未开放额度补充。');
      return;
    }

    if (!topUpSourcePassId) {
      setTopUpMessage('请选择来源卡。');
      return;
    }

    const value = topUpValue.trim();
    if (!value) {
      setTopUpMessage('请输入补充值。');
      return;
    }

    if (topUpVerificationMethod === 'pin' && !topUpPin.trim()) {
      setTopUpMessage('请输入 PIN 完成二次确认。');
      return;
    }

    setIsSubmittingTopUp(true);
    setTopUpMessage(null);

    try {
      if (topUpVerificationMethod === 'server_account') {
        if (!sessionUser?.serverAccountVerified || !sessionUser.serverAccountName) {
          setTopUpMessage('请先在账户页完成服务器账号验证。');
          return;
        }

        if (!topUpServerChallenge) {
          const result = await postJson<StartTopUpServerChallengeResponse>(
            `/api/wallet/passes/${selectedPass.id}/top-ups/server-challenge/start`,
            {
              sourcePassId: topUpSourcePassId,
              value,
              note: topUpNote.trim() || undefined,
            },
          );
          setTopUpServerChallenge(result.challenge);
          setTopUpRequest(result.topUpRequest);
          setTopUpMessage(
            `请在服务器聊天内发送 ${result.challenge.code}，然后再次点击确认。`,
          );
          return;
        }

        const result = await postJson<ConfirmTopUpWithServerResponse>(
          `/api/wallet/passes/${selectedPass.id}/top-ups/confirm-server`,
          {
            sourcePassId: topUpSourcePassId,
            value,
            note: topUpNote.trim() || undefined,
            challengeId: topUpServerChallenge.id,
          },
        );

        if (
          result.status === 'verified' &&
          result.topUp &&
          result.sourcePass &&
          result.targetPass &&
          result.ledgerEntry
        ) {
          await applyTopUpResult(result as WalletTopUpResponse);
          return;
        }

        if (result.status === 'rotated' && result.challenge) {
          setTopUpServerChallenge(result.challenge);
          setTopUpRequest(result.topUpRequest ?? null);
          setTopUpMessage(
            `检测到其他聊天内容，验证码已更新。请发送 ${result.challenge.code} 后再确认。`,
          );
          return;
        }

        if (result.status === 'expired') {
          setTopUpServerChallenge(null);
          setTopUpRequest(result.topUpRequest ?? null);
          setTopUpMessage('验证码已过期，请重新获取。');
          return;
        }

        if (result.status === 'cancelled') {
          setTopUpServerChallenge(null);
          setTopUpRequest(result.topUpRequest ?? null);
          setTopUpMessage('这次额度补充请求已取消。');
          return;
        }

        if (result.status === 'failed') {
          setTopUpServerChallenge(null);
          setTopUpRequest(result.topUpRequest ?? null);
          setTopUpMessage('这次额度补充请求已失败，请重新发起。');
          return;
        }

        setTopUpRequest(result.topUpRequest ?? topUpRequest);
        setTopUpMessage('还没有检测到匹配的服务器聊天验证码，请发送后再确认。');
        return;
      }

      const result = await postJson<WalletTopUpResponse>(
        `/api/wallet/passes/${selectedPass.id}/top-ups`,
        {
          sourcePassId: topUpSourcePassId,
          value,
          secondFactor: topUpPin.trim(),
          note: topUpNote.trim() || undefined,
        },
      );

      await applyTopUpResult(result);
    } catch (error) {
      setTopUpMessage(error instanceof Error ? error.message : '补充额度失败。');
    } finally {
      setIsSubmittingTopUp(false);
    }
  };

  const cancelTopUpRequest = async () => {
    if (!topUpRequest) {
      setTopUpMessage('当前没有可取消的额度补充请求。');
      return;
    }

    setIsSubmittingTopUp(true);
    setTopUpMessage(null);

    try {
      const result = await postJson<CancelTopUpRequestResponse>(
        `/api/wallet/top-ups/${encodeURIComponent(topUpRequest.id)}/cancel`,
        {
          reason: '用户取消本次额度补充',
        },
      );
      setTopUpServerChallenge(null);
      setTopUpRequest(result.topUpRequest);
      const sourcePassTitle = passes.find(
        (pass) => pass.id === result.topUpRequest.sourcePassId,
      )?.displayName;
      const targetPassTitle = passes.find(
        (pass) => pass.id === result.topUpRequest.targetPassId,
      )?.displayName;
      setRecentTopUpRequest({
        ...result.topUpRequest,
        ...(sourcePassTitle ? { sourcePassTitle } : {}),
        ...(targetPassTitle ? { targetPassTitle } : {}),
      });
      setTopUpMessage('已取消本次额度补充请求。');
    } catch (error) {
      setTopUpMessage(error instanceof Error ? error.message : '取消额度补充请求失败。');
    } finally {
      setIsSubmittingTopUp(false);
    }
  };

  const openCurrentTopUpDispute = () => {
    if (!currentDisputableTopUp) {
      setTopUpMessage('当前没有可关联的额度补充请求。');
      return;
    }

    setDisputeSubjectType('pass_top_up');
    setDisputeTopUpId(currentDisputableTopUp.id);
    setDisputeMessage(null);
    setActiveDetailModule('createDispute');
  };

  const applyTopUpResult = async (result: WalletTopUpResponse) => {
    const completedAt = new Date().toISOString();

    setPasses((currentPasses) =>
      currentPasses.map((pass) => {
        if (pass.id === result.sourcePass.id) {
          return { ...pass, ...result.sourcePass };
        }

        if (pass.id === result.targetPass.id) {
          return { ...pass, ...result.targetPass };
        }

        return pass;
      }),
    );
    setTopUpValue('');
    setTopUpNote('');
    setTopUpPin('');
    setTopUpServerChallenge(null);
    setRecentTopUpRequest({
      id: result.topUp.id,
      status: result.topUp.status ?? 'Succeeded',
      sourcePassId: result.sourcePass.id,
      targetPassId: result.targetPass.id,
      value: result.topUp.value,
      verificationMethod: topUpVerificationMethod,
      expiresAt: null,
      sourcePassTitle: result.sourcePass.displayName,
      targetPassTitle: result.targetPass.displayName,
    });
    setTopUpHistory((currentHistory) => [
      {
        id: result.topUp.id,
        status: result.topUp.status ?? 'Succeeded',
        value: result.topUp.value,
        verificationMethod: topUpVerificationMethod,
        note: topUpNote.trim() || null,
        actionLinkId: null,
        sourceLedgerEntryId: result.topUp.sourceLedgerEntryId,
        targetLedgerEntryId: result.topUp.targetLedgerEntryId,
        failureCode: null,
        failureMessage: null,
        expiresAt: null,
        completedAt,
        cancelledAt: null,
        reversedAt: null,
        createdAt: completedAt,
        updatedAt: completedAt,
        sourcePass: result.sourcePass,
        targetPass: result.targetPass,
      },
      ...currentHistory.filter((request) => request.id !== result.topUp.id),
    ]);
    setTopUpHistoryMessage(null);
    setTopUpRequest(null);
    setTopUpMessage(
      `已补充 ${formatBenefitValue(result.topUp.value, result.targetPass.benefitType)}。`,
    );

    const detail = await getJson<WalletPassDetailResponse>(
      `/api/wallet/passes/${result.targetPass.id}`,
    );
    setPassDetail(detail);
    if (activeDetailModule === 'ledger') {
      await loadPassLedger(result.targetPass.id);
    }
  };

  const submitSelfRedemption = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setRedemptionMessage('请先选择卡券。');
      return;
    }

    if (isUsingOfflineSnapshot) {
      setRedemptionMessage('当前使用离线卡券数据，不能发起消耗。');
      return;
    }

    const requestedValue = selfRedemptionValue.trim();
    if (!requestedValue) {
      setRedemptionMessage('请输入消耗值。');
      return;
    }

    setIsCreatingSelfRedemption(true);
    setRedemptionMessage(null);

    try {
      const result = await postJson<CreateWalletRedemptionResponse>(
        '/api/wallet/redemption-requests',
        {
          passId: selectedPass.id,
          requestedValue,
          verificationMethod: selfRedemptionMethod,
          idempotencyKey: createClientIdempotencyKey('wallet-redemption'),
        },
      );

      setRedemptionRequests((currentRequests) => [
        result.redemptionRequest,
        ...currentRequests.filter((request) => request.id !== result.redemptionRequest.id),
      ]);
      setSelfRedemptionValue('');
      setRedemptionMessage(
        `已发起消耗：${formatBenefitValue(result.redemptionRequest.requestedValue, result.redemptionRequest.pass.benefitType)}，请继续完成确认。`,
      );
      setActiveDetailModule('redemptions');
    } catch (error) {
      setRedemptionMessage(error instanceof Error ? error.message : '发起消耗失败。');
    } finally {
      setIsCreatingSelfRedemption(false);
    }
  };

  const startRedemptionServerChallenge = async (request: WalletRedemptionRequest) => {
    setConfirmingRedemptionId(request.id);
    setRedemptionMessage(null);

    try {
      const result = await postJson<StartServerRedemptionChallengeResponse>(
        `/api/wallet/redemption-requests/${request.id}/server-challenge/start`,
      );
      setServerRedemptionChallenges((currentChallenges) => ({
        ...currentChallenges,
        [request.id]: result.challenge,
      }));
      setRedemptionRequests((currentRequests) =>
        currentRequests.map((item) =>
          item.id === result.redemptionRequest.id ? result.redemptionRequest : item,
        ),
      );
      setRedemptionMessage(
        `请用服务器 ID「${result.challenge.serverId}」在服务器聊天内发送验证码 ${result.challenge.code}，然后点击检查确认。`,
      );
    } catch (error) {
      setRedemptionMessage(error instanceof Error ? error.message : '获取服务器验证码失败。');
    } finally {
      setConfirmingRedemptionId(null);
    }
  };

  const confirmRedemptionWithServer = async (request: WalletRedemptionRequest) => {
    const challenge = serverRedemptionChallenges[request.id];
    if (!challenge) {
      setRedemptionMessage('请先获取本次服务器验证码。');
      return;
    }

    setConfirmingRedemptionId(request.id);
    setRedemptionMessage(null);

    try {
      const result = await postJson<ConfirmServerRedemptionResponse>(
        `/api/wallet/redemption-requests/${request.id}/confirm-server`,
        {
          challengeId: challenge.id,
        },
      );

      if (result.status === 'verified' && result.pass) {
        await applyConfirmedRedemptionResult({
          redemptionRequest: result.redemptionRequest,
          pass: result.pass,
          ledgerEntry: result.ledgerEntry ?? null,
        });
        return;
      }

      if (result.status === 'rotated' && result.challenge) {
        const nextChallenge = result.challenge;
        setServerRedemptionChallenges((currentChallenges) => ({
          ...currentChallenges,
          [request.id]: nextChallenge,
        }));
        setRedemptionMessage(
          `检测到其他聊天内容，验证码已刷新。请发送新的验证码 ${nextChallenge.code}。`,
        );
        return;
      }

      if (result.status === 'expired') {
        setServerRedemptionChallenges((currentChallenges) => {
          const nextChallenges = { ...currentChallenges };
          delete nextChallenges[request.id];
          return nextChallenges;
        });
        setRedemptionMessage('本次服务器验证码已过期，请重新获取验证码。');
        return;
      }

      setRedemptionMessage(`尚未在服务器聊天内看到验证码 ${challenge.code}，请发送后再检查。`);
    } catch (error) {
      setRedemptionMessage(error instanceof Error ? error.message : '服务器账号确认失败。');
      if (selectedPass && !isUsingOfflineSnapshot) {
        try {
          const result = await getJson<WalletRedemptionsResponse>(
            `/api/wallet/redemption-requests?passId=${encodeURIComponent(selectedPass.id)}`,
          );
          setRedemptionRequests(result.redemptionRequests);
        } catch {
          // 保留现有列表，避免刷新失败时把仍待处理的请求误隐藏。
        }
      }
    } finally {
      setConfirmingRedemptionId(null);
    }
  };

  const confirmRedemptionWithPin = async (
    event: FormEvent<HTMLFormElement>,
    request: WalletRedemptionRequest,
  ) => {
    event.preventDefault();
    const pin = pinInputs[request.id] ?? '';
    if (!pin) {
      setRedemptionMessage('请输入 PIN。');
      return;
    }

    await confirmRedemption(request, `/api/wallet/redemption-requests/${request.id}/confirm-pin`, {
      pin,
    });
  };

  const confirmRedemption = async (
    request: WalletRedemptionRequest,
    endpoint: string,
    body?: unknown,
  ) => {
    setConfirmingRedemptionId(request.id);
    setRedemptionMessage(null);

    try {
      const result = await postJson<ConfirmRedemptionResponse>(endpoint, body);
      await applyConfirmedRedemptionResult(result);
    } catch (error) {
      setRedemptionMessage(error instanceof Error ? error.message : '确认核销请求失败。');
      if (selectedPass && !isUsingOfflineSnapshot) {
        try {
          const result = await getJson<WalletRedemptionsResponse>(
            `/api/wallet/redemption-requests?passId=${encodeURIComponent(selectedPass.id)}`,
          );
          setRedemptionRequests(result.redemptionRequests);
        } catch {
          // 保留现有列表，避免刷新失败时把仍待处理的请求误隐藏。
        }
      }
    } finally {
      setConfirmingRedemptionId(null);
    }
  };

  const applyConfirmedRedemptionResult = async (result: ConfirmRedemptionResponse) => {
    setPasses((currentPasses) =>
      currentPasses.map((pass) =>
        pass.id === result.pass.id ? { ...pass, ...toWalletPassFromRedemption(result.pass) } : pass,
      ),
    );
    setRedemptionRequests((currentRequests) =>
      currentRequests.filter((item) => item.id !== result.redemptionRequest.id),
    );
    setPinInputs((currentInputs) => {
      const nextInputs = { ...currentInputs };
      delete nextInputs[result.redemptionRequest.id];
      return nextInputs;
    });
    setServerRedemptionChallenges((currentChallenges) => {
      const nextChallenges = { ...currentChallenges };
      delete nextChallenges[result.redemptionRequest.id];
      return nextChallenges;
    });
    setRedemptionMessage(
      `已确认消耗：${formatBenefitValue(result.redemptionRequest.requestedValue, result.pass.benefitType)}。`,
    );

    const detail = await getJson<WalletPassDetailResponse>(`/api/wallet/passes/${result.pass.id}`);
    setPassDetail(detail);
    if (activeDetailModule === 'ledger') {
      await loadPassLedger(result.pass.id);
    }
  };

  const submitDispute = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setDisputeMessage('请先选择卡券。');
      return;
    }

    if (isUsingOfflineSnapshot) {
      setDisputeMessage('当前使用离线卡券数据，不能提交争议。');
      return;
    }

    if (!disputeReason.trim()) {
      setDisputeMessage('请输入争议原因。');
      return;
    }

    setIsSubmittingDispute(true);
    setDisputeMessage(null);

    try {
      const disputePayload: {
        passId: string;
        reason: string;
        subjectType?: DisputeSubjectType;
        subjectId?: string;
      } = {
        passId: selectedPass.id,
        reason: disputeReason.trim(),
      };

      if (disputeSubjectType === 'pass_top_up') {
        if (!currentDisputableTopUp) {
          setDisputeMessage('当前没有可关联的额度补充请求。');
          return;
        }

        disputePayload.subjectType = 'pass_top_up';
        disputePayload.subjectId = currentDisputableTopUp.id;
      }

      const result = await postJson<CreateDisputeResponse>('/api/wallet/disputes', {
        ...disputePayload,
      });
      setDisputes((currentDisputes) => [result.dispute, ...currentDisputes].slice(0, 5));
      setDisputeReason('');
      setDisputeSubjectType('pass');
      setDisputeTopUpId('');
      setDisputeMessage('争议已提交，管理员处理后会更新状态。');
      setActiveDetailModule('disputes');
    } catch (error) {
      setDisputeMessage(error instanceof Error ? error.message : '提交争议失败。');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const submitTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setTransferMessage('请先选择卡券。');
      return;
    }

    if (!canTransferSelectedPass) {
      setTransferMessage('该卡券未开放转赠。');
      return;
    }

    if (!transferRecipient.trim()) {
      setTransferMessage('请输入接收方用户名或邮箱。');
      return;
    }

    setIsSubmittingTransfer(true);
    setTransferMessage(null);

    try {
      const result = await postJson<WalletPassTransferResponse>(
        `/api/wallet/passes/${selectedPass.id}/transfer`,
        {
          recipient: transferRecipient.trim(),
          note: transferNote.trim() || undefined,
        },
      );
      setSentTransfers((currentTransfers) => [result.transfer, ...currentTransfers]);
      setTransferRecipient('');
      setTransferNote('');
      setTransferMessage(`已向 ${result.transfer.toUser.username} 发起转赠，等待对方确认。`);
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : '发起转赠失败。');
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  const acceptTransfer = async (transfer: WalletPassTransfer) => {
    setResolvingTransferId(transfer.id);
    setTransferMessage(null);

    try {
      const result = await postJson<WalletPassTransferResponse>(
        `/api/wallet/transfers/${transfer.id}/accept`,
      );
      setReceivedTransfers((currentTransfers) =>
        currentTransfers.map((item) => (item.id === result.transfer.id ? result.transfer : item)),
      );
      setTransferMessage(`已接收「${result.transfer.pass.displayName}」。`);
      await refreshWalletSnapshot();
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : '接收转赠失败。');
    } finally {
      setResolvingTransferId(null);
    }
  };

  const rejectTransfer = async (transfer: WalletPassTransfer) => {
    setResolvingTransferId(transfer.id);
    setTransferMessage(null);

    try {
      const result = await postJson<WalletPassTransferResponse>(
        `/api/wallet/transfers/${transfer.id}/reject`,
      );
      setReceivedTransfers((currentTransfers) =>
        currentTransfers.map((item) => (item.id === result.transfer.id ? result.transfer : item)),
      );
      setTransferMessage('已拒绝该转赠请求。');
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : '拒绝转赠失败。');
    } finally {
      setResolvingTransferId(null);
    }
  };

  const cancelTransfer = async (transfer: WalletPassTransfer) => {
    setResolvingTransferId(transfer.id);
    setTransferMessage(null);

    try {
      const result = await postJson<WalletPassTransferResponse>(
        `/api/wallet/transfers/${transfer.id}/cancel`,
      );
      setSentTransfers((currentTransfers) =>
        currentTransfers.map((item) => (item.id === result.transfer.id ? result.transfer : item)),
      );
      setTransferMessage('已取消该转赠请求。');
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : '取消转赠失败。');
    } finally {
      setResolvingTransferId(null);
    }
  };

  const verifyLocation = async () => {
    if (!selectedPass) {
      setLocationVerificationMessage('请先选择卡券。');
      return;
    }

    if (isUsingOfflineSnapshot) {
      setLocationVerificationMessage('当前使用离线卡券数据，不能进行位置核验。');
      return;
    }

    if (!sessionUser?.serverAccountVerified || !sessionUser.serverAccountName) {
      setLocationVerificationMessage('请先在账户页完成服务器账号验证。');
      return;
    }

    setIsVerifyingLocation(true);
    setLocationVerificationMessage(null);

    try {
      const result = await postJson<VerifyLocationResponse>(
        `/api/wallet/passes/${selectedPass.id}/verify-location`,
      );
      setLocationVerificationMessage(
        `已核验 ${result.player.name}，坐标 X ${formatCoordinate(result.player.x)} / Z ${formatCoordinate(result.player.z)}，有效至 ${formatDate(
          result.expiresAt,
          '',
        )}。`,
      );
    } catch (error) {
      setLocationVerificationMessage(error instanceof Error ? error.message : '位置核验失败。');
    } finally {
      setIsVerifyingLocation(false);
    }
  };

  const isGuestLanding = !sessionUser && hasLoadedWallet;

  return (
    <main
      className={`wallet-shell${isGuestLanding ? ' wallet-guest-shell' : ''}${isDetailOpen ? ' wallet-detail-open' : ''}${isDetailClosing ? ' wallet-detail-closing' : ''}`}
    >
      <header className="topbar">
        <a className="brand" href="/" aria-label="临东通首页">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>{sessionUser ? '钱包' : '临东通'}</span>
        </a>
        <nav className="topbar-actions" aria-label={sessionUser ? '钱包操作' : '页面设置'}>
          <ThemeSettings />
          {sessionUser ? (
            <>
              <button
                className={`icon-button${isSearchOpen ? ' is-active' : ''}`}
                type="button"
                aria-label="搜索"
                title="搜索"
                aria-expanded={isSearchOpen}
                onClick={toggleSearch}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  search
                </span>
              </button>
              <a className="icon-button" href="/add" aria-label="添加卡券" title="添加卡券">
                <span className="material-symbols-rounded" aria-hidden="true">
                  add
                </span>
              </a>
              <button
                className={`icon-button${isEditing ? ' is-active' : ''}`}
                type="button"
                aria-label="编辑"
                title="编辑"
                aria-expanded={isEditing}
                onClick={toggleEditing}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  edit
                </span>
              </button>
              <a className="account-entry" href="/account" aria-label="账户">
                <UserAvatar avatarUrl={sessionUser.avatarUrl} fallbackUrl={sessionUser.avatarFallbackUrl} />
                <span>{sessionUser.username}</span>
              </a>
            </>
          ) : null}
        </nav>
      </header>

      {sessionUser && isSearchOpen ? (
        <section className="wallet-search" aria-label="搜索卡券">
          <span className="material-symbols-rounded" aria-hidden="true">
            search
          </span>
          <input
            type="search"
            placeholder="搜索卡券"
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            autoFocus
          />
          {searchKeyword ? (
            <button
              className="search-clear"
              type="button"
              aria-label="清空搜索"
              onClick={() => setSearchKeyword('')}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                close
              </span>
            </button>
          ) : null}
        </section>
      ) : null}

      {isGuestLanding ? (
        <UnauthenticatedHome message={walletMessage} />
      ) : (
      <section
        className={`wallet-layout ${selectedPass ? 'wallet-layout-has-detail' : 'wallet-layout-empty'}`}
        aria-label="卡包"
      >
        <aside className="category-rail" aria-label="分类">
          {categoryCounts.map((category) => (
            <a
              className={`category-item${category.key === selectedCategory.key ? ' is-active' : ''}`}
              href={getCategoryHref(category.key)}
              aria-current={category.key === selectedCategory.key ? 'page' : undefined}
              key={category.key}
              onClick={(event) => switchCategory(event, category.key)}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                {category.icon}
              </span>
              <span>{category.label}</span>
              <strong>{category.count}</strong>
            </a>
          ))}
        </aside>

        <section className="pass-stack-panel" aria-label="卡券列表">
          {walletMessage ? (
            <div className="flow-notice" role="status" aria-live="polite">
              <span>{walletMessage}</span>
            </div>
          ) : null}
          {!walletMessage && offlineSnapshotAt ? (
            <div className="flow-notice flow-notice-muted" role="status" aria-live="polite">
              <span>离线卡券已同步：{formatDate(offlineSnapshotAt, '未知')}</span>
            </div>
          ) : null}
          {isEditing ? (
            <div className="edit-toolbar" role="status">
              <span className="material-symbols-rounded" aria-hidden="true">
                drag_indicator
              </span>
              <span>编辑模式</span>
              <small>
                {editMessage ??
                  (searchKeyword.trim()
                    ? '清空搜索后可调整顺序。'
                    : '使用上下按钮调整顺序，删除会归档卡券。')}
              </small>
            </div>
          ) : null}
          {isNotificationsLoading || notificationMessage || unreadNotifications.length > 0 ? (
            <section className="notification-inbox" aria-label="提醒">
              <div className="detail-section-heading">
                <h3>提醒</h3>
                <span>{unreadNotifications.length}</span>
              </div>
              {isNotificationsLoading ? <p className="detail-status">正在读取提醒...</p> : null}
              {notificationMessage ? <p className="detail-status">{notificationMessage}</p> : null}
              {unreadNotifications.map((notification) => (
                <article className="notification-inbox-item" key={notification.id}>
                  <div>
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                    <small>
                      {notification.providerName ?? '系统'} ·{' '}
                      {formatDate(notification.createdAt, '')}
                    </small>
                  </div>
                  <div className="admin-list-actions">
                    {notification.passId ? (
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => openNotificationPass(notification)}
                      >
                        查看
                      </button>
                    ) : null}
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={readingNotificationId === notification.id}
                      onClick={() => void markNotificationRead(notification)}
                    >
                      {readingNotificationId === notification.id ? '处理中' : '已读'}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
          {isTransfersLoading || transferMessage || pendingReceivedTransfers.length > 0 ? (
            <section className="transfer-inbox" aria-label="转赠请求">
              <div className="detail-section-heading">
                <h3>转赠请求</h3>
                <span>{pendingReceivedTransfers.length}</span>
              </div>
              {isTransfersLoading ? <p className="detail-status">正在读取转赠请求...</p> : null}
              {transferMessage ? <p className="detail-status">{transferMessage}</p> : null}
              {pendingReceivedTransfers.map((transfer) => (
                <article className="transfer-inbox-item" key={transfer.id}>
                  <div>
                    <strong>{transfer.pass.displayName}</strong>
                    <span>
                      {transfer.fromUser.username} 转赠 · 到期：{formatDate(transfer.expiresAt, '')}
                    </span>
                    {transfer.note ? <small>{transfer.note}</small> : null}
                  </div>
                  <div className="admin-list-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={resolvingTransferId === transfer.id}
                      onClick={() => void rejectTransfer(transfer)}
                    >
                      拒绝
                    </button>
                    <button
                      className="primary-action"
                      type="button"
                      disabled={resolvingTransferId === transfer.id}
                      onClick={() => void acceptTransfer(transfer)}
                    >
                      接收
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
          {filteredPasses.length > 0 ? (
            <div className={`pass-card-list${!isEditing ? ' pass-card-list-stacked' : ''}`}>
              {filteredPasses.map((pass, visibleIndex) => {
                const categoryIndex = selectedCategoryPasses.findIndex(
                  (item) => item.id === pass.id,
                );
                const isFirst = categoryIndex <= 0;
                const isLast = categoryIndex >= selectedCategoryPasses.length - 1;
                const isSelected = selectedPass?.id === pass.id;
                const isAfterSelected =
                  visibleIndex > 0 && filteredPasses[visibleIndex - 1]?.id === selectedPass?.id;
                const cardClassName = `wallet-pass-card wallet-pass-card-${pass.category}${pass.backgroundImageUrl ? ' wallet-pass-card-has-image' : ''}${pass.hideTitle === true ? ' wallet-pass-card-title-hidden' : ''}${isSelected ? ' is-selected' : ''}`;
                const slotClassName = `pass-card-stack-slot${isSelected ? ' is-expanded' : ''}${isAfterSelected ? ' is-after-expanded' : ''}${isEditing ? ' is-editing' : ''}`;
                const slotStyle = {
                  '--stack-z': String(visibleIndex + 1),
                } as CSSProperties;

                return (
                  <div className={slotClassName} key={pass.id} style={slotStyle}>
                    {isEditing ? (
                      <article className={`${cardClassName} wallet-pass-card-editable`}>
                        <button
                          className="wallet-pass-card-main"
                          type="button"
                          onClick={() => selectPass(pass.id)}
                        >
                          <PassCardContent pass={pass} />
                        </button>
                        <div className="pass-edit-actions" aria-label={`${pass.displayName} 编辑操作`}>
                          <button
                            className="mini-icon-button"
                            type="button"
                            aria-label="上移"
                            title="上移"
                            disabled={!canReorder || isFirst || isSavingEdit}
                            onClick={() => void movePass(pass.id, 'up')}
                          >
                            <span className="material-symbols-rounded" aria-hidden="true">
                              keyboard_arrow_up
                            </span>
                          </button>
                          <button
                            className="mini-icon-button"
                            type="button"
                            aria-label="下移"
                            title="下移"
                            disabled={!canReorder || isLast || isSavingEdit}
                            onClick={() => void movePass(pass.id, 'down')}
                          >
                            <span className="material-symbols-rounded" aria-hidden="true">
                              keyboard_arrow_down
                            </span>
                          </button>
                          <button
                            className="mini-icon-button mini-icon-button-danger"
                            type="button"
                            aria-label="移除"
                            title="移除"
                            disabled={isSavingEdit}
                            onClick={() => void archivePass(pass)}
                          >
                            <span className="material-symbols-rounded" aria-hidden="true">
                              delete
                            </span>
                          </button>
                        </div>
                      </article>
                    ) : (
                      <button
                        className={cardClassName}
                        type="button"
                        onClick={() => selectPass(pass.id)}
                      >
                        <PassCardContent pass={pass} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={`pass-stack-empty pass-stack-empty-${selectedCategory.key}`}>
              <div className="empty-card-body">
                <h1>{emptyTitle}</h1>
              </div>
              <div className="empty-card-footer">
                <span>{footerText}</span>
                <a className="pill-action" href="/add">
                  添加
                </a>
              </div>
            </div>
          )}
        </section>

        {selectedPass ? (
          <button
            className="detail-panel-scrim"
            type="button"
            tabIndex={-1}
            aria-label="关闭卡券详情背景"
            onClick={closeSelectedPass}
          />
        ) : null}

        {selectedPass ? (
          <aside className={`detail-panel${isDetailClosing ? ' is-closing' : ''}`} aria-label="卡券详情">
            <div className="detail-panel-heading">
              <h2>{passDetail?.pass.displayName ?? selectedPass.displayName}</h2>
              <button
                className="detail-close-button"
                type="button"
                aria-label="关闭卡券详情"
                onClick={closeSelectedPass}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <div className="detail-selected-card-face" aria-hidden="true">
              <div
                className={`wallet-pass-card wallet-pass-card-${selectedPass.category}${selectedPass.backgroundImageUrl ? ' wallet-pass-card-has-image' : ''}${selectedPass.hideTitle === true ? ' wallet-pass-card-title-hidden' : ''}`}
              >
                <PassCardContent pass={selectedPass} />
              </div>
            </div>
            <div className="detail-balance">
              <span>当前余额</span>
              <strong>
                {formatBenefitValue(
                  passDetail?.pass.balanceValue ?? selectedPass.balanceValue,
                  selectedPass.benefitType,
                )}
              </strong>
            </div>
            {isPassDetailLoading ? <p className="detail-status">正在读取详情...</p> : null}
            {passDetailMessage ? (
              <p className="detail-status detail-status-error">{passDetailMessage}</p>
            ) : null}
            <div className="detail-action-grid" aria-label="卡券详情模块">
              <button
                className={activeDetailModule === 'passInfo' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('passInfo')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  badge
                </span>
                <strong>卡片详情</strong>
                <small>{passDetail?.pass.publicNumber ?? selectedPass.maskedNumber ?? '查看'}</small>
              </button>
              <button
                className={activeDetailModule === 'provider' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('provider')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  storefront
                </span>
                <strong>发卡方</strong>
                <small>{passDetail?.pass.providerName ?? selectedPass.providerName}</small>
              </button>
              {selectedPass.category === 'ticket' ? (
                <button
                  className={activeDetailModule === 'ticket' ? 'is-active' : ''}
                  type="button"
                  onClick={() => openDetailModule('ticket')}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    confirmation_number
                  </span>
                  <strong>票券</strong>
                  <small>{formatTicketStatus(passDetail?.pass.ticketInfo ?? null)}</small>
                </button>
              ) : null}
              {selectedPass.category === 'identity_key' ? (
                <button
                  className={activeDetailModule === 'location' ? 'is-active' : ''}
                  type="button"
                  onClick={() => openDetailModule('location')}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    my_location
                  </span>
                  <strong>位置核验</strong>
                  <small>{locationVerificationRequired ? '已配置' : '未配置'}</small>
                </button>
              ) : null}
              <button
                className={activeDetailModule === 'topUp' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('topUp')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  add_card
                </span>
                <strong>充值</strong>
                <small>{canTopUpSelectedPass ? '开放' : '关闭'}</small>
              </button>
              <button
                className={activeDetailModule === 'use' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('use')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  swipe_down
                </span>
                <strong>核销</strong>
                <small>{canUseSelectedPass ? '可用' : '不可用'}</small>
              </button>
              <button
                className={activeDetailModule === 'redemptions' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('redemptions')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  pending_actions
                </span>
                <strong>待确认</strong>
                <small>{redemptionRequests.length}</small>
              </button>
              <button
                className={activeDetailModule === 'transfer' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('transfer')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  move_up
                </span>
                <strong>转赠</strong>
                <small>{canTransferSelectedPass ? '开放' : '关闭'}</small>
              </button>
              <button
                className={activeDetailModule === 'disputes' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('disputes')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  report
                </span>
                <strong>争议</strong>
                <small>{disputes.length}</small>
              </button>
              <button
                className={activeDetailModule === 'ledger' ? 'is-active' : ''}
                type="button"
                onClick={() => openDetailModule('ledger')}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  receipt_long
                </span>
                <strong>记录</strong>
                <small>{activeDetailModule === 'ledger' ? transactionRecords.length : '查看'}</small>
              </button>
              <button
                className="detail-action-danger"
                type="button"
                disabled={isUsingOfflineSnapshot || isSavingEdit}
                onClick={() => void archivePass(selectedPass)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  delete
                </span>
                <strong>删除</strong>
                <small>{isUsingOfflineSnapshot ? '离线不可用' : '移除'}</small>
              </button>
            </div>
            {activeDetailModuleLabel ? (
              <div
                className={`detail-module-slot ${isDetailModuleDialog ? 'is-dialog' : 'is-inline'}`}
                role={isDetailModuleDialog ? 'dialog' : undefined}
                aria-modal={isDetailModuleDialog ? true : undefined}
                aria-label={activeDetailModuleLabel}
              >
                {isDetailModuleDialog ? (
                  <button
                    className="detail-module-backdrop"
                    type="button"
                    aria-label="关闭弹窗"
                    onClick={() => setActiveDetailModule(null)}
                  />
                ) : null}
                <div className="detail-module-panel">
                  <div className="detail-module-toolbar">
                    <strong>{activeDetailModuleLabel}</strong>
                    <button
                      className="detail-close-button"
                      type="button"
                      aria-label="关闭"
                      onClick={() => setActiveDetailModule(null)}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">
                        close
                      </span>
                    </button>
                  </div>
                  {activeDetailModule === 'passInfo' ? (
                    <section className="detail-pass-info" aria-label="卡片详情">
                      <dl className="detail-list">
                        <div>
                          <dt>卡面标题</dt>
                          <dd>{passDetail?.pass.title ?? selectedPass.title}</dd>
                        </div>
                        <div>
                          <dt>编号</dt>
                          <dd>{passDetail?.pass.publicNumber ?? selectedPass.maskedNumber ?? '未设置'}</dd>
                        </div>
                        <div>
                          <dt>状态</dt>
                          <dd>{passDetail?.pass.status ?? selectedPass.status}</dd>
                        </div>
                        <div>
                          <dt>冻结值</dt>
                          <dd>{passDetail?.pass.frozenValue ?? selectedPass.frozenValue}</dd>
                        </div>
                        <div>
                          <dt>透支额度</dt>
                          <dd>{passDetail?.pass.overdraftLimit ?? selectedPass.overdraftLimit}</dd>
                        </div>
                        <div>
                          <dt>有效期</dt>
                          <dd>
                            {formatDate(passDetail?.pass.expiresAt ?? selectedPass.expiresAt, '长期有效')}
                          </dd>
                        </div>
                        <div>
                          <dt>添加时间</dt>
                          <dd>{formatDate(passDetail?.pass.addedAt ?? null, '尚未记录')}</dd>
                        </div>
                      </dl>
                      <p className="detail-status">
                        临东通提供技术支持，权益、注销和条款等均为虚构。
                      </p>
                    </section>
                  ) : null}
                  {activeDetailModule === 'provider' ? (
                    <section className="detail-provider" aria-label="发卡方信息">
                      <div className="detail-provider-card">
                        <div>
                          <strong>{passDetail?.pass.providerName ?? selectedPass.providerName}</strong>
                          <span>这张卡由该发卡方提供和维护。</span>
                        </div>
                        {passDetail?.pass.providerIntroductionUrl ? (
                          <a
                            className="secondary-action"
                            href={passDetail.pass.providerIntroductionUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            查看介绍
                          </a>
                        ) : (
                          <p className="detail-status">发卡方暂未设置介绍链接。</p>
                        )}
                      </div>
                    </section>
                  ) : null}
            {activeDetailModule === 'ticket' && (passDetail?.pass.ticketInfo || selectedPass.category === 'ticket') ? (
              <section className="detail-ticket" aria-label="票券信息">
                <dl className="detail-list">
                  <div>
                    <dt>活动</dt>
                    <dd>
                      {passDetail?.pass.ticketInfo?.eventName ??
                        passDetail?.pass.title ??
                        selectedPass.title}
                    </dd>
                  </div>
                  <div>
                    <dt>场地</dt>
                    <dd>{passDetail?.pass.ticketInfo?.venue ?? '未设置'}</dd>
                  </div>
                  <div>
                    <dt>场次</dt>
                    <dd>{formatDate(passDetail?.pass.ticketInfo?.startsAt ?? null, '未设置')}</dd>
                  </div>
                  <div>
                    <dt>座位</dt>
                    <dd>{passDetail?.pass.ticketInfo?.seatLabel ?? '未设置'}</dd>
                  </div>
                </dl>
              </section>
            ) : null}
            {activeDetailModule === 'location' && selectedPass.category === 'identity_key' ? (
              <section className="detail-location" aria-label="位置核验">
                {passDetail?.pass.locationVerification?.rules?.rules.length ? (
                  <dl className="detail-list">
                    {passDetail.pass.locationVerification.rules.rules.map((rule) => (
                      <div key={rule.id}>
                        <dt>{rule.label}</dt>
                        <dd>{formatLocationRule(rule)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="detail-status">此卡券暂未配置位置范围。</p>
                )}
                {passDetail?.pass.locationVerification?.required &&
                !sessionUser?.serverAccountVerified ? (
                  <p className="detail-status">
                    位置核验需要先完成服务器账号验证。<a href="/account">前往账户页</a>
                  </p>
                ) : null}
                {passDetail?.pass.locationVerification?.required &&
                sessionUser?.serverAccountVerified &&
                sessionUser.serverAccountName ? (
                  <p className="detail-status">
                    将使用服务器 ID「{sessionUser.serverAccountName}」核验当前位置。
                  </p>
                ) : null}
                {locationVerificationMessage ? (
                  <p className="detail-status">{locationVerificationMessage}</p>
                ) : null}
                <button
                  className="secondary-action"
                  type="button"
                  disabled={
                    isUsingOfflineSnapshot ||
                    isPassDetailLoading ||
                    isVerifyingLocation ||
                    !canVerifySelectedLocation
                  }
                  onClick={() => void verifyLocation()}
                >
                  {isVerifyingLocation ? '核验中' : '验证当前位置'}
                </button>
              </section>
            ) : null}
            {activeDetailModule === 'topUp' ? (
            <section className="detail-top-up" aria-label="额度补充">
              {!passDetail && isPassDetailLoading ? (
                <p className="detail-status">正在读取额度补充规则...</p>
              ) : null}
              {topUpMessage ? <p className="detail-status">{topUpMessage}</p> : null}
              {currentDisputableTopUp ? (
                <button className="secondary-action" type="button" onClick={openCurrentTopUpDispute}>
                  提交最近补充争议
                </button>
              ) : null}
              {canTopUpSelectedPass && topUpSourcePasses.length === 0 ? (
                <p className="detail-status">当前没有同类且开放作为补充来源的卡券。</p>
              ) : null}
              <form className="detail-top-up-form" onSubmit={(event) => void submitTopUp(event)}>
                <label>
                  <span>来源卡</span>
                  <button
                    className="top-up-source-trigger"
                    type="button"
                    onClick={() => openDetailModule('topUpSource')}
                    disabled={
                      !canTopUpSelectedPass ||
                      isUsingOfflineSnapshot ||
                      isSubmittingTopUp ||
                      topUpSourcePasses.length === 0
                    }
                  >
                    <span>
                      {selectedTopUpSourcePass
                        ? `${selectedTopUpSourcePass.displayName} · ${formatBenefitValue(selectedTopUpSourcePass.balanceValue, selectedTopUpSourcePass.benefitType)}`
                        : '暂无可用来源卡'}
                    </span>
                    <span className="material-symbols-rounded" aria-hidden="true">
                      chevron_right
                    </span>
                  </button>
                </label>
                <label>
                  <span>补充值</span>
                  <input
                    value={topUpValue}
                    onChange={(event) => {
                      setTopUpValue(event.target.value);
                      setTopUpServerChallenge(null);
                      setTopUpRequest(null);
                    }}
                    placeholder={formatBenefitPlaceholder(selectedPass.benefitType)}
                    inputMode="decimal"
                    pattern={decimalInputPattern}
                    disabled={
                      !canTopUpSelectedPass ||
                      isUsingOfflineSnapshot ||
                      isSubmittingTopUp ||
                      topUpSourcePasses.length === 0
                    }
                    required
                  />
                </label>
                <label>
                  <span>确认方式</span>
                  <select
                    value={topUpVerificationMethod}
                    onChange={(event) => {
                      setTopUpVerificationMethod(
                        event.target.value === 'server_account' ? 'server_account' : 'pin',
                      );
                      setTopUpServerChallenge(null);
                      setTopUpRequest(null);
                      setTopUpMessage(null);
                    }}
                    disabled={
                      !canTopUpSelectedPass ||
                      isUsingOfflineSnapshot ||
                      isSubmittingTopUp ||
                      topUpSourcePasses.length === 0
                    }
                  >
                    <option value="pin">PIN</option>
                    <option value="server_account">服务器账号确认</option>
                  </select>
                </label>
                <label>
                  <span>备注</span>
                  <textarea
                    value={topUpNote}
                    onChange={(event) => {
                      setTopUpNote(event.target.value);
                      setTopUpServerChallenge(null);
                      setTopUpRequest(null);
                    }}
                    placeholder="可选"
                    rows={2}
                    disabled={
                      !canTopUpSelectedPass ||
                      isUsingOfflineSnapshot ||
                      isSubmittingTopUp ||
                      topUpSourcePasses.length === 0
                    }
                    maxLength={500}
                  />
                </label>
                {topUpVerificationMethod === 'pin' ? (
                  <label>
                    <span>PIN</span>
                    <input
                      type="password"
                      value={topUpPin}
                      onChange={(event) => setTopUpPin(event.target.value)}
                      placeholder="用于确认本次额度补充"
                      inputMode="numeric"
                      pattern="[0-9]{4,12}"
                      autoComplete="one-time-code"
                      disabled={
                        !canTopUpSelectedPass ||
                        isUsingOfflineSnapshot ||
                        isSubmittingTopUp ||
                        topUpSourcePasses.length === 0
                      }
                      required
                    />
                  </label>
                ) : (
                  <div className="top-up-server-challenge">
                    <span>服务器账号</span>
                    {sessionUser?.serverAccountVerified && sessionUser.serverAccountName ? (
                      topUpServerChallenge ? (
                        <>
                          <strong>{topUpServerChallenge.code}</strong>
                          {topUpRequest ? (
                            <small>
                              请求 {topUpRequest.id.slice(0, 8)} ·{' '}
                              {formatTopUpRequestStatus(topUpRequest.status)}
                            </small>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <p>点击后生成本次验证码。</p>
                          {topUpRequest ? (
                            <small>
                              请求 {topUpRequest.id.slice(0, 8)} ·{' '}
                              {formatTopUpRequestStatus(topUpRequest.status)}
                            </small>
                          ) : null}
                        </>
                      )
                    ) : (
                      <p>需要先在账户页完成服务器账号验证。</p>
                    )}
                  </div>
                )}
                {topUpVerificationMethod === 'server_account' &&
                topUpRequest?.status === 'WaitingVerification' ? (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={isSubmittingTopUp}
                    onClick={() => void cancelTopUpRequest()}
                  >
                    取消本次补充
                  </button>
                ) : null}
                <button
                  className="secondary-action"
                  type="submit"
                  disabled={
                    !canTopUpSelectedPass ||
                    isUsingOfflineSnapshot ||
                    isSubmittingTopUp ||
                    topUpSourcePasses.length === 0
                  }
                >
                  {isSubmittingTopUp
                    ? '处理中'
                    : topUpVerificationMethod === 'server_account' && !topUpServerChallenge
                      ? '获取验证码'
                      : '确认补充'}
                </button>
              </form>
            </section>
            ) : null}
            {activeDetailModule === 'topUpSource' ? (
            <section className="detail-top-up-source" aria-label="选择来源卡">
              {topUpSourcePasses.length ? (
                <div className="top-up-source-list">
                  {topUpSourcePasses.map((pass) => (
                    <button
                      className={`top-up-source-option${pass.id === topUpSourcePassId ? ' is-selected' : ''}`}
                      type="button"
                      key={pass.id}
                      onClick={() => {
                        setTopUpSourcePassId(pass.id);
                        setTopUpServerChallenge(null);
                        setTopUpRequest(null);
                        setActiveDetailModule('topUp');
                      }}
                    >
                      <span>{pass.providerName}</span>
                      <strong>{pass.displayName}</strong>
                      <b>{formatBenefitValue(pass.balanceValue, pass.benefitType)}</b>
                      <small>{pass.maskedNumber ?? pass.status}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="detail-status">当前没有同类且开放作为补充来源的卡券。</p>
              )}
              <div className="form-actions compact-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setActiveDetailModule('topUp')}
                >
                  返回充值
                </button>
              </div>
            </section>
            ) : null}
            {activeDetailModule === 'transfer' ? (
            <section className="detail-transfers" aria-label="卡券转赠">
              {!passDetail && isPassDetailLoading ? (
                <p className="detail-status">正在读取转赠规则...</p>
              ) : null}
              {selectedPassSentTransfers.length ? (
                <ol>
                  {selectedPassSentTransfers.map((transfer) => (
                    <li key={transfer.id}>
                      <div>
                        <strong>等待 {transfer.toUser.username} 确认</strong>
                        <span>到期：{formatDate(transfer.expiresAt, '')}</span>
                      </div>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={resolvingTransferId === transfer.id}
                        onClick={() => void cancelTransfer(transfer)}
                      >
                        取消
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
              <form
                className="detail-transfer-form"
                onSubmit={(event) => void submitTransfer(event)}
              >
                <label>
                  <span>接收方</span>
                  <input
                    value={transferRecipient}
                    onChange={(event) => setTransferRecipient(event.target.value)}
                    placeholder="用户名或邮箱"
                    disabled={
                      !canTransferSelectedPass || isUsingOfflineSnapshot || isSubmittingTransfer
                    }
                    maxLength={120}
                  />
                </label>
                <label>
                  <span>备注</span>
                  <textarea
                    value={transferNote}
                    onChange={(event) => setTransferNote(event.target.value)}
                    placeholder="可选"
                    rows={2}
                    disabled={
                      !canTransferSelectedPass || isUsingOfflineSnapshot || isSubmittingTransfer
                    }
                    maxLength={500}
                  />
                </label>
                <button
                  className="secondary-action"
                  type="submit"
                  disabled={
                    !canTransferSelectedPass ||
                    isUsingOfflineSnapshot ||
                    isSubmittingTransfer ||
                    Boolean(selectedPassSentTransfers.length)
                  }
                >
                  {isSubmittingTransfer ? '发起中' : '发起转赠'}
                </button>
              </form>
            </section>
            ) : null}
            {activeDetailModule === 'use' ? (
            <section className="detail-use" aria-label="发起消耗">
              {redemptionMessage ? <p className="detail-status">{redemptionMessage}</p> : null}
              <form
                className="detail-use-form"
                onSubmit={(event) => void submitSelfRedemption(event)}
              >
                <label>
                  <span>消耗值</span>
                  <input
                    value={selfRedemptionValue}
                    onChange={(event) => setSelfRedemptionValue(event.target.value)}
                    placeholder={formatBenefitPlaceholder(selectedPass.benefitType)}
                    inputMode="decimal"
                    pattern={decimalInputPattern}
                    disabled={
                      !canUseSelectedPass ||
                      isUsingOfflineSnapshot ||
                      isCreatingSelfRedemption ||
                      Boolean(redemptionRequests.length)
                    }
                    required
                  />
                </label>
                <label>
                  <span>验证方式</span>
                  <select
                    value={selfRedemptionMethod}
                    onChange={(event) =>
                      setSelfRedemptionMethod(
                        event.target.value as WalletRedemptionRequest['verificationMethod'],
                      )
                    }
                    disabled={
                      !canUseSelectedPass ||
                      isUsingOfflineSnapshot ||
                      isCreatingSelfRedemption ||
                      Boolean(redemptionRequests.length)
                    }
                  >
                    <option value="pin">PIN</option>
                    <option value="server_account">服务器账号</option>
                  </select>
                </label>
                <button
                  className="secondary-action"
                  type="submit"
                  disabled={
                    !canUseSelectedPass ||
                    isUsingOfflineSnapshot ||
                    isCreatingSelfRedemption ||
                    Boolean(redemptionRequests.length)
                  }
                >
                  {isCreatingSelfRedemption ? '发起中' : '发起使用'}
                </button>
              </form>
            </section>
            ) : null}
            {activeDetailModule === 'redemptions' ? (
            <section className="detail-redemptions" aria-label="待确认核销请求">
              {isRedemptionsLoading ? <p className="detail-status">正在读取待确认请求...</p> : null}
              {redemptionMessage ? <p className="detail-status">{redemptionMessage}</p> : null}
              {redemptionRequests.length ? (
                <ol>
                  {redemptionRequests.map((request) => {
                    const serverChallenge = serverRedemptionChallenges[request.id];

                    return (
                      <li key={request.id}>
                        <div>
                          <strong>
                            {formatBenefitValue(request.requestedValue, request.pass.benefitType)}
                          </strong>
                          <span>
                            {request.providerName} ·{' '}
                            {formatVerificationMethod(request.verificationMethod)} · 到期：
                            {formatDate(request.expiresAt, '')}
                          </span>
                          <span>
                            尝试：{request.verificationFailureCount}/
                            {request.maxVerificationAttempts}
                            {request.failureMessage ? ` · ${request.failureMessage}` : ''}
                          </span>
                        </div>
                        {request.verificationMethod === 'server_account' ? (
                          <div className="server-confirm-panel">
                            {serverChallenge ? (
                              <p>
                                用服务器 ID「{serverChallenge.serverId}」发送：
                                <strong>{serverChallenge.code}</strong>
                              </p>
                            ) : (
                              <p>需要为本次消耗重新获取服务器聊天验证码。</p>
                            )}
                            <div className="inline-actions">
                              <button
                                className="secondary-action"
                                type="button"
                                disabled={confirmingRedemptionId === request.id}
                                onClick={() => void startRedemptionServerChallenge(request)}
                              >
                                {serverRedemptionChallenges[request.id]
                                  ? '重新获取验证码'
                                  : '获取验证码'}
                              </button>
                              <button
                                className="secondary-action"
                                type="button"
                                disabled={confirmingRedemptionId === request.id || !serverChallenge}
                                onClick={() => void confirmRedemptionWithServer(request)}
                              >
                                {confirmingRedemptionId === request.id
                                  ? '检查中'
                                  : '我已发送，检查确认'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <form
                            className="inline-pin-form"
                            onSubmit={(event) => void confirmRedemptionWithPin(event, request)}
                          >
                            <input
                              type="password"
                              inputMode="numeric"
                              pattern="[0-9]{4,12}"
                              placeholder="PIN"
                              value={pinInputs[request.id] ?? ''}
                              onChange={(event) =>
                                setPinInputs((currentInputs) => ({
                                  ...currentInputs,
                                  [request.id]: event.target.value,
                                }))
                              }
                              required
                            />
                            <button
                              className="secondary-action"
                              type="submit"
                              disabled={confirmingRedemptionId === request.id}
                            >
                              {confirmingRedemptionId === request.id ? '确认中' : '确认'}
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : !isRedemptionsLoading ? (
                <p className="detail-status">暂无待确认消耗。</p>
              ) : null}
            </section>
            ) : null}
            {activeDetailModule === 'createDispute' ? (
            <section className="detail-disputes" aria-label="提交新的争议">
              {disputeMessage ? <p className="detail-status">{disputeMessage}</p> : null}
              <form className="detail-dispute-form" onSubmit={(event) => void submitDispute(event)}>
                <label>
                  <span>争议对象</span>
                  <select
                    value={disputeSubjectType}
                    onChange={(event) => {
                      const nextSubjectType =
                        event.target.value === 'pass_top_up' && currentDisputableTopUp
                          ? 'pass_top_up'
                          : 'pass';
                      setDisputeSubjectType(nextSubjectType);
                      setDisputeTopUpId(
                        nextSubjectType === 'pass_top_up' ? currentDisputableTopUp?.id ?? '' : '',
                      );
                    }}
                    disabled={isUsingOfflineSnapshot || isSubmittingDispute}
                  >
                    <option value="pass">当前卡券</option>
                    {currentDisputableTopUp ? (
                      <option value="pass_top_up">额度补充请求</option>
                    ) : null}
                  </select>
                </label>
                {disputeSubjectType === 'pass_top_up' && currentDisputableTopUp ? (
                  <label>
                    <span>补充请求</span>
                    <select
                      value={currentDisputableTopUp.id}
                      onChange={(event) => setDisputeTopUpId(event.target.value)}
                      disabled={isUsingOfflineSnapshot || isSubmittingDispute}
                    >
                      {disputableTopUpOptions.map((request) => (
                        <option value={request.id} key={request.id}>
                          {formatTopUpRequestStatus(request.status)} · {request.id.slice(0, 8)} ·{' '}
                          {formatBenefitValue(request.value, selectedPass.benefitType)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  <span>争议原因</span>
                  <textarea
                    value={disputeReason}
                    onChange={(event) => setDisputeReason(event.target.value)}
                    placeholder={
                      disputeSubjectType === 'pass_top_up'
                        ? '例如：来源卡扣减或目标卡增加的额度不符合预期'
                        : '例如：余额扣减有误、票券信息不一致'
                    }
                    rows={5}
                    disabled={isUsingOfflineSnapshot || isSubmittingDispute}
                  />
                </label>
                <div className="form-actions compact-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => setActiveDetailModule('disputes')}
                  >
                    返回记录
                  </button>
                  <button
                    className="primary-action"
                    type="submit"
                    disabled={isUsingOfflineSnapshot || isSubmittingDispute}
                  >
                    {isSubmittingDispute ? '提交中' : '提交'}
                  </button>
                </div>
              </form>
            </section>
            ) : null}
            {activeDetailModule === 'disputes' ? (
            <section className="detail-disputes" aria-label="争议记录">
              {isDisputesLoading ? <p className="detail-status">正在读取争议记录...</p> : null}
              {disputeMessage ? <p className="detail-status">{disputeMessage}</p> : null}
              <div className="form-actions compact-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={isUsingOfflineSnapshot}
                  onClick={() => {
                    setDisputeSubjectType('pass');
                    setDisputeTopUpId('');
                    setDisputeMessage(null);
                    setActiveDetailModule('createDispute');
                  }}
                >
                  提交新的争议
                </button>
              </div>
              {disputes.length ? (
                <ol>
                  {disputes.map((dispute) => (
                    <li key={dispute.id}>
                      <div>
                        <strong>{formatDisputeStatus(dispute.status)}</strong>
                        <small>{formatDisputeSubject(dispute)}</small>
                        <span>{dispute.reason}</span>
                      </div>
                      <small>{formatDate(dispute.updatedAt, '')}</small>
                    </li>
                  ))}
                </ol>
              ) : !isDisputesLoading ? (
                <p className="detail-status">暂无争议记录。</p>
              ) : null}
            </section>
            ) : null}
            {activeDetailModule === 'ledger' ? (
            <section className="detail-ledger" aria-label="交易记录">
              {isLedgerLoading ? <p className="detail-status">正在读取交易记录...</p> : null}
              {isTopUpHistoryLoading ? <p className="detail-status">正在读取额度补充记录...</p> : null}
              {ledgerMessage ? <p className="detail-status detail-status-error">{ledgerMessage}</p> : null}
              {topUpHistoryMessage ? <p className="detail-status detail-status-error">{topUpHistoryMessage}</p> : null}
              {transactionRecords.length ? (
                <ol>
                  {transactionRecords.map((record) =>
                    record.kind === 'ledger' ? (
                      <li key={record.id}>
                        <div>
                          <strong>{formatLedgerReason(record.entry.reason)}</strong>
                          <span>{record.entry.note ?? formatLedgerActor(record.entry.createdByType)}</span>
                        </div>
                        <div>
                          <b>{formatSignedValue(record.entry.changeValue, record.entry.benefitType)}</b>
                          <small>{formatDate(record.entry.createdAt, '')}</small>
                        </div>
                      </li>
                    ) : (
                      <li key={record.id}>
                        <div>
                          <strong>{formatTopUpHistorySummary(record.request, selectedPass.id)}</strong>
                          <span>
                            {formatTopUpHistoryCounterparty(record.request, selectedPass.id)} ·{' '}
                            {formatVerificationMethod(record.request.verificationMethod)}
                          </span>
                          <span>
                            {formatTopUpRequestStatus(record.request.status)} ·{' '}
                            {formatDate(record.request.completedAt ?? record.request.cancelledAt ?? record.request.updatedAt, '')}
                            {record.request.failureMessage ? ` · ${record.request.failureMessage}` : ''}
                          </span>
                        </div>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => {
                            setDisputeSubjectType('pass_top_up');
                            setDisputeTopUpId(record.request.id);
                            setDisputeMessage(null);
                            setActiveDetailModule('createDispute');
                          }}
                        >
                          提交争议
                        </button>
                      </li>
                    ),
                  )}
                </ol>
              ) : !isLedgerLoading && !isTopUpHistoryLoading ? (
                <p className="detail-status">暂无交易记录。</p>
              ) : null}
            </section>
            ) : null}
                </div>
              </div>
            ) : null}
          </aside>
        ) : null}
      </section>
      )}
    </main>
  );
}

function getCategoryHref(categoryKey: CategoryKey): string {
  return categoryKey === 'account' ? '/' : `/?category=${categoryKey}`;
}

function isActiveSessionUser(user: SessionResponse['user']): boolean {
  return user?.status === 'Active';
}

function isDialogDetailModule(module: DetailModule): boolean {
  return [
    'passInfo',
    'provider',
    'ticket',
    'location',
    'topUp',
    'topUpSource',
    'use',
    'redemptions',
    'transfer',
    'disputes',
    'createDispute',
    'ledger',
  ].includes(module);
}

function formatInactiveAccountMessage(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '账户注册申请正在等待管理员审核，通过后才能使用卡包功能。',
    Rejected: '账户注册申请未通过，请根据管理员反馈补充信息后重新提交。',
    WaitingServerVerification: '账户正在等待服务器账号验证，请回到注册流程完成验证。',
    CodeRotated: '服务器验证码已更新，请使用最新验证码完成验证。',
    Verified: '服务器账号已验证，账户正在完成激活，请稍后刷新。',
    Approved: '账户已通过审核，正在完成激活，请稍后刷新。',
    Draft: '账户注册信息尚未提交完成。',
    Failed: '账户注册流程失败，请重新提交注册申请或联系管理员。',
  };

  return labels[status] ?? `账户当前状态为 ${status}，暂不能使用卡包功能。`;
}

function formatTopUpRequestStatus(status: TopUpRequestStatus): string {
  const labels: Record<TopUpRequestStatus, string> = {
    Created: '已创建',
    WaitingVerification: '等待验证',
    Succeeded: '已完成',
    Failed: '已失败',
    Cancelled: '已取消',
    Expired: '已过期',
    Reversed: '已冲正',
  };

  return labels[status];
}

function formatTopUpHistorySummary(request: WalletTopUpHistoryItem, selectedPassId: string): string {
  const benefitType =
    request.targetPass.id === selectedPassId
      ? request.targetPass.benefitType
      : request.sourcePass.benefitType;
  const prefix = request.targetPass.id === selectedPassId ? '补充' : '作为来源消耗';

  return `${prefix} ${formatBenefitValue(request.value, benefitType)}`;
}

function formatTopUpHistoryCounterparty(
  request: WalletTopUpHistoryItem,
  selectedPassId: string,
): string {
  if (request.targetPass.id === selectedPassId) {
    return `来源：${request.sourcePass.displayName}`;
  }

  if (request.sourcePass.id === selectedPassId) {
    return `目标：${request.targetPass.displayName}`;
  }

  return `${request.sourcePass.displayName} -> ${request.targetPass.displayName}`;
}

function toWalletPassSummary(pass: WalletPassDetail): WalletPass {
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
    maskedNumber: pass.maskedNumber,
    backgroundImageUrl: pass.backgroundImageUrl ?? null,
    balanceValue: pass.balanceValue,
    frozenValue: pass.frozenValue,
    overdraftLimit: pass.overdraftLimit,
    expiresAt: pass.expiresAt,
    sortOrder: pass.sortOrder,
    updatedAt: pass.updatedAt,
  };
}

function toWalletPassFromRedemption(pass: WalletRedemptionPass): WalletPass {
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
    maskedNumber: pass.maskedNumber,
    backgroundImageUrl: pass.backgroundImageUrl ?? null,
    balanceValue: pass.balanceValue,
    frozenValue: pass.frozenValue,
    overdraftLimit: pass.overdraftLimit,
    expiresAt: pass.expiresAt,
    sortOrder: pass.sortOrder,
    updatedAt: pass.updatedAt,
  };
}

function PassCardContent({ pass }: { pass: WalletPass }) {
  const hasCardImage = Boolean(pass.backgroundImageUrl);
  const shouldShowFallbackInfo = !hasCardImage && pass.hideTitle !== true;

  return (
    <>
      {hasCardImage ? (
        <span
          className="wallet-pass-card-image"
          aria-hidden="true"
          style={{ backgroundImage: 'url(' + pass.backgroundImageUrl + ')' }}
        />
      ) : null}
      {shouldShowFallbackInfo ? <strong>{pass.title}</strong> : null}
      {shouldShowFallbackInfo ? <b>{formatBenefitValue(pass.balanceValue, pass.benefitType)}</b> : null}
      <small>{formatPassTailNumber(pass.maskedNumber) ?? '****'}</small>
    </>
  );
}

function UnauthenticatedHome({ message }: { message: string | null }) {
  return (
    <section className="guest-home" aria-labelledby="guest-home-title">
      <div className="guest-home-copy">
        <span className="account-kicker">临东通</span>
        <h1 id="guest-home-title">
          <span>在一处</span>
          <span>行遍天地间</span>
          <span>就是现在</span>
        </h1>
        <p>把卡券、证件、票券和领取码收进同一个卡包，登录后即可同步到你的设备。</p>
        {message ? (
          <div className="flow-notice" role="status" aria-live="polite">
            <span>{message}</span>
          </div>
        ) : null}
        <div className="form-actions">
          <a className="primary-action" href="/register">
            <span className="material-symbols-rounded" aria-hidden="true">
              person_add
            </span>
            <span>注册</span>
          </a>
          <a className="secondary-action" href="/login">
            登录
          </a>
          <a className="secondary-action" href="/add">
            使用领取码
          </a>
        </div>
      </div>
      <div className="guest-home-visual" aria-hidden="true">
        <div className="wallet-pass-card wallet-pass-card-account">
          <span>临东通</span>
          <strong>城市通行卡</strong>
          <b>128</b>
          <small>**** 2026</small>
        </div>
        <div className="wallet-pass-card wallet-pass-card-ticket">
          <span>票券</span>
          <strong>天地间观光线</strong>
          <b>1</b>
          <small>**** 0624</small>
        </div>
        <div className="wallet-pass-card wallet-pass-card-identity_key">
          <span>身份钥匙</span>
          <strong>临东港口通行证</strong>
          <b>OK</b>
          <small>**** LD</small>
        </div>
      </div>
    </section>
  );
}

function formatPassTailNumber(maskedNumber: string | null): string | null {
  if (!maskedNumber) {
    return null;
  }

  const tail = maskedNumber.trim().slice(-4);

  return tail ? '**** ' + tail : maskedNumber;
}

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

function replaceCategoryOrder(
  passes: WalletPass[],
  categoryKey: CategoryKey,
  orderedPassIds: string[],
): WalletPass[] {
  const orderIndex = new Map(orderedPassIds.map((passId, index) => [passId, index]));
  const orderedCategoryPasses = passes
    .filter((pass) => pass.category === categoryKey)
    .sort(
      (first, second) =>
        (orderIndex.get(first.id) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(second.id) ?? Number.MAX_SAFE_INTEGER),
    );
  let categoryPassIndex = 0;

  return passes.map((pass) => {
    if (pass.category !== categoryKey) {
      return pass;
    }

    const nextPass = orderedCategoryPasses[categoryPassIndex];
    categoryPassIndex += 1;
    return nextPass ?? pass;
  });
}

function formatBenefitValue(value: string, benefitType: WalletPass['benefitType']): string {
  if (benefitType === 'points') {
    return `${Number(value).toLocaleString('zh-CN')} 积分`;
  }

  if (benefitType === 'times') {
    return `${Number(value).toLocaleString('zh-CN')} 次`;
  }

  return Number(value).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  });
}

function formatSignedValue(value: string, benefitType: WalletPass['benefitType']): string {
  const numericValue = Number(value);
  const sign = numericValue > 0 ? '+' : '';
  return `${sign}${formatBenefitValue(value, benefitType)}`;
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }

  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLedgerReason(reason: WalletLedgerEntry['reason']): string {
  const labels: Record<WalletLedgerEntry['reason'], string> = {
    issue: '初始发放',
    grant: '权益发放',
    use: '消耗权益',
    top_up: '额度补充',
    adjustment: '人工调整',
    refund: '退回权益',
    sync: '同步更新',
  };

  return labels[reason];
}

function formatLedgerActor(actorType: WalletLedgerEntry['createdByType']): string {
  const labels: Record<WalletLedgerEntry['createdByType'], string> = {
    user: '用户操作',
    provider: '提供方操作',
    admin: '管理员操作',
    system: '系统操作',
  };

  return labels[actorType];
}

function formatVerificationMethod(method: WalletRedemptionRequest['verificationMethod']): string {
  return method === 'server_account' ? '服务器账号验证' : 'PIN 验证';
}

function formatBenefitPlaceholder(benefitType: WalletPass['benefitType']): string {
  if (benefitType === 'points') {
    return '例如：100';
  }

  if (benefitType === 'times') {
    return '例如：1';
  }

  return '例如：18.7';
}

function createClientIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function formatDisputeStatus(status: WalletDispute['status']): string {
  const labels: Record<WalletDispute['status'], string> = {
    Submitted: '已提交',
    InReview: '处理中',
    NeedMoreInfo: '需要补充',
    Approved: '已认可',
    Rejected: '已驳回',
    Reversed: '已反转',
    Closed: '已关闭',
  };

  return labels[status];
}

function formatDisputeSubject(dispute: WalletDispute): string {
  const labels: Record<string, string> = {
    pass: '当前卡券',
    ledger_entry: '交易流水',
    redemption_request: '消耗请求',
    admin_adjustment: '管理员调整',
    pass_top_up: '额度补充',
  };

  return `${labels[dispute.subjectType] ?? dispute.subjectType} · ${dispute.subjectId.slice(0, 8)}`;
}

function readTransferableRule(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { transferable?: unknown }).transferable === true;
}

function formatTicketStatus(ticketInfo: WalletTicketInfo | null): string {
  if (!ticketInfo) {
    return '未设置';
  }

  const checkInLabels: Record<WalletTicketInfo['checkInStatus'], string> = {
    not_checked_in: '未检票',
    checked_in: '已检票',
    voided: '已作废',
  };
  const changeLabels: Record<WalletTicketInfo['changeStatus'], string> = {
    none: '无变更',
    rescheduled: '已改签',
    cancelled: '已取消',
  };

  return `${checkInLabels[ticketInfo.checkInStatus]} · ${changeLabels[ticketInfo.changeStatus]}`;
}

function formatLocationRule(rule: WalletLocationRule): string {
  const expiresText = `${rule.expiresAfterSeconds} 秒有效`;

  if (rule.kind === 'circle') {
    return `圆形范围 · 中心 X ${formatCoordinate(rule.centerX)} / Z ${formatCoordinate(rule.centerZ)} · 半径 ${formatCoordinate(rule.radius)} · ${expiresText}`;
  }

  return `矩形范围 · X ${formatCoordinate(rule.minX)} 到 ${formatCoordinate(rule.maxX)} · Z ${formatCoordinate(rule.minZ)} 到 ${formatCoordinate(
    rule.maxZ,
  )} · ${expiresText}`;
}

function formatCoordinate(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '未设置';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
