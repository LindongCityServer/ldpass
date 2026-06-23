import { Inject, Injectable } from '@nestjs/common';
import { lstat, readdir, statfs } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { PrismaService } from '../../shared/database/prisma.service.js';

const defaultThresholdBytes = 1024n * 1024n * 1024n;
const defaultThresholdRatio = 0.1;
const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

@Injectable()
export class StorageMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async checkStorage() {
    const targetPath = resolve(process.env.STORAGE_MONITOR_PATH || process.env.PROJECT_ROOT_PATH || defaultProjectRoot);
    const projectUsage = await this.readProjectUsage();
    const stats = await statfs(targetPath);
    const blockSize = BigInt(stats.bsize);
    const totalBytes = BigInt(stats.blocks) * blockSize;
    const freeBytes = BigInt(stats.bavail) * blockSize;
    const freeRatio = totalBytes > 0n ? Number(freeBytes) / Number(totalBytes) : 0;
    const thresholdBytes = this.readThresholdBytes();
    const thresholdRatio = this.readThresholdRatio();
    const drive = parse(targetPath).root || targetPath;
    const isLow = freeBytes <= thresholdBytes || freeRatio <= thresholdRatio;

    const activeAlert = await this.syncAlert({
      drive,
      freeBytes,
      totalBytes,
      thresholdBytes,
      thresholdRatio,
      isLow,
      projectUsedBytes: projectUsage.projectUsedBytes,
    });

    return {
      storage: {
        drive,
        path: targetPath,
        freeBytes: freeBytes.toString(),
        totalBytes: totalBytes.toString(),
        freeRatio,
        thresholdBytes: thresholdBytes.toString(),
        thresholdRatio,
        status: isLow ? 'low' : 'ok',
      },
      projectUsage: this.toProjectUsageView(projectUsage),
      activeAlert,
    };
  }

  private async syncAlert(input: {
    drive: string;
    freeBytes: bigint;
    totalBytes: bigint;
    thresholdBytes: bigint;
    thresholdRatio: number;
    isLow: boolean;
    projectUsedBytes: bigint;
  }) {
    const activeAlert = await this.prisma.storageAlert.findFirst({
      where: {
        drive: input.drive,
        status: 'active',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (input.isLow) {
      if (activeAlert) {
        const updatedAlert = await this.prisma.storageAlert.update({
          where: {
            id: activeAlert.id,
          },
          data: {
            freeBytes: input.freeBytes,
            totalBytes: input.totalBytes,
            thresholdBytes: input.thresholdBytes,
            thresholdRatio: input.thresholdRatio.toFixed(4),
          },
        });

        return this.toAlertView(updatedAlert);
      }

      const createdAlert = await this.prisma.storageAlert.create({
        data: {
          drive: input.drive,
          freeBytes: input.freeBytes,
          totalBytes: input.totalBytes,
          thresholdBytes: input.thresholdBytes,
          thresholdRatio: input.thresholdRatio.toFixed(4),
          status: 'active',
        },
      });

      await this.eventBus.publish({
        type: 'StorageAlertRaised',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorType: 'system',
        actorId: 'storage-monitor',
        payload: {
          alertId: createdAlert.id,
          drive: input.drive,
          freeBytes: input.freeBytes.toString(),
          totalBytes: input.totalBytes.toString(),
          projectUsedBytes: input.projectUsedBytes.toString(),
          thresholdBytes: input.thresholdBytes.toString(),
          thresholdRatio: input.thresholdRatio.toFixed(4),
        },
      });

      return this.toAlertView(createdAlert);
    }

    if (activeAlert) {
      const resolvedAlert = await this.prisma.storageAlert.update({
        where: {
          id: activeAlert.id,
        },
        data: {
          freeBytes: input.freeBytes,
          totalBytes: input.totalBytes,
          status: 'resolved',
          resolvedAt: new Date(),
        },
      });

      await this.eventBus.publish({
        type: 'StorageAlertResolved',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorType: 'system',
        actorId: 'storage-monitor',
        payload: {
          alertId: resolvedAlert.id,
          drive: input.drive,
          freeBytes: input.freeBytes.toString(),
          totalBytes: input.totalBytes.toString(),
        },
      });
    }

    return null;
  }

  private readThresholdBytes(): bigint {
    const configuredValue = process.env.STORAGE_ALERT_MIN_FREE_BYTES;
    if (!configuredValue) {
      return defaultThresholdBytes;
    }

    try {
      return BigInt(configuredValue);
    } catch {
      return defaultThresholdBytes;
    }
  }

  private readThresholdRatio(): number {
    const configuredValue = Number.parseFloat(process.env.STORAGE_ALERT_MIN_FREE_RATIO ?? '');
    if (!Number.isFinite(configuredValue) || configuredValue <= 0 || configuredValue >= 1) {
      return defaultThresholdRatio;
    }

    return configuredValue;
  }

  private async readProjectUsage() {
    const projectRoot = resolve(process.env.PROJECT_ROOT_PATH || defaultProjectRoot);
    const dataPath = resolve(process.env.PROJECT_DATA_PATH || join(projectRoot, 'data'));
    const logsPath = resolve(process.env.PROJECT_LOGS_PATH || join(projectRoot, 'logs'));
    const assetsPath = resolve(process.env.PROJECT_ASSETS_PATH || join(projectRoot, 'assets'));
    const uploadsPath = resolve(process.env.PROJECT_UPLOADS_PATH || join(projectRoot, 'uploads'));
    const dependencyPath = resolve(join(projectRoot, 'node_modules'));
    const databasePath = this.resolveDatabasePath(projectRoot);

    const [projectUsedBytes, databaseBytes, logsBytes, assetsBytes, uploadsBytes, dependencyBytes] = await Promise.all([
      this.safeReadPathSize(projectRoot),
      databasePath ? this.safeReadPathSize(databasePath) : Promise.resolve(0n),
      this.safeReadPathSize(logsPath),
      this.safeReadPathSize(assetsPath),
      this.safeReadPathSize(uploadsPath),
      this.safeReadPathSize(dependencyPath),
    ]);

    return {
      projectRoot,
      dataPath,
      logsPath,
      assetsPath,
      uploadsPath,
      databasePath,
      projectUsedBytes,
      businessDataBytes: databaseBytes + logsBytes + assetsBytes + uploadsBytes,
      databaseBytes,
      logsBytes,
      assetsBytes,
      uploadsBytes,
      dependencyBytes,
    };
  }

  private resolveDatabasePath(projectRoot: string): string | null {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.startsWith('file:')) {
      return null;
    }

    const rawPath = databaseUrl.slice('file:'.length);
    if (!rawPath) {
      return null;
    }

    return resolve(projectRoot, rawPath);
  }

  private async safeReadPathSize(path: string): Promise<bigint> {
    try {
      return await this.readPathSize(path);
    } catch {
      return 0n;
    }
  }

  private async readPathSize(path: string): Promise<bigint> {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      return 0n;
    }

    if (!stats.isDirectory()) {
      return BigInt(stats.size);
    }

    const entries = await readdir(path, { withFileTypes: true });
    let total = BigInt(stats.size);

    await Promise.all(entries.map(async (entry) => {
      if (entry.isSymbolicLink()) {
        return;
      }

      total += await this.safeReadPathSize(join(path, entry.name));
    }));

    return total;
  }

  private toProjectUsageView(usage: {
    projectRoot: string;
    dataPath: string;
    logsPath: string;
    assetsPath: string;
    uploadsPath: string;
    databasePath: string | null;
    projectUsedBytes: bigint;
    businessDataBytes: bigint;
    databaseBytes: bigint;
    logsBytes: bigint;
    assetsBytes: bigint;
    uploadsBytes: bigint;
    dependencyBytes: bigint;
  }) {
    return {
      projectRoot: usage.projectRoot,
      dataPath: usage.dataPath,
      logsPath: usage.logsPath,
      assetsPath: usage.assetsPath,
      uploadsPath: usage.uploadsPath,
      databasePath: usage.databasePath,
      projectUsedBytes: usage.projectUsedBytes.toString(),
      businessDataBytes: usage.businessDataBytes.toString(),
      databaseBytes: usage.databaseBytes.toString(),
      logsBytes: usage.logsBytes.toString(),
      assetsBytes: usage.assetsBytes.toString(),
      uploadsBytes: usage.uploadsBytes.toString(),
      dependencyBytes: usage.dependencyBytes.toString(),
    };
  }

  private toAlertView(alert: {
    id: string;
    drive: string;
    freeBytes: bigint;
    totalBytes: bigint;
    thresholdBytes: bigint | null;
    thresholdRatio: { toString(): string } | null;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }) {
    return {
      id: alert.id,
      drive: alert.drive,
      freeBytes: alert.freeBytes.toString(),
      totalBytes: alert.totalBytes.toString(),
      thresholdBytes: alert.thresholdBytes?.toString() ?? null,
      thresholdRatio: alert.thresholdRatio?.toString() ?? null,
      status: alert.status,
      createdAt: alert.createdAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    };
  }
}
