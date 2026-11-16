import type { Status } from './types'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

interface ApiEnvelope {
  success?: unknown
  message?: unknown
  results?: unknown
}

/** Failed requests keep the parsed envelope so callers can inspect `results`. */
type RawResult =
  | { ok: true; data: ApiEnvelope }
  | { ok: false; message: string; envelope: ApiEnvelope | null }

async function post(url: string, body?: unknown): Promise<RawResult> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    })
  } catch {
    return {
      ok: false,
      message:
        'Network error: the server could not be reached, or your session expired. Reload the page and try again.',
      envelope: null,
    }
  }

  let data: ApiEnvelope | null = null
  try {
    const parsed: unknown = JSON.parse(await res.text())
    if (typeof parsed === 'object' && parsed !== null)
      data = parsed
  } catch {
    data = null
  }
  if (data === null) {
    return {
      ok: false,
      message: `Unexpected non-JSON response (HTTP ${res.status}).`,
      envelope: null,
    }
  }
  const serverMessage =
    typeof data.message === 'string' && data.message !== ''
      ? data.message
      : null
  if (!res.ok || data.success !== true) {
    return {
      ok: false,
      message: serverMessage ?? `Request failed (HTTP ${res.status}).`,
      envelope: data,
    }
  }
  return { ok: true, data }
}

/** POST /api/update-training. Only a server-confirmed success returns ok. */
export async function updateTraining(
  email: string,
  status: Status,
): Promise<ApiResult<null>> {
  const result = await post('/api/update-training', { email, status })
  return result.ok
    ? { ok: true, data: null }
    : { ok: false, message: result.message }
}

export interface SyncResults {
  message: string
  added: number | null
  updated: number | null
  removed: number | null
  skipped: number | null
  errors: string[]
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * Outcome of a sync request. A failed request may still carry `partial`
 * results: the server applied some changes before failing (HTTP 207), so the
 * database may have changed even though `ok` is false.
 */
export type SyncApiResult =
  | { ok: true; data: SyncResults }
  | { ok: false; message: string; partial?: SyncResults }

/** Per-error display cap; errors render only as text nodes. */
const MAX_ERROR_LENGTH = 300

/** Returns well-formed results, or null for any other shape. */
function parseResults(raw: unknown, message: string): SyncResults | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const errors = r['errors']
  if (
    !Array.isArray(errors) ||
    !errors.every((e): e is string => typeof e === 'string')
  )
    return null
  const added = num(r['added'])
  const updated = num(r['updated'])
  const removed = num(r['removed'])
  const skipped = num(r['skipped'])
  if (
    added === null ||
    updated === null ||
    removed === null ||
    skipped === null
  )
    return null
  return {
    message,
    added,
    updated,
    removed,
    skipped,
    errors: errors.map((e) =>
      e.length > MAX_ERROR_LENGTH ? `${e.slice(0, MAX_ERROR_LENGTH)}…` : e,
    ),
  }
}

/** POST /api/okta/sync (same-origin, no body). */
export async function syncOkta(): Promise<SyncApiResult> {
  const result = await post('/api/okta/sync')
  if (!result.ok) {
    const partial = result.envelope
      ? parseResults(result.envelope.results, result.message)
      : null
    return partial
      ? { ok: false, message: result.message, partial }
      : { ok: false, message: result.message }
  }
  const message =
    typeof result.data.message === 'string' && result.data.message !== ''
      ? result.data.message
      : 'Sync completed.'
  const data = parseResults(result.data.results, message)
  if (data === null) {
    return {
      ok: false,
      message:
        'The sync response had an unexpected format. Reload to check the current directory data before retrying.',
    }
  }
  return { ok: true, data }
}
