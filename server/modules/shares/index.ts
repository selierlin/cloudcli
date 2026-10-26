// sharesRoutes: mounted by the server entrypoint for the authenticated create/revoke endpoints.
// publicSharesRoutes: mounted by the server entrypoint at `/s`, outside authentication.
// sweepExpiredShares: called once on boot for links nobody opens or lists.
export { publicSharesRoutes, sharesRoutes, sweepExpiredShares } from './shares.module.js';
