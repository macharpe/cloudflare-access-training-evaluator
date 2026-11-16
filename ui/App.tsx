import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Meter } from '@cloudflare/kumo/components/meter'
import { Pagination } from '@cloudflare/kumo/components/pagination'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import { Text } from '@cloudflare/kumo/components/text'
import { Toasty, useKumoToastManager } from '@cloudflare/kumo/components/toast'
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise'
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/csr/ArrowsDownUp'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CircleDashedIcon } from '@phosphor-icons/react/dist/csr/CircleDashed'
import { CircleHalfIcon } from '@phosphor-icons/react/dist/csr/CircleHalf'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon'
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck'
import { ShieldSlashIcon } from '@phosphor-icons/react/dist/csr/ShieldSlash'
import { SunIcon } from '@phosphor-icons/react/dist/csr/Sun'
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users'
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { syncOkta, updateTraining, type SyncResults } from './api'
import { readBootstrap } from './bootstrap'
import { absoluteTime, initials, plural, relativeTime, runPool } from './format'
import {
  STATUS_LABEL,
  STATUS_ORDER,
  hasAccess,
  type Bootstrap,
  type Status,
  type TrainingUser,
} from './types'

const PAGE_SIZE = 8
const BULK_CONCURRENCY = 4

const STATUS_ITEMS: Record<Status, string> = STATUS_LABEL

const STATUS_DOT: Record<Status, string> = {
  completed: 'bg-kumo-success',
  started: 'bg-kumo-warning',
  'not started': 'bg-kumo-danger',
}

type SortKey = 'name' | 'email' | 'status' | 'access' | 'updated'
type SortDir = 'asc' | 'desc'
type Filter = 'all' | Status

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

type Mode = 'light' | 'dark'

function getInitialMode(): Mode {
  const attr = document.documentElement.getAttribute('data-mode')
  if (attr === 'dark' || attr === 'light') return attr
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(getInitialMode)

  useEffect(() => {
    document.documentElement.setAttribute('data-mode', mode)
    try {
      localStorage.setItem('ui-mode', mode)
    } catch {
      /* storage unavailable */
    }
  }, [mode])

  const next = mode === 'dark' ? 'light' : 'dark'
  return (
    <Button
      variant="secondary"
      size="sm"
      shape="square"
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next} theme`}
      data-testid="theme-toggle"
      icon={mode === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

function CloudflareMark() {
  return (
    <svg
      width="32"
      height="22"
      viewBox="0 0 256 116"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Cloudflare"
    >
      <path
        d="M176.332 108.348c1.593-5.311 1.062-10.622-1.593-13.809-2.656-3.187-6.374-5.311-11.154-5.842L71.17 87.634c-.531 0-1.062-.531-1.593-.531-.531-.531-.531-1.062 0-1.593.531-1.062 1.062-1.594 2.124-1.594l92.946-1.062c11.154-.531 22.839-9.56 27.087-20.182l5.312-13.809c0-.531.531-1.062 0-1.593C191.203 20.182 166.772 0 138.091 0 111.535 0 88.697 16.996 80.73 40.897c-5.311-3.718-11.684-5.843-19.12-5.311-12.747 1.062-22.838 11.684-24.432 24.431-.531 3.187 0 6.374.532 9.56C16.996 70.108 0 87.103 0 108.348c0 2.124 0 3.718.531 5.842.531 1.063 1.593 1.594 2.125 1.594h172.083c1.062 0 2.125-.531 2.125-1.594l1.468-5.842z"
        fill="#F4811F"
      />
      <path
        d="M205.544 48.863h-2.656c-.531 0-1.062.531-1.593 1.062l-3.718 12.747c-1.593 5.311-1.062 10.622 1.594 13.809 2.656 3.187 6.374 5.311 11.154 5.842l19.652 1.062c.531 0 1.062.531 1.593.531.531.531.531 1.062 0 1.593-.531 1.062-1.062 1.593-2.124 1.593l-20.182 1.062c-11.154.531-22.839 9.56-27.087 20.182l-1.063 4.781c-.531.531 0 1.593 1.063 1.593h70.107c1.062 0 1.593-.531 1.593-1.593 1.062-4.249 2.124-9.029 2.124-13.81C256 72.232 233.162 48.863 205.544 48.863z"
        fill="#FAAD3F"
      />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function StatCard(props: {
  label: string
  value: number
  total: number
  icon: ReactNode
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  testId: string
  caption?: string
}) {
  const { label, value, total, icon, tone, testId, caption } = props
  const toneBg = {
    neutral: 'bg-kumo-tint text-kumo-strong',
    success: 'bg-kumo-success-tint text-kumo-success',
    warning: 'bg-kumo-warning-tint text-kumo-warning',
    danger: 'bg-kumo-danger-tint text-kumo-danger',
  }[tone]
  const pct = total === 0 ? 0 : Math.round((value / total) * 100)
  const fill = {
    neutral: 'fill-kumo-contrast',
    success: 'fill-kumo-success',
    warning: 'fill-kumo-warning',
    danger: 'fill-kumo-danger',
  }[tone]
  return (
    <div
      className="flex flex-col gap-4 rounded-xl bg-kumo-base p-5 ring ring-kumo-hairline"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Text variant="secondary" size="sm">
            {label}
          </Text>
          <span
            className="text-3xl font-semibold tabular-nums tracking-tight text-kumo-default"
            data-testid={`${testId}-value`}
          >
            {value}
          </span>
        </div>
        <span
          className={`flex size-9 items-center justify-center rounded-full ${toneBg}`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {/* SVG dimensions preserve the prototype's bar without CSP-blocked style attributes. */}
        <svg
          className="h-1.5 w-full overflow-hidden rounded-full bg-kumo-tint"
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect width={pct} height={6} className={fill} />
        </svg>
        <Text variant="secondary" size="xs">
          {caption ?? `${pct}% of all users`}
        </Text>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pending change dialog                                               */
/* ------------------------------------------------------------------ */

interface Target {
  id: string
  name: string
  email: string
  from: Status
}

interface PendingChange {
  status: Status
  source: 'row' | 'bulk'
  /** Snapshot taken when the dialog opened; only users whose status would change. */
  targets: Target[]
}

function ConfirmChangeDialog(props: {
  pending: PendingChange | null
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { pending, submitting, onCancel, onConfirm } = props
  const info = useMemo(() => {
    if (!pending) return null
    const willGrant = pending.targets.filter(
      (t) => !hasAccess(t.from) && hasAccess(pending.status),
    )
    const willRevoke = pending.targets.filter(
      (t) => hasAccess(t.from) && !hasAccess(pending.status),
    )
    return { willGrant, willRevoke }
  }, [pending])

  const nextGranted = pending ? hasAccess(pending.status) : false

  return (
    <Dialog.Root
      open={pending !== null}
      onOpenChange={(o) => {
        if (!o && !submitting) onCancel()
      }}
      role="alertdialog"
    >
      <Dialog size="lg" className="p-6" data-testid="confirm-dialog">
        {pending && info && (
          <>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-kumo-warning-tint text-kumo-warning"
                  aria-hidden="true"
                >
                  <WarningIcon size={20} weight="fill" />
                </span>
                <Dialog.Title
                  className="text-xl font-semibold"
                  data-testid="dialog-title"
                >
                  {pending.source === 'bulk'
                    ? `Change training status for ${plural(pending.targets.length, 'user', 'users')}?`
                    : `Change training status for ${pending.targets[0]?.name ?? 'this user'}?`}
                </Dialog.Title>
              </div>
              <Dialog.Close
                aria-label="Close"
                render={(p) => (
                  <Button
                    {...p}
                    variant="ghost"
                    shape="square"
                    size="sm"
                    disabled={submitting}
                    icon={<XIcon size={16} />}
                    aria-label="Close"
                  />
                )}
              />
            </div>

            <Dialog.Description className="text-kumo-strong">
              Status will be set to{' '}
              <strong className="font-semibold text-kumo-default">
                {STATUS_LABEL[pending.status]}
              </strong>
              . Access is granted only to users whose training is{' '}
              <strong className="font-semibold text-kumo-default">
                Completed
              </strong>
              ; every other status is denied.
            </Dialog.Description>

            <div className="mt-4">
              <Banner
                size="sm"
                variant={info.willRevoke.length > 0 ? 'error' : 'alert'}
                icon={
                  nextGranted ? (
                    <ShieldCheckIcon weight="fill" />
                  ) : (
                    <ShieldSlashIcon weight="fill" />
                  )
                }
                title="Access changes"
                className="text-kumo-strong"
                description={[
                  info.willGrant.length > 0
                    ? `${info.willGrant.length} will be granted access`
                    : null,
                  info.willRevoke.length > 0
                    ? `${info.willRevoke.length} will lose access`
                    : null,
                  info.willGrant.length === 0 && info.willRevoke.length === 0
                    ? 'No access change (access stays denied)'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </div>

            <ul
              className="mt-4 divide-y divide-kumo-hairline rounded-lg bg-kumo-recessed ring ring-kumo-hairline"
              aria-label="Affected users"
            >
              {pending.targets.slice(0, 5).map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="min-w-0 truncate text-kumo-default">
                    {t.name}
                  </span>
                  <span className="shrink-0 text-kumo-strong">
                    {STATUS_LABEL[t.from]} → {STATUS_LABEL[pending.status]}
                    <span className="ml-2">
                      ({hasAccess(t.from) ? 'Granted' : 'Denied'} →{' '}
                      {nextGranted ? 'Granted' : 'Denied'})
                    </span>
                  </span>
                </li>
              ))}
              {pending.targets.length > 5 && (
                <li className="px-3 py-2 text-sm text-kumo-subtle">
                  + {pending.targets.length - 5} more
                </li>
              )}
            </ul>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <Dialog.Close
                render={(p) => (
                  <Button
                    {...p}
                    variant="secondary"
                    disabled={submitting}
                    data-testid="dialog-cancel"
                  >
                    Cancel
                  </Button>
                )}
              />
              <Button
                variant={info.willRevoke.length > 0 ? 'destructive' : 'primary'}
                loading={submitting}
                onClick={onConfirm}
                data-testid="dialog-confirm"
              >
                {submitting
                  ? 'Applying…'
                  : `Apply to ${plural(pending.targets.length, 'user', 'users')}`}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </Dialog.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Sortable header                                                     */
/* ------------------------------------------------------------------ */

function SortHead(props: {
  label: string
  column: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
}) {
  const { label, column, sortKey, sortDir, onSort } = props
  const active = sortKey === column
  const Icon = !active
    ? ArrowsDownUpIcon
    : sortDir === 'asc'
      ? CaretUpIcon
      : CaretDownIcon
  return (
    <Table.Head
      aria-sort={
        active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        data-testid={`sort-${column}`}
        className="-mx-1 inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left font-medium text-inherit outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
      >
        {label}
        <Icon
          size={12}
          weight={active ? 'bold' : 'regular'}
          className={active ? 'text-kumo-default' : 'text-kumo-inactive'}
          aria-hidden="true"
        />
      </button>
    </Table.Head>
  )
}

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

function summarizeSync(r: SyncResults): string {
  const parts = [
    r.added !== null ? `${r.added} added` : null,
    r.updated !== null ? `${r.updated} updated` : null,
    r.removed !== null ? `${r.removed} removed` : null,
    r.skipped !== null ? `${r.skipped} skipped` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `${parts.join(' · ')}. ` : ''
}

interface Notice {
  variant: 'default' | 'alert' | 'error'
  title: string
  description: string
  details?: string[]
  reload?: boolean
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function Dashboard({ bootstrap }: { bootstrap: Bootstrap }) {
  const toast = useKumoToastManager()
  const [users, setUsers] = useState<TrainingUser[]>(bootstrap.users)
  const [loadError, setLoadError] = useState<string | null>(bootstrap.loadError)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<Status | null>(null)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const counts = useMemo(() => {
    const c = { all: users.length, completed: 0, started: 0, 'not started': 0 }
    for (const u of users) c[u.status] += 1
    return c
  }, [users])

  const completionPct =
    counts.all === 0 ? 0 : Math.round((counts.completed / counts.all) * 100)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = users.filter(
      (u) =>
        (filter === 'all' || u.status === filter) &&
        (q === '' ||
          u.name.toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q)),
    )
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: TrainingUser, b: TrainingUser): number => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'email':
          return (a.email ?? '').localeCompare(b.email ?? '')
        case 'status':
          return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        case 'access':
          return Number(hasAccess(a.status)) - Number(hasAccess(b.status))
        case 'updated':
          return (a.updatedMs ?? 0) - (b.updatedMs ?? 0)
      }
    }
    return [...rows].sort(
      (a, b) =>
        dir * cmp(a, b) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
  }, [users, filter, query, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  // A bulk change must only ever touch rows the admin can currently see.
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(filtered.map((u) => u.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  useEffect(() => {
    setAnnouncement(`${plural(filtered.length, 'user', 'users')} shown`)
  }, [filtered.length])

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('asc')
    }
    setPage(1)
  }

  // Rows without an email cannot be addressed by the update API.
  const selectableIds = pageRows
    .filter((u) => u.email !== null)
    .map((u) => u.id)
  const selectedOnPage = selectableIds.filter((id) => selected.has(id)).length
  const allOnPage =
    selectableIds.length > 0 && selectedOnPage === selectableIds.length

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const togglePage = () =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (allOnPage) selectableIds.forEach((id) => n.delete(id))
      else selectableIds.forEach((id) => n.add(id))
      return n
    })

  const buildTargets = (ids: string[], status: Status): Target[] => {
    const wanted = new Set(ids)
    const out: Target[] = []
    for (const u of users) {
      if (wanted.has(u.id) && u.email !== null && u.status !== status) {
        out.push({ id: u.id, name: u.name, email: u.email, from: u.status })
      }
    }
    return out
  }

  const confirm = useCallback(async () => {
    if (!pending || submitting) return
    const { status, source, targets } = pending
    setSubmitting(true)
    setNotice(null)
    try {
      const outcomes = await runPool(targets, BULK_CONCURRENCY, async (t) => ({
        t,
        res: await updateTraining(t.email, status),
      }))
      const ok = outcomes.filter((o) => o.res.ok).map((o) => o.t)
      const failed = outcomes.flatMap((o) =>
        o.res.ok ? [] : [{ t: o.t, message: o.res.message }],
      )

      if (ok.length > 0) {
        const okIds = new Set(ok.map((t) => t.id))
        const stamp = Date.now()
        setUsers((prev) =>
          prev.map((u) =>
            okIds.has(u.id) ? { ...u, status, updatedMs: stamp } : u,
          ),
        )
        setNow(stamp)
        // Only successfully changed users leave the selection; failures stay selected for a retry.
        if (source === 'bulk') {
          setSelected(
            (prev) => new Set([...prev].filter((id) => !okIds.has(id))),
          )
        }
      }
      if (source === 'bulk' && failed.length === 0) setBulkStatus(null)

      const label = STATUS_LABEL[status]
      const access = hasAccess(status) ? 'Access granted' : 'Access denied'
      if (failed.length === 0) {
        toast.add({
          title: 'Training status updated',
          description: `${plural(ok.length, 'user', 'users')} set to ${label}. ${access}.`,
          variant: 'success',
          timeout: 5000,
        })
      } else {
        const details = failed.map((f) => `${f.t.name}: ${f.message}`)
        setNotice({
          variant: 'error',
          title:
            ok.length > 0
              ? `Partially applied: ${ok.length} updated, ${failed.length} failed`
              : `Update failed for ${plural(failed.length, 'user', 'users')}`,
          description:
            ok.length > 0
              ? `${plural(ok.length, 'user', 'users')} set to ${label}. The ${plural(failed.length, 'user', 'users')} below kept their previous status${source === 'bulk' ? ' and stay selected so you can retry' : ''}.`
              : 'No changes were saved. Statuses are unchanged.',
          details,
        })
        toast.add({
          title: ok.length > 0 ? 'Some updates failed' : 'Update failed',
          description: details[0] ?? 'Request failed.',
          variant: 'error',
          timeout: 8000,
        })
      }
    } finally {
      setSubmitting(false)
      setPending(null)
    }
  }, [pending, submitting, toast])

  // The authenticated HTML is the source of directory data (there is no
  // separate users API). Refresh it in-place so a partial-sync notice is not
  // lost in a full page navigation. Never execute scripts from the response.
  const reloadDirectory = async () => {
    try {
      const response = await fetch(window.location.href, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Directory reload failed')
      // Extract only the inert bootstrap JSON. Parsing the full document with
      // DOMParser would also process its newly-nonced <style> under the current
      // page's CSP. Never insert returned HTML into the live document.
      const html = await response.text()
      const json = html.match(
        /<script\b[^>]*\bid=["']training-data["'][^>]*>([\s\S]*?)<\/script\s*>/i,
      )?.[1]
      const fresh = readBootstrap({
        getElementById: () =>
          json === undefined ? null : { textContent: json },
      })
      if (fresh.loadError !== null) {
        setLoadError(fresh.loadError)
        return false
      }
      setUsers(fresh.users)
      setLoadError(null)
      setSelected(new Set())
      return true
    } catch {
      setLoadError(
        'The latest directory data could not be loaded after syncing.',
      )
      return false
    }
  }

  const runSync = async () => {
    setSyncing(true)
    setNotice(null)
    try {
      const res = await syncOkta()
      if (!res.ok) {
        if (res.partial) {
          // Some changes may have been applied before the failure. Refresh
          // directory data exactly as on success, retaining the error notice.
          const p = res.partial
          const refreshed = await reloadDirectory()
          setNotice({
            variant: 'error',
            title: 'Okta sync partially failed',
            description: `${summarizeSync(p)}Some changes may have been applied. ${refreshed ? 'The directory data has been refreshed.' : 'Reload to try loading the latest directory data.'}`,
            details: p.errors,
            reload: true,
          })
          toast.add({
            title: 'Sync partially failed',
            description: res.message,
            variant: 'error',
            timeout: 8000,
          })
          return
        }
        setNotice({
          variant: 'error',
          title: 'Okta sync failed',
          description: res.message,
        })
        toast.add({
          title: 'Okta sync failed',
          description: res.message,
          variant: 'error',
          timeout: 8000,
        })
        return
      }
      const r = res.data
      const refreshed = await reloadDirectory()
      const hasErrors = r.errors.length > 0
      setNotice({
        variant: hasErrors ? 'alert' : 'default',
        title: hasErrors
          ? 'Okta sync completed with errors'
          : 'Okta sync completed',
        description: `${summarizeSync(r)}${refreshed ? 'The directory data has been refreshed.' : 'Reload to try loading the latest directory data.'}`,
        details: r.errors,
        reload: true,
      })
      toast.add({
        title: hasErrors ? 'Sync completed with errors' : 'Sync completed',
        description: r.message,
        variant: hasErrors ? 'warning' : 'success',
        timeout: 6000,
      })
    } finally {
      setSyncing(false)
    }
  }

  const bulkChanging = bulkStatus
    ? buildTargets([...selected], bulkStatus).length
    : 0

  const tabs = [
    { value: 'all', label: `All ${counts.all}` },
    { value: 'completed', label: `Completed ${counts.completed}` },
    { value: 'started', label: `In progress ${counts.started}` },
    { value: 'not started', label: `Not started ${counts['not started']}` },
  ]

  const showLoadError = loadError !== null

  return (
    <div className="min-h-screen bg-kumo-canvas text-kumo-default">
      <header className="border-b border-kumo-hairline bg-kumo-base">
        <div className="mx-auto flex h-12 max-w-[88rem] items-center justify-between gap-3 px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <CloudflareMark />
            <span className="text-sm font-semibold tracking-tight text-kumo-default">
              Cloudflare Access
            </span>
            <span className="hidden text-sm text-kumo-subtle sm:inline">
              Training Completion Status
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-[88rem] px-4 pb-16 sm:px-8">
        <section className="flex flex-col gap-6 pb-10 pt-12 sm:flex-row sm:items-end sm:justify-between sm:pb-12 sm:pt-16">
          <div className="flex max-w-2xl flex-col gap-3">
            <Text variant="heading1" as="h1" data-testid="page-title">
              Training dashboard
            </Text>
            <Text variant="secondary" size="lg" as="p">
              Track Access training progress for everyone synced from Okta.
              Access is granted only once training is completed.
            </Text>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Button
              variant="primary"
              onClick={() => {
                void runSync()
              }}
              disabled={submitting || pending !== null}
              loading={syncing}
              icon={<ArrowsClockwiseIcon size={16} />}
              data-testid="sync-button"
            >
              {syncing ? 'Syncing…' : 'Sync from Okta'}
            </Button>
            <Text variant="secondary" size="xs" as="p" data-testid="sync-meta">
              Imports users from your Okta directory.
            </Text>
          </div>
        </section>

        <div className="flex flex-col gap-3 pb-6" aria-live="polite">
          {showLoadError && (
            <Banner
              variant="error"
              icon={<WarningIcon weight="fill" />}
              title="Users could not be loaded"
              description={`${loadError ?? ''} The figures below are not reliable. Reload the page to try again.`}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </Button>
              }
            />
          )}
          {notice && (
            <div data-testid="notice">
              <Banner
                variant={notice.variant}
                icon={
                  notice.variant === 'default' ? (
                    <CheckCircleIcon weight="fill" />
                  ) : (
                    <WarningIcon weight="fill" />
                  )
                }
                title={notice.title}
                description={
                  <>
                    {notice.description}
                    {notice.details && notice.details.length > 0 && (
                      <ul className="mt-2 list-disc pl-5">
                        {notice.details.slice(0, 8).map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                        {notice.details.length > 8 && (
                          <li>+ {notice.details.length - 8} more</li>
                        )}
                      </ul>
                    )}
                  </>
                }
                action={
                  <div className="flex gap-2">
                    {notice.reload && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => window.location.reload()}
                      >
                        Reload
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setNotice(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                }
              />
            </div>
          )}
        </div>

        <section
          aria-label="Training summary"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
        >
          <StatCard
            label="Total users"
            value={counts.all}
            total={counts.all}
            tone="neutral"
            testId="stat-total"
            icon={<UsersIcon size={18} weight="bold" />}
            caption="In the training database"
          />
          <StatCard
            label="Completed"
            value={counts.completed}
            total={counts.all}
            tone="success"
            testId="stat-completed"
            icon={<CheckCircleIcon size={18} weight="bold" />}
          />
          <StatCard
            label="In progress"
            value={counts.started}
            total={counts.all}
            tone="warning"
            testId="stat-started"
            icon={<CircleHalfIcon size={18} weight="bold" />}
          />
          <StatCard
            label="Not started"
            value={counts['not started']}
            total={counts.all}
            tone="danger"
            testId="stat-not-started"
            icon={<CircleDashedIcon size={18} weight="bold" />}
          />
        </section>

        <section
          className="mt-4 rounded-xl bg-kumo-base p-5 ring ring-kumo-hairline"
          data-testid="completion-meter"
        >
          <Meter
            label="Overall completion"
            value={completionPct}
            max={100}
            showValue
            customValue={`${counts.completed} of ${counts.all} users · ${completionPct}%`}
          />
        </section>

        <section
          className="mt-10 flex flex-col gap-4"
          aria-labelledby="users-heading"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-1">
              <Text variant="heading" size="lg" as="h2" id="users-heading">
                Users
              </Text>
              <Text variant="secondary" size="sm" as="p">
                Changing a status asks for confirmation because it changes
                access.
              </Text>
            </div>
            <div className="w-full sm:w-72">
              <Input
                label="Search users"
                placeholder="Name or email"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                data-testid="search"
              />
            </div>
          </div>

          <div className="overflow-x-auto pb-1">
            <Tabs
              size="sm"
              variant="segmented"
              tabs={tabs.map((tab) => ({
                ...tab,
                className: 'text-kumo-strong',
              }))}
              value={filter}
              onValueChange={(v) => {
                setFilter(v as Filter)
                setPage(1)
              }}
            />
          </div>

          <div
            className="flex min-h-14 flex-col gap-3 rounded-xl bg-kumo-recessed px-4 py-3 ring ring-kumo-hairline sm:flex-row sm:items-center sm:justify-between"
            data-testid="bulk-bar"
          >
            <Text
              variant="body"
              size="sm"
              as="p"
              data-testid="selected-count"
              aria-live="polite"
            >
              {selected.size === 0
                ? 'Select users to change their training status in bulk.'
                : `${plural(selected.size, 'user', 'users')} selected`}
            </Text>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <Select
                  label="Set status to"
                  size="sm"
                  placeholder="Choose status"
                  disabled={selected.size === 0 || submitting || syncing}
                  value={bulkStatus}
                  onValueChange={(v) => setBulkStatus(v)}
                  items={STATUS_ITEMS}
                  data-testid="bulk-select"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={
                  selected.size === 0 ||
                  !bulkStatus ||
                  bulkChanging === 0 ||
                  submitting ||
                  syncing
                }
                onClick={() => {
                  if (!bulkStatus) return
                  const targets = buildTargets([...selected], bulkStatus)
                  if (targets.length > 0)
                    setPending({ status: bulkStatus, source: 'bulk', targets })
                }}
                data-testid="bulk-review"
              >
                Review change…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={selected.size === 0 || submitting || syncing}
                onClick={() => setSelected(new Set())}
                data-testid="bulk-clear"
              >
                Clear selection
              </Button>
            </div>
          </div>

          <LayerCard className="p-0">
            <div className="overflow-x-auto">
              <Table
                aria-label="Users and training status"
                className="min-w-[56rem]"
              >
                <Table.Header>
                  <Table.Row>
                    <Table.Head className="w-10">
                      <Checkbox
                        checked={allOnPage}
                        indeterminate={selectedOnPage > 0 && !allOnPage}
                        disabled={
                          selectableIds.length === 0 || submitting || syncing
                        }
                        onCheckedChange={togglePage}
                        aria-label="Select all users on this page"
                      />
                    </Table.Head>
                    <SortHead
                      label="User"
                      column="name"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSort}
                    />
                    <SortHead
                      label="Email"
                      column="email"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSort}
                    />
                    <SortHead
                      label="Training status"
                      column="status"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSort}
                    />
                    <SortHead
                      label="Access evaluation"
                      column="access"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSort}
                    />
                    <SortHead
                      label="Updated"
                      column="updated"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSort}
                    />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {pageRows.map((u) => {
                    const granted = hasAccess(u.status)
                    const editable = u.email !== null
                    return (
                      <Table.Row
                        key={u.id}
                        variant={selected.has(u.id) ? 'selected' : 'default'}
                        data-testid="user-row"
                        data-user={u.email ?? ''}
                      >
                        <Table.Cell className="w-10">
                          <Checkbox
                            checked={selected.has(u.id)}
                            disabled={!editable || submitting || syncing}
                            onCheckedChange={() => toggleRow(u.id)}
                            aria-label={`Select ${u.name}`}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex items-center gap-3">
                            <span
                              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kumo-tint text-xs font-semibold text-kumo-strong ring ring-kumo-hairline"
                              aria-hidden="true"
                            >
                              {initials(u.name)}
                            </span>
                            <span className="font-medium text-kumo-default">
                              {u.name}
                            </span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-kumo-strong">
                            {u.email ?? '—'}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="w-40">
                            <Select
                              aria-label={`Training status for ${u.name}`}
                              size="sm"
                              value={u.status}
                              disabled={!editable || submitting || syncing}
                              onValueChange={(v) => {
                                if (!v || v === u.status || u.email === null)
                                  return
                                const status = v
                                setPending({
                                  status,
                                  source: 'row',
                                  targets: [
                                    {
                                      id: u.id,
                                      name: u.name,
                                      email: u.email,
                                      from: u.status,
                                    },
                                  ],
                                })
                              }}
                              items={STATUS_ITEMS}
                              renderValue={(v: Status) => (
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className={`size-2 rounded-full ${STATUS_DOT[v]}`}
                                    aria-hidden="true"
                                  />
                                  {STATUS_LABEL[v]}
                                </span>
                              )}
                              data-testid="row-status"
                            />
                          </div>
                          {!editable && (
                            <Text variant="secondary" size="xs">
                              No email on record; cannot be updated.
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Badge
                            variant={granted ? 'success' : 'error'}
                            icon={
                              granted ? (
                                <ShieldCheckIcon weight="fill" />
                              ) : (
                                <ShieldSlashIcon weight="fill" />
                              )
                            }
                            data-testid="access-badge"
                          >
                            {granted ? 'Granted' : 'Denied'}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <time
                            className="whitespace-nowrap text-kumo-strong"
                            title={absoluteTime(u.updatedMs)}
                            {...(u.updatedMs !== null
                              ? {
                                  dateTime: new Date(u.updatedMs).toISOString(),
                                }
                              : {})}
                          >
                            {relativeTime(u.updatedMs, now)}
                          </time>
                        </Table.Cell>
                      </Table.Row>
                    )
                  })}
                </Table.Body>
              </Table>
            </div>
            {pageRows.length === 0 && (
              <Empty
                size="sm"
                icon={<MagnifyingGlassIcon size={32} />}
                title={users.length === 0 ? 'No users yet' : 'No users match'}
                description={
                  users.length === 0
                    ? showLoadError
                      ? 'Users could not be loaded.'
                      : 'Run “Sync from Okta” to import users.'
                    : 'Try a different name, email, or status filter.'
                }
                contents={
                  users.length > 0 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setQuery('')
                        setFilter('all')
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            )}
          </LayerCard>

          <div data-testid="pagination">
            <Pagination
              page={safePage}
              setPage={setPage}
              perPage={PAGE_SIZE}
              totalCount={filtered.length}
            />
          </div>
        </section>
      </main>

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="live-region"
      >
        {announcement}
      </p>

      <ConfirmChangeDialog
        pending={pending}
        submitting={submitting}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  )
}

export default function App({ bootstrap }: { bootstrap: Bootstrap }) {
  return (
    <Toasty>
      <Dashboard bootstrap={bootstrap} />
    </Toasty>
  )
}
