// providerRegistry: the module-level registry of every provider implementation
// (built eagerly at load, safe to enumerate during startup) for modules that need
// to walk all harnesses, e.g. the Browser feature's MCP migration.
export { providerRegistry } from './provider.registry.js';
export { sessionSynchronizerService } from './services/session-synchronizer.service.js';
export { providerSkillsService } from './services/skills.service.js';
export { providerMcpService } from './services/mcp.service.js';
// mcpCatalogService: owns the app-side user-scope MCP catalog (SSOT) that the
// MCP matrix routes read and edit.
export { mcpCatalogService } from './services/mcp-catalog.service.js';
export { providerRuntimeService } from './services/provider-runtime.service.js';

// providerModelsService: used by Commands to list models and resolve the active session model.
export { providerModelsService } from './services/provider-models.service.js';

// sessionsService: used by the websocket module's chat gateway to resolve an
// edited message's resume point, which only the providers module can read.
export { sessionsService } from './services/sessions.service.js';

export { initializeSessionsWatcher } from './services/sessions-watcher.service.js';
export { closeSessionsWatcher } from './services/sessions-watcher.service.js';

// initializeEphemeralCleanup/closeEphemeralCleanup: used by server/index.ts to
// reclaim leftover btw copies on boot and to keep sweeping long-idle ones.
export {
  closeEphemeralCleanup,
  initializeEphemeralCleanup,
} from './services/ephemeral-cleanup.service.js';

// providerSettingsSourceService: used by server/index.ts to hand the shell
// service the active claude settings file (the `claude --settings` equivalent)
// so terminal launches match the chat-side relay/auth configuration.
export { providerSettingsSourceService } from './services/provider-settings-source.service.js';

// getWorkbuddyCommand: used by the websocket shell service to spawn the
// WorkBuddy CLI at its resolved absolute path (not reliant on the PTY's PATH).
export { getWorkbuddyCommand } from './list/workbuddy/workbuddy-auth.provider.js';

// getPiCommand: used by the websocket shell service to spawn the Pi CLI at its
// resolved absolute path (not reliant on the PTY's PATH).
export { getPiCommand } from './list/pi/pi-auth.provider.js';

// getZcodeCommand: used by the websocket shell service to spawn the ZCode CLI
// (either the `zcode` binary or `node <bundle>`) without relying on the PTY's PATH.
export { getZcodeCommand } from './list/zcode/zcode-auth.provider.js';

// getOpenclawCommand: used by the websocket shell service to spawn the OpenClaw
// CLI at its resolved absolute path (not reliant on the PTY's PATH).
export { getOpenclawCommand } from './list/openclaw/openclaw-auth.provider.js';
