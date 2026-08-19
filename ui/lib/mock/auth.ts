/* Mock auth — lưu tài khoản trong localStorage khi USE_MOCK=1.
   Dùng để dev/test mà không cần backend. */

import type { User } from "@/stores";

const STORAGE_KEY = "mock_auth_users";
const SESSION_KEY = "mock_auth_session";

interface StoredUser extends User {
  password?: string;
  auth_provider: "email" | "google";
}

function readUsers(): StoredUser[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const users = raw ? (JSON.parse(raw) as StoredUser[]) : [];
    
    // Tự động tạo một tài khoản mặc định nếu chưa có, giúp dev UI dễ dàng
    if (users.length === 0) {
      const defaultUser: StoredUser = {
        id: "user-demo",
        email: "demo@vinbdi.org",
        password: "password123",
        name: "Người dùng Demo",
        avatar_url: null,
        timezone: "Asia/Ho_Chi_Minh",
        auth_provider: "email",
      };
      users.push(defaultUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    }
    
    return users;
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
}

function getSessionUserId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}

function setSessionUserId(id: string) {
  localStorage.setItem(SESSION_KEY, id);
}

function clearSessionUserId() {
  localStorage.removeItem(SESSION_KEY);
}

function toPublicUser(u: StoredUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar_url: u.avatar_url,
    timezone: u.timezone,
  };
}

function findUserByEmail(email: string): StoredUser | undefined {
  const normalized = email.toLowerCase().trim();
  return readUsers().find((u) => u.email === normalized);
}

function findUserById(id: string): StoredUser | undefined {
  return readUsers().find((u) => u.id === id);
}

function delay<T>(data: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), ms));
}

function fail(code: string, message: string): never {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  throw err;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
};

export async function mockAuthRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const body = options.body as Record<string, string> | undefined;

  if (path === "/auth/register" && method === "POST") {
    const email = body?.email?.toLowerCase().trim();
    const password = body?.password;
    const name = body?.name?.trim();
    if (!email || !password || !name) fail("VAL_006", "Thiếu trường bắt buộc.");
    if (password.length < 8) fail("VAL_005", "Mật khẩu phải có ít nhất 8 ký tự.");
    if (findUserByEmail(email)) fail("AUTH_008", "Email đã được sử dụng.");

    const user: StoredUser = {
      id: `user-${Date.now()}`,
      email,
      name,
      password,
      avatar_url: null,
      timezone: "Asia/Ho_Chi_Minh",
      auth_provider: "email",
    };
    const users = readUsers();
    users.push(user);
    writeUsers(users);
    setSessionUserId(user.id);
    return delay(toPublicUser(user) as T);
  }

  if (path === "/auth/login" && method === "POST") {
    const email = body?.email?.toLowerCase().trim();
    const password = body?.password;
    if (!email || !password) fail("VAL_006", "Thiếu trường bắt buộc.");
    const user = findUserByEmail(email);
    if (!user || user.password !== password) {
      fail("AUTH_009", "Email hoặc mật khẩu không đúng.");
    }
    setSessionUserId(user.id);
    return delay(toPublicUser(user) as T);
  }

  if (path === "/auth/refresh" && method === "POST") {
    const id = getSessionUserId();
    if (!id) fail("AUTH_006", "Phiên đăng nhập đã hết hạn.");
    const user = findUserById(id);
    if (!user) fail("AUTH_006", "Phiên đăng nhập đã hết hạn.");
    return delay(toPublicUser(user) as T);
  }

  if (path === "/auth/me" && method === "GET") {
    const id = getSessionUserId();
    if (!id) fail("AUTH_006", "Phiên đăng nhập đã hết hạn.");
    const user = findUserById(id);
    if (!user) fail("AUTH_006", "Phiên đăng nhập đã hết hạn.");
    return delay(toPublicUser(user) as T);
  }

  if (path === "/auth/me" && method === "PATCH") {
    const id = getSessionUserId();
    if (!id) fail("AUTH_006", "Phiên đăng nhập đã hết hạn.");
    const users = readUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) fail("AUTH_006", "Phiên đăng nhập đã hết hạn.");
    if (body?.name) users[idx].name = String(body.name).trim();
    if (body?.timezone) users[idx].timezone = String(body.timezone).trim();
    writeUsers(users);
    return delay(toPublicUser(users[idx]) as T);
  }

  if (path.startsWith("/auth/logout") && method === "POST") {
    clearSessionUserId();
    return delay({ ok: true } as T);
  }

  fail("SYS_001", "Endpoint mock chưa hỗ trợ.");
}

/** Mock Google OAuth — tạo hoặc đăng nhập user Google giả lập. */
export async function mockGoogleLogin(): Promise<User> {
  const email = "lab@gmail.com";
  let user = findUserByEmail(email);
  if (!user) {
    user = {
      id: "user-google-001",
      email,
      name: "Phòng Lab (Google)",
      avatar_url: null,
      timezone: "Asia/Ho_Chi_Minh",
      auth_provider: "google",
    };
    const users = readUsers();
    users.push(user);
    writeUsers(users);
  }
  setSessionUserId(user.id);
  return delay(toPublicUser(user));
}

export function mockHasSession(): boolean {
  return !!getSessionUserId();
}

export function mockClearSession() {
  clearSessionUserId();
}
