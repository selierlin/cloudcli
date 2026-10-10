import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import { MCP_SUPPORTED_SCOPES, MCP_SUPPORTED_TRANSPORTS } from '@/shared/constants';
import type {
  McpFormState,
  McpProject,
  McpProvider,
  McpScope,
  McpTestConnectionInput,
  McpTestConnectionResult,
  McpTestConnectionSource,
  McpTransport,
  ProviderMcpServer,
} from '@/shared/types';
import {
  createJsonInputFromServer,
  formatKeyValueLines,
  getErrorMessage,
  getProjectPath,
  isMcpTransport,
  parseKeyValueLines,
  parseListLines,
} from '@/modules/mcp/utils/mcpFormatting';

type UseMcpServerFormArgs = {
  provider: McpProvider;
  editingServer: ProviderMcpServer | null;
  currentProjects: McpProject[];
  supportedScopes?: McpScope[];
  supportedTransports?: McpTransport[];
  unsupportedTransportMessage?: (transport: McpTransport) => string;
  /**
   * Id of the catalog entry being edited, when the form is opened from the MCP
   * matrix. It lets the "test connection" probe restore redacted header values
   * from the catalog row; a provider-scope edit uses the server's own identity
   * instead.
   */
  catalogEntryId?: string;
  onSubmit: (formData: McpFormState, editingServer: ProviderMcpServer | null) => Promise<void>;
};

type MultilineFieldText = {
  args: string;
  env: string;
  headers: string;
  envVars: string;
  envHttpHeaders: string;
};

const DEFAULT_MCP_FORM: McpFormState = {
  name: '',
  scope: 'user',
  workspacePath: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  cwd: '',
  url: '',
  headers: {},
  envVars: [],
  bearerTokenEnvVar: '',
  envHttpHeaders: {},
  importMode: 'form',
  jsonInput: '',
};

const cloneDefaultForm = (
  provider: McpProvider,
  supportedScopes = MCP_SUPPORTED_SCOPES[provider],
  supportedTransports = MCP_SUPPORTED_TRANSPORTS[provider],
): McpFormState => ({
  ...DEFAULT_MCP_FORM,
  scope: supportedScopes[0],
  transport: supportedTransports[0],
  args: [],
  env: {},
  headers: {},
  envVars: [],
  envHttpHeaders: {},
});

const createFormStateFromServer = (
  provider: McpProvider,
  server: ProviderMcpServer,
  supportedScopes?: McpScope[],
  supportedTransports?: McpTransport[],
): McpFormState => ({
  ...cloneDefaultForm(provider, supportedScopes, supportedTransports),
  name: server.name,
  scope: server.scope,
  workspacePath: server.workspacePath || '',
  transport: server.transport,
  command: server.command || '',
  args: server.args || [],
  env: server.env || {},
  cwd: server.cwd || '',
  url: server.url || '',
  headers: server.headers || {},
  envVars: server.envVars || [],
  bearerTokenEnvVar: server.bearerTokenEnvVar || '',
  envHttpHeaders: server.envHttpHeaders || {},
  jsonInput: createJsonInputFromServer(server),
});

const createMultilineTextFromForm = (formData: McpFormState): MultilineFieldText => ({
  args: formData.args.join('\n'),
  env: formatKeyValueLines(formData.env),
  headers: formatKeyValueLines(formData.headers),
  envVars: formData.envVars.join('\n'),
  envHttpHeaders: formatKeyValueLines(formData.envHttpHeaders),
});

const normalizeScope = (supportedScopes: McpScope[], value: McpScope): McpScope => (
  supportedScopes.includes(value) ? value : supportedScopes[0]
);

const normalizeTransport = (supportedTransports: McpTransport[], value: McpTransport): McpTransport => (
  supportedTransports.includes(value) ? value : supportedTransports[0]
);

export function useMcpServerForm({
  provider,
  editingServer,
  currentProjects,
  supportedScopes = MCP_SUPPORTED_SCOPES[provider],
  supportedTransports = MCP_SUPPORTED_TRANSPORTS[provider],
  unsupportedTransportMessage,
  catalogEntryId,
  onSubmit,
}: UseMcpServerFormArgs) {
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState<McpFormState>(() => (
    cloneDefaultForm(provider, supportedScopes, supportedTransports)
  ));
  const [multilineText, setMultilineText] = useState<MultilineFieldText>(() => (
    createMultilineTextFromForm(cloneDefaultForm(provider, supportedScopes, supportedTransports))
  ));
  const [jsonValidationError, setJsonValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestConnectionResult | null>(null);

  const isEditing = Boolean(editingServer);

  // The modal is mounted only while open, so this runs on mount and whenever the
  // edit target changes. The state initializers above already produce the blank
  // form; this exists to load an existing server into it.
  useEffect(() => {
    setJsonValidationError('');
    if (editingServer) {
      const nextFormData = createFormStateFromServer(provider, editingServer, supportedScopes, supportedTransports);
      setFormData(nextFormData);
      setMultilineText(createMultilineTextFromForm(nextFormData));
      return;
    }

    const nextFormData = cloneDefaultForm(provider, supportedScopes, supportedTransports);
    setFormData(nextFormData);
    setMultilineText(createMultilineTextFromForm(nextFormData));
  }, [editingServer, provider, supportedScopes, supportedTransports]);

  const projectOptions = useMemo(() => (
    currentProjects
      .map((project) => ({
        value: getProjectPath(project),
        // Fall back to projectId (DB primary key) when no display name is set.
        label: project.displayName || project.projectId,
      }))
      .filter((project) => project.value)
  ), [currentProjects]);

  // A probe only describes the endpoint as it was when it ran, so any edit to
  // the fields it read clears the last result at the point of the change.
  const updateForm = <K extends keyof McpFormState>(key: K, value: McpFormState[K]) => {
    if (key === 'url' || key === 'transport' || key === 'importMode') {
      setTestResult(null);
    }
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const updateScope = (scope: McpScope) => {
    setFormData((prev) => ({
      ...prev,
      scope: normalizeScope(supportedScopes, scope),
      workspacePath: scope === 'user' ? '' : prev.workspacePath,
    }));
  };

  const updateTransport = (transport: McpTransport) => {
    setTestResult(null);
    setFormData((prev) => ({ ...prev, transport: normalizeTransport(supportedTransports, transport) }));
  };

  const validateJsonInput = (value: string) => {
    if (!value.trim()) {
      setJsonValidationError('');
      return;
    }

    try {
      const parsed = JSON.parse(value) as { type?: unknown; transport?: unknown; command?: unknown; url?: unknown };
      const transportInput = parsed.transport || parsed.type;
      if (!isMcpTransport(transportInput)) {
        setJsonValidationError(t('mcpForm.validation.missingType'));
      } else if (!supportedTransports.includes(transportInput)) {
        setJsonValidationError(
          unsupportedTransportMessage?.(transportInput) ?? t('mcpServers.errors.providerTransportUnsupported', {
            provider,
            transport: transportInput,
            defaultValue: `${provider} does not support ${transportInput} MCP servers`,
          }),
        );
      } else if (transportInput === 'stdio' && !parsed.command) {
        setJsonValidationError(t('mcpForm.validation.stdioRequiresCommand'));
      } else if ((transportInput === 'http' || transportInput === 'sse') && !parsed.url) {
        setJsonValidationError(t('mcpForm.validation.httpRequiresUrl', { type: transportInput }));
      } else {
        setJsonValidationError('');
      }
    } catch {
      setJsonValidationError(t('mcpForm.validation.invalidJson'));
    }
  };

  const updateJsonInput = (value: string) => {
    setTestResult(null);
    setFormData((prev) => ({ ...prev, jsonInput: value }));
    validateJsonInput(value);
  };

  const updateMultilineText = <K extends keyof MultilineFieldText>(key: K, value: MultilineFieldText[K]) => {
    if (key === 'headers') {
      setTestResult(null);
    }
    setMultilineText((prev) => ({ ...prev, [key]: value }));
  };

  const createSubmitFormData = (): McpFormState => ({
    ...formData,
    args: parseListLines(multilineText.args),
    env: parseKeyValueLines(multilineText.env),
    headers: parseKeyValueLines(multilineText.headers),
    envVars: parseListLines(multilineText.envVars),
    envHttpHeaders: parseKeyValueLines(multilineText.envHttpHeaders),
  });

  // Identifies the saved definition a probe should restore redacted header
  // values from. Absent for a new server, whose headers the user typed in full.
  const buildTestSource = (): McpTestConnectionSource | undefined => {
    if (!editingServer) {
      return undefined;
    }

    if (catalogEntryId) {
      return { kind: 'catalog', id: catalogEntryId };
    }

    return {
      kind: 'provider',
      provider,
      name: editingServer.name,
      scope: editingServer.scope,
      workspacePath: editingServer.workspacePath,
    };
  };

  // Resolves the probe input from whichever import mode is active: the
  // structured fields in form mode, or the pasted JSON in json mode. Returns
  // null when the current input is not an http/sse endpoint carrying a URL.
  const buildTestInput = (): McpTestConnectionInput | null => {
    if (formData.importMode === 'json') {
      try {
        const parsed = JSON.parse(formData.jsonInput) as {
          type?: unknown;
          transport?: unknown;
          url?: unknown;
          headers?: unknown;
        };
        const transport = parsed.transport ?? parsed.type;
        if (
          (transport !== 'http' && transport !== 'sse')
          || typeof parsed.url !== 'string'
          || !parsed.url.trim()
        ) {
          return null;
        }

        return {
          transport,
          url: parsed.url.trim(),
          headers: parsed.headers && typeof parsed.headers === 'object'
            ? Object.fromEntries(
              Object.entries(parsed.headers as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            )
            : undefined,
          source: buildTestSource(),
        };
      } catch {
        return null;
      }
    }

    if (formData.transport === 'stdio' || !formData.url.trim()) {
      return null;
    }

    return {
      transport: formData.transport,
      url: formData.url.trim(),
      headers: parseKeyValueLines(multilineText.headers),
      source: buildTestSource(),
    };
  };

  const testInput = buildTestInput();
  const canTest = testInput !== null && !isTesting;

  const handleTest = async () => {
    if (!testInput) {
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await readApiJson<{ success: true; data: McpTestConnectionResult }>(
        await api.providers.testMcpServer(testInput),
      );
      setTestResult(response.data);
    } catch (error) {
      setTestResult({ ok: false, error: getErrorMessage(error) });
    } finally {
      setIsTesting(false);
    }
  };

  const canSubmit = useMemo(() => {
    if (!formData.name.trim()) {
      return false;
    }

    if (formData.scope !== 'user' && !formData.workspacePath.trim()) {
      return false;
    }

    if (formData.importMode === 'json') {
      return Boolean(formData.jsonInput.trim()) && !jsonValidationError;
    }

    if (formData.transport === 'stdio') {
      return Boolean(formData.command.trim());
    }

    return Boolean(formData.url.trim());
  }, [formData, jsonValidationError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      // Textareas keep raw strings while editing so users can create blank
      // lines or partial KEY=value entries without the form rewriting them.
      await onSubmit(createSubmitFormData(), editingServer);
    } catch (error) {
      const message = getErrorMessage(error);
      alert(t('mcpServers.errors.errorAlert', { message, defaultValue: `Error: ${message}` }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formData,
    multilineText,
    projectOptions,
    isEditing,
    isSubmitting,
    isTesting,
    testResult,
    canTest,
    jsonValidationError,
    canSubmit,
    updateForm,
    updateScope,
    updateTransport,
    updateJsonInput,
    updateMultilineText,
    handleSubmit,
    handleTest,
  };
}
