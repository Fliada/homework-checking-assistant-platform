import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 2000 } },
});
const base = import.meta.env.VITE_API_URL || '/api/v1';
let accessToken = sessionStorage.getItem('reviewer.access') || '';
let refreshPromise: Promise<boolean> | null = null;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export function setSession(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  sessionStorage.setItem('reviewer.access', accessToken);
  sessionStorage.setItem('reviewer.refresh', tokens.refreshToken);
  queryClient.clear();
}
export function clearSession() {
  accessToken = '';
  sessionStorage.removeItem('reviewer.access');
  sessionStorage.removeItem('reviewer.refresh');
  queryClient.clear();
}
export function hasSession() {
  return !!accessToken;
}
async function refresh(): Promise<boolean> {
  const token = sessionStorage.getItem('reviewer.refresh');
  if (!token) return false;
  try {
    const response = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    accessToken = data.accessToken;
    sessionStorage.setItem('reviewer.access', accessToken);
    if (data.refreshToken) sessionStorage.setItem('reviewer.refresh', data.refreshToken);
    return true;
  } catch {
    return false;
  }
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  retry = true,
  idempotencyKey?: string,
): Promise<T> {
  let response: Response;
  const key = method !== 'GET' ? idempotencyKey || crypto.randomUUID() : undefined;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      'Не удалось соединиться с сервером. Проверьте подключение и повторите действие.',
      0,
    );
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    refreshPromise ??= refresh().finally(() => {
      refreshPromise = null;
    });
    if (await refreshPromise) return api<T>(path, body, method, false, key);
    clearSession();
    window.dispatchEvent(new Event('session-expired'));
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const detail =
      typeof problem.detail === 'string'
        ? problem.detail
        : Array.isArray(problem.detail)
          ? problem.detail.map((d: { msg: string }) => d.msg).join('; ')
          : undefined;
    throw new ApiError(
      problem.message || detail || `Запрос не выполнен (${response.status})`,
      response.status,
      problem.code,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
