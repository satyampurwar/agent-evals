/** Thin fetch wrapper. Every call goes through the Vite proxy at /api (see vite.config.ts). */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

/** Nest error bodies carry `message` as a string, an array of strings, or an object. */
export function messageOf(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join('; ');
    if (m && typeof m === 'object') {
      const nested = m as { message?: unknown; missingTaskIds?: string[]; missingConfigIds?: string[] };
      const parts = [typeof nested.message === 'string' ? nested.message : `HTTP ${status}`];
      if (nested.missingTaskIds?.length) parts.push(`unknown tasks: ${nested.missingTaskIds.join(', ')}`);
      if (nested.missingConfigIds?.length) parts.push(`unknown configs: ${nested.missingConfigIds.join(', ')}`);
      return parts.join(' · ');
    }
  }
  return `HTTP ${status}`;
}

export async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse<T>> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // A proxy error page or an empty body. Keep the raw text for the message below.
      data = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, messageOf(data, res.status), data);
  }
  return { status: res.status, data: data as T };
}

/** Text to show for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function get<T>(path: string): Promise<T> {
  return request<T>('GET', path).then((r) => r.data);
}

export function post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return request<T>('POST', path, body);
}
