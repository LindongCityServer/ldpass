import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [
      pendingUsers,
      activeUsers,
      suspendedUsers,
      deletedUsers,
      pendingProviders,
      pendingProviderProfileChanges,
      pendingProviderApiKeyChanges,
      pendingProviderWebhookChanges,
      activeProviders,
      suspendedProviders,
      archivedProviders,
      pendingTemplateVersions,
      pendingTicketUpdates,
      openDisputes,
      activeStorageAlerts,
      totalPasses,
      issuedPasses,
      addedPasses,
      activePasses,
      frozenPasses,
      activeAddPassTokens,
      activeActionLinks,
      recentAuditLogs,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: { in: ['PendingReview', 'WaitingServerVerification', 'CodeRotated'] } } }),
      this.prisma.user.count({ where: { status: 'Active' } }),
      this.prisma.user.count({ where: { status: 'Suspended' } }),
      this.prisma.user.count({ where: { status: 'Deleted' } }),
      this.prisma.provider.count({ where: { status: 'PendingReview' } }),
      this.prisma.providerProfileChangeRequest.count({ where: { status: 'PendingReview' } }),
      this.prisma.providerApiKeyChangeRequest.count({ where: { status: 'PendingReview' } }),
      this.prisma.providerWebhookChangeRequest.count({ where: { status: 'PendingReview' } }),
      this.prisma.provider.count({ where: { status: 'Active' } }),
      this.prisma.provider.count({ where: { status: 'Suspended' } }),
      this.prisma.provider.count({ where: { status: 'Archived' } }),
      this.prisma.passTemplateVersion.count({ where: { status: 'PendingReview' } }),
      this.prisma.passTicketUpdateRequest.count({ where: { status: 'PendingReview' } }),
      this.prisma.dispute.count({ where: { status: { in: ['Submitted', 'InReview', 'NeedMoreInfo'] } } }),
      this.prisma.storageAlert.count({ where: { status: 'active' } }),
      this.prisma.pass.count(),
      this.prisma.pass.count({ where: { status: 'Issued' } }),
      this.prisma.pass.count({ where: { status: 'Added' } }),
      this.prisma.pass.count({ where: { status: 'Active' } }),
      this.prisma.pass.count({ where: { status: 'Frozen' } }),
      this.prisma.addPassToken.count({ where: { status: 'Active' } }),
      this.prisma.walletActionLink.count({ where: { status: 'Active' } }),
      this.prisma.auditLog.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 8,
        select: {
          id: true,
          eventType: true,
          actorType: true,
          actorId: true,
          subjectType: true,
          subjectId: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      users: {
        pendingReview: pendingUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        deleted: deletedUsers,
      },
      providers: {
        pendingReview: pendingProviders,
        pendingProfileChanges: pendingProviderProfileChanges,
        pendingApiKeyChanges: pendingProviderApiKeyChanges,
        pendingWebhookChanges: pendingProviderWebhookChanges,
        active: activeProviders,
        suspended: suspendedProviders,
        archived: archivedProviders,
      },
      reviews: {
        templateVersionsPending: pendingTemplateVersions,
        ticketUpdatesPending: pendingTicketUpdates,
        disputesOpen: openDisputes,
      },
      passes: {
        total: totalPasses,
        issued: issuedPasses,
        added: addedPasses,
        active: activePasses,
        frozen: frozenPasses,
      },
      operations: {
        activeAddPassTokens,
        activeActionLinks,
        activeStorageAlerts,
      },
      recentAuditLogs: recentAuditLogs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        actorType: log.actorType,
        actorId: log.actorId,
        subjectType: log.subjectType,
        subjectId: log.subjectId,
        createdAt: log.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
