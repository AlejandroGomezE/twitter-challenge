const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// The session lives in an httpOnly cookie the JS never reads; `credentials: 'include'` makes the
// browser send it cross-origin (the Vite dev server and the API run on different ports).
async function request(path, { method = 'GET', body, headers, ...rest } = {}) {
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
  const payload = !text ? null : contentType.includes('application/json') ? JSON.parse(text) : text;

  if (!res.ok) {
    const message = (payload && payload.message) || res.statusText;
    throw new ApiError(res.status, message, payload);
  }

  return payload;
}

export const apiClient = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
