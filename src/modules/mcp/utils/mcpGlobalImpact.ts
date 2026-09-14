import { MCP_GLOBAL_ADD_BLOCKED_REASON, MCP_PROVIDER_NAMES, MCP_SUPPORTED_SCOPES, MCP_SUPPORTED_TRANSPORTS } from '@/shared/constants';
import type { McpGlobalImpactEntry, McpProvider, McpScope, McpTransport } from '@/shared/types';

// Reuse the provider-name map as the canonical provider order so a new provider
// cannot be added to the MCP settings without showing up in the preview.
const mcpProviderOrder = Object.keys(MCP_PROVIDER_NAMES) as McpProvider[];

/**
 * Predicts which providers a global (all-providers) MCP add will actually reach.
 *
 * The backend validates the scope and transport inside each provider rather than
 * up front, so this mirrors `MCP_SUPPORTED_SCOPES` / `MCP_SUPPORTED_TRANSPORTS`
 * per provider plus the providers that never take part in a global add at all.
 * WorkBuddy additionally requires its workspace to be a registered active
 * project, which is not knowable here; the form only offers registered projects,
 * so that case is left out of the prediction and still surfaces after submitting.
 */
export const getGlobalMcpImpact = (
  scope: McpScope,
  transport: McpTransport,
): McpGlobalImpactEntry[] => (
  mcpProviderOrder.map((provider) => {
    const blockedReason = MCP_GLOBAL_ADD_BLOCKED_REASON[provider];
    if (blockedReason) {
      return { provider, supported: false, reason: blockedReason };
    }

    if (!MCP_SUPPORTED_SCOPES[provider].includes(scope)) {
      return { provider, supported: false, reason: 'scopeUnsupported' };
    }

    if (!MCP_SUPPORTED_TRANSPORTS[provider].includes(transport)) {
      return { provider, supported: false, reason: 'transportUnsupported' };
    }

    return { provider, supported: true };
  })
);
