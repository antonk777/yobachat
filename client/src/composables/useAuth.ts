import { computed, ref } from 'vue';
import { kSharedConfig } from '@/config';

const kTokenStorageKey = 'yobachat_auth_token';

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
    const loginUrl = `https://${kSharedConfig.apiHost}${kSharedConfig.basePath}auth/twitch/login`;
    window.location.href = loginUrl;
  }

  /**
   * Verify token with server
   */
  async function verifyToken(): Promise<boolean> {
    if (!token.value) {
      return false;
    }

    try {
      const response = await fetch(`https://${kSharedConfig.apiHost}${kSharedConfig.basePath}auth/verify`, {
        headers: {
          'Authorization': `Bearer ${token.value}`
        }
      });

      if (!response.ok) {
        logout();
        return false;
      }

      const data = await response.json() as { valid: boolean };

      if (!data.valid) {
        logout();
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Auth] Failed to verify token:', error);
      return false;
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
    username,
    token: computed(() => token.value),
    login,
    logout,
    verifyToken,
    handleOAuthError,
    handleCallback,
    setToken
  };
}

