import { it } from 'vitest'

/**
 * Marks a test that documents a CURRENTLY KNOWN gap in the source (a security
 * property the project guidance says must hold, but which the code at the time
 * of writing does not enforce). `it.fails` keeps the suite green while the gap
 * exists and turns RED ("expected to fail but passed") the moment the gap is
 * fixed, which is the cue to change `knownGap(` to `it(` for that test.
 *
 * Run `SHOW_GAPS=1 npx vitest run` to execute them as normal tests and read
 * the real assertion failures.
 */
export const knownGap = process.env['SHOW_GAPS'] ? it : it.fails
