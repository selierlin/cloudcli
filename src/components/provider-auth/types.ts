import type { LLMProvider } from '../../types/app';

export type ProviderAuthStatus = {
  installed?: boolean;
  authenticated: boolean;
  authVerified?: boolean;
  email: string | null;
  method: string | null;
  error: string | null;
  loading: boolean;
};

export type ProviderAuthStatusMap = Record<LLMProvider, ProviderAuthStatus>;

export const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy'];

export const PROVIDER_AUTH_STATUS_ENDPOINTS: Record<LLMProvider, string> = {
  claude: '/api/providers/claude/auth/status',
  cursor: '/api/providers/cursor/auth/status',
  codex: '/api/providers/codex/auth/status',
  opencode: '/api/providers/opencode/auth/status',
  dsh: '/api/providers/dsh/auth/status',
  workbuddy: '/api/providers/workbuddy/auth/status',
};

export const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: { installed: false, authenticated: false, authVerified: true, email: null, method: null, error: null, loading },
  cursor: { installed: false, authenticated: false, authVerified: true, email: null, method: null, error: null, loading },
  codex: { installed: false, authenticated: false, authVerified: true, email: null, method: null, error: null, loading },
  opencode: { installed: false, authenticated: false, authVerified: true, email: null, method: null, error: null, loading },
  dsh: { installed: false, authenticated: false, authVerified: true, email: null, method: null, error: null, loading },
  workbuddy: { installed: false, authenticated: false, authVerified: false, email: null, method: null, error: null, loading },
});
