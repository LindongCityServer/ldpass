'use client';

import { useEffect, useState } from 'react';
import { getJson } from './api-client';

type PlatformNoticeTone = 'info' | 'warning' | 'critical';

interface PlatformStatusResponse {
  status: {
    announcement: {
      title: string | null;
      body: string | null;
      tone: PlatformNoticeTone;
      updatedAt: string | null;
    } | null;
    maintenance: {
      enabled: boolean;
      title: string | null;
      body: string | null;
      updatedAt: string | null;
    };
    updatedAt: string | null;
  };
}

export function PlatformStatusBanner() {
  const [platformStatus, setPlatformStatus] = useState<PlatformStatusResponse['status'] | null>(null);

  useEffect(() => {
    let isMounted = true;

    getJson<PlatformStatusResponse>('/api/platform/status')
      .then((response) => {
        if (isMounted) {
          setPlatformStatus(response.status);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  if (!platformStatus) {
    return null;
  }

  const banners: Array<{
    key: string;
    title: string;
    body: string | null;
    icon: string;
    tone: PlatformNoticeTone;
    role: 'status' | 'alert';
  }> = [];

  if (platformStatus.maintenance.enabled) {
    banners.push({
      key: 'maintenance',
      title: platformStatus.maintenance.title ?? '平台维护中',
      body: platformStatus.maintenance.body,
      icon: 'construction',
      tone: 'critical',
      role: 'alert',
    });
  }

  if (platformStatus.announcement) {
    banners.push({
      key: 'announcement',
      title: platformStatus.announcement.title ?? '平台公告',
      body: platformStatus.announcement.body,
      icon: platformStatus.announcement.tone === 'info' ? 'campaign' : 'warning',
      tone: platformStatus.announcement.tone,
      role: 'status',
    });
  }

  if (banners.length === 0) {
    return null;
  }

  return (
    <div className="platform-status-region" aria-label="平台状态">
      {banners.map((banner) => (
        <section className={`platform-status-banner platform-status-${banner.tone}`} role={banner.role} key={banner.key}>
          <span className="material-symbols-rounded" aria-hidden="true">
            {banner.icon}
          </span>
          <div>
            <strong>{banner.title}</strong>
            {banner.body ? <span>{banner.body}</span> : null}
          </div>
        </section>
      ))}
    </div>
  );
}
