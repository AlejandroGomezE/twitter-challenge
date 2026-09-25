export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// The session lives in an httpOnly cookie the JS never reads; `credentials: 'include'` makes the
// browser send it cross-origin (the Vite dev server and the API run on different ports).
export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: string;
  body?: unknown;
}

// The error body the API sends (Nest's `{ statusCode, message, error }`; validation errors carry
// an array of messages).
export interface ApiErrorBody {
  message?: string | string[];
}

// Resolves to the parsed JSON body typed as `T` — the caller vouches for the shape (see types.ts).
async function request<T>(
  path: string,
  { method = 'GET', body, headers, ...rest }: RequestOptions = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Empty bodies (e.g. 204 No Content) resolve to `null` rather than `''`.
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  const payload: unknown = !text ? null : contentType.includes('application/json') ? JSON.parse(text) : text;

  if (!res.ok) {
    const message = String((payload as ApiErrorBody | null)?.message || res.statusText);
    throw new ApiError(res.status, message, payload);
  }

  return payload as T;
}

type Options = Omit<RequestOptions, 'method' | 'body'>;

export const apiClient = {
  get: <T>(path: string, options?: Options) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Options) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Options) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Options) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Options) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
