import { useEffect, useMemo, useState } from 'react';

import type { AgentCategory, AgentContext, AgentContextByProvider, AgentProvider, AgentSettingsProject, ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, DshPermissionMode, OpenCodePermissionMode, OpenclawPermissionMode, OmpPermissionMode, PiPermissionMode, ProviderAuthStatus, WorkbuddyPermissionMode, ZcodePermissionMode } from '@/shared/types';
import AgentCategoryContentSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryTabsSection';
import AgentSelectorSection from '@/modules/settings/tabs/agents-settings/sections/AgentSelectorSection';

type ProviderAuthStatusByProvider = Record<AgentProvider, ProviderAuthStatus>;

type AgentsSettingsTabProps = {
  providerAuthStatus: ProviderAuthStatusByProvider;
  onProviderLogin: (provider: AgentProvider) => void;
  /** Re-reads one provider's CLI/auth state from the server. */
  onProviderAuthRecheck: (provider: AgentProvider) => void;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  workbuddyPermissionMode: WorkbuddyPermissionMode;
  onWorkbuddyPermissionModeChange: (value: WorkbuddyPermissionMode) => void;
  zcodePermissionMode: ZcodePermissionMode;
  onZcodePermissionModeChange: (value: ZcodePermissionMode) => void;
  piPermissionMode: PiPermissionMode;
  onPiPermissionModeChange: (value: PiPermissionMode) => void;
  dshPermissionMode: DshPermissionMode;
  onDshPermissionModeChange: (value: DshPermissionMode) => void;
  ompPermissionMode: OmpPermissionMode;
  onOmpPermissionModeChange: (value: OmpPermissionMode) => void;
  openclawPermissionMode: OpenclawPermissionMode;
  onOpenclawPermissionModeChange: (value: OpenclawPermissionMode) => void;
  opencodePermissionMode: OpenCodePermissionMode;
  onOpenCodePermissionModeChange: (value: OpenCodePermissionMode) => void;
  projects: AgentSettingsProject[];
  /** Opens the MCP matrix tab, which is where user-scope MCP servers are edited now. */
  onOpenMcpMatrix?: () => void;
};

/** Rendered by Settings for the "agents" tab, hosting per-provider account, permission, MCP and skill settings. */
export default function AgentsSettingsTab({
  providerAuthStatus,
  onProviderLogin,
  onProviderAuthRecheck,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  workbuddyPermissionMode,
  onWorkbuddyPermissionModeChange,
  zcodePermissionMode,
  onZcodePermissionModeChange,
  piPermissionMode,
  onPiPermissionModeChange,
  dshPermissionMode,
  onDshPermissionModeChange,
  ompPermissionMode,
  onOmpPermissionModeChange,
  openclawPermissionMode,
  onOpenclawPermissionModeChange,
  opencodePermissionMode,
  onOpenCodePermissionModeChange,
  projects,
  onOpenMcpMatrix,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('claude');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');
  const visibleCategories = useMemo<AgentCategory[]>(() => (
    selectedAgent === 'opencode'
      ? ['account', 'permissions', 'mcp']
      : ['account', 'permissions', 'mcp', 'skills']
  ), [selectedAgent]);

  const visibleAgents = useMemo<AgentProvider[]>(() => {
    return ['claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp', 'openclaw'];
  }, []);

  const agentContextById = useMemo<AgentContextByProvider>(() => {
    const buildContext = (provider: AgentProvider): AgentContext => ({
      authStatus: providerAuthStatus[provider],
      onLogin: () => onProviderLogin(provider),
      onRecheck: () => onProviderAuthRecheck(provider),
    });

    return {
      claude: buildContext('claude'),
      cursor: buildContext('cursor'),
      codex: buildContext('codex'),
      opencode: buildContext('opencode'),
      dsh: buildContext('dsh'),
      workbuddy: buildContext('workbuddy'),
      pi: buildContext('pi'),
      zcode: buildContext('zcode'),
      omp: buildContext('omp'),
      openclaw: buildContext('openclaw'),
    };
  }, [
    onProviderAuthRecheck,
    onProviderLogin,
    providerAuthStatus,
  ]);

  useEffect(() => {
    if (!visibleCategories.includes(selectedCategory)) {
      setSelectedCategory(visibleCategories[0] ?? 'account');
    }
  }, [selectedCategory, visibleCategories]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AgentSelectorSection
        agents={visibleAgents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        agentContextById={agentContextById}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AgentCategoryTabsSection
          categories={visibleCategories}
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />

        <AgentCategoryContentSection
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          agentContextById={agentContextById}
          claudePermissions={claudePermissions}
          onClaudePermissionsChange={onClaudePermissionsChange}
          cursorPermissions={cursorPermissions}
          onCursorPermissionsChange={onCursorPermissionsChange}
          codexPermissionMode={codexPermissionMode}
          onCodexPermissionModeChange={onCodexPermissionModeChange}
          workbuddyPermissionMode={workbuddyPermissionMode}
          onWorkbuddyPermissionModeChange={onWorkbuddyPermissionModeChange}
          zcodePermissionMode={zcodePermissionMode}
          onZcodePermissionModeChange={onZcodePermissionModeChange}
          piPermissionMode={piPermissionMode}
          onPiPermissionModeChange={onPiPermissionModeChange}
          dshPermissionMode={dshPermissionMode}
          onDshPermissionModeChange={onDshPermissionModeChange}
          ompPermissionMode={ompPermissionMode}
          onOmpPermissionModeChange={onOmpPermissionModeChange}
          openclawPermissionMode={openclawPermissionMode}
          onOpenclawPermissionModeChange={onOpenclawPermissionModeChange}
          opencodePermissionMode={opencodePermissionMode}
          onOpenCodePermissionModeChange={onOpenCodePermissionModeChange}
          projects={projects}
          onOpenMcpMatrix={onOpenMcpMatrix}
        />
      </div>
    </div>
  );
}
