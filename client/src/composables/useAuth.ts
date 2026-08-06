import { computed, ref } from 'vue';
import { getApiOrigin, joinSharedPath } from '@shared/shared-urls';
import { kSharedConfig } from '@/config';

const kTokenStorageKey = 'yobachat_auth_token';

export interface VerifyTokenResult {
  ok: boolean;
}

interface TokenPayload {
  username: string;
  iat: number;
  exp: number;
}

/**
 * Local admin auth (JWT from /auth/local — no Twitch OAuth).
 */
export function useAuth() {
  const token = ref<string | null>(localStorage.getItem(kTokenStorageKey));

  function decodeToken(tok: string): TokenPayload | null {
    try {
      const parts = tok.split('.');
      if (parts.length !== 3) {
        return null;
      }
      return JSON.parse(atob(parts[1])) as TokenPayload;
    } catch {
      return null;
    }
  }

  function isTokenExpired(tok: string): boolean {
    const payload = decodeToken(tok);
    if (!payload || !payload.exp) {
      return true;
    }
    return Date.now() / 1000 > payload.exp;
  }

  const isAuthenticated = computed(() => {
    if (!token.value) {
      return false;
    }
    return !isTokenExpired(token.value);
  });

  const username = computed(() => {
    if (!token.value) {
      return null;
    }
    return decodeToken(token.value)?.username || null;
  });

  function setToken(newToken: string): void {
    token.value = newToken;
    localStorage.setItem(kTokenStorageKey, newToken);
  }

  function logout(): void {
    token.value = null;
    localStorage.removeItem(kTokenStorageKey);
  }

  async function loginLocal(): Promise<boolean> {
    try {
      const response = await fetch(`${getApiOrigin(kSharedConfig)}${joinSharedPath(kSharedConfig, 'auth/local')}`);

      if (!response.ok) {
        console.error('[Auth] Local admin login failed:', response.status);
        return false;
      }

      const data = await response.json() as { token?: string };

      if (!data.token) {
        return false;
      }

      setToken(data.token);
      return true;
    } catch (error) {
      console.error('[Auth] Local admin login error:', error);
      return false;
    }
  }

  async function verifyToken(): Promise<VerifyTokenResult> {
    if (!token.value) {
      return { ok: false };
    }

    try {
      const response = await fetch(`${getApiOrigin(kSharedConfig)}${joinSharedPath(kSharedConfig, 'auth/verify')}`, {
        headers: {
          'Authorization': `Bearer ${token.value}`
        }
      });

      if (response.status === 401) {
        logout();
        return { ok: false };
      }

      if (!response.ok) {
        return { ok: false };
      }

      const data = await response.json() as { valid?: boolean };

      if (!data.valid) {
        logout();
        return { ok: false };
      }

      return { ok: true };
    } catch (error) {
      console.error('[Auth] Failed to verify token:', error);
      return { ok: false };
    }
  }

  async function ensureAuthenticated(): Promise<VerifyTokenResult> {
    const existing = await verifyToken();

    if (existing.ok) {
      return existing;
    }

    const issued = await loginLocal();
    return issued ? verifyToken() : { ok: false };
  }

  return {
    isAuthenticated,
    username,
    token: computed(() => token.value),
    loginLocal,
    ensureAuthenticated,
    logout,
    verifyToken,
    setToken
  };
}
