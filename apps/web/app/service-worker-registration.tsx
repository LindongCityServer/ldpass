'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        await registration.update();
      } catch {
        // 不阻断主流程；离线能力不可用时，页面仍按普通 Web 应用运行。
      }
    };

    void register();
  }, []);

  return null;
}
