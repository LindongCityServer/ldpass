export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const defaultApiRequestTimeoutMs = 15000;

export async function getJson<TResponse>(url: string): Promise<TResponse> {
  const response = await fetchWithTimeout(url, {
    credentials: 'include',
  });

  return readJsonResponse<TResponse>(response);
}

export async function postJson<TResponse>(url: string, body?: unknown): Promise<TResponse> {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetchWithTimeout(url, init);

  return readJsonResponse<TResponse>(response);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), defaultApiRequestTimeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiClientError('请求超时，请检查 API 服务、数据库连接或稍后重试。', 0);
    }

    throw new ApiClientError('无法连接服务器，请检查 API 服务是否正在运行。', 0);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readJsonResponse<TResponse>(response: Response): Promise<TResponse> {
  const payload = (await response.json().catch(() => null)) as unknown;

  if (response.ok) {
    return payload as TResponse;
  }

  const errorMessage = readErrorMessage(payload);
  if (response.status >= 500 && (!errorMessage || errorMessage === 'Internal server error')) {
    throw new ApiClientError('服务器内部错误，请检查 API 进程和数据库连接。', response.status);
  }

  throw new ApiClientError(errorMessage ?? `请求失败：${response.status}`, response.status);
}

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const message = (payload as { message?: unknown }).message;

  if (Array.isArray(message)) {
    return message.join('；');
  }

  return typeof message === 'string' ? message : null;
}
