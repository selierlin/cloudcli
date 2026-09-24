// networkRoutes: mounted by the server entrypoint at /api/network.
export { default as networkRoutes } from './network.routes.js';
// applyProxyToProcessEnv: applied by the server entrypoint once the database is ready.
export { applyProxyToProcessEnv } from './network.service.js';
