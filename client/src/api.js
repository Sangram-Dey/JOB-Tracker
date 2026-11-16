// One small wrapper around fetch for every API call.
// It attaches a fresh Clerk session token; the server's clerkMiddleware verifies it.
// blob: true returns the response body as a file (a PDF), for previews and downloads.
export async function api(path, { method = 'GET', body, blob = false } = {}) {
  const token = await window.Clerk?.session?.getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });
  if (blob && res.ok) return res.blob();
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, issues: data?.issues });
  }
  return data;
}
