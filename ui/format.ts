const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function relativeTime(ms: number | null, now: number): string {
  if (ms === null) return 'Unknown'
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour')
  if (minutes < 60 * 24 * 30)
    return rtf.format(-Math.round(minutes / (60 * 24)), 'day')
  return rtf.format(-Math.round(minutes / (60 * 24 * 30)), 'month')
}

export function absoluteTime(ms: number | null): string {
  if (ms === null) return 'Unknown'
  return new Date(ms).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => Array.from(p)[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return letters || '?'
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Run `worker` over `items` with at most `limit` in flight. */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await worker(items[i] as T)
      }
    },
  )
  await Promise.all(lanes)
  return results
}
