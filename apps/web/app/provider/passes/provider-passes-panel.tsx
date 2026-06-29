'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

interface ProviderPassUser {
  id: string;
  username: string;
  email: string;
}

interface ProviderPass {
  id: string;
  displayName: string;
  title: string;
  category: string;
  benefitType: 'amount' | 'points' | 'times';
  status: string;
  publicNumber: string | null;
  maskedNumber: string | null;
  balanceValue: string;
  frozenValue: string;
  overdraftLimit: string;
  ticketInfo: ProviderTicketInfo | null;
  user: ProviderPassUser | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderTicketInfo {
  eventName: string | null;
  venue: string | null;
  startsAt: string | null;
  seatLabel: string | null;
  checkInStatus: 'not_checked_in' | 'checked_in' | 'voided';
  changeStatus: 'none' | 'rescheduled' | 'cancelled';
}

interface ProviderTicketUpdateRequest {
  id: string;
  passId: string;
  providerId: string;
  status: string;
  currentTicketInfo: ProviderTicketInfo | null;
  proposedTicketInfo: ProviderTicketInfo | null;
  reason: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  pass: Pick<
    ProviderPass,
    | 'id'
    | 'displayName'
    | 'title'
    | 'category'
    | 'benefitType'
    | 'publicNumber'
    | 'maskedNumber'
    | 'user'
  >;
}

interface ProviderPassesResponse {
  passes: ProviderPass[];
}

interface AdjustPassResponse {
  pass: ProviderPass;
  ledgerEntry: {
    id: string;
    beforeValue: string;
    changeValue: string;
    afterValue: string;
    reason: string;
    note: string | null;
    createdAt: string;
  };
}

interface ProviderRedemptionRequest {
  id: string;
  status: string;
  verificationMethod: 'server_account' | 'pin';
  requestedValue: string;
  expiresAt: string;
  verificationFailureCount: number;
  maxVerificationAttempts: number;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  pass: ProviderPass;
  user: ProviderPassUser | null;
}

interface ProviderRedemptionsResponse {
  redemptionRequests: ProviderRedemptionRequest[];
}

interface CreateRedemptionResponse {
  redemptionRequest: ProviderRedemptionRequest;
}

interface CancelRedemptionResponse {
  redemptionRequest: ProviderRedemptionRequest;
}

interface ReverseRedemptionResponse {
  redemptionRequest: ProviderRedemptionRequest;
  pass: Pick<
    ProviderPass,
    'id' | 'status' | 'balanceValue' | 'frozenValue' | 'overdraftLimit' | 'updatedAt'
  >;
  ledgerEntry: {
    id: string;
    beforeValue: string;
    changeValue: string;
    afterValue: string;
    reason: string;
    note: string | null;
    createdAt: string;
  } | null;
}

interface UpdateTicketResponse {
  pass: ProviderPass;
  ticketUpdateRequest: ProviderTicketUpdateRequest;
}

interface ProviderTicketUpdateRequestsResponse {
  ticketUpdateRequests: ProviderTicketUpdateRequest[];
}

interface ChangePassStatusResponse {
  pass: ProviderPass;
  revokedAddPassTokens?: number;
}

interface ProviderActionLink {
  id: string;
  kind: 'use' | 'top_up';
  status: string;
  providerName: string;
  targetPassId: string;
  requestedValue: string;
  verificationMethod: 'server_account' | 'pin';
  note: string | null;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  token?: string;
  actionPath?: string;
  targetPass: Pick<
    ProviderPass,
    | 'id'
    | 'displayName'
    | 'title'
    | 'category'
    | 'benefitType'
    | 'status'
    | 'publicNumber'
    | 'maskedNumber'
    | 'balanceValue'
    | 'user'
  >;
  consumedByUser: ProviderPassUser | null;
}

interface CreateActionLinkResponse {
  actionLink: ProviderActionLink;
}

interface ProviderActionLinksResponse {
  actionLinks: ProviderActionLink[];
}

interface RevokeActionLinkResponse {
  actionLink: ProviderActionLink;
}

interface BatchRevokeActionLinksResponse {
  revokedActionLinks: ProviderActionLink[];
  skippedActionLinks: ProviderActionLink[];
  notFoundActionLinkIds: string[];
}

type ActionLinkKindFilter = 'all' | ProviderActionLink['kind'];
type ActionLinkStatusFilter = 'all' | 'Active' | 'Consumed' | 'Expired' | 'Revoked';
type ProviderPassDialogKind =
  | 'detail'
  | 'adjust'
  | 'redemption'
  | 'actionLink'
  | 'status'
  | 'ticketUpdate'
  | 'ticketRequests';

export function ProviderPassesPanel() {
  const [passes, setPasses] = useState<ProviderPass[]>([]);
  const [redemptionRequests, setRedemptionRequests] = useState<ProviderRedemptionRequest[]>([]);
  const [selectedPassId, setSelectedPassId] = useState<string | null>(null);
  const [activePassDialog, setActivePassDialog] = useState<ProviderPassDialogKind | null>(null);
  const [keyword, setKeyword] = useState('');
  const [changeValue, setChangeValue] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [consumeValue, setConsumeValue] = useState('');
  const [consumeMethod, setConsumeMethod] = useState<'server_account' | 'pin'>('server_account');
  const [consumeExpiresInSeconds, setConsumeExpiresInSeconds] = useState('120');
  const [consumeMaxVerificationAttempts, setConsumeMaxVerificationAttempts] = useState('3');
  const [actionLinkKind, setActionLinkKind] = useState<'use' | 'top_up'>('use');
  const [actionLinkValue, setActionLinkValue] = useState('');
  const [actionLinkMethod, setActionLinkMethod] = useState<'server_account' | 'pin'>('pin');
  const [actionLinkExpiresInSeconds, setActionLinkExpiresInSeconds] = useState('900');
  const [actionLinkNote, setActionLinkNote] = useState('');
  const [actionLinkKindFilter, setActionLinkKindFilter] = useState<ActionLinkKindFilter>('all');
  const [actionLinkStatusFilter, setActionLinkStatusFilter] =
    useState<ActionLinkStatusFilter>('all');
  const [actionLinkScope, setActionLinkScope] = useState<'current' | 'all'>('current');
  const [selectedActionLinkIds, setSelectedActionLinkIds] = useState<string[]>([]);
  const [latestActionLink, setLatestActionLink] = useState<ProviderActionLink | null>(null);
  const [actionLinks, setActionLinks] = useState<ProviderActionLink[]>([]);
  const [ticketEventName, setTicketEventName] = useState('');
  const [ticketVenue, setTicketVenue] = useState('');
  const [ticketStartsAt, setTicketStartsAt] = useState('');
  const [ticketSeatLabel, setTicketSeatLabel] = useState('');
  const [ticketCheckInStatus, setTicketCheckInStatus] =
    useState<ProviderTicketInfo['checkInStatus']>('not_checked_in');
  const [ticketChangeStatus, setTicketChangeStatus] =
    useState<ProviderTicketInfo['changeStatus']>('none');
  const [ticketUpdateReason, setTicketUpdateReason] = useState('');
  const [ticketUpdateRequests, setTicketUpdateRequests] = useState<ProviderTicketUpdateRequest[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingRedemption, setIsCreatingRedemption] = useState(false);
  const [isCreatingActionLink, setIsCreatingActionLink] = useState(false);
  const [cancellingRedemptionId, setCancellingRedemptionId] = useState<string | null>(null);
  const [reversingRedemptionId, setReversingRedemptionId] = useState<string | null>(null);
  const [isUpdatingTicket, setIsUpdatingTicket] = useState(false);
  const [isLoadingTicketUpdateRequests, setIsLoadingTicketUpdateRequests] = useState(true);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isLoadingRedemptions, setIsLoadingRedemptions] = useState(true);
  const [isLoadingActionLinks, setIsLoadingActionLinks] = useState(true);
  const [revokingActionLinkId, setRevokingActionLinkId] = useState<string | null>(null);
  const [isBatchRevokingActionLinks, setIsBatchRevokingActionLinks] = useState(false);
  const [exportingType, setExportingType] = useState<'passes' | 'ledger' | null>(null);

  const selectedPass = useMemo(
    () => passes.find((pass) => pass.id === selectedPassId) ?? passes[0] ?? null,
    [passes, selectedPassId],
  );
  const visibleActionLinks = useMemo(
    () =>
      actionLinks
        .filter((actionLink) =>
          actionLinkKindFilter === 'all' ? true : actionLink.kind === actionLinkKindFilter,
        )
        .filter((actionLink) =>
          actionLinkStatusFilter === 'all' ? true : actionLink.status === actionLinkStatusFilter,
        )
        .filter((actionLink) =>
          actionLinkScope === 'current' ? actionLink.targetPassId === selectedPass?.id : true,
        )
        .slice(0, actionLinkScope === 'current' ? 12 : 50),
    [actionLinkKindFilter, actionLinkScope, actionLinkStatusFilter, actionLinks, selectedPass?.id],
  );
  const visibleTicketUpdateRequests = useMemo(
    () =>
      ticketUpdateRequests
        .filter((request) => (selectedPass ? request.passId === selectedPass.id : true))
        .slice(0, 8),
    [selectedPass, ticketUpdateRequests],
  );
  const selectedActionLinkIdSet = useMemo(
    () => new Set(selectedActionLinkIds),
    [selectedActionLinkIds],
  );
  const selectableActionLinkIds = useMemo(
    () =>
      visibleActionLinks
        .filter((actionLink) => actionLink.status === 'Active')
        .map((actionLink) => actionLink.id),
    [visibleActionLinks],
  );

  const loadPasses = async (nextKeyword = keyword) => {
    setIsLoading(true);
    setMessage(null);

    const search = new URLSearchParams();
    search.set('take', '50');
    if (nextKeyword.trim()) {
      search.set('keyword', nextKeyword.trim());
    }

    try {
      const result = await getJson<ProviderPassesResponse>(
        `/api/provider/issuing/passes?${search.toString()}`,
      );
      setPasses(result.passes);
      setSelectedPassId((currentId) => {
        if (currentId && result.passes.some((pass) => pass.id === currentId)) {
          return currentId;
        }

        return result.passes[0]?.id ?? null;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取卡券列表失败。');
    } finally {
      setIsLoading(false);
    }
  };

  const loadRedemptionRequests = async (nextKeyword = keyword) => {
    setIsLoadingRedemptions(true);

    const search = new URLSearchParams();
    search.set('take', '10');
    if (nextKeyword.trim()) {
      search.set('keyword', nextKeyword.trim());
    }

    try {
      const result = await getJson<ProviderRedemptionsResponse>(
        `/api/provider/redemptions?${search.toString()}`,
      );
      setRedemptionRequests(result.redemptionRequests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取核销请求失败。');
    } finally {
      setIsLoadingRedemptions(false);
    }
  };

  const loadActionLinks = async () => {
    setIsLoadingActionLinks(true);

    const search = new URLSearchParams();
    search.set('take', '50');
    if (actionLinkKindFilter !== 'all') {
      search.set('kind', actionLinkKindFilter);
    }
    if (actionLinkStatusFilter !== 'all') {
      search.set('status', actionLinkStatusFilter);
    }

    try {
      const result = await getJson<ProviderActionLinksResponse>(
        `/api/provider/action-links?${search.toString()}`,
      );
      setActionLinks(result.actionLinks);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取操作链接失败。');
    } finally {
      setIsLoadingActionLinks(false);
    }
  };

  const loadTicketUpdateRequests = async () => {
    setIsLoadingTicketUpdateRequests(true);

    try {
      const result = await getJson<ProviderTicketUpdateRequestsResponse>(
        '/api/provider/issuing/ticket-update-requests',
      );
      setTicketUpdateRequests(result.ticketUpdateRequests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取票券变更申请失败。');
    } finally {
      setIsLoadingTicketUpdateRequests(false);
    }
  };

  useEffect(() => {
    void loadPasses('');
    void loadRedemptionRequests('');
    void loadActionLinks();
    void loadTicketUpdateRequests();
  }, []);

  useEffect(() => {
    setSelectedActionLinkIds((currentIds) =>
      currentIds.filter((actionLinkId) =>
        actionLinks.some((actionLink) => actionLink.id === actionLinkId),
      ),
    );
  }, [actionLinks]);

  useEffect(() => {
    setSelectedActionLinkIds((currentIds) =>
      currentIds.filter((actionLinkId) =>
        visibleActionLinks.some((actionLink) => actionLink.id === actionLinkId),
      ),
    );
  }, [visibleActionLinks]);

  useEffect(() => {
    const ticketInfo = selectedPass?.ticketInfo ?? null;
    setTicketEventName(ticketInfo?.eventName ?? '');
    setTicketVenue(ticketInfo?.venue ?? '');
    setTicketStartsAt(toDateTimeLocalValue(ticketInfo?.startsAt ?? null));
    setTicketSeatLabel(ticketInfo?.seatLabel ?? '');
    setTicketCheckInStatus(ticketInfo?.checkInStatus ?? 'not_checked_in');
    setTicketChangeStatus(ticketInfo?.changeStatus ?? 'none');
    setTicketUpdateReason('');
  }, [selectedPass?.id, selectedPass?.ticketInfo]);

  const openPassDialog = (pass: ProviderPass, dialogKind: ProviderPassDialogKind) => {
    setSelectedPassId(pass.id);
    setActivePassDialog(dialogKind);

    if (dialogKind === 'adjust') {
      setChangeValue('');
      setReason('');
      setNote('');
    }

    if (dialogKind === 'redemption') {
      setConsumeValue('');
      setConsumeMethod('server_account');
      setConsumeExpiresInSeconds('120');
      setConsumeMaxVerificationAttempts('3');
    }

    if (dialogKind === 'actionLink') {
      setActionLinkKind('use');
      setActionLinkValue('');
      setActionLinkMethod('pin');
      setActionLinkExpiresInSeconds('900');
      setActionLinkNote('');
      setLatestActionLink(null);
      setActionLinkScope('current');
    }

    if (dialogKind === 'ticketUpdate') {
      const ticketInfo = pass.ticketInfo;
      setTicketEventName(ticketInfo?.eventName ?? '');
      setTicketVenue(ticketInfo?.venue ?? '');
      setTicketStartsAt(toDateTimeLocalValue(ticketInfo?.startsAt ?? null));
      setTicketSeatLabel(ticketInfo?.seatLabel ?? '');
      setTicketCheckInStatus(ticketInfo?.checkInStatus ?? 'not_checked_in');
      setTicketChangeStatus(ticketInfo?.changeStatus ?? 'none');
      setTicketUpdateReason('');
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadPasses(keyword);
    void loadRedemptionRequests(keyword);
  };

  const exportCsv = async (type: 'passes' | 'ledger') => {
    const search = new URLSearchParams();
    search.set('take', '500');
    if (keyword.trim()) {
      search.set('keyword', keyword.trim());
    }

    const endpoint =
      type === 'passes'
        ? `/api/provider/issuing/passes/export.csv?${search.toString()}`
        : `/api/provider/issuing/ledger/export.csv?${search.toString()}`;
    const filename =
      type === 'passes' ? 'ldpass-provider-passes.csv' : 'ldpass-provider-ledger.csv';

    setExportingType(type);
    setMessage(null);

    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await readExportError(response));
      }

      const content = await response.text();
      downloadTextFile(filename, content, 'text/csv;charset=utf-8');
      setMessage(type === 'passes' ? '卡券清单 CSV 已生成。' : '权益流水 CSV 已生成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出 CSV 失败。');
    } finally {
      setExportingType(null);
    }
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setMessage('请先选择要调整的卡券。');
      return;
    }

    if (!changeValue.trim() || !reason.trim()) {
      setMessage('请输入调整值和调整原因。');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<AdjustPassResponse>(
        `/api/provider/issuing/passes/${selectedPass.id}/adjust`,
        {
          changeValue: changeValue.trim(),
          reason: reason.trim(),
          note: note.trim() || undefined,
        },
      );
      setPasses((currentPasses) =>
        currentPasses.map((pass) => (pass.id === result.pass.id ? result.pass : pass)),
      );
      setChangeValue('');
      setReason('');
      setNote('');
      setMessage(
        `已调整权益：${formatSignedValue(result.ledgerEntry.changeValue, result.pass.benefitType)}，当前值 ${formatBenefitValue(result.pass.balanceValue, result.pass.benefitType)}。`,
      );
      setActivePassDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '调整权益失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitRedemptionRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setMessage('请先选择要消耗的卡券。');
      return;
    }

    if (!selectedPass.user) {
      setMessage('卡券尚未被用户领取，不能发起消耗请求。');
      return;
    }

    if (!consumeValue.trim()) {
      setMessage('请输入消耗值。');
      return;
    }

    setIsCreatingRedemption(true);
    setMessage(null);

    try {
      const result = await postJson<CreateRedemptionResponse>('/api/provider/redemptions', {
        passId: selectedPass.id,
        requestedValue: consumeValue.trim(),
        verificationMethod: consumeMethod,
        expiresInSeconds: Number(consumeExpiresInSeconds || '120'),
        maxVerificationAttempts: Number(consumeMaxVerificationAttempts || '3'),
      });
      setRedemptionRequests((currentRequests) =>
        [result.redemptionRequest, ...currentRequests].slice(0, 10),
      );
      setConsumeValue('');
      setMessage(`已发起消耗请求，等待 ${selectedPass.user.username} 确认。`);
      setActivePassDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发起消耗请求失败。');
    } finally {
      setIsCreatingRedemption(false);
    }
  };

  const submitActionLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setMessage('请先选择要生成链接的卡券。');
      return;
    }

    if (!selectedPass.user) {
      setMessage('卡券尚未被用户领取，不能生成操作链接。');
      return;
    }

    if (!actionLinkValue.trim()) {
      setMessage('请输入链接数值。');
      return;
    }

    setIsCreatingActionLink(true);
    setLatestActionLink(null);
    setMessage(null);

    try {
      const result = await postJson<CreateActionLinkResponse>('/api/provider/action-links', {
        kind: actionLinkKind,
        targetPassId: selectedPass.id,
        requestedValue: actionLinkValue.trim(),
        verificationMethod: actionLinkMethod,
        expiresInSeconds: Number(actionLinkExpiresInSeconds || '900'),
        note: actionLinkNote.trim() || undefined,
      });
      setLatestActionLink(result.actionLink);
      setActionLinks((currentLinks) =>
        [
          result.actionLink,
          ...currentLinks.filter((actionLink) => actionLink.id !== result.actionLink.id),
        ].slice(0, 50),
      );
      setActionLinkValue('');
      setActionLinkNote('');
      setMessage('操作链接已生成，完整链接只在本次结果中展示。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成操作链接失败。');
    } finally {
      setIsCreatingActionLink(false);
    }
  };

  const revokeActionLink = async (actionLink: ProviderActionLink) => {
    const reason = window.prompt('请输入撤销操作链接的原因');
    if (reason === null) {
      return;
    }

    if (!reason.trim()) {
      setMessage('撤销原因不能为空。');
      return;
    }

    setRevokingActionLinkId(actionLink.id);
    setMessage(null);

    try {
      const result = await postJson<RevokeActionLinkResponse>(
        `/api/provider/action-links/${actionLink.id}/revoke`,
        {
          reason: reason.trim(),
        },
      );
      setActionLinks((currentLinks) =>
        currentLinks.map((currentLink) =>
          currentLink.id === result.actionLink.id ? result.actionLink : currentLink,
        ),
      );
      setMessage('操作链接已撤销。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销操作链接失败。');
    } finally {
      setRevokingActionLinkId(null);
    }
  };

  const toggleActionLinkSelection = (actionLinkId: string) => {
    setSelectedActionLinkIds((currentIds) =>
      currentIds.includes(actionLinkId)
        ? currentIds.filter((currentId) => currentId !== actionLinkId)
        : [...currentIds, actionLinkId],
    );
  };

  const toggleAllVisibleActionLinks = () => {
    setSelectedActionLinkIds((currentIds) => {
      const selectableIds = selectableActionLinkIds;
      const selectableIdSet = new Set(selectableIds);
      const hasSelectedAll =
        selectableIds.length > 0 &&
        selectableIds.every((actionLinkId) => currentIds.includes(actionLinkId));

      if (hasSelectedAll) {
        return currentIds.filter((actionLinkId) => !selectableIdSet.has(actionLinkId));
      }

      return [...new Set([...currentIds, ...selectableIds])];
    });
  };

  const batchRevokeActionLinks = async () => {
    const actionLinkIds = selectedActionLinkIds.filter((actionLinkId) =>
      actionLinks.some(
        (actionLink) => actionLink.id === actionLinkId && actionLink.status === 'Active',
      ),
    );

    if (!actionLinkIds.length) {
      setMessage('请选择至少一个可用的操作链接。');
      return;
    }

    const reason = window.prompt(`请输入批量撤销 ${actionLinkIds.length} 条操作链接的原因`);
    if (reason === null) {
      return;
    }

    if (!reason.trim()) {
      setMessage('撤销原因不能为空。');
      return;
    }

    setIsBatchRevokingActionLinks(true);
    setMessage(null);

    try {
      const result = await postJson<BatchRevokeActionLinksResponse>(
        '/api/provider/action-links/revoke-batch',
        {
          actionLinkIds,
          reason: reason.trim(),
        },
      );
      const updatedLinks = [...result.revokedActionLinks, ...result.skippedActionLinks];
      setActionLinks((currentLinks) =>
        currentLinks.map((currentLink) => {
          const updatedLink = updatedLinks.find((actionLink) => actionLink.id === currentLink.id);
          return updatedLink ?? currentLink;
        }),
      );
      setSelectedActionLinkIds((currentIds) =>
        currentIds.filter((actionLinkId) => !actionLinkIds.includes(actionLinkId)),
      );
      setMessage(
        `已撤销 ${result.revokedActionLinks.length} 条操作链接。${
          result.skippedActionLinks.length
            ? `跳过 ${result.skippedActionLinks.length} 条非可用链接。`
            : ''
        }${result.notFoundActionLinkIds.length ? `未找到 ${result.notFoundActionLinkIds.length} 条。` : ''}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量撤销操作链接失败。');
    } finally {
      setIsBatchRevokingActionLinks(false);
    }
  };

  const copyLatestActionLink = async () => {
    if (!latestActionLink) {
      return;
    }

    if (!latestActionLink.actionPath) {
      setMessage('完整链接只在生成时展示，历史记录不能再次复制。');
      return;
    }

    await navigator.clipboard.writeText(formatActionLinkUrl(latestActionLink.actionPath));
    setMessage('已复制操作链接。');
  };

  const submitTicketUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPass) {
      setMessage('请先选择票券。');
      return;
    }

    if (selectedPass.category !== 'ticket') {
      setMessage('只有票券分类可以更新票券字段。');
      return;
    }

    setIsUpdatingTicket(true);
    setMessage(null);

    try {
      const result = await postJson<UpdateTicketResponse>(
        `/api/provider/issuing/passes/${selectedPass.id}/ticket`,
        {
          eventName: ticketEventName.trim(),
          venue: ticketVenue.trim(),
          startsAt: ticketStartsAt,
          seatLabel: ticketSeatLabel.trim(),
          checkInStatus: ticketCheckInStatus,
          changeStatus: ticketChangeStatus,
          reason: ticketUpdateReason.trim() || undefined,
        },
      );
      setTicketUpdateRequests((currentRequests) => [
        result.ticketUpdateRequest,
        ...currentRequests.filter((request) => request.id !== result.ticketUpdateRequest.id),
      ]);
      setTicketUpdateReason('');
      setMessage('票券字段变更已提交，等待管理员审核后生效。');
      setActivePassDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交票券字段变更失败。');
    } finally {
      setIsUpdatingTicket(false);
    }
  };

  const cancelRedemptionRequest = async (request: ProviderRedemptionRequest) => {
    const reason = window.prompt('请输入取消核销原因');
    if (reason === null) {
      return;
    }

    if (!reason.trim()) {
      setMessage('取消核销原因不能为空。');
      return;
    }

    setCancellingRedemptionId(request.id);
    setMessage(null);

    try {
      const result = await postJson<CancelRedemptionResponse>(
        `/api/provider/redemptions/${request.id}/cancel`,
        {
          reason: reason.trim(),
        },
      );
      setRedemptionRequests((currentRequests) =>
        currentRequests.map((currentRequest) =>
          currentRequest.id === result.redemptionRequest.id
            ? result.redemptionRequest
            : currentRequest,
        ),
      );
      setMessage('核销请求已取消。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '取消核销请求失败。');
    } finally {
      setCancellingRedemptionId(null);
    }
  };

  const reverseRedemptionRequest = async (request: ProviderRedemptionRequest) => {
    if (!window.confirm('冲正会把本次已消耗的权益加回用户卡券，并保留原始消耗流水。确定继续吗？')) {
      return;
    }

    const reason = window.prompt('请输入冲正原因');
    if (reason === null) {
      return;
    }

    if (!reason.trim()) {
      setMessage('冲正原因不能为空。');
      return;
    }

    setReversingRedemptionId(request.id);
    setMessage(null);

    try {
      const result = await postJson<ReverseRedemptionResponse>(
        `/api/provider/redemptions/${request.id}/reverse`,
        {
          reason: reason.trim(),
        },
      );
      setRedemptionRequests((currentRequests) =>
        currentRequests.map((currentRequest) =>
          currentRequest.id === result.redemptionRequest.id
            ? result.redemptionRequest
            : currentRequest,
        ),
      );
      setPasses((currentPasses) =>
        currentPasses.map((pass) =>
          pass.id === result.pass.id
            ? {
                ...pass,
                status: result.pass.status,
                balanceValue: result.pass.balanceValue,
                frozenValue: result.pass.frozenValue,
                overdraftLimit: result.pass.overdraftLimit,
                updatedAt: result.pass.updatedAt,
              }
            : pass,
        ),
      );
      setMessage(
        result.ledgerEntry
          ? `已冲正消耗：+${formatBenefitValue(result.ledgerEntry.changeValue, request.pass.benefitType)}，当前值 ${formatBenefitValue(
              result.ledgerEntry.afterValue,
              request.pass.benefitType,
            )}。`
          : '该消耗请求已冲正。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '冲正核销请求失败。');
    } finally {
      setReversingRedemptionId(null);
    }
  };

  const changePassStatus = async (action: 'freeze' | 'unfreeze' | 'archive') => {
    if (!selectedPass) {
      setMessage('请先选择要处理的卡券。');
      return;
    }

    const actionLabel = action === 'freeze' ? '冻结' : action === 'unfreeze' ? '解冻' : '取消';
    const reason = window.prompt(`请输入${actionLabel}原因`);
    if (reason === null) {
      return;
    }

    if (!reason.trim()) {
      setMessage(`${actionLabel}原因不能为空。`);
      return;
    }

    if (
      action === 'archive' &&
      !window.confirm('取消后卡券会归档，未使用的领取码会被撤销。确定继续吗？')
    ) {
      return;
    }

    setIsChangingStatus(true);
    setMessage(null);

    try {
      const result = await postJson<ChangePassStatusResponse>(
        `/api/provider/issuing/passes/${selectedPass.id}/${action}`,
        {
          reason: reason.trim(),
        },
      );
      setPasses((currentPasses) =>
        currentPasses.map((pass) => (pass.id === result.pass.id ? result.pass : pass)),
      );
      setMessage(
        action === 'archive'
          ? `已取消卡券，撤销 ${result.revokedAddPassTokens ?? 0} 个未使用领取码。`
          : `已${actionLabel}卡券。`,
      );
      setActivePassDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${actionLabel}卡券失败。`);
    } finally {
      setIsChangingStatus(false);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="provider-passes-title">
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-passes-title">卡券权益调整</h1>
        </div>
      </div>

      <form className="audit-filter-grid" onSubmit={submitSearch}>
        <label>
          <span>搜索卡券</span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="卡号、尾号、卡券名称、用户名"
          />
        </label>
        <div className="audit-filter-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadPasses(keyword)}
          >
            刷新
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={exportingType !== null}
            onClick={() => void exportCsv('passes')}
          >
            {exportingType === 'passes' ? '导出中' : '导出卡券 CSV'}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={exportingType !== null}
            onClick={() => void exportCsv('ledger')}
          >
            {exportingType === 'ledger' ? '导出中' : '导出流水 CSV'}
          </button>
          <button className="primary-action" type="submit">
            <span className="material-symbols-rounded" aria-hidden="true">
              search
            </span>
            <span>搜索</span>
          </button>
        </div>
      </form>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {selectedPass && activePassDialog ? (
        <div className="admin-dialog-layer">
          <button
            className="admin-dialog-scrim"
            type="button"
            aria-label="关闭弹窗"
            onClick={() => setActivePassDialog(null)}
          />
          <section
            className="admin-dialog-panel admin-pass-dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={readProviderPassDialogTitle(activePassDialog, selectedPass)}
          >
            <div className="admin-dialog-heading">
              <h2>{readProviderPassDialogTitle(activePassDialog, selectedPass)}</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setActivePassDialog(null)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            {activePassDialog === 'detail' ? <ProviderPassDetail pass={selectedPass} /> : null}
            {activePassDialog === 'adjust' ? (
              <form className="admin-adjustment-panel" onSubmit={submitAdjustment}>
                <div>
                  <p>正在调整</p>
                  <h2>{selectedPass.displayName}</h2>
                  <span>
                    {selectedPass.maskedNumber ?? selectedPass.publicNumber ?? selectedPass.id}
                  </span>
                </div>
                <strong>
                  {formatBenefitValue(selectedPass.balanceValue, selectedPass.benefitType)}
                </strong>
                <label>
                  <span>增减量</span>
                  <input
                    value={changeValue}
                    onChange={(event) => setChangeValue(event.target.value)}
                    placeholder="+30 或 -5"
                    required
                  />
                </label>
                <label>
                  <span>原因</span>
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="补发活动权益"
                    required
                  />
                </label>
                <label>
                  <span>备注</span>
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="可选"
                  />
                </label>
                <button className="primary-action" type="submit" disabled={isSubmitting}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    tune
                  </span>
                  <span>{isSubmitting ? '提交中' : '提交调整'}</span>
                </button>
              </form>
            ) : null}

            {activePassDialog === 'redemption' ? (
              <form
                className="admin-adjustment-panel provider-redemption-form"
                onSubmit={submitRedemptionRequest}
              >
                <div>
                  <p>发起消耗</p>
                  <h2>{selectedPass.user ? selectedPass.user.username : '尚未领取'}</h2>
                  <span>
                    {selectedPass.maskedNumber ?? selectedPass.publicNumber ?? selectedPass.id}
                  </span>
                </div>
                <strong>
                  {formatBenefitValue(selectedPass.balanceValue, selectedPass.benefitType)}
                </strong>
                <label>
                  <span>消耗值</span>
                  <input
                    value={consumeValue}
                    onChange={(event) => setConsumeValue(event.target.value)}
                    placeholder="例如：18.7"
                    required
                  />
                </label>
                <label>
                  <span>验证方式</span>
                  <select
                    value={consumeMethod}
                    onChange={(event) =>
                      setConsumeMethod(event.target.value as 'server_account' | 'pin')
                    }
                  >
                    <option value="server_account">服务器账号</option>
                    <option value="pin">PIN</option>
                  </select>
                </label>
                <label>
                  <span>有效秒数</span>
                  <input
                    value={consumeExpiresInSeconds}
                    onChange={(event) => setConsumeExpiresInSeconds(event.target.value)}
                    inputMode="numeric"
                    placeholder="120"
                    required
                  />
                </label>
                <label>
                  <span>最大尝试</span>
                  <input
                    value={consumeMaxVerificationAttempts}
                    onChange={(event) => setConsumeMaxVerificationAttempts(event.target.value)}
                    inputMode="numeric"
                    placeholder="3"
                    required
                  />
                </label>
                <button
                  className="primary-action"
                  type="submit"
                  disabled={isCreatingRedemption || !selectedPass.user}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    point_of_sale
                  </span>
                  <span>{isCreatingRedemption ? '发起中' : '发起消耗'}</span>
                </button>
              </form>
            ) : null}

            {activePassDialog === 'actionLink' ? (
              <form
                className="admin-adjustment-panel provider-redemption-form"
                onSubmit={submitActionLink}
              >
                <div>
                  <p>生成操作链接</p>
                  <h2>{selectedPass.user ? selectedPass.user.username : '尚未领取'}</h2>
                  <span>
                    {selectedPass.maskedNumber ?? selectedPass.publicNumber ?? selectedPass.id}
                  </span>
                </div>
                <strong>
                  {formatBenefitValue(selectedPass.balanceValue, selectedPass.benefitType)}
                </strong>
                <label>
                  <span>链接类型</span>
                  <select
                    value={actionLinkKind}
                    onChange={(event) => {
                      const nextKind = event.target.value as 'use' | 'top_up';
                      setActionLinkKind(nextKind);
                    }}
                  >
                    <option value="use">确认使用</option>
                    <option value="top_up">额度补充</option>
                  </select>
                </label>
                <label>
                  <span>{actionLinkKind === 'use' ? '消耗值' : '补充值'}</span>
                  <input
                    value={actionLinkValue}
                    onChange={(event) => setActionLinkValue(event.target.value)}
                    placeholder="例如：18.7"
                    required
                  />
                </label>
                <label>
                  <span>验证方式</span>
                  <select
                    value={actionLinkMethod}
                    onChange={(event) =>
                      setActionLinkMethod(event.target.value as 'server_account' | 'pin')
                    }
                  >
                    <option value="pin">PIN</option>
                    <option value="server_account">服务器账号</option>
                  </select>
                </label>
                <label>
                  <span>有效秒数</span>
                  <input
                    value={actionLinkExpiresInSeconds}
                    onChange={(event) => setActionLinkExpiresInSeconds(event.target.value)}
                    inputMode="numeric"
                    placeholder="900"
                    required
                  />
                </label>
                <label>
                  <span>备注</span>
                  <input
                    value={actionLinkNote}
                    onChange={(event) => setActionLinkNote(event.target.value)}
                    placeholder="可选"
                  />
                </label>
                <button
                  className="primary-action"
                  type="submit"
                  disabled={isCreatingActionLink || !selectedPass.user}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    link
                  </span>
                  <span>{isCreatingActionLink ? '生成中' : '生成链接'}</span>
                </button>
                {latestActionLink ? (
                  <div className="action-link-result">
                    <span>完整链接只显示一次</span>
                    <code>
                      {latestActionLink.actionPath
                        ? formatActionLinkUrl(latestActionLink.actionPath)
                        : '链接已隐藏'}
                    </code>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void copyLatestActionLink()}
                    >
                      复制链接
                    </button>
                  </div>
                ) : null}
                <div className="action-link-list">
                  <div className="action-link-list-heading">
                    <span>
                      {actionLinkScope === 'current' ? '当前卡券操作链接' : '全部操作链接'}
                    </span>
                    <div className="admin-list-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={!selectableActionLinkIds.length}
                        onClick={toggleAllVisibleActionLinks}
                      >
                        {selectableActionLinkIds.length > 0 &&
                        selectableActionLinkIds.every((actionLinkId) =>
                          selectedActionLinkIdSet.has(actionLinkId),
                        )
                          ? '取消全选'
                          : '全选可用'}
                      </button>
                      <button
                        className="secondary-action danger-action"
                        type="button"
                        disabled={!selectedActionLinkIds.length || isBatchRevokingActionLinks}
                        onClick={() => void batchRevokeActionLinks()}
                      >
                        {isBatchRevokingActionLinks
                          ? '撤销中'
                          : `批量撤销 ${selectedActionLinkIds.length || ''}`}
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={isLoadingActionLinks}
                        onClick={() => void loadActionLinks()}
                      >
                        {isLoadingActionLinks ? '刷新中' : '刷新'}
                      </button>
                    </div>
                  </div>
                  <div className="action-link-filters" aria-label="操作链接筛选">
                    <label>
                      <span>范围</span>
                      <select
                        value={actionLinkScope}
                        onChange={(event) =>
                          setActionLinkScope(event.target.value as 'current' | 'all')
                        }
                      >
                        <option value="current">当前卡券</option>
                        <option value="all">全部卡券</option>
                      </select>
                    </label>
                    <label>
                      <span>类型</span>
                      <select
                        value={actionLinkKindFilter}
                        onChange={(event) =>
                          setActionLinkKindFilter(event.target.value as ActionLinkKindFilter)
                        }
                      >
                        <option value="all">全部</option>
                        <option value="use">确认使用</option>
                        <option value="top_up">额度补充</option>
                      </select>
                    </label>
                    <label>
                      <span>状态</span>
                      <select
                        value={actionLinkStatusFilter}
                        onChange={(event) =>
                          setActionLinkStatusFilter(event.target.value as ActionLinkStatusFilter)
                        }
                      >
                        <option value="all">全部</option>
                        <option value="Active">可用</option>
                        <option value="Consumed">已使用</option>
                        <option value="Expired">已过期</option>
                        <option value="Revoked">已撤销</option>
                      </select>
                    </label>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={isLoadingActionLinks}
                      onClick={() => void loadActionLinks()}
                    >
                      应用筛选
                    </button>
                  </div>
                  {visibleActionLinks.length ? (
                    <ol>
                      {visibleActionLinks.map((actionLink) => (
                        <li key={actionLink.id}>
                          <label className="action-link-select">
                            <input
                              type="checkbox"
                              checked={selectedActionLinkIdSet.has(actionLink.id)}
                              disabled={actionLink.status !== 'Active'}
                              onChange={() => toggleActionLinkSelection(actionLink.id)}
                            />
                            <span className="material-symbols-rounded" aria-hidden="true">
                              check
                            </span>
                          </label>
                          <div>
                            <strong>
                              {formatActionLinkKind(actionLink.kind)} ·{' '}
                              {formatActionLinkStatus(actionLink.status)}
                            </strong>
                            <span>
                              {formatBenefitValue(
                                actionLink.requestedValue,
                                actionLink.targetPass.benefitType,
                              )}{' '}
                              · {formatVerificationMethod(actionLink.verificationMethod)}
                            </span>
                            <small>
                              {actionLink.targetPass.displayName} · 到期{' '}
                              {formatDate(actionLink.expiresAt)} ·{' '}
                              {actionLink.targetPass.user?.username ?? '未知用户'}
                            </small>
                            {actionLink.revokeReason ? (
                              <small>撤销原因：{actionLink.revokeReason}</small>
                            ) : null}
                          </div>
                          {actionLink.status === 'Active' ? (
                            <button
                              className="secondary-action danger-action"
                              type="button"
                              disabled={revokingActionLinkId === actionLink.id}
                              onClick={() => void revokeActionLink(actionLink)}
                            >
                              {revokingActionLinkId === actionLink.id ? '撤销中' : '撤销'}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="empty-hint">
                      {isLoadingActionLinks ? '正在读取操作链接。' : '当前筛选下暂无操作链接。'}
                    </p>
                  )}
                </div>
              </form>
            ) : null}

            {activePassDialog === 'status' ? (
              <div className="admin-adjustment-panel provider-status-panel">
                <div>
                  <p>状态管理</p>
                  <h2>{formatPassStatus(selectedPass.status)}</h2>
                  <span>
                    {selectedPass.maskedNumber ?? selectedPass.publicNumber ?? selectedPass.id}
                  </span>
                </div>
                <strong>{selectedPass.user ? selectedPass.user.username : '尚未领取'}</strong>
                <div className="admin-list-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={
                      isChangingStatus ||
                      selectedPass.status === 'Frozen' ||
                      selectedPass.status === 'Archived'
                    }
                    onClick={() => void changePassStatus('freeze')}
                  >
                    冻结
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={isChangingStatus || selectedPass.status !== 'Frozen'}
                    onClick={() => void changePassStatus('unfreeze')}
                  >
                    解冻
                  </button>
                  <button
                    className="danger-action"
                    type="button"
                    disabled={isChangingStatus || selectedPass.status === 'Archived'}
                    onClick={() => void changePassStatus('archive')}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            {selectedPass.category === 'ticket' && activePassDialog === 'ticketUpdate' ? (
              <form
                className="admin-adjustment-panel provider-ticket-form"
                onSubmit={submitTicketUpdate}
              >
                <div>
                  <p>票券字段</p>
                  <h2>{selectedPass.ticketInfo?.eventName || selectedPass.title}</h2>
                  <span>{selectedPass.ticketInfo?.seatLabel || '未设置座位'}</span>
                </div>
                <strong>{formatTicketStatus(selectedPass.ticketInfo)}</strong>
                <label>
                  <span>活动名称</span>
                  <input
                    value={ticketEventName}
                    onChange={(event) => setTicketEventName(event.target.value)}
                    placeholder="活动名称"
                  />
                </label>
                <label>
                  <span>场地</span>
                  <input
                    value={ticketVenue}
                    onChange={(event) => setTicketVenue(event.target.value)}
                    placeholder="场地"
                  />
                </label>
                <label>
                  <span>场次时间</span>
                  <input
                    type="datetime-local"
                    value={ticketStartsAt}
                    onChange={(event) => setTicketStartsAt(event.target.value)}
                  />
                </label>
                <label>
                  <span>座位</span>
                  <input
                    value={ticketSeatLabel}
                    onChange={(event) => setTicketSeatLabel(event.target.value)}
                    placeholder="座位"
                  />
                </label>
                <label>
                  <span>检票状态</span>
                  <select
                    value={ticketCheckInStatus}
                    onChange={(event) =>
                      setTicketCheckInStatus(
                        event.target.value as ProviderTicketInfo['checkInStatus'],
                      )
                    }
                  >
                    <option value="not_checked_in">未检票</option>
                    <option value="checked_in">已检票</option>
                    <option value="voided">已作废</option>
                  </select>
                </label>
                <label>
                  <span>改签/取消</span>
                  <select
                    value={ticketChangeStatus}
                    onChange={(event) =>
                      setTicketChangeStatus(
                        event.target.value as ProviderTicketInfo['changeStatus'],
                      )
                    }
                  >
                    <option value="none">无变更</option>
                    <option value="rescheduled">已改签</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </label>
                <label>
                  <span>变更说明</span>
                  <input
                    value={ticketUpdateReason}
                    onChange={(event) => setTicketUpdateReason(event.target.value)}
                    placeholder="例如场次调整、座位更正"
                    maxLength={200}
                  />
                </label>
                <button className="primary-action" type="submit" disabled={isUpdatingTicket}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    confirmation_number
                  </span>
                  <span>{isUpdatingTicket ? '提交中' : '提交审核'}</span>
                </button>
                <p className="empty-hint">票券字段属于卡券可见信息，管理员审核通过后才会生效。</p>
              </form>
            ) : null}

            {selectedPass.category === 'ticket' && activePassDialog === 'ticketRequests' ? (
              <section
                className="admin-adjustment-panel provider-ticket-review-list"
                aria-label="票券变更申请"
              >
                <div>
                  <p>票券变更申请</p>
                  <h2>{visibleTicketUpdateRequests.length}</h2>
                  <span>显示当前票券最近的变更申请。</span>
                </div>
                <div className="admin-list-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={isLoadingTicketUpdateRequests}
                    onClick={() => void loadTicketUpdateRequests()}
                  >
                    {isLoadingTicketUpdateRequests ? '刷新中' : '刷新申请'}
                  </button>
                </div>
                {visibleTicketUpdateRequests.length ? (
                  <ol>
                    {visibleTicketUpdateRequests.map((request) => (
                      <li key={request.id}>
                        <div>
                          <strong>{formatTicketUpdateRequestStatus(request.status)}</strong>
                          <span>{formatTicketStatus(request.proposedTicketInfo)}</span>
                          <small>
                            {formatTicketSummary(request.proposedTicketInfo)} · 提交{' '}
                            {formatDate(request.createdAt)}
                          </small>
                          {request.reason ? <small>说明：{request.reason}</small> : null}
                          {request.reviewReason ? (
                            <small>审核意见：{request.reviewReason}</small>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="empty-hint">
                    {isLoadingTicketUpdateRequests
                      ? '正在读取票券变更申请。'
                      : '当前票券暂无变更申请。'}
                  </p>
                )}
              </section>
            ) : null}
          </section>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取卡券列表。</p> : null}
      {!isLoading && passes.length === 0 ? <p className="empty-note">暂无可调整的卡券。</p> : null}

      <div className="admin-list">
        {passes.map((pass) => {
          const passNumber = pass.maskedNumber ?? pass.publicNumber ?? '未设置';
          const holder = pass.user ? `${pass.user.username} / ${pass.user.email}` : '尚未领取';

          return (
            <article
              className={`admin-list-item${selectedPass?.id === pass.id ? ' is-selected' : ''}`}
              key={pass.id}
            >
              <div>
                <h2>{pass.displayName}</h2>
                <p>
                  {formatPassStatus(pass.status)} · {formatBenefitLabel(pass.benefitType)} ·
                  当前值：
                  {formatBenefitValue(pass.balanceValue, pass.benefitType)}
                </p>
                <p>
                  持有人：{holder} · 尾号：{passNumber}
                </p>
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => openPassDialog(pass, 'detail')}
                >
                  详情
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => openPassDialog(pass, 'adjust')}
                >
                  调整余额
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!pass.user}
                  onClick={() => openPassDialog(pass, 'redemption')}
                >
                  发起消耗
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!pass.user}
                  onClick={() => openPassDialog(pass, 'actionLink')}
                >
                  操作链接
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={pass.status === 'Archived'}
                  onClick={() => openPassDialog(pass, 'status')}
                >
                  {pass.status === 'Frozen' ? '解冻' : '冻结'}
                </button>
                {pass.category === 'ticket' ? (
                  <>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => openPassDialog(pass, 'ticketUpdate')}
                    >
                      票券字段
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => openPassDialog(pass, 'ticketRequests')}
                    >
                      变更记录
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <section className="admin-list-section" aria-labelledby="provider-redemptions-title">
        <div className="detail-section-heading">
          <h2 id="provider-redemptions-title">最近核销请求</h2>
          <span>{redemptionRequests.length}</span>
        </div>
        {isLoadingRedemptions ? <p className="empty-note">正在读取核销请求。</p> : null}
        <div className="admin-list">
          {redemptionRequests.map((request) => (
            <article className="admin-list-item" key={request.id}>
              <div>
                <h2>{request.pass.displayName}</h2>
                <p>
                  {formatRedemptionStatus(request.status)} ·{' '}
                  {formatVerificationMethod(request.verificationMethod)} ·{' '}
                  {formatBenefitValue(request.requestedValue, request.pass.benefitType)} · 尝试：
                  {request.verificationFailureCount}/{request.maxVerificationAttempts}
                </p>
                <p>
                  用户：{request.user ? `${request.user.username} / ${request.user.email}` : '未知'}{' '}
                  · 到期：
                  {new Date(request.expiresAt).toLocaleString('zh-CN')}
                </p>
                {request.failureMessage ? <p>{request.failureMessage}</p> : null}
              </div>
              {request.status === 'WaitingVerification' ? (
                <div className="admin-list-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={cancellingRedemptionId === request.id}
                    onClick={() => void cancelRedemptionRequest(request)}
                  >
                    {cancellingRedemptionId === request.id ? '取消中' : '取消'}
                  </button>
                </div>
              ) : request.status === 'Succeeded' ? (
                <div className="admin-list-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={reversingRedemptionId === request.id}
                    onClick={() => void reverseRedemptionRequest(request)}
                  >
                    {reversingRedemptionId === request.id ? '冲正中' : '冲正'}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function ProviderPassDetail({ pass }: { pass: ProviderPass }) {
  return (
    <dl className="admin-detail-list">
      <div>
        <dt>卡面标题</dt>
        <dd>{pass.title}</dd>
      </div>
      <div>
        <dt>分类</dt>
        <dd>{formatCategoryLabel(pass.category)}</dd>
      </div>
      <div>
        <dt>卡号</dt>
        <dd>{pass.maskedNumber ?? pass.publicNumber ?? pass.id}</dd>
      </div>
      <div>
        <dt>持有人</dt>
        <dd>{pass.user ? `${pass.user.username} / ${pass.user.email}` : '尚未领取'}</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{formatPassStatus(pass.status)}</dd>
      </div>
      <div>
        <dt>权益类型</dt>
        <dd>{formatBenefitLabel(pass.benefitType)}</dd>
      </div>
      <div>
        <dt>当前值</dt>
        <dd>{formatBenefitValue(pass.balanceValue, pass.benefitType)}</dd>
      </div>
      <div>
        <dt>冻结值</dt>
        <dd>{formatBenefitValue(pass.frozenValue, pass.benefitType)}</dd>
      </div>
      <div>
        <dt>透支额度</dt>
        <dd>{formatBenefitValue(pass.overdraftLimit, pass.benefitType)}</dd>
      </div>
      {pass.category === 'ticket' ? (
        <>
          <div>
            <dt>票券状态</dt>
            <dd>{formatTicketStatus(pass.ticketInfo)}</dd>
          </div>
          <div>
            <dt>票券信息</dt>
            <dd>{formatTicketSummary(pass.ticketInfo)}</dd>
          </div>
        </>
      ) : null}
      <div>
        <dt>创建时间</dt>
        <dd>{formatDate(pass.createdAt)}</dd>
      </div>
      <div>
        <dt>最近更新</dt>
        <dd>{formatDate(pass.updatedAt)}</dd>
      </div>
    </dl>
  );
}

function readProviderPassDialogTitle(kind: ProviderPassDialogKind, pass: ProviderPass): string {
  const labels: Record<ProviderPassDialogKind, string> = {
    detail: '卡券详情',
    adjust: '调整余额',
    redemption: '发起消耗',
    actionLink: '生成操作链接',
    status: pass.status === 'Frozen' ? '解冻卡券' : '冻结或取消',
    ticketUpdate: '票券字段',
    ticketRequests: '票券变更记录',
  };

  return `${labels[kind]} · ${pass.displayName}`;
}

function formatCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    account: '账户/卡',
    identity_key: '证件/钥匙',
    ticket: '票券',
  };

  return labels[category] ?? category;
}

function formatBenefitLabel(benefitType: ProviderPass['benefitType']): string {
  const labels: Record<ProviderPass['benefitType'], string> = {
    amount: '金额',
    points: '积分',
    times: '次数',
  };

  return labels[benefitType];
}

function formatBenefitValue(value: string, benefitType: ProviderPass['benefitType']): string {
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

function formatSignedValue(value: string, benefitType: ProviderPass['benefitType']): string {
  const numericValue = Number(value);
  const sign = numericValue > 0 ? '+' : '';
  return `${sign}${formatBenefitValue(value, benefitType)}`;
}

function formatVerificationMethod(method: ProviderRedemptionRequest['verificationMethod']): string {
  return method === 'server_account' ? '服务器账号验证' : 'PIN 验证';
}

function formatActionLinkKind(kind: ProviderActionLink['kind']): string {
  return kind === 'top_up' ? '额度补充' : '确认使用';
}

function formatActionLinkStatus(status: string): string {
  const labels: Record<string, string> = {
    Active: '可用',
    Consumed: '已使用',
    Expired: '已过期',
    Revoked: '已撤销',
  };

  return labels[status] ?? status;
}

function formatRedemptionStatus(status: string): string {
  const labels: Record<string, string> = {
    Created: '已创建',
    WaitingVerification: '等待确认',
    Verified: '已验证',
    Processing: '处理中',
    Succeeded: '已完成',
    Reversed: '已冲正',
    Failed: '失败',
    Cancelled: '已取消',
    Expired: '已过期',
  };

  return labels[status] ?? status;
}

function formatPassStatus(status: string): string {
  const labels: Record<string, string> = {
    Issued: '待领取',
    Added: '已添加',
    Active: '可用',
    Frozen: '已冻结',
    Expired: '已过期',
    UsedUp: '已用尽',
    Archived: '已取消',
  };

  return labels[status] ?? status;
}

function formatTicketStatus(ticketInfo: ProviderTicketInfo | null): string {
  if (!ticketInfo) {
    return '未设置';
  }

  const checkInLabels: Record<ProviderTicketInfo['checkInStatus'], string> = {
    not_checked_in: '未检票',
    checked_in: '已检票',
    voided: '已作废',
  };
  const changeLabels: Record<ProviderTicketInfo['changeStatus'], string> = {
    none: '无变更',
    rescheduled: '已改签',
    cancelled: '已取消',
  };

  return `${checkInLabels[ticketInfo.checkInStatus]} · ${changeLabels[ticketInfo.changeStatus]}`;
}

function formatTicketUpdateRequestStatus(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '待管理员审核',
    Approved: '已通过',
    Rejected: '已拒绝',
  };

  return labels[status] ?? status;
}

function formatTicketSummary(ticketInfo: ProviderTicketInfo | null): string {
  if (!ticketInfo) {
    return '未设置票券字段';
  }

  return [
    ticketInfo.eventName || '未设置活动',
    ticketInfo.venue || '未设置场地',
    ticketInfo.seatLabel || '未设置座位',
  ].join(' · ');
}

function toDateTimeLocalValue(value: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}

async function readExportError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return message.join('；');
    }

    if (typeof message === 'string') {
      return message;
    }
  }

  return `导出失败：${response.status}`;
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], {
    type: mimeType,
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function formatActionLinkUrl(actionPath: string): string {
  if (typeof window === 'undefined') {
    return actionPath;
  }

  return new URL(actionPath, window.location.origin).toString();
}
