import type { IpRegion } from '@ldpass/contracts';

export interface ApiRequestLike {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
  rawBody?: Buffer | string;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

export interface ApiResponseLike {
  setHeader(name: string, value: string | string[]): void;
  getHeader?(name: string): number | string | string[] | undefined;
}

export function readHeader(request: ApiRequestLike, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function isTrustingProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS?.trim().toLowerCase() !== 'false';
}

export function readClientIp(request: ApiRequestLike): string {
  const candidates = isTrustingProxyHeaders()
    ? [
        readHeader(request, 'x-forwarded-for')?.split(',')[0],
        readHeader(request, 'cf-connecting-ip'),
        readHeader(request, 'x-real-ip'),
        request.ip,
        request.socket?.remoteAddress,
      ]
    : [request.socket?.remoteAddress, request.ip];

  for (const candidate of candidates) {
    const normalized = normalizeClientIp(candidate ?? '');
    if (isIpLiteral(normalized)) {
      return normalized;
    }
  }

  return 'unknown';
}

function isIpLiteral(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

function isIpv6(value: string): boolean {
  if (!value.includes(':')) {
    return false;
  }

  return /^[0-9a-f:.]+$/i.test(value);
}

export function readClientIpRegion(request: ApiRequestLike): IpRegion {
  return classifyIpRegion(readClientIp(request));
}

export function readUserAgent(request: ApiRequestLike): string | undefined {
  return readHeader(request, 'user-agent');
}

function normalizeClientIp(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return 'unknown';
  }

  if (trimmedValue.startsWith('::ffff:')) {
    return trimmedValue.slice('::ffff:'.length);
  }

  if (trimmedValue.startsWith('[')) {
    const closingBracketIndex = trimmedValue.indexOf(']');
    if (closingBracketIndex > 0) {
      return trimmedValue.slice(1, closingBracketIndex);
    }
  }

  const portSeparatorIndex = trimmedValue.lastIndexOf(':');
  if (portSeparatorIndex > -1 && trimmedValue.indexOf(':') === portSeparatorIndex) {
    const hostPart = trimmedValue.slice(0, portSeparatorIndex);
    const portPart = trimmedValue.slice(portSeparatorIndex + 1);
    if (/^\d+$/.test(portPart) && isIpv4(hostPart)) {
      return hostPart;
    }
  }

  return trimmedValue;
}

export function classifyIpRegion(ip: string): IpRegion {
  const source = 'local-ip-classifier';

  if (ip === 'unknown') {
    return {
      country: '未知',
      provinceOrState: '未知',
      source,
    };
  }

  if (isIpv4(ip)) {
    const octets = ip.split('.').map((part) => Number.parseInt(part, 10));
    const [first = 0, second = 0] = octets;

    if (first === 127) {
      return localRegion('本机', source);
    }

    if (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    ) {
      return localRegion('内网', source);
    }

    if (first === 169 && second === 254) {
      return localRegion('链路本地', source);
    }

    if (first === 100 && second >= 64 && second <= 127) {
      return localRegion('运营商共享地址', source);
    }

    if (
      (first === 192 && second === 0) ||
      (first === 198 && second === 51) ||
      (first === 203 && second === 0) ||
      first >= 224
    ) {
      return localRegion('保留地址', source);
    }

    return {
      country: '未知',
      provinceOrState: '公网（未解析）',
      source,
    };
  }

  const lowerIp = ip.toLowerCase();
  if (lowerIp === '::1') {
    return localRegion('本机', source);
  }

  if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) {
    return localRegion('内网', source);
  }

  if (lowerIp.startsWith('fe80:')) {
    return localRegion('链路本地', source);
  }

  return {
    country: '未知',
    provinceOrState: '公网（未解析）',
    source,
  };
}

function localRegion(label: string, source: string): IpRegion {
  return {
    country: label,
    provinceOrState: label,
    source,
  };
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }

    const numberValue = Number.parseInt(part, 10);
    return numberValue >= 0 && numberValue <= 255;
  });
}
