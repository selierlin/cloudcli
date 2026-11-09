import express, { type Request, type Response } from 'express';

import {
  getWorkbuddyAccountCredits,
  getWorkbuddySwitchProgress,
  getWorkbuddySwitchStatus,
  switchWorkbuddyAccount,
} from '@/modules/workbuddy-switch/workbuddy-switch.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

/**
 * State of the optional workbuddy-switch companion: availability, version,
 * whether the desktop app is running, and the accounts CloudCLI can sign in as.
 */
router.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await getWorkbuddySwitchStatus()));
  }),
);

/** Signs WorkBuddy in as one stored account; restarts the desktop app only when it is running. */
router.post(
  '/switch',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { accountId?: unknown };
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) {
      throw new AppError('accountId is required.', {
        code: 'WORKBUDDY_SWITCH_ACCOUNT_REQUIRED',
        statusCode: 400,
      });
    }

    res.json(createApiSuccessResponse(await switchWorkbuddyAccount(accountId)));
  }),
);

/** Credits left on every stored account, so each row can show its own balance. */
router.get(
  '/credits',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await getWorkbuddyAccountCredits()));
  }),
);

/** Live progress of an in-flight switch, polled by the settings card while it waits. */
router.get(
  '/switch/progress',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await getWorkbuddySwitchProgress()));
  }),
);

export default router;
