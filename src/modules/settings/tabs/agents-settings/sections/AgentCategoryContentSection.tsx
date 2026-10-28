import type { AgentCategory, AgentContextByProvider, AgentProvider, AgentSettingsProject, ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, DshPermissionMode, LLMProvider, McpProject, OpenCodePermissionMode, OpenclawPermissionMode, OmpPermissionMode, PermissionMode, PiPermissionMode, SkillsProject, WorkbuddyPermissionMode, ZcodePermissionMode } from '@/shared/types';
import { McpServers } from '@/modules/mcp';
import { ProviderSkills } from '@/modules/skills';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';
import ProviderQuotaSection from '@/modules/settings/tabs/agents-settings/sections/content/ProviderQuotaSection';
import ProviderSettingsSourceSection from '@/modules/settings/tabs/agents-settings/sections/content/ProviderSettingsSourceSection';

/** Providers rendered by the shared permission-mode picker; claude and cursor have their own allowlist panels. */
type ModePickerProvider = Exclude<LLMProvider, 'claude' | 'cursor'>;

type AgentCategoryContentSectionProps = {
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  agentContextById: AgentContextByProvider;
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

/** Rendered by AgentsSettingsTab to show the panel for the selected provider and category. */
export default function AgentCategoryContentSection({
  selectedAgent,
  selectedCategory,
  agentContextById,
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
}: AgentCategoryContentSectionProps) {
  // Keyed by provider rather than branched per provider: a provider added to
  // LLMProvider without a mode here is a compile error, instead of the blank
  // (or wrong) panel opencode and workbuddy shipped with.
  const permissionModeByAgent: Record<ModePickerProvider, PermissionMode> = {
    codex: codexPermissionMode,
    workbuddy: workbuddyPermissionMode,
    zcode: zcodePermissionMode,
    pi: piPermissionMode,
    dsh: dshPermissionMode,
    omp: ompPermissionMode,
    openclaw: openclawPermissionMode,
    opencode: opencodePermissionMode,
  };

  const setPermissionModeByAgent: Record<ModePickerProvider, (mode: PermissionMode) => void> = {
    codex: (mode) => onCodexPermissionModeChange(mode as CodexPermissionMode),
    workbuddy: (mode) => onWorkbuddyPermissionModeChange(mode as WorkbuddyPermissionMode),
    zcode: (mode) => onZcodePermissionModeChange(mode as ZcodePermissionMode),
    pi: (mode) => onPiPermissionModeChange(mode as PiPermissionMode),
    dsh: (mode) => onDshPermissionModeChange(mode as DshPermissionMode),
    omp: (mode) => onOmpPermissionModeChange(mode as OmpPermissionMode),
    openclaw: (mode) => onOpenclawPermissionModeChange(mode as OpenclawPermissionMode),
    opencode: (mode) => onOpenCodePermissionModeChange(mode as OpenCodePermissionMode),
  };

  return (
    <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4">
      {selectedCategory === 'account' && (
        <div className="space-y-6">
          <AccountContent
            agent={selectedAgent}
            authStatus={agentContextById[selectedAgent].authStatus}
            onLogin={agentContextById[selectedAgent].onLogin}
          />
          <ProviderQuotaSection agent={selectedAgent} />
          {(selectedAgent === 'claude' || selectedAgent === 'codex') && (
            <ProviderSettingsSourceSection provider={selectedAgent} />
          )}
        </div>
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
        <PermissionsContent
          agent="claude"
          skipPermissions={claudePermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value });
          }}
          allowedTools={claudePermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, allowedTools: value });
          }}
          disallowedTools={claudePermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
        <PermissionsContent
          agent="cursor"
          skipPermissions={cursorPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, skipPermissions: value });
          }}
          allowedCommands={cursorPermissions.allowedCommands}
          onAllowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, allowedCommands: value });
          }}
          disallowedCommands={cursorPermissions.disallowedCommands}
          onDisallowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, disallowedCommands: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent !== 'claude' && selectedAgent !== 'cursor' && (
        <PermissionsContent
          agent={selectedAgent}
          permissionMode={permissionModeByAgent[selectedAgent]}
          onPermissionModeChange={setPermissionModeByAgent[selectedAgent]}
        />
      )}

      {selectedCategory === 'mcp' && (
        // AgentSettingsProject.name is populated from the DB projectId by
        // normalizeProjectForSettings, so we can map it straight through.
        <McpServers
          selectedProvider={selectedAgent}
          currentProjects={projects.map<McpProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
          onOpenMcpMatrix={onOpenMcpMatrix}
        />
      )}

      {selectedCategory === 'skills' && selectedAgent !== 'opencode' && (
        <ProviderSkills
          selectedProvider={selectedAgent}
          currentProjects={projects.map<SkillsProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}
    </div>
  );
}
