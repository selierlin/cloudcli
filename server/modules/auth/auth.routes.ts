import express from 'express';
import type { RequestHandler } from 'express';

import type { createAuthService } from './auth.service.js';

type AuthenticatedRequest = express.Request & { user?: unknown };

/** Extracts the transport context the audit trail records for an auth attempt. */
function requestContext(req: express.Request): { ip?: string; userAgent?: string } {
  const userAgent = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined };
}

/**
 * Creates the Auth transport adapter. Handlers only parse request data and
 * delegate authentication behavior to the injected application service.
 */
export function createAuthRouter(
  service: ReturnType<typeof createAuthService>,
  authenticateToken: RequestHandler,
): express.Router {
  const router = express.Router();

  router.get('/status', (_req, res, next) => {
    try {
      res.json(service.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/register', async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      res.json(await service.register(body.username, body.password, requestContext(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      res.json(await service.login(body.username, body.password, requestContext(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/user', authenticateToken, (req, res) => {
    res.json(service.getCurrentUser((req as AuthenticatedRequest).user));
  });

  router.post('/refresh', authenticateToken, (req, res) => {
    res.json(service.refreshSession((req as AuthenticatedRequest).user));
  });

  router.post('/logout', authenticateToken, (req, res) => {
    // Logging out is not a reason to extend the session: the authenticateToken
    // middleware may have set a fresh X-Refreshed-Token, and leaving it would
    // let the frontend write a live token back after the user cleared it.
    res.removeHeader('X-Refreshed-Token');
    res.json(service.logout((req as AuthenticatedRequest).user, requestContext(req)));
  });

  return router;
}
