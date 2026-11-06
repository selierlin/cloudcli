import express from 'express';
import type { Request, Response } from 'express';

import type { ScheduledTaskScheduleKind } from '@/modules/database/index.js';
import {
  runScheduledTaskNow,
} from '@/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.js';
import { scheduledTasksService } from '@/modules/scheduled-tasks/services/scheduled-tasks.service.js';
import type { ScheduledTaskInput } from '@/modules/scheduled-tasks/services/scheduled-tasks.service.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };

function readUserId(request: Request): number {
  const userId = Number((request as AuthenticatedRequest).user?.id);
  if (!Number.isInteger(userId)) {
    throw new AppError('Authenticated user is required.', {
      code: 'USER_REQUIRED',
      statusCode: 401,
    });
  }
  return userId;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${field} is required.`, {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return value;
}

function readBody(request: Request): Record<string, unknown> {
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return body as Record<string, unknown>;
}

function readScheduleKind(value: unknown): ScheduledTaskScheduleKind {
  if (value === 'once' || value === 'interval' || value === 'daily' || value === 'weekly') {
    return value;
  }
  throw new AppError('scheduleKind must be once, interval, daily or weekly.', {
    code: 'INVALID_REQUEST_BODY',
    statusCode: 400,
  });
}

/** Reads the full payload a create needs; an update reuses it field by field. */
function readCreateInput(body: Record<string, unknown>): ScheduledTaskInput {
  return {
    name: readString(body.name, 'name'),
    prompt: readString(body.prompt, 'prompt'),
    provider: readString(body.provider, 'provider') as LLMProvider,
    model: typeof body.model === 'string' ? body.model : null,
    effort: typeof body.effort === 'string' ? body.effort : null,
    permissionMode: typeof body.permissionMode === 'string' ? body.permissionMode : null,
    projectPath: typeof body.projectPath === 'string' ? body.projectPath : null,
    scheduleKind: readScheduleKind(body.scheduleKind),
    scheduleSpec: body.scheduleSpec,
    timezone: readString(body.timezone, 'timezone'),
  };
}

/** Only the fields the client actually sent, so a switch toggle cannot blank a prompt. */
function readUpdateInput(body: Record<string, unknown>): Partial<ScheduledTaskInput> {
  const patch: Partial<ScheduledTaskInput> = {};

  if (body.name !== undefined) patch.name = readString(body.name, 'name');
  if (body.prompt !== undefined) patch.prompt = readString(body.prompt, 'prompt');
  if (body.provider !== undefined) patch.provider = readString(body.provider, 'provider') as LLMProvider;
  if (body.model !== undefined) patch.model = typeof body.model === 'string' ? body.model : null;
  if (body.effort !== undefined) patch.effort = typeof body.effort === 'string' ? body.effort : null;
  if (body.permissionMode !== undefined) {
    patch.permissionMode = typeof body.permissionMode === 'string' ? body.permissionMode : null;
  }
  if (body.projectPath !== undefined) {
    patch.projectPath = typeof body.projectPath === 'string' ? body.projectPath : null;
  }
  if (body.scheduleKind !== undefined) patch.scheduleKind = readScheduleKind(body.scheduleKind);
  if (body.scheduleSpec !== undefined) patch.scheduleSpec = body.scheduleSpec;
  if (body.timezone !== undefined) patch.timezone = readString(body.timezone, 'timezone');

  return patch;
}

/**
 * HTTP surface for scheduled tasks.
 *
 * Mounted by the server entrypoint with the provider runtime gateway, because
 * "run now" starts a real provider turn and the router must not reach into the
 * runtime registry itself.
 */
export function createScheduledTasksRouter(runtime: ProviderRuntimeGateway): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      res.json(createApiSuccessResponse(scheduledTasksService.list(readUserId(req))));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const result = scheduledTasksService.create(readUserId(req), readCreateInput(readBody(req)));
      res.status(201).json(createApiSuccessResponse(result));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      res.json(createApiSuccessResponse(scheduledTasksService.get(readUserId(req), readString(req.params.id, 'id'))));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const result = scheduledTasksService.update(
        readUserId(req),
        readString(req.params.id, 'id'),
        readUpdateInput(readBody(req)),
      );
      res.json(createApiSuccessResponse(result));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      scheduledTasksService.remove(readUserId(req), readString(req.params.id, 'id'));
      res.json(createApiSuccessResponse({ deleted: true }));
    }),
  );

  router.post(
    '/:id/enabled',
    asyncHandler(async (req: Request, res: Response) => {
      const body = readBody(req);
      if (typeof body.enabled !== 'boolean') {
        throw new AppError('enabled must be a boolean.', {
          code: 'INVALID_REQUEST_BODY',
          statusCode: 400,
        });
      }
      res.json(createApiSuccessResponse(
        scheduledTasksService.setEnabled(readUserId(req), readString(req.params.id, 'id'), body.enabled),
      ));
    }),
  );

  router.post(
    '/:id/run',
    asyncHandler(async (req: Request, res: Response) => {
      const run = runScheduledTaskNow(readUserId(req), readString(req.params.id, 'id'), runtime);
      res.status(202).json(createApiSuccessResponse(run));
    }),
  );

  router.get(
    '/:id/runs',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = Number(req.query.limit);
      res.json(createApiSuccessResponse(
        scheduledTasksService.listRuns(
          readUserId(req),
          readString(req.params.id, 'id'),
          Number.isFinite(limit) ? limit : undefined,
        ),
      ));
    }),
  );

  return router;
}
