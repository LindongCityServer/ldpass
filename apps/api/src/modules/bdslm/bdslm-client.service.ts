import { Injectable } from '@nestjs/common';
import type { BdslmChatMessage, BdslmPlayerMarker } from '@ldpass/contracts';

const defaultBdslmRequestTimeoutMs = 5000;

@Injectable()
export class BdslmClientService {
  async fetchChatMessages(start?: number): Promise<BdslmChatMessage[]> {
    const url = this.createUrl('/api/chat/fetch');

    if (typeof start === 'number') {
      url.searchParams.set('start', String(start));
    }

    return this.fetchJson<BdslmChatMessage[]>(url);
  }

  async fetchPlayerMarkers(): Promise<BdslmPlayerMarker[]> {
    return this.fetchJson<BdslmPlayerMarker[]>(this.createUrl('/api/getPlayerMarkers'));
  }

  private createUrl(pathname: string): URL {
    const baseUrl = process.env.BDSLM_BASE_URL;

    if (!baseUrl) {
      throw new Error('BDSLM_BASE_URL is not configured.');
    }

    return new URL(pathname, baseUrl);
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.readRequestTimeoutMs());

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`BDSLM request failed with status ${response.status}.`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('BDSLM request timed out.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private readRequestTimeoutMs(): number {
    const configuredValue = Number.parseInt(process.env.BDSLM_REQUEST_TIMEOUT_MS ?? '', 10);
    if (!Number.isFinite(configuredValue) || configuredValue < 1000 || configuredValue > 60000) {
      return defaultBdslmRequestTimeoutMs;
    }

    return configuredValue;
  }
}
