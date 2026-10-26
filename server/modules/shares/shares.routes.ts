import express from 'express';

import type { createSharesService } from './shares.service.js';

type SharesService = ReturnType<typeof createSharesService>;

/** The public page used for both expired and revoked links. */
const UNAVAILABLE_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>链接已失效 / Link unavailable</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f6f4; color: #26251f; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 28rem; padding: 2rem; text-align: center; }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  p { margin: 0.25rem 0; color: #6b695f; line-height: 1.6; }
</style>
</head>
<body>
<main>
  <h1>链接已失效</h1>
  <p>This shared conversation has expired or was revoked.</p>
</main>
</body>
</html>`;

/** Applies the headers every published transcript must carry. */
function setPublicShareHeaders(res: express.Response): void {
  // A published link is unlisted, never indexed, and never cached: revocation
  // has to take effect on the next request, not when a CDN decides to revalidate.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // The document is self-contained, but a transcript may still reference a
  // remote image or a theme font the export left as an absolute URL. Those are
  // the only origins it may reach; scripts, frames and forms stay blocked.
  //
  // `script-src` is deliberately absent, so it falls back to `default-src
  // 'none'`. This is the boundary, not a nicety: the uploaded document is
  // stored verbatim and served from the app's own origin, so any script that
  // ran here could read the reader's `auth-token` from localStorage and send it
  // out through the allowed image origin. The export therefore renders shared
  // snapshots without their scripts (`interactive: false`) — do not relax this
  // to make a snapshot's own controls work.
  //
  // Note what stays open: `style-src 'unsafe-inline'` plus `img-src https:` can
  // still exfiltrate the page's own DOM through attribute selectors and
  // `background: url(...)`. That reaches the transcript the publisher uploaded,
  // not the reader's storage, so it is a lesser channel — but blocking scripts
  // does not block it.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
}

/**
 * Authenticated management endpoints: list, create and revoke.
 *
 * Mounted by the server entrypoint at `/api/shares` behind `authenticateToken`;
 * the reader-facing `/s/:token` route is in `createPublicSharesRouter`.
 */
export function createSharesRouter(service: SharesService): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json({ success: true, shares: await service.listShares() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const created = await service.createShare({
        html: typeof body.html === 'string' ? body.html : '',
        title: typeof body.title === 'string' ? body.title : '',
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
        messageCount: typeof body.messageCount === 'number' ? body.messageCount : 0,
      });
      res.status(201).json({ success: true, share: created });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:shareId', async (req, res, next) => {
    try {
      const revoked = await service.revokeShare(req.params.shareId);
      if (!revoked) {
        res.status(404).json({
          success: false,
          error: { code: 'SHARE_NOT_FOUND', message: 'This share no longer exists' },
        });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * The anonymous reader endpoint.
 *
 * Mounted by the server entrypoint at `/s`, before every authenticated `/api`
 * route, because the token in the URL is the only credential a recipient has.
 */
export function createPublicSharesRouter(service: SharesService): express.Router {
  const router = express.Router();

  router.get('/:token', async (req, res, next) => {
    try {
      const resolved = await service.resolveShare(req.params.token);
      if (resolved.status !== 'ok') {
        setPublicShareHeaders(res);
        res.status(resolved.status === 'missing' ? 404 : 410).type('html').send(UNAVAILABLE_PAGE);
        return;
      }

      setPublicShareHeaders(res);
      res.type('html');
      res.sendFile(resolved.filePath, (error) => {
        // The service already checked the file; losing it in between is still
        // possible (manual cleanup), and sendFile's default error page would
        // leak the absolute path.
        if (error && !res.headersSent) {
          res.status(404).type('html').send(UNAVAILABLE_PAGE);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
