import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LegalDocumentKey } from '@ldpass/contracts';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { defaultDocuments } from './default-documents.js';
import type { UpdateLegalDocumentDto } from './dto.js';

const legalDocumentKeys = ['terms', 'privacy'] as const satisfies LegalDocumentKey[];
type VisibleLegalDocumentKey = (typeof legalDocumentKeys)[number];

@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listDocuments() {
    const documents = await this.prisma.legalDocument.findMany({
      where: {
        key: {
          in: [...legalDocumentKeys],
        },
      },
    });
    const documentMap = new Map(documents.map((document) => [document.key, document]));

    return {
      documents: legalDocumentKeys.map((key) => {
        const document = documentMap.get(key);

        return document
          ? {
              key: document.key,
              title: document.title,
              content: document.content,
              updatedById: document.updatedById,
              createdAt: document.createdAt.toISOString(),
              updatedAt: document.updatedAt.toISOString(),
              isDefault: false,
            }
          : this.readDefaultDocument(key);
      }),
    };
  }

  async getDocument(keyValue: string) {
    const key = this.readKey(keyValue);
    const document = await this.prisma.legalDocument.findUnique({
      where: {
        key,
      },
    });

    if (!document) {
      return this.readDefaultDocument(key);
    }

    return {
      key: document.key,
      title: document.title,
      content: document.content,
      updatedById: document.updatedById,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      isDefault: false,
    };
  }

  async updateDocument(keyValue: string, dto: UpdateLegalDocumentDto, admin: AuthenticatedUser) {
    const key = this.readKey(keyValue);
    const document = await this.prisma.legalDocument.upsert({
      where: {
        key,
      },
      update: {
        title: dto.title.trim(),
        content: dto.content.trim(),
        updatedById: admin.id,
      },
      create: {
        key,
        title: dto.title.trim(),
        content: dto.content.trim(),
        updatedById: admin.id,
      },
    });

    await this.eventBus.publish({
      type: 'LegalDocumentUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        key,
        updatedBy: admin.id,
      },
    });

    return {
      key: document.key,
      title: document.title,
      content: document.content,
      updatedById: document.updatedById,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      isDefault: false,
    };
  }

  private readKey(keyValue: string): VisibleLegalDocumentKey {
    if ((legalDocumentKeys as readonly string[]).includes(keyValue)) {
      return keyValue as VisibleLegalDocumentKey;
    }

    throw new BadRequestException('未知的协议文档类型。');
  }

  private readDefaultDocument(key: LegalDocumentKey) {
    const document = defaultDocuments[key];

    return {
      key,
      title: document.title,
      content: document.content,
      updatedById: null,
      createdAt: null,
      updatedAt: null,
      isDefault: true,
    };
  }
}
