import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type SystemUpdateCommandResult = {
  exitCode: number | null;
  output: string;
  errorOutput: string;
};

/** Upper bound for a client diagnostics payload; the recorder sends far less. */
const MAX_CLIENT_DIAGNOSTICS_BYTES = 8 * 1024 * 1024;

type SystemUpdateDependencies = {
  appRoot: string;
  homeDirectory: string;
  installMode: 'git' | 'npm';
  isPlatform: boolean;
  environment: NodeJS.ProcessEnv;
  runShellCommand(
    command: string,
    workingDirectory: string,
    environment: NodeJS.ProcessEnv,
    onOutput: (output: string) => void,
    onErrorOutput: (errorOutput: string) => void,
  ): Promise<SystemUpdateCommandResult>;
  logInfo(message: string, detail?: string): void;
  logError(message: string, detail?: string): void;
};

/**
 * Creates the update workflow used by the system module and its focused tests.
 * Runtime-specific process spawning stays behind the injected command adapter.
 */
export function createSystemUpdateService(dependencies: SystemUpdateDependencies) {
  return {
    /** Selects and executes the correct update workflow for this installation. */
    async updateSystem() {
      const updateCommand = dependencies.isPlatform
        ? 'npm run update:platform'
        : dependencies.installMode === 'git'
          ? 'git checkout main && git pull && npm install'
          : 'npm install -g @cloudcli-ai/cloudcli@latest';
      const workingDirectory = dependencies.isPlatform || dependencies.installMode === 'git'
        ? dependencies.appRoot
        : dependencies.homeDirectory;

      dependencies.logInfo('Starting system update from directory:', workingDirectory);

      try {
        const result = await dependencies.runShellCommand(
          updateCommand,
          workingDirectory,
          dependencies.environment,
          (output) => dependencies.logInfo('Update output:', output),
          (errorOutput) => dependencies.logError('Update error:', errorOutput),
        );

        if (result.exitCode === 0) {
          return {
            success: true as const,
            output: result.output || 'Update completed successfully',
            message: 'Update completed. Please restart the server to apply changes.',
          };
        }

        return {
          success: false as const,
          error: 'Update command failed',
          output: result.output,
          errorOutput: result.errorOutput,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.logError('Update process error:', message);
        return {
          success: false as const,
          error: message,
        };
      }
    },

    /**
     * Persists a client diagnostics report so it can be read from the machine
     * running the server. The payload originates in the browser and is treated
     * as opaque text: nothing here interprets it, and the name is generated so
     * a report can never choose its own path.
     */
    async saveClientDiagnostics(report: unknown) {
      if (report === null || typeof report !== 'object' || Array.isArray(report)) {
        return { success: false as const, error: 'Report must be a JSON object' };
      }

      const serialized = JSON.stringify(report, null, 2);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_CLIENT_DIAGNOSTICS_BYTES) {
        return { success: false as const, error: 'Report exceeds the size limit' };
      }

      const directory = path.join(dependencies.homeDirectory, '.cloudcli', 'diagnostics');
      const fileName = `client-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`;
      const filePath = path.join(directory, fileName);

      try {
        await mkdir(directory, { recursive: true });
        await writeFile(filePath, serialized, 'utf8');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.logError('Failed to save client diagnostics:', message);
        return { success: false as const, error: message };
      }

      dependencies.logInfo('Saved client diagnostics to:', filePath);
      return { success: true as const, path: filePath };
    },
  };
}
