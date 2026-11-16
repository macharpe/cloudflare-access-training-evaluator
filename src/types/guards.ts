/**
 * Type Guards for Runtime Type Validation
 *
 * These functions provide runtime type checking to ensure
 * data conforms to expected TypeScript types.
 */

import type { TrainingStatus } from './index'

/** The only valid training statuses. `completed` is the only one granting access. */
export const TRAINING_STATUSES: readonly TrainingStatus[] = [
  'not started',
  'started',
  'completed',
]

/**
 * Type guard to check if value is a valid TrainingStatus
 *
 * @param value - Value to check
 * @returns True if value is a valid training status
 */
export function isTrainingStatus(value: unknown): value is TrainingStatus {
  return (
    typeof value === 'string' &&
    (TRAINING_STATUSES as readonly string[]).includes(value)
  )
}
