import { sharedTranscriptsDb } from '@/modules/database/index.js';

import { createPublicSharesRouter, createSharesRouter } from './shares.routes.js';
import { createSharesService } from './shares.service.js';

const sharesService = createSharesService({ store: sharedTranscriptsDb });

export const sharesRoutes = createSharesRouter(sharesService);
export const publicSharesRoutes = createPublicSharesRouter(sharesService);

/** Boot-time cleanup of expired snapshots; see `sweepExpired` in the service. */
export const sweepExpiredShares = (): Promise<void> => sharesService.sweepExpired();
