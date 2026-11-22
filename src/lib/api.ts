const rawApiBase =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_URL) || "";
export const API_BASE_URL = rawApiBase.trim().replace(/\/+$/, "");

/**
 * Resolves an API path against optional VITE_API_URL (for separate static frontend deployments)
 * or defaults to same-origin relative paths (/api/...) for Node and Netlify Functions deployments.
 */
export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

/**
 * Safely parses an HTTP Response body as JSON.
 * Prevents "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
 * when a server or CDN returns an empty body or HTML error page.
 */
export async function safeParseJson<T = any>(res: Response): Promise<T> {
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    if (res.status === 404 || res.status === 405) {
      throw new Error(
        `Backend API endpoint returned an empty response (HTTP ${res.status}). If hosted on Netlify, ensure the site is deployed with Netlify Functions (netlify.toml) or set VITE_API_URL.`
      );
    }
    throw new Error(`Server returned an empty response (HTTP ${res.status}).`);
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    if (trimmed.startsWith("<")) {
      throw new Error(
        `API returned an HTML page instead of JSON (HTTP ${res.status}). Ensure /api/* routes are reaching the backend server or Netlify Function.`
      );
    }
    throw new Error(`Invalid JSON response from server (HTTP ${res.status}).`);
  }
}
