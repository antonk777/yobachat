import { computed, ref } from 'vue';
import { getApiOrigin, isSecureSharedConfig, joinSharedPath } from '@shared/shared-urls';
import { kSharedConfig } from '@/config';

const kTokenStorageKey = 'yobachat_auth_token';

export interface VerifyTokenResult {
  ok: boolean;
  /** True when JWT is valid but Twitch chat tokens are missing or unusable. */
  needsTwitchOAuth?: boolean;
}

interface TokenPayload {
  username: string;
  iat: number;
  exp: number;
}

/**
 * Composable for managing authentication
 */
export function useAuth() {
  const token = ref<string | null>(localStorage.getItem(kTokenStorageKey));
  const isLocalMode = !isSecureSharedConfig(kSharedConfig);

  /**
   * Decode JWT token (without verification - server verifies)
   */
  function decodeToken(tok: string): TokenPayload | null {
    try {
      const parts = tok.split('.');
      if (parts.length !== 3) {
        return null;
      }
      const payload = JSON.parse(atob(parts[1])) as TokenPayload;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Check if token is expired
   */
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
    const payload = decodeToken(token.value);
    return payload?.username || null;
  });

  /**
   * Set the authentication token
   */
  function setToken(newToken: string): void {
    token.value = newToken;
    localStorage.setItem(kTokenStorageKey, newToken);
  }

  /**
   * Clear the authentication token
   */
  function logout(): void {
    token.value = null;
    localStorage.removeItem(kTokenStorageKey);
  }

  /**
   * Initiate login by redirecting to Twitch OAuth
   */
  function login(): void {
    const loginUrl = `${getApiOrigin(kSharedConfig)}${joinSharedPath(kSharedConfig, 'auth/twitch/login')}`;
    window.location.href = loginUrl;
  }

  /**
   * Local HTTP mode (`secure: false`): mint an admin JWT without Twitch OAuth.
   */
  async function loginLocal(): Promise<boolean> {
    if (!isLocalMode) {
      return false;
    }

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

  /**
   * Ensure we have a valid session. In local mode, auto-issues a local admin token if needed.
   */
  async function ensureAuthenticated(): Promise<VerifyTokenResult> {
    const existing = await verifyToken();

    if (existing.ok) {
      return existing;
    }

    if (isLocalMode) {
      const issued = await loginLocal();

      if (issued) {
        return verifyToken();
      }
    }

    return { ok: false };
  }

  /**
   * Verify token with server. Does not clear the session when Twitch chat OAuth is missing — use `needsTwitchOAuth`.
   */
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

      const data = await response.json() as { valid?: boolean; twitchChatOAuth?: boolean };

      if (!data.valid) {
        logout();
        return { ok: false };
      }

      return {
        ok: true,
        needsTwitchOAuth: data.twitchChatOAuth === false,
      };
    } catch (error) {
      console.error('[Auth] Failed to verify token:', error);
      return { ok: false };
    }
  }

  /**
   * Handle OAuth error from URL query params
   * Returns the error message if present (and cleans up URL), or null if no error
   */
  function handleOAuthError(): string | null {
    const url = new URL(window.location.href);
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      const errorMessage = `Authentication error: ${decodeURIComponent(oauthError)}`;
      // Clean up URL - remove error param from search
      url.searchParams.delete('error');
      url.hash = '';
      // Use URL object's pathname and search properties (normalized by URL constructor)
      window.history.replaceState(null, '', url.toString());

      return errorMessage;
    }

    return null;
  }

  /**
   * Handle OAuth callback - extract token from URL hash
   */
  function handleCallback(): boolean {
    const url = new URL(window.location.href);

    // Check for token in URL hash (format: #token=...)
    const hash = url.hash;

    if (hash.startsWith('#token=')) {
      const extractedToken = decodeURIComponent(hash.substring(7));
      setToken(extractedToken);
      // Clean up URL - remove hash while preserving pathname and search
      url.hash = '';
      // Use URL object's pathname and search properties (normalized by URL constructor)
      window.history.replaceState(null, '', url.toString());
      return true;
    }

    // Also check query params as fallback
    const tokenParam = url.searchParams.get('token');

    if (tokenParam) {
      setToken(tokenParam);
      // Clean up URL - remove token param from search
      url.searchParams.delete('token');
      url.hash = '';
      // Use URL object's pathname and search properties (normalized by URL constructor)
      window.history.replaceState(null, '', url.toString());
      return true;
    }

    return false;
  }

  return {
    isAuthenticated,
    isLocalMode,
    username,
    token: computed(() => token.value),
    login,
    loginLocal,
    ensureAuthenticated,
    logout,
    verifyToken,
    handleOAuthError,
    handleCallback,
    setToken
  };
}
