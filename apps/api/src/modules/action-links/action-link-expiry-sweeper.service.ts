import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ActionLinksService } from './action-links.service.js';

@Injectable()
export class ActionLinkExpirySweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActionLinkExpirySweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(private readonly actionLinksService: ActionLinksService) {}

  onModuleInit(): void {
    if (process.env.ACTION_LINK_EXPIRY_SWEEP_ENABLED === 'false') {
      return;
    }

    const intervalSeconds = readPositiveInt(
      process.env.ACTION_LINK_EXPIRY_SWEEP_INTERVAL_SECONDS,
      60,
    );
    this.timer = setInterval(() => {
      void this.processOnce();
    }, intervalSeconds * 1000);
    void this.processOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processOnce(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      const batchSize = readPositiveInt(process.env.ACTION_LINK_EXPIRY_SWEEP_BATCH_SIZE, 100);
      const result = await this.actionLinksService.expireOutdatedActionLinks(undefined, batchSize);
      if (result.expiredCount > 0) {
        this.logger.log(`已清理 ${result.expiredCount} 条过期操作链接。`);
      }
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : '操作链接过期清理失败。');
    } finally {
      this.isProcessing = false;
    }
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}
