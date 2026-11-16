import { isStatus, type Bootstrap, type TrainingUser } from './types'

/** D1 CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC. */
function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Read the server-injected JSON. Any parse/shape failure is surfaced as an
 * explicit load error instead of an empty (apparently successful) list.
 */
export function readBootstrap(
  source: {
    getElementById(id: string): Pick<HTMLElement, 'textContent'> | null
  } = document,
): Bootstrap {
  const el = source.getElementById('training-data')
  if (!el?.textContent) {
    return { users: [], loadError: 'Dashboard data was missing from the page.' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(el.textContent)
  } catch {
    return { users: [], loadError: 'Dashboard data could not be parsed.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { users: [], loadError: 'Dashboard data had an unexpected shape.' }
  }
  const obj = raw as Record<string, unknown>
  const loadError =
    typeof obj['loadError'] === 'string' ? obj['loadError'] : null
  const rows = Array.isArray(obj['users']) ? (obj['users'] as unknown[]) : null
  if (rows === null) {
    return {
      users: [],
      loadError: loadError ?? 'Dashboard data had an unexpected shape.',
    }
  }
  const users: TrainingUser[] = []
  let invalidRows = false
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      invalidRows = true
      continue
    }
    const r = row as Record<string, unknown>
    const idRaw = r['id']
    if (typeof idRaw !== 'number' && typeof idRaw !== 'string') {
      invalidRows = true
      continue
    }
    if (!isStatus(r['training_status'])) invalidRows = true
    const email = str(r['primary_email'])
    users.push({
      id: String(idRaw),
      name:
        str(r['first_name']) ??
        str(r['username']) ??
        email ??
        `User ${String(idRaw)}`,
      email,
      // Unknown values are treated as the safe (denied) state.
      status: isStatus(r['training_status'])
        ? r['training_status']
        : 'not started',
      updatedMs: parseTimestamp(r['updated_at']),
    })
  }
  return {
    users,
    loadError:
      loadError ??
      (invalidRows ? 'Some user records had an unexpected format.' : null),
  }
}
