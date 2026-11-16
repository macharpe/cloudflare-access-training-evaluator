export type Status = 'not started' | 'started' | 'completed'

export interface TrainingUser {
  /** Stable row key (D1 integer id as string). */
  id: string
  name: string
  /** `null` when the directory record has no primary email. */
  email: string | null
  status: Status
  /** Epoch milliseconds, or `null` when the stored timestamp is unparsable. */
  updatedMs: number | null
}

export interface Bootstrap {
  users: TrainingUser[]
  /** Set when the initial load failed; an empty list is then NOT a success. */
  loadError: string | null
}

export const STATUS_LABEL: Record<Status, string> = {
  'not started': 'Not started',
  started: 'In progress',
  completed: 'Completed',
}

export const STATUS_ORDER: Record<Status, number> = {
  'not started': 0,
  started: 1,
  completed: 2,
}

/** Access evaluation rule: ONLY completed training grants access. */
export const hasAccess = (s: Status): boolean => s === 'completed'

export function isStatus(value: unknown): value is Status {
  return value === 'not started' || value === 'started' || value === 'completed'
}
