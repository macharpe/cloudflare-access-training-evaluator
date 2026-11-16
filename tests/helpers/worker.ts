import worker from '../../src/index'
import type { Env } from '../../src/types'

export function call(env: Env, path: string, init: RequestInit = {}, base = 'https://admin.example.com') {
  return worker.fetch(new Request(`${base}${path}`, init), env, {} as ExecutionContext)
}

export async function json(res: Response): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = await res.json()
  return body
}

export function postJson(body: unknown, headers: Headers | Record<string, string> = {}): RequestInit {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) }
}
