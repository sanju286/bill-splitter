import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiCall } from '../api'
import { formatCents, formatDateTime } from '../format'
import type { Balance, Bill, HomeDetails, Member } from '../types'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { homeId?: string } => {
    const homeId = search.homeId
    return typeof homeId === 'string' && homeId.length > 0 ? { homeId } : {}
  },
  component: Home,
})

function Home() {
  const { homeId } = Route.useSearch()
  if (homeId === undefined) {
    return <SetupPage />
  }
  return <HomePage homeId={homeId} />
}

// ---------------------------------------------------------------- setup ----

// Shown until a home is picked. Lets you create a home or open one you
// already created.
function SetupPage() {
  const navigate = Route.useNavigate()
  const [creating, setCreating] = useState(false)
  const [homeName, setHomeName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [openHomeId, setOpenHomeId] = useState('')

  async function createHome() {
    setCreating(true)
    setCreateError(null)
    const result = await apiCall<{ id: string }>('/api/homes', {
      method: 'POST',
      body: { name: homeName },
    })
    if (!result.ok) {
      setCreateError(result.message)
      setCreating(false)
      return
    }
    navigate({ to: '/', search: { homeId: result.data.id } })
  }

  return (
    <main style={styles.page}>
      <h1>Bill Splitter</h1>
      <p>Create a home for your flatmates, or open one you already made.</p>

      <form
        style={styles.card}
        onSubmit={(event) => {
          event.preventDefault()
          if (!creating) void createHome()
        }}
      >
        <h2 style={styles.h2}>New home</h2>
        <input
          style={styles.input}
          placeholder="Home name, e.g. Flat 4B"
          value={homeName}
          onChange={(event) => setHomeName(event.target.value)}
        />
        <button
          type="submit"
          style={styles.button}
          disabled={creating || homeName.trim().length === 0}
        >
          {creating ? 'Creating…' : 'Create home'}
        </button>
        {createError !== null && <p style={styles.error}>{createError}</p>}
      </form>

      <form
        style={styles.card}
        onSubmit={(event) => {
          event.preventDefault()
          const id = openHomeId.trim()
          if (id.length > 0) navigate({ to: '/', search: { homeId: id } })
        }}
      >
        <h2 style={styles.h2}>Open a home</h2>
        <input
          style={styles.input}
          placeholder="Home id"
          value={openHomeId}
          onChange={(event) => setOpenHomeId(event.target.value)}
        />
        <button type="submit" style={styles.button} disabled={openHomeId.trim().length === 0}>
          Open
        </button>
      </form>
    </main>
  )
}

// ------------------------------------------------------------ home page ----

type Load = 'loading' | 'ready' | 'error'

type HomeData = {
  home: HomeDetails
  members: Member[]
  bills: Bill[]
  balances: Balance[]
}

function HomePage({ homeId }: { homeId: string }) {
  const [load, setLoad] = useState<Load>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<HomeData | null>(null)

  // Per-share state, keyed by share id.
  const [paying, setPaying] = useState<Set<string>>(() => new Set())
  const [payErrors, setPayErrors] = useState<Record<string, string>>({})

  // Guards against an older request's response overwriting newer data when
  // the user switches homes quickly.
  const requestSeq = useRef(0)

  const refresh = useCallback(async (id: string) => {
    const seq = ++requestSeq.current
    setLoad('loading')
    setLoadError(null)

    const [homeResult, membersResult, billsResult, balancesResult] = await Promise.all([
      apiCall<HomeDetails>(`/api/homes/${encodeURIComponent(id)}`),
      apiCall<{ members: Member[] }>(`/api/homes/${encodeURIComponent(id)}/members`),
      apiCall<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(id)}/bills`),
      apiCall<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(id)}/balances`),
    ])

    if (seq !== requestSeq.current) return // a newer load took over

    if (!homeResult.ok) {
      setLoad('error')
      setLoadError(homeResult.message)
      return
    }
    if (!membersResult.ok || !billsResult.ok || !balancesResult.ok) {
      const failed = [membersResult, billsResult, balancesResult].find((result) => !result.ok)
      setLoad('error')
      setLoadError(failed && !failed.ok ? failed.message : null)
      return
    }
    setData({
      home: homeResult.data,
      members: membersResult.data.members,
      bills: billsResult.data.bills,
      balances: balancesResult.data.balances,
    })
    setLoad('ready')
  }, [])

  useEffect(() => {
    setPaying(new Set())
    setPayErrors({})
    setData(null)
    void refresh(homeId)
  }, [homeId, refresh])

  async function payShare(bill: Bill, shareId: string) {
    setPayErrors((errors) => {
      const next = { ...errors }
      delete next[shareId]
      return next
    })
    setPaying((ids) => new Set(ids).add(shareId))

    const result = await apiCall<{ paidAt: string }>(
      `/api/bills/${encodeURIComponent(bill.id)}/shares/${encodeURIComponent(shareId)}/pay`,
      { method: 'POST', idempotencyKey: crypto.randomUUID() },
    )
    if (!result.ok) {
      // The share stays unpaid in our state; a refresh from the server
      // (below) confirms what the database actually stored.
      setPayErrors((errors) => ({ ...errors, [shareId]: result.message }))
    }

    await refresh(homeId)

    setPaying((ids) => {
      const next = new Set(ids)
      next.delete(shareId)
      return next
    })
  }

  if (load === 'loading' && data === null) {
    return (
      <main style={styles.page}>
        <p>Loading home…</p>
      </main>
    )
  }
  if (load === 'error') {
    return (
      <main style={styles.page}>
        <h1>Bill Splitter</h1>
        <p style={styles.error}>{loadError ?? 'Something went wrong.'}</p>
        <button type="button" style={styles.button} onClick={() => void refresh(homeId)}>
          Try again
        </button>{' '}
        <BackLink />
      </main>
    )
  }
  if (data === null) return null // unreachable, keeps TypeScript happy

  const memberNames = new Map(data.members.map((m) => [m.id, m.name]))
  const unpaidCount = (bill: Bill) => bill.shares.filter((share) => share.paidAt === null).length

  return (
    <main style={styles.page}>
      <BackLink /> <span style={styles.muted}>{data.home.name}</span>
      <h1>Bill Splitter</h1>
      <section style={styles.card}>
        <h2 style={styles.h2}>Members</h2>
        <AddMemberForm homeId={homeId} onAdded={() => void refresh(homeId)} />
        {data.members.length === 0 ? (
          <p style={styles.muted}>No members yet — add the people who live here.</p>
        ) : (
          <ul style={styles.list}>
            {data.members.map((member) => (
              <li key={member.id}>{member.name}</li>
            ))}
          </ul>
        )}
      </section>
      <section style={styles.card}>
        <h2 style={styles.h2}>Balances</h2>
        <ul style={styles.list}>
          {data.balances.map((balance) => (
            <li key={balance.memberId}>
              {balance.name} owes <b>{formatCents(balance.outstandingCents)}</b>
            </li>
          ))}
        </ul>
      </section>
      <section style={styles.card}>
        <h2 style={styles.h2}>Bills</h2>
        <AddBillForm
          homeId={homeId}
          hasMembers={data.members.length > 0}
          onAdded={() => void refresh(homeId)}
        />
        {data.bills.length === 0 ? (
          <p style={styles.muted}>No bills yet — add your first bill above.</p>
        ) : (
          data.bills.map((bill) => (
            <div key={bill.id} style={styles.bill}>
              <h3 style={styles.h3}>
                {bill.title} — {formatCents(bill.totalCents)}{' '}
                <span style={styles.muted}>
                  ({unpaidCount(bill)} unpaid of {bill.shares.length})
                </span>
              </h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Member</th>
                    <th style={styles.th}>Share</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {bill.shares.map((share) => {
                    const busy = paying.has(share.id)
                    return (
                      <tr key={share.id}>
                        <td style={styles.td}>
                          {memberNames.get(share.memberId) ?? 'Unknown member'}
                        </td>
                        <td style={styles.td}>{formatCents(share.amountCents)}</td>
                        <td style={styles.td}>
                          {share.paidAt === null ? (
                            <span style={styles.unpaid}>Unpaid</span>
                          ) : (
                            <span style={styles.paid}>Paid {formatDateTime(share.paidAt)}</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          {share.paidAt === null && (
                            <>
                              <button
                                type="button"
                                style={styles.button}
                                disabled={busy}
                                onClick={() => void payShare(bill, share.id)}
                              >
                                {busy ? 'Paying…' : 'Pay'}
                              </button>
                              {payErrors[share.id] !== undefined && (
                                <p style={styles.error}>{payErrors[share.id]}</p>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>
    </main>
  )
}

// The API is the source of truth: added entries appear after the refresh
// that follows the POST. Until then the form shows what happened.
function AddMemberForm({ homeId, onAdded }: { homeId: string; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addMember() {
    setBusy(true)
    setError(null)
    const result = await apiCall<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, {
      method: 'POST',
      body: { name },
    })
    if (!result.ok) {
      setError(result.message)
      setBusy(false)
      return
    }
    setName('')
    setBusy(false)
    onAdded()
  }

  return (
    <form
      style={styles.formRow}
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) void addMember()
      }}
    >
      <input
        style={styles.input}
        placeholder="Member name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" style={styles.button} disabled={busy || name.trim().length === 0}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
      {error !== null && <p style={styles.error}>{error}</p>}
    </form>
  )
}

function AddBillForm({
  homeId,
  hasMembers,
  onAdded,
}: {
  homeId: string
  hasMembers: boolean
  onAdded: () => void
}) {
  const [title, setTitle] = useState('')
  const [total, setTotal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addBill() {
    setBusy(true)
    setError(null)
    const result = await apiCall<Bill>(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
      method: 'POST',
      body: { title, totalCents: Number(total) },
    })
    if (!result.ok) {
      // The API rejects bad amounts (422); its message is shown as-is.
      setError(result.message)
      setBusy(false)
      return
    }
    setTitle('')
    setTotal('')
    setBusy(false)
    onAdded()
  }

  return (
    <form
      style={styles.formRow}
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) void addBill()
      }}
    >
      <input
        style={styles.input}
        placeholder="Bill title, e.g. Electricity"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <input
        style={styles.input}
        placeholder="Total in cents, e.g. 2500"
        value={total}
        onChange={(event) => setTotal(event.target.value)}
      />
      <button
        type="submit"
        style={styles.button}
        disabled={busy || title.trim().length === 0 || total.trim().length === 0}
      >
        {busy ? 'Adding…' : 'Add bill'}
      </button>
      {!hasMembers && (
        <p style={styles.muted}>Add a member first — bills need someone to split to.</p>
      )}
      {error !== null && <p style={styles.error}>{error}</p>}
    </form>
  )
}

function BackLink() {
  const navigate = Route.useNavigate()
  return (
    <a
      href="/"
      style={styles.link}
      onClick={(event) => {
        event.preventDefault()
        navigate({ to: '/', search: {} })
      }}
    >
      ← Change home
    </a>
  )
}

// -------------------------------------------------------------- visuals ----

const styles = {
  page: { padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 } as const,
  card: {
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  } as const,
  h2: { marginTop: 0 } as const,
  h3: { marginBottom: 8 } as const,
  input: { padding: 8, marginRight: 8, marginBottom: 8 } as const,
  button: { padding: '8px 12px', cursor: 'pointer' } as const,
  formRow: { marginBottom: 12 } as const,
  list: { marginTop: 8 } as const,
  bill: { marginBottom: 16, borderTop: '1px solid #eee', paddingTop: 8 } as const,
  table: { borderCollapse: 'collapse', width: '100%' } as const,
  th: { textAlign: 'left', borderBottom: '1px solid #ccc', padding: 4 } as const,
  td: { borderBottom: '1px solid #eee', padding: 4, verticalAlign: 'top' } as const,
  paid: { color: '#0a7d32' } as const,
  unpaid: { color: '#a15c00' } as const,
  error: { color: '#b00020', margin: '4px 0 0' } as const,
  muted: { color: '#666' } as const,
  link: { color: '#2563eb' } as const,
}
