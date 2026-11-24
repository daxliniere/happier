import { logger } from '@/ui/logger';

const MAX_ERROR_MESSAGE_CHARS = 300;

function readText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, MAX_ERROR_MESSAGE_CHARS);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function readErrorFields(error: unknown): Readonly<{ name?: string; code?: string; message?: string; cause?: unknown }> {
  if (!error || typeof error !== 'object') return { message: readText(error) };
  const record = error as Record<string, unknown>;
  return { name: readText(record.name), code: readText(record.code), message: readText(record.message), cause: record.cause };
}

/**
 * Describe a probe failure for the log: name, code, message and one level of cause (a network
 * failure's useful part is usually its cause, e.g. `ECONNREFUSED`). Never includes request
 * headers, credentials or environment values.
 */
export function describeProbeError(error: unknown): Readonly<Record<string, string>> {
  if (error === undefined || error === null) return {};
  const fields = readErrorFields(error);
  const cause = fields.cause === undefined ? null : readErrorFields(fields.cause);
  return {
    ...(fields.name ? { errorName: fields.name } : {}),
    ...(fields.code ? { errorCode: fields.code } : {}),
    ...(fields.message ? { errorMessage: fields.message } : {}),
    ...(cause?.code ? { causeCode: cause.code } : {}),
    ...(cause?.message ? { causeMessage: cause.message } : {}),
  };
}

/**
 * Record why a model probe failed. A probe failure degrades to the last known or static model
 * list, so this is the only place the cause is visible. Written to the file log at `warn`, which
 * is enabled in every process by default. A caller cancellation is not a failure and is skipped.
 */
export function logModelProbeFailure(params: Readonly<{
  scope: string;
  reason: string;
  details?: Readonly<Record<string, unknown>>;
  error?: unknown;
  signal?: AbortSignal | null;
}>): void {
  if (params.signal?.aborted) return;
  logger.warnFile(`[model-probe] ${params.scope}: ${params.reason}`, {
    ...params.details,
    ...describeProbeError(params.error),
  });
}
