/* Central API client — Bearer + single-flight refresh (MASTER §18.2). */

import { API_BASE } from "./config";
import { clearAccessToken, getAccessToken, setAccessToken } from "./token-store";
import { toErrorObject, type ErrorObject } from "@/lib/errors";

export class ApiError extends Error {
  code: string;
  status: number;
  trace_id?: string;

  constructor(status: number, err: ErrorObject) {
    super(err.message);
    this.name = "ApiError";
    this.status = status;
    this.code = err.code;
    this.trace_id = err.trace_id;
  }
}

type Envelope<T> = { data: T; meta?: unknown };

let refreshPromise: Promise<string | null> | null = null;

function detailToError(status: number, body: unknown): ApiError {
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string; type?: string };
      return new ApiError(status, {
        code: "VAL_005",
        message: typeof first.msg === "string" ? first.msg : "Invalid request",
      });
    }
    if (detail && typeof detail === "object") {
      return new ApiError(status, toErrorObject(detail));
    }
    if (typeof detail === "string") {
      return new ApiError(status, { code: "SYS_001", message: detail });
    }
  }
  return new ApiError(status, { code: "SYS_001", message: `HTTP ${status}` });
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Rotate refresh cookie → new access token. Returns null if unauthenticated. */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      clearAccessToken();
      return null;
    }
    const body = (await parseJson(res)) as Envelope<{ access_token?: string }> | null;
    const token = body?.data?.access_token;
    if (!token) {
      clearAccessToken();
      return null;
    }
    setAccessToken(token);
    return token;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** skip Authorization header (login/public) */
  auth?: boolean;
  /** do not retry after refresh */
  skipRefreshRetry?: boolean;
  /** include refresh cookie (default true) */
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    auth = true,
    skipRefreshRetry = false,
    credentials = "include",
    signal,
  } = options;

  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const hdrs: Record<string, string> = { ...headers };
  if (body !== undefined && !hdrs["Content-Type"]) {
    hdrs["Content-Type"] = "application/json";
  }
  if (auth) {
    const token = getAccessToken();
    if (token) hdrs.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers: hdrs,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials,
    signal,
  });

  if (res.status === 401 && auth && !skipRefreshRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefreshRetry: true });
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const parsed = await parseJson(res);
  if (!res.ok) {
    throw detailToError(res.status, parsed);
  }

  if (parsed && typeof parsed === "object" && "data" in (parsed as object)) {
    return (parsed as Envelope<T>).data;
  }
  return parsed as T;
}

export const apiClient = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
};
