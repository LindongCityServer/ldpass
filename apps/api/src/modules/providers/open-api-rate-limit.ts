const defaultRateLimitWindowSeconds = 60;
const defaultRateLimitMaxRequests = 120;

export interface OpenApiRateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

export function readOpenApiRateLimitConfig(): OpenApiRateLimitConfig {
  return {
    windowSeconds: readPositiveInteger(process.env.OPEN_API_RATE_LIMIT_WINDOW_SECONDS, defaultRateLimitWindowSeconds),
    maxRequests: readPositiveInteger(process.env.OPEN_API_RATE_LIMIT_MAX_REQUESTS, defaultRateLimitMaxRequests),
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}
