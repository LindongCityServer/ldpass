import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LegalDocumentKey } from '@ldpass/contracts';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { UpdateLegalDocumentDto } from './dto.js';

const legalDocumentKeys = ['terms', 'privacy'] as const satisfies LegalDocumentKey[];
type VisibleLegalDocumentKey = (typeof legalDocumentKeys)[number];

const defaultDocuments: Record<LegalDocumentKey, { title: string; content: string }> = {
  terms: {
    title: '服务条款',
    content:
      '这是临东通服务条款的初始占位文本。管理员需要在后台补充正式条款后再对外发布。\n\n' +
      '本项目不接入真实支付通道，卡券余额、积分、次数等权益仅用于平台内记录和核销。',
  },
  privacy: {
    title: '隐私政策',
    content:
      '这是临东通隐私政策的初始占位文本。管理员需要在后台补充正式隐私政策后再对外发布。\n\n' +
      '平台会处理注册信息、登录设备、服务器账号验证信息、卡券持有与核销记录等必要数据。',
  },
  provider_agreement: {
    title: '提供方协议',
    content:
      '这是临东通提供方协议的初始占位文本。管理员需要在后台补充正式提供方协议后再对外发布。\n\n' +
      '提供方提交的卡券模板、权益规则、位置核验范围和展示信息需要经过平台管理员审核。',
  },
};

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
