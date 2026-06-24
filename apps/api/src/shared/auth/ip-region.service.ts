import { Injectable } from '@nestjs/common';
import type { IpRegion } from '@ldpass/contracts';
import { classifyIpRegion } from './request-context.js';

interface PconlineIpResponse {
  ip?: string;
  pro?: string;
  proCode?: string;
  city?: string;
  cityCode?: string;
  region?: string;
  addr?: string;
  regionNames?: string;
}

@Injectable()
export class IpRegionService {
  private readonly cache = new Map<string, { expiresAt: number; region: IpRegion }>();

  async resolve(ip: string | null | undefined): Promise<IpRegion> {
    const normalizedIp = ip?.trim() || 'unknown';
    const fallback = classifyIpRegion(normalizedIp);
    if (fallback.source === 'local-ip-classifier' && fallback.provinceOrState !== '公网（未解析）') {
      return fallback;
    }

    const cached = this.cache.get(normalizedIp);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.region;
    }

    try {
      const response = await fetch(
        `https://whois.pconline.com.cn/ipJson.jsp?ip=${encodeURIComponent(normalizedIp)}&json=true`,
        {
          signal: AbortSignal.timeout(2500),
        },
      );

      if (!response.ok) {
        throw new Error(`pconline ip lookup failed: ${response.status}`);
      }

      const payload = await this.readPconlinePayload(response);
      const region = this.toIpRegion(payload, fallback);
      this.cache.set(normalizedIp, {
        region,
        expiresAt: Date.now() + 1000 * 60 * 60 * 6,
      });
      return region;
    } catch {
      return fallback;
    }
  }

  async resolveMany(ips: Array<string | null | undefined>): Promise<Map<string, IpRegion>> {
    const uniqueIps = Array.from(new Set(ips.map((ip) => ip?.trim()).filter((ip): ip is string => Boolean(ip))));
    const entries = await Promise.all(uniqueIps.map(async (ip) => [ip, await this.resolve(ip)] as const));
    return new Map(entries);
  }

  private async readPconlinePayload(response: Response): Promise<PconlineIpResponse> {
    const bytes = await response.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(bytes);
    const jsonText = text.trim().startsWith('{')
      ? text.trim()
      : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);

    return JSON.parse(jsonText) as PconlineIpResponse;
  }

  private toIpRegion(payload: PconlineIpResponse, fallback: IpRegion): IpRegion {
    const country = this.cleanRegionPart(payload.region || payload.regionNames) || fallback.country;
    const provinceOrState = this.cleanRegionPart(payload.pro) || fallback.provinceOrState;
    const city = this.cleanRegionPart(payload.city) || undefined;
    const addr = this.cleanRegionPart(payload.addr);

    return {
      ...(country ? { country } : {}),
      ...(provinceOrState ? { provinceOrState } : {}),
      ...(city ? { city } : {}),
      ...(addr ? { address: addr } : {}),
      source: 'pconline',
    };
  }

  private cleanRegionPart(value: string | undefined): string | null {
    const trimmedValue = value?.replace(/\s+/g, '').trim() ?? '';
    if (!trimmedValue || trimmedValue === 'XX' || trimmedValue === '未知') {
      return null;
    }

    return trimmedValue;
  }
}
