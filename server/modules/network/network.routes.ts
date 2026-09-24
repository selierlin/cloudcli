import express, { type Request, type Response } from 'express';

import { networkProxyService } from '@/modules/network/network.service.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

// ----------------- Global network proxy -----------------
/**
 * Machine-level HTTP proxy for CloudCLI and every agent CLI it spawns. GET
 * returns the stored URL; PUT persists it (blank = go direct) and applies it to
 * the running process, so the next spawned session picks it up without a
 * restart.
 */
router.get(
  '/proxy',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(networkProxyService.getConfig()));
  }),
);

router.put(
  '/proxy',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = networkProxyService.updateConfig({
      proxyUrl: typeof body.proxyUrl === 'string' ? body.proxyUrl : undefined,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

export default router;
