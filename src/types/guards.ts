/**
 * Type Guards for Runtime Type Validation
 *
 * These functions provide runtime type checking to ensure
 * data conforms to expected TypeScript types.
 */

import type { TrainingStatus, AccessClaims } from './index';

/**
 * Type guard to check if value is a valid TrainingStatus
 *
 * @param value - Value to check
 * @returns True if value is a valid training status
 */
export function isTrainingStatus(value: unknown): value is TrainingStatus {
  return (
    typeof value === 'string' &&
    ['not started', 'started', 'completed'].includes(value)
  );
}

/**
 * Type guard to check if object has AccessClaims shape
 *
 * @param value - Value to check
 * @returns True if value matches AccessClaims interface
 */
export function isAccessClaims(value: unknown): value is AccessClaims {
  if (typeof value !== 'object' || value === null) return false;

  const claims = value as Record<string, unknown>;

  return (
    typeof claims['email'] === 'string' &&
    typeof claims['exp'] === 'number' &&
    typeof claims['iat'] === 'number' &&
    typeof claims['nonce'] === 'string' &&
    typeof claims['identity'] === 'object' &&
    claims['identity'] !== null
  );
}

/**
 * Asserts that a value is non-null
 *
 * @param value - Value to check
 * @param message - Error message if assertion fails
 * @throws Error if value is null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message: string = 'Value is null or undefined'
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

/**
 * Type guard for checking if value is a string
 *
 * @param value - Value to check
 * @returns True if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for checking if value is a number
 *
 * @param value - Value to check
 * @returns True if value is a number and not NaN
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard for checking if value is a non-empty string
 *
 * @param value - Value to check
 * @returns True if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
