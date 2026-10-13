import { AppError } from '@/shared/utils.js';

type AuthUser = {
  id: number | bigint;
  username: string;
};

type AuthLoginUser = AuthUser & { password_hash: string };

/**
 * Transport context captured for the audit trail. Optional because existing
 * two-argument callers (e.g. `service.login('alice', 'wrong')`) must keep working.
 */
export type AuthRequestContext = { ip?: string; userAgent?: string };

/** One audit event handed to the injected sink; `userId` is omitted for `login_failure` so a failure never reveals whether the username exists. */
export type AuthAuditEvent = {
  type: 'login_success' | 'login_failure' | 'logout' | 'register';
  userId?: number | null;
  username?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

type AuthDependencies = {
  users: {
    hasUsers(): boolean;
    createUser(username: string, passwordHash: string): AuthUser;
    getUserByUsername(username: string): AuthLoginUser | undefined;
    updateLastLogin(userId: number): void;
  };
  transaction: {
    begin(): void;
    commit(): void;
    rollback(): void;
  };
  hashPassword(password: string): Promise<string>;
  comparePassword(password: string, passwordHash: string): Promise<boolean>;
  generateToken(user: AuthUser): string;
  /** Best-effort audit sink; recording must never change the auth outcome. */
  audit: { record(event: AuthAuditEvent): void };
};

function numericUserId(userId: number | bigint): number {
  return Number(userId);
}

/**
 * Narrows an `unknown` authenticated principal to the `{ id, username }` the
 * token and audit paths need, or null when it is not a valid principal.
 * Shared by `refreshSession` and `logout`.
 */
function narrowAuthUser(user: unknown): AuthUser | null {
  if (
    typeof user !== 'object'
    || user === null
    || !('id' in user)
    || !('username' in user)
    || (typeof user.id !== 'number' && typeof user.id !== 'bigint')
    || typeof user.username !== 'string'
  ) {
    return null;
  }
  return { id: user.id, username: user.username };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Creates the Auth application service around explicit persistence, crypto,
 * transaction, and token dependencies.
 */
export function createAuthService(dependencies: AuthDependencies) {
  // Auditing is best-effort: a failing audit sink must never change the auth
  // outcome, so every audit write goes through this guard (hard constraint G4).
  const recordAudit = (event: AuthAuditEvent): void => {
    try {
      dependencies.audit.record(event);
    } catch (err) {
      console.error('Auth audit recording failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    getStatus() {
      return {
        needsSetup: !dependencies.users.hasUsers(),
        isAuthenticated: false,
      };
    },

    async register(usernameInput: unknown, passwordInput: unknown, context: AuthRequestContext = {}) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';

      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }
      if (username.length < 3 || password.length < 6) {
        throw new AppError(
          'Username must be at least 3 characters, password at least 6 characters',
          { code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400 },
        );
      }

      dependencies.transaction.begin();
      try {
        if (dependencies.users.hasUsers()) {
          throw new AppError('User already exists. This is a single-user system.', {
            code: 'AUTH_USER_ALREADY_CONFIGURED',
            statusCode: 403,
          });
        }

        const passwordHash = await dependencies.hashPassword(password);
        const user = dependencies.users.createUser(username, passwordHash);
        const token = dependencies.generateToken(user);
        dependencies.transaction.commit();
        dependencies.users.updateLastLogin(numericUserId(user.id));
        // Recorded after commit: an audit write before the commit would be
        // caught by the rollback path below and silently discarded.
        recordAudit({
          type: 'register',
          userId: numericUserId(user.id),
          username: user.username,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        });

        return {
          success: true,
          user: { id: user.id, username: user.username },
          token,
        };
      } catch (error) {
        dependencies.transaction.rollback();
        if (isUniqueConstraintError(error)) {
          throw new AppError('Username already exists', {
            code: 'AUTH_USERNAME_CONFLICT',
            statusCode: 409,
          });
        }
        throw error;
      }
    },

    async login(usernameInput: unknown, passwordInput: unknown, context: AuthRequestContext = {}) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';
      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }

      const user = dependencies.users.getUserByUsername(username);
      const validPassword = user
        ? await dependencies.comparePassword(password, user.password_hash)
        : false;
      if (!user || !validPassword) {
        // Recorded before throwing so the failed attempt is always persisted;
        // no userId — a failure must not disclose whether the username exists.
        recordAudit({
          type: 'login_failure',
          username,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        });
        throw new AppError('Invalid username or password', {
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401,
        });
      }

      dependencies.users.updateLastLogin(numericUserId(user.id));
      recordAudit({
        type: 'login_success',
        userId: numericUserId(user.id),
        username: user.username,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
      return {
        success: true,
        user: { id: user.id, username: user.username },
        token: dependencies.generateToken(user),
      };
    },

    getCurrentUser(user: unknown) {
      return { user };
    },

    refreshSession(user: unknown) {
      const current = narrowAuthUser(user);
      if (!current) {
        throw new AppError('Authenticated user is required', {
          code: 'AUTH_USER_REQUIRED',
          statusCode: 401,
        });
      }

      return { token: dependencies.generateToken(current) };
    },

    logout(user: unknown, context: AuthRequestContext = {}) {
      // The stored `logout` event means "the client cleared its token", not
      // "the server-side session ended" — JWTs stay valid until they expire.
      const current = narrowAuthUser(user);
      if (current) {
        recordAudit({
          type: 'logout',
          userId: numericUserId(current.id),
          username: current.username,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        });
      }
      return { success: true, message: 'Logged out successfully' };
    },
  };
}
