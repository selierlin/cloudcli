import { ArrowUpRight, Edit3, ExternalLink, Globe, Lock, Plus, Server, Terminal, Trash2, Users, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { McpProject, McpProvider, McpScope, McpTransport, ProviderMcpServer } from '@/shared/types';
import { IS_PLATFORM } from '@/shared/utils';
import { ActionMenu, Badge, Button } from '@/shared/ui';
import { MCP_ADD_BLOCKED_REASON, MCP_GLOBAL_SUPPORTED_SCOPES, MCP_GLOBAL_SUPPORTED_TRANSPORTS, MCP_PROVIDER_NAMES, MCP_SUPPORTED_SCOPES } from '@/shared/constants';
import { useMcpServers } from '@/modules/mcp/hooks/useMcpServers';
import { useMcpCatalog } from '@/modules/mcp/hooks/useMcpCatalog';
import { maskSecret } from '@/modules/mcp/utils/mcpFormatting';
import McpServerFormModal from '@/modules/mcp/McpServerFormModal';

type McpServersProps = {
  selectedProvider: McpProvider;
  currentProjects: McpProject[];
  /** Opens the MCP matrix tab. Every user-scope row is read-only here, so this is the only entry to editing one. */
  onOpenMcpMatrix?: () => void;
};

const MCP_PROVIDER_BUTTON_CLASSES: Record<McpProvider, string> = {
  claude: 'bg-primary text-primary-foreground hover:bg-primary/90',
  cursor: 'bg-primary text-primary-foreground hover:bg-primary/90',
  codex: 'bg-primary text-primary-foreground hover:bg-primary/90',
  opencode: 'bg-primary text-primary-foreground hover:bg-primary/90',
  dsh: 'bg-primary text-primary-foreground hover:bg-primary/90',
  workbuddy: 'bg-primary text-primary-foreground hover:bg-primary/90',
  pi: 'bg-primary text-primary-foreground hover:bg-primary/90',
  zcode: 'bg-primary text-primary-foreground hover:bg-primary/90',
  omp: 'bg-primary text-primary-foreground hover:bg-primary/90',
};

/**
 * The scopes the global (all-provider) add form still offers.
 *
 * The user scope is owned by the MCP matrix, so this page must not create a
 * second, competing definition of a user-scope server. `MCP_GLOBAL_SUPPORTED_SCOPES`
 * keeps `user` because other consumers still reason about it.
 */
const GLOBAL_FORM_SCOPES: McpScope[] = MCP_GLOBAL_SUPPORTED_SCOPES.filter((scope) => scope !== 'user');

const getTransportIcon = (transport: string | undefined) => {
  if (transport === 'stdio') {
    return <Terminal className="h-4 w-4" />;
  }

  if (transport === 'sse') {
    return <Zap className="h-4 w-4" />;
  }

  if (transport === 'http') {
    return <Globe className="h-4 w-4" />;
  }

  return <Server className="h-4 w-4" />;
};

const getScopeLabel = (scope: McpScope, t: (key: string) => string): string => {
  if (scope === 'user') {
    return t('mcpServers.scope.user');
  }

  if (scope === 'local') {
    return t('mcpServers.scope.local');
  }

  return t('mcpServers.scope.project');
};

const getServerKey = (server: ProviderMcpServer): string => (
  `${server.provider}:${server.scope}:${server.workspacePath || 'global'}:${server.name}`
);

// Servers prefixed with `cloudcli-` are written and removed automatically by a
// CloudCLI feature toggle (e.g. the Browser tab), not added by the user. They are
// shown read-only so users don't edit/delete them out of sync with the feature.
const isManagedServer = (server: ProviderMcpServer): boolean => server.name.startsWith('cloudcli-');

/**
 * Who owns editing a row, which is what its read-only badge and hint name.
 *
 * A user-scope row is never editable here: the MCP matrix owns that scope, so
 * the row either mirrors a catalog entry (`matrix`) or a file entry the matrix
 * does not know about (`cloudcli` / `harness` / `unmanaged`). Local and project
 * scopes stay file-native and editable, so they carry no owner at all.
 */
type McpRowOwner = 'matrix' | 'cloudcli' | 'harness' | 'unmanaged';

type McpRowDetails = Pick<ProviderMcpServer, 'command' | 'args' | 'cwd' | 'url' | 'env' | 'envVars'>;

type McpServerRow = {
  key: string;
  name: string;
  transport: McpTransport;
  scope: McpScope;
  projectDisplayName?: string;
  details: McpRowDetails;
  /** Null when this page can edit the row. */
  owner: McpRowOwner | null;
  /** False for rows whose connection details are noise, like CloudCLI's own feature servers. */
  showDetails: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
};

function ConfigLine({ label, children }: { label: string; children: string }) {
  if (!children) {
    return null;
  }

  return (
    <div>
      {label}:{' '}
      <code className="rounded bg-muted px-1 text-xs">{children}</code>
    </div>
  );
}

function TeamMcpFeatureCard() {
  const { t } = useTranslation('settings');

  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-foreground">{t('mcpServers.team.title')}</h4>
            <Lock className="h-3 w-3 text-muted-foreground/60" />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('mcpServers.team.description')}
          </p>
          <a
            href="https://cloudcli.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
          >
            {t('mcpServers.team.cta')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** Rendered by the settings module's agents tab to list and manage one provider's MCP servers. */
export default function McpServers({ selectedProvider, currentProjects, onOpenMcpMatrix }: McpServersProps) {
  const { t } = useTranslation('settings');
  const {
    servers,
    isLoading,
    isLoadingProjectScopes,
    loadError,
    deleteError,
    saveStatus,
    serverForm,
    openForm,
    openGlobalForm,
    closeForm,
    submitForm,
    submitGlobalForm,
    deleteServer,
  } = useMcpServers({ selectedProvider, currentProjects });
  // Read-only half of the matrix's catalog, so the user-scope rows can be split
  // into the entries the matrix owns and the file entries it does not.
  const { entries: catalogEntries, error: catalogError } = useMcpCatalog();

  const providerName = MCP_PROVIDER_NAMES[selectedProvider];
  const description = t(`mcpServers.description.${selectedProvider}`, {
    defaultValue: `Model Context Protocol servers provide additional tools and data sources to ${providerName}`,
  });
  const globalButtonLabel = t('mcpServers.addGlobalButton');
  const providerButtonLabel = t('mcpServers.addProviderButton', { provider: providerName });
  // dsh and pi can never persist an MCP server, so both add entries stay
  // visible but disabled while naming the reason for the selected provider.
  const addBlockedReason = MCP_ADD_BLOCKED_REASON[selectedProvider];
  // A harness-managed provider still reports the servers its harness loads, but
  // every write is rejected, so those rows are shown without edit or delete.
  const isHarnessManagedProvider = addBlockedReason === 'harnessManaged';
  const addBlockedDescription = addBlockedReason
    ? t(`mcpServers.addBlocked.${addBlockedReason}`)
    : null;
  const globalAddDescription = addBlockedDescription ?? t('mcpServers.addGlobalDescription');
  const providerAddDescription = addBlockedDescription
    ?? t('mcpServers.addProviderDescription', { provider: providerName });
  const globalModalDescription = t('mcpServers.globalModalDescription');
  // The user scope moved to the MCP matrix, so the per-harness form only offers
  // what stays file-native. Filtered per provider and memoized: the form reloads
  // its fields whenever this list's identity changes.
  const formScopes = useMemo(
    () => MCP_SUPPORTED_SCOPES[selectedProvider].filter((scope) => scope !== 'user'),
    [selectedProvider],
  );

  const rows = useMemo<McpServerRow[]>(() => {
    const ownedByMatrix = new Set(
      catalogEntries.filter((entry) => entry.enabled[selectedProvider]).map((entry) => entry.name),
    );

    // A catalog entry the matrix enabled for this harness is the authoritative
    // definition, so the row is rendered from it rather than from the file copy
    // — which also keeps it visible when the projection into the file failed.
    const catalogRows: McpServerRow[] = catalogEntries
      .filter((entry) => entry.enabled[selectedProvider])
      .map((entry) => ({
        key: `catalog:${entry.id}`,
        name: entry.name,
        transport: entry.transport,
        scope: 'user',
        details: entry.config,
        owner: 'matrix',
        showDetails: true,
      }));

    const fileRows: McpServerRow[] = servers.flatMap((server) => {
      const cloudcliManaged = isManagedServer(server);
      // Both groups are read-only, but only the catalog-owned one is editable
      // elsewhere; the file-only rows name whoever really owns them.
      if (server.scope === 'user' && ownedByMatrix.has(server.name)) {
        return [];
      }

      const owner: McpRowOwner | null = server.scope === 'user'
        ? (cloudcliManaged ? 'cloudcli' : isHarnessManagedProvider ? 'harness' : 'unmanaged')
        : ((cloudcliManaged || isHarnessManagedProvider)
          ? (cloudcliManaged ? 'cloudcli' : 'harness')
          : null);

      return [{
        key: getServerKey(server),
        name: server.name,
        transport: server.transport,
        scope: server.scope,
        projectDisplayName: server.projectDisplayName,
        details: server,
        owner,
        showDetails: !cloudcliManaged,
        onEdit: owner ? undefined : () => openForm(server),
        onDelete: owner ? undefined : () => void deleteServer(server),
      }];
    });

    return [...catalogRows, ...fileRows];
  }, [catalogEntries, deleteServer, isHarnessManagedProvider, openForm, selectedProvider, servers]);

  const userRows = rows.filter((row) => row.scope === 'user');
  const fileScopedRows = rows.filter((row) => row.scope !== 'user');

  const describeOwner = (owner: McpRowOwner): string => {
    if (owner === 'matrix') {
      return t('mcpServers.userScope.managedHint');
    }

    if (owner === 'cloudcli') {
      return t('mcpServers.managed.hint', { defaultValue: 'Managed by CloudCLI.' });
    }

    if (owner === 'harness') {
      return t('mcpServers.managed.harnessHint', {
        provider: providerName,
        defaultValue: `Managed by ${providerName} itself.`,
      });
    }

    return t('mcpServers.userScope.unmanagedHint');
  };

  const ownerBadgeLabel = (owner: McpRowOwner): string => {
    if (owner === 'matrix') {
      return t('mcpServers.userScope.managedBadge');
    }

    if (owner === 'unmanaged') {
      return t('mcpServers.userScope.unmanagedBadge');
    }

    return t('mcpServers.managed.badge', { defaultValue: 'Managed' });
  };

  const renderRow = (row: McpServerRow) => (
    <div key={row.key} className="rounded-lg border border-border bg-card/50 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {row.showDetails && getTransportIcon(row.transport)}
            <span className="font-medium text-foreground">{row.name}</span>
            {row.showDetails && (
              <>
                <Badge variant="outline" className="text-xs">
                  {row.transport || 'stdio'}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {getScopeLabel(row.scope, t)}
                </Badge>
                {row.projectDisplayName && (
                  <Badge variant="outline" className="max-w-full truncate text-xs">
                    {row.projectDisplayName}
                  </Badge>
                )}
              </>
            )}
            {row.owner && (
              <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                {ownerBadgeLabel(row.owner)}
              </Badge>
            )}
          </div>

          <div className="space-y-1 text-sm text-muted-foreground">
            {row.showDetails && (
              <>
                <ConfigLine label={t('mcpServers.config.command')}>{row.details.command || ''}</ConfigLine>
                <ConfigLine label={t('mcpServers.config.url')}>{row.details.url || ''}</ConfigLine>
                <ConfigLine label={t('mcpServers.config.args')}>{(row.details.args || []).join(' ')}</ConfigLine>
                <ConfigLine label={t('mcpServers.config.cwd')}>{row.details.cwd || ''}</ConfigLine>
                {row.details.env && Object.keys(row.details.env).length > 0 && (
                  <ConfigLine label={t('mcpServers.config.environment')}>
                    {Object.entries(row.details.env).map(([key, value]) => `${key}=${maskSecret(value)}`).join(', ')}
                  </ConfigLine>
                )}
                {row.details.envVars && row.details.envVars.length > 0 && (
                  <ConfigLine label={t('mcpServers.config.envVars')}>{row.details.envVars.join(', ')}</ConfigLine>
                )}
              </>
            )}
            {row.owner && (
              <div className="text-xs text-muted-foreground">{describeOwner(row.owner)}</div>
            )}
          </div>
        </div>

        {!row.owner && (
          <div className="ml-4 flex items-center gap-2">
            <Button
              onClick={row.onEdit}
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              title={t('mcpServers.actions.edit')}
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button
              onClick={row.onDelete}
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700"
              title={t('mcpServers.actions.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Server className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-500" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-lg font-medium text-foreground">{t('mcpServers.title')}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <ActionMenu
          label={t('mcpServers.addButton')}
          icon={Plus}
          className="w-full sm:w-auto"
          triggerClassName={`w-full sm:w-auto ${MCP_PROVIDER_BUTTON_CLASSES[selectedProvider]}`}
          items={[
            {
              key: 'global',
              label: globalButtonLabel,
              description: globalAddDescription,
              icon: Globe,
              disabled: addBlockedReason !== null,
              onSelect: openGlobalForm,
            },
            {
              key: 'provider',
              label: providerButtonLabel,
              description: providerAddDescription,
              icon: Server,
              disabled: addBlockedReason !== null,
              onSelect: () => openForm(),
            },
          ]}
        />

      </div>

      <div className="space-y-2">
        <div className="min-h-4">
          {saveStatus === 'success' && (
            <span className="animate-in fade-in text-xs text-muted-foreground">{t('saveStatus.success')}</span>
          )}
          {isLoadingProjectScopes && (
            <span className="animate-in fade-in text-xs text-muted-foreground">{t('mcpServers.refreshingProjectScopes')}</span>
          )}
        </div>
      </div>

      {(loadError || deleteError || catalogError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {deleteError || loadError || catalogError}
        </div>
      )}

      <div className="space-y-4">
        {isLoading && rows.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">{t('mcpServers.loading')}</div>
        )}

        {userRows.length > 0 && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-muted-foreground">{t('mcpServers.sections.userScope')}</h4>
              {onOpenMcpMatrix && (
                <button
                  type="button"
                  onClick={onOpenMcpMatrix}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
                >
                  {t('mcpServers.openMatrix')}
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              )}
            </div>
            {userRows.map(renderRow)}
          </section>
        )}

        {fileScopedRows.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{t('mcpServers.sections.fileScopes')}</h4>
            {fileScopedRows.map(renderRow)}
          </section>
        )}

        {!isLoading && !isLoadingProjectScopes && rows.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">{t('mcpServers.empty')}</div>
        )}
      </div>

      {selectedProvider === 'codex' && (
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <h4 className="mb-2 font-medium text-foreground">{t('mcpServers.help.title')}</h4>
          <p className="text-sm text-muted-foreground">{t('mcpServers.help.description')}</p>
        </div>
      )}

      {selectedProvider === 'claude' && !IS_PLATFORM && <TeamMcpFeatureCard />}

      {/* Mounted only while open: each instance runs a full useMcpServerForm. */}
      {serverForm?.scope === 'provider' && (
        <McpServerFormModal
          provider={selectedProvider}
          editingServer={serverForm.editingServer}
          currentProjects={currentProjects}
          supportedScopes={formScopes}
          title={serverForm.editingServer ? undefined : providerButtonLabel}
          submitLabel={providerButtonLabel}
          onClose={closeForm}
          onSubmit={submitForm}
        />
      )}

      {serverForm?.scope === 'global' && (
        <McpServerFormModal
          provider={selectedProvider}
          mode="global"
          editingServer={null}
          currentProjects={currentProjects}
          title={globalButtonLabel}
          description={globalModalDescription}
          submitLabel={globalButtonLabel}
          supportedScopes={GLOBAL_FORM_SCOPES}
          supportedTransports={MCP_GLOBAL_SUPPORTED_TRANSPORTS}
          onClose={closeForm}
          onSubmit={(formData) => submitGlobalForm(formData)}
        />
      )}
    </div>
  );
}
