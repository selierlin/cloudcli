import express from 'express';

import { getUserThemesDir, asyncHandler } from '@/shared/utils.js';

import { readThemeFile, scanThemeFiles } from './services/theme-files.service.js';

const router = express.Router();

/**
 * Lists the user themes in the host's `~/.cloudcli/themes` folder. The client
 * merges them with its builtin registry and offers the ones it can parse.
 */
router.get('/', asyncHandler(async (_req, res) => {
  res.json({ themes: await scanThemeFiles(getUserThemesDir()) });
}));

/**
 * Serves one theme file verbatim. The client compiles it into a `<style>`
 * element, so nothing is rewritten here — the gates in the service are what keep
 * an unsafe file out.
 */
router.get('/:fileName', asyncHandler(async (req, res) => {
  // A named segment is a string at runtime; the type is only wide because the
  // shared handler signature admits wildcard routes.
  const fileName = req.params.fileName as string;
  const theme = await readThemeFile(getUserThemesDir(), fileName);
  if (theme.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid theme file name' });
  }
  if (theme.status === 'missing') {
    return res.status(404).json({ error: 'Theme file not found' });
  }

  res.setHeader('Content-Type', theme.contentType);
  // The client appends `?v=<modifiedAt>` itself, so caching here adds nothing.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(theme.content);
}));

export default router;
