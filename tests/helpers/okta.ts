import { vi } from 'vitest'
import { TEST_OKTA_DOMAIN } from './env'
import type { TestKey } from './jwt'
import { jwksFetch } from './jwt'

/** URL string of a fetch() first argument (string, URL or Request). */
export function fetchUrl(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  throw new Error('unexpected fetch input in test')
}

export const OKTA_BASE = `https://${TEST_OKTA_DOMAIN}`

export function oktaUser(login: string, firstName = 'First', extra: Record<string, unknown> = {}) {
  return {
    id: `id-${login}`,
    status: 'ACTIVE',
    created: '2024-01-01T00:00:00.000Z',
    lastLogin: null,
    profile: { login, firstName, lastName: 'Last', email: login },
    ...extra,
  }
}

export function jsonResponse(
  body: unknown,
  opts: { status?: number; link?: string | string[] } = {},
): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  const links = Array.isArray(opts.link) ? opts.link : opts.link ? [opts.link] : []
  for (const l of links) headers.append('link', l)
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    statusText: opts.status && opts.status >= 400 ? 'Error' : 'OK',
    headers,
  })
}

export function nextLink(url: string): string {
  return `<${url}>; rel="next"`
}

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>

/**
 * Install a global fetch stub. Any call not matched by the handler throws, so a
 * test fails loudly if the Worker contacts an unexpected host.
 */
export function stubFetch(handler: FetchHandler, jwksKeys: TestKey[] = []) {
  const jwks = jwksFetch(jwksKeys)
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/cdn-cgi/access/certs')) return jwks(input, init)
    return handler(url, init)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

export function oktaCalls(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(
    ([u]) => !fetchUrl(u).endsWith('/cdn-cgi/access/certs'),
  )
}
