'use client';

import { useEffect, useState } from 'react';
import { getJson, postJson } from '../../api-client';

interface StorageAlert {
  id: string;
  drive: string;
  freeBytes: string;
  totalBytes: string;
  thresholdBytes: string | null;
  thresholdRatio: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface StorageStatusResponse {
  storage: {
    drive: string;
    path: string;
    freeBytes: string;
    totalBytes: string;
    freeRatio: number;
    thresholdBytes: string;
    thresholdRatio: number;
    status: 'ok' | 'low';
  };
  projectUsage: {
    projectRoot: string;
    dataPath: string;
    logsPath: string;
    assetsPath: string;
    uploadsPath: string;
    databasePath: string | null;
    projectUsedBytes: string;
    businessDataBytes: string;
    databaseBytes: string;
    logsBytes: string;
    assetsBytes: string;
    uploadsBytes: string;
    dependencyBytes: string;
  };
  activeAlert: StorageAlert | null;
}

export function StorageStatusPanel() {
  const [status, setStatus] = useState<StorageStatusResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadStatus = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<StorageStatusResponse>('/api/admin/storage/status');
      setStatus(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取存储状态失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const checkNow = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await postJson<StorageStatusResponse>('/api/admin/storage/check');
      setStatus(result);
      setMessage(result.storage.status === 'low' ? '检测完成：当前存储空间低于阈值。' : '检测完成：当前存储空间正常。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检测存储空间失败。');
    } finally {
      setIsLoading(false);
    }
  };

  const usedRatio = status ? 1 - status.storage.freeRatio : 0;

  return (
    <section className="admin-panel" aria-labelledby="storage-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="storage-title">存储状态</h1>
        </div>
        <a className="secondary-action" href="/admin/audit">
          审计日志
        </a>
        <button className="primary-action" type="button" onClick={() => void checkNow()} disabled={isLoading}>
          <span className="material-symbols-rounded" aria-hidden="true">
            hard_drive
          </span>
          <span>{isLoading ? '检测中' : '立即检测'}</span>
        </button>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading && !status ? <p className="empty-note">正在读取存储状态。</p> : null}

      {status ? (
        <div className={`storage-status-card storage-status-${status.storage.status}`}>
          <div>
            <p>{status.storage.status === 'low' ? '空间不足' : '空间正常'}</p>
            <h2>{status.storage.drive}</h2>
            <span>{status.storage.path}</span>
          </div>
          <strong>{formatPercent(status.storage.freeRatio)} 可用</strong>
          <div className="storage-meter" aria-hidden="true">
            <span style={{ inlineSize: `${Math.min(Math.max(usedRatio * 100, 0), 100)}%` }} />
          </div>
          <dl className="storage-stat-grid">
            <div>
              <dt>可用空间</dt>
              <dd>{formatBytes(status.storage.freeBytes)}</dd>
            </div>
            <div>
              <dt>总空间</dt>
              <dd>{formatBytes(status.storage.totalBytes)}</dd>
            </div>
            <div>
              <dt>最低可用空间</dt>
              <dd>{formatBytes(status.storage.thresholdBytes)}</dd>
            </div>
            <div>
              <dt>最低可用比例</dt>
              <dd>{formatPercent(status.storage.thresholdRatio)}</dd>
            </div>
            <div>
              <dt>项目总占用</dt>
              <dd>{formatBytes(status.projectUsage.projectUsedBytes)}</dd>
            </div>
            <div>
              <dt>业务数据占用</dt>
              <dd>{formatBytes(status.projectUsage.businessDataBytes)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {status ? (
        <section className="admin-list-section" aria-labelledby="project-storage-title">
          <div className="detail-section-heading">
            <h2 id="project-storage-title">项目占用明细</h2>
            <span>{status.projectUsage.projectRoot}</span>
          </div>
          <dl className="storage-stat-grid">
            <div>
              <dt>SQLite 数据库</dt>
              <dd>{formatBytes(status.projectUsage.databaseBytes)}</dd>
            </div>
            <div>
              <dt>日志目录</dt>
              <dd>{formatBytes(status.projectUsage.logsBytes)}</dd>
            </div>
            <div>
              <dt>品牌素材</dt>
              <dd>{formatBytes(status.projectUsage.assetsBytes)}</dd>
            </div>
            <div>
              <dt>上传目录</dt>
              <dd>{formatBytes(status.projectUsage.uploadsBytes)}</dd>
            </div>
            <div>
              <dt>依赖目录</dt>
              <dd>{formatBytes(status.projectUsage.dependencyBytes)}</dd>
            </div>
          </dl>
          <p className="empty-note">
            数据库：{status.projectUsage.databasePath ?? '未识别'}；业务数据占用不包含依赖目录。
          </p>
        </section>
      ) : null}

      {status?.activeAlert ? (
        <article className="admin-list-item storage-alert-item">
          <div>
            <h2>活动告警</h2>
            <p>
              {status.activeAlert.drive} · {formatBytes(status.activeAlert.freeBytes)} 可用 / {formatBytes(status.activeAlert.totalBytes)} 总计
            </p>
            <p>触发时间：{new Date(status.activeAlert.createdAt).toLocaleString('zh-CN')}</p>
          </div>
        </article>
      ) : null}
    </section>
  );
}

function formatBytes(value: string): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return value;
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let normalizedValue = numericValue;
  while (normalizedValue >= 1024 && unitIndex < units.length - 1) {
    normalizedValue /= 1024;
    unitIndex += 1;
  }

  return `${normalizedValue.toLocaleString('zh-CN', { maximumFractionDigits: unitIndex === 0 ? 0 : 2 })} ${units[unitIndex]}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
}
