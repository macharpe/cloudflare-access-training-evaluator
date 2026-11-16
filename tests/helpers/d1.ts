/**
 * Minimal in-memory D1 fake backed by Node's built-in SQLite.
 *
 * It executes the Worker's real SQL, so queries, constraints (CHECK, UNIQUE)
 * and parameter binding are exercised for real instead of being mocked away.
 */
import { DatabaseSync } from 'node:sqlite'

export interface RecordedCall {
  sql: string
  params: unknown[]
}

export type FailureRule = (call: RecordedCall) => Error | undefined

export const USERS_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    first_name TEXT,
    primary_email TEXT,
    training_status TEXT NOT NULL CHECK (training_status IN ('not started', 'started', 'completed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`

export class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:')
  readonly calls: RecordedCall[] = []
  /** One entry per `batch()` call, holding the statements it was given. */
  readonly batches: RecordedCall[][] = []
  private failures: FailureRule[] = []

  /** Create the final users schema (mirrors the applied migrations). */
  withSchema(): this {
    this.sqlite.exec(USERS_SCHEMA)
    return this
  }

  /** Inject a failure for statements matching the rule. */
  failWhen(rule: FailureRule): void {
    this.failures.push(rule)
  }

  clearFailures(): void {
    this.failures = []
  }

  /** Statements executed so far that match a regexp. */
  callsMatching(re: RegExp): RecordedCall[] {
    return this.calls.filter((c) => re.test(c.sql))
  }

  seed(
    username: string,
    status: 'not started' | 'started' | 'completed' = 'not started',
    firstName: string | null = null,
    email: string | null = `${username}@example.com`,
  ): void {
    this.sqlite
      .prepare(
        'INSERT INTO users (username, first_name, primary_email, training_status) VALUES (?, ?, ?, ?)',
      )
      .run(username, firstName, email, status)
  }

  rows(): Array<Record<string, unknown>> {
    return this.sqlite
      .prepare('SELECT * FROM users ORDER BY username')
      .all()
      .map((r) => ({ ...r }))
  }

  status(username: string): string | null {
    const row = this.sqlite
      .prepare('SELECT training_status FROM users WHERE username = ?')
      .get(username) as { training_status: string } | undefined
    return row ? row.training_status : null
  }

  prepare(sql: string): TestStatement {
    return new TestStatement(this, sql, [])
  }

  /**
   * D1 `batch()`: runs the statements in order inside ONE transaction.
   * Any failing statement (SQL error or injected failure) rolls back the whole
   * batch, so no partial writes persist — matching D1's documented semantics.
   */
  async batch(statements: TestStatement[]) {
    this.batches.push(statements.map((s) => s.recorded()))
    this.sqlite.exec('BEGIN')
    try {
      const results = statements.map((s) => s.runSync())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  /** @internal */
  execute(sql: string, params: unknown[]): RecordedCall {
    const call = { sql, params }
    this.calls.push(call)
    for (const rule of this.failures) {
      const err = rule(call)
      if (err) throw err
    }
    return call
  }
}

export class TestStatement {
  constructor(
    private readonly db: TestD1,
    private readonly sql: string,
    private readonly params: unknown[],
  ) {}

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, params)
  }

  /** @internal SQL + params as recorded for assertions. */
  recorded(): RecordedCall {
    return { sql: this.sql, params: this.params }
  }

  /** @internal Synchronous execution used by `TestD1.batch`. */
  runSync() {
    this.db.execute(this.sql, this.params)
    if (/^\s*SELECT/i.test(this.sql)) {
      const rows = this.db.sqlite
        .prepare(this.sql)
        .all(...(this.params as never[]))
        .map((r) => ({ ...r }))
      return { success: true, results: rows, meta: { changes: 0 } }
    }
    const info = this.db.sqlite
      .prepare(this.sql)
      .run(...(this.params as never[]))
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    }
  }

  async run() {
    this.db.execute(this.sql, this.params)
    const info = this.db.sqlite
      .prepare(this.sql)
      .run(...(this.params as never[]))
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.db.execute(this.sql, this.params)
    const row = this.db.sqlite.prepare(this.sql).get(...(this.params as never[]))
    return row ? ({ ...row } as T) : null
  }

  async all<T = Record<string, unknown>>() {
    this.db.execute(this.sql, this.params)
    const rows = this.db.sqlite
      .prepare(this.sql)
      .all(...(this.params as never[]))
      .map((r) => ({ ...r }) as T)
    return { success: true, results: rows, meta: { changes: 0 } }
  }
}
