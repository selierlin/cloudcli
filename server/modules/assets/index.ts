// Express router mounted at /api/assets by server/index.ts for uploading,
// serving, releasing and reclaiming chat attachments stored in the global
// ~/.cloudcli/assets folder.
export { default as assetsRoutes } from './assets.routes.js';
// initializeAssetCleanup/closeAssetCleanup: used by server/index.ts to reclaim
// abandoned uploads on boot and to keep sweeping old ones.
export {
  closeAssetCleanup,
  initializeAssetCleanup,
} from './services/asset-gc.service.js';
