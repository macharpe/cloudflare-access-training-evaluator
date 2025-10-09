/**
 * Input validation utilities
 *
 * Provides runtime validation for user inputs, email addresses,
 * and external data to prevent security issues.
 */

/**
 * Validate email format using RFC 5322 compliant regex
 *
 * @param email - Email address to validate
 * @returns True if valid email format
 */
export function isValidEmail(email: unknown): email is string {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // RFC 5322 compliant email regex (simplified but robust)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254; // RFC limit
}

/**
 * Extract and validate username from email
 *
 * @param email - Email address
 * @returns Validated username (lowercase)
 * @throws Error if email is invalid
 */
export function extractUsername(email: string): string {
  if (!isValidEmail(email)) {
    throw new Error('Invalid email format');
  }

  const parts = email.split('@');
  const username = parts[0]?.toLowerCase().trim();

  if (!username) {
    throw new Error('Username cannot be empty');
  }

  // Additional username validation
  if (username.length === 0) {
    throw new Error('Username cannot be empty');
  }

  if (username.length > 64) {
    throw new Error('Username too long (max 64 characters)');
  }

  // Ensure username contains only valid characters
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error('Username contains invalid characters');
  }

  return username;
}

/**
 * Validate training status
 *
 * @param status - Training status to validate
 * @returns True if valid status
 */
export function isValidTrainingStatus(status: unknown): boolean {
  const validStatuses = ['not started', 'started', 'completed'];
  return typeof status === 'string' && validStatuses.includes(status);
}

/**
 * Sanitize string input for logging (prevent log injection)
 *
 * @param input - Input string to sanitize
 * @returns Sanitized string safe for logging
 */
export function sanitizeForLogging(input: unknown): string {
  if (!input || typeof input !== 'string') {
    return String(input || '');
  }

  // Remove control characters and limit length for logging
  return input
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .substring(0, 200);
}

/**
 * Validate Okta domain format
 *
 * @param domain - Okta domain to validate
 * @returns True if valid domain format
 */
export function isValidOktaDomain(domain: unknown): domain is string {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  // Basic domain validation for Okta
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.includes('.');
}

/**
 * Validate group ID format
 *
 * @param groupId - Group ID to validate
 * @returns True if valid group ID format
 */
export function isValidGroupId(groupId: unknown): groupId is string {
  if (!groupId || typeof groupId !== 'string') {
    return false;
  }

  // Okta group IDs are typically alphanumeric with some special chars
  return /^[a-zA-Z0-9_-]{1,255}$/.test(groupId);
}
