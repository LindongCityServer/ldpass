'use client';

export type ClientDeviceSystem = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';

const clientDeviceStorageKey = 'ldpass.clientDeviceId';

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    brands?: Array<{
      brand: string;
      version: string;
    }>;
    mobile?: boolean;
    platform?: string;
  };
};

export function readClientDevice() {
  return {
    clientDeviceId: readOrCreateClientDeviceId(),
    deviceSystem: detectClientDeviceSystem(),
    deviceLabel: createClientDeviceLabel(),
  };
}

function readOrCreateClientDeviceId(): string {
  const existingId = window.localStorage.getItem(clientDeviceStorageKey);
  if (existingId) {
    return existingId;
  }

  const nextId = createClientDeviceId();
  window.localStorage.setItem(clientDeviceStorageKey, nextId);
  return nextId;
}

function createClientDeviceId(): string {
  const cryptoApi = window.crypto as Crypto & { randomUUID?: () => string };
  if (cryptoApi.randomUUID) {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function detectClientDeviceSystem(): ClientDeviceSystem {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();

  if (userAgent.includes('android')) {
    return 'android';
  }

  if (
    userAgent.includes('iphone') ||
    userAgent.includes('ipad') ||
    platform.includes('iphone') ||
    platform.includes('ipad')
  ) {
    return 'ios';
  }

  if (platform.includes('win')) {
    return 'windows';
  }

  if (platform.includes('mac')) {
    return 'macos';
  }

  if (platform.includes('linux')) {
    return 'linux';
  }

  return 'other';
}

function createClientDeviceLabel(): string {
  const systemLabels: Record<ClientDeviceSystem, string> = {
    android: 'Android 设备',
    ios: 'iOS 设备',
    windows: 'Windows 设备',
    macos: 'macOS 设备',
    linux: 'Linux 设备',
    other: '未知设备',
  };
  const system = detectClientDeviceSystem();
  const navigatorWithUserAgentData = window.navigator as NavigatorWithUserAgentData;
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform || window.navigator.platform || '';
  const browserBrand = navigatorWithUserAgentData.userAgentData?.brands?.find(
    (brand) => !brand.brand.toLowerCase().includes('not'),
  )?.brand;
  const details = Array.from(new Set([platform, browserBrand].filter(Boolean)));

  return (
    details.length ? `${systemLabels[system]} · ${details.join(' / ')}` : systemLabels[system]
  ).slice(0, 80);
}
