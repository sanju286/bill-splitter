import { Hono } from 'hono'
import { isNonEmptyText, isPositiveWholeCents, readJsonObject } from './http'
import { splitCents } from './split'
import type { BalanceDto, BillDto, BillRow, ShareDto, ShareRow } from './types'

export const billsRoutes = new Hono<{ Bindings: Env }>()

function toShareDto(row: ShareRow): ShareDto {
  return {
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
  }
}

// POST /api/homes/:homeId/bills  { title, totalCents } -> 201 BillDto
billsRoutes.post('/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const parsed = await readJsonObject(c)
  if (!parsed.ok) {
    return c.json({ error: 'Body must be a JSON object' }, 400)
  }
  const { title, totalCents } = parsed.body
  if (!isNonEmptyText(title)) {
    return c.json({ error: 'title must be a non-empty string' }, 422)
  }
  if (!isPositiveWholeCents(totalCents)) {
    return c.json({ error: 'totalCents must be a positive whole number of cents' }, 422)
  }

  const exists = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!exists) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare('SELECT id FROM members WHERE home_id = ? ORDER BY seq')
    .bind(homeId)
    .all<{ id: string }>()
  const memberIds = members.results.map((row) => row.id)
  if (memberIds.length === 0) {
    return c.json({ error: 'Home has no members to split the bill' }, 422)
  }

  // The members were just loaded in seq order, so the first members get the
  // extra cents and the shares line up with the split rule.
  const amounts = splitCents(totalCents, memberIds.length)
  const billId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const shares = memberIds.map((memberId, index) => ({
    id: crypto.randomUUID(),
    memberId,
    amountCents: amounts[index] ?? 0,
  }))

  // The bill and all of its shares are inserted in one transaction: viewers
  // never see a bill without its shares, and a failed insert leaves nothing behind.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents, createdAt),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  const bill: BillDto = {
    id: billId,
    homeId,
    title,
    totalCents,
    shares: shares.map((share) => ({
      id: share.id,
      memberId: share.memberId,
      amountCents: share.amountCents,
      paidAt: null,
    })),
  }
  return c.json(bill, 201)
})

// GET /api/homes/:homeId/bills -> 200 { bills: [...] }
billsRoutes.get('/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const exists = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!exists) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const bills = await c.env.DB.prepare('SELECT * FROM bills WHERE home_id = ? ORDER BY rowid')
    .bind(homeId)
    .all<BillRow>()
  const shares = await c.env.DB.prepare(
    'SELECT sh.* FROM shares sh JOIN bills b ON b.id = sh.bill_id WHERE b.home_id = ? ORDER BY sh.rowid',
  )
    .bind(homeId)
    .all<ShareRow>()

  const sharesByBill = new Map<string, ShareDto[]>()
  for (const share of shares.results) {
    const list = sharesByBill.get(share.bill_id) ?? []
    list.push(toShareDto(share))
    sharesByBill.set(share.bill_id, list)
  }

  const billsDto: BillDto[] = bills.results.map((bill) => ({
    id: bill.id,
    homeId: bill.home_id,
    title: bill.title,
    totalCents: bill.total_cents,
    shares: sharesByBill.get(bill.id) ?? [],
  }))
  return c.json({ bills: billsDto })
})

// GET /api/homes/:homeId/balances -> 200 { balances: [...] }
// List the members in the order they were added; outstandingCents is the sum
// of the member's unpaid shares across all bills of the home.
billsRoutes.get('/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const exists = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!exists) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY seq',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()
  const owing = await c.env.DB.prepare(
    'SELECT sh.member_id AS member_id, SUM(sh.amount_cents) AS outstanding ' +
      'FROM shares sh JOIN bills b ON b.id = sh.bill_id ' +
      'WHERE b.home_id = ? AND sh.paid_at IS NULL ' +
      'GROUP BY sh.member_id',
  )
    .bind(homeId)
    .all<{ member_id: string; outstanding: number }>()

  const owedByMember = new Map<string, number>()
  for (const row of owing.results) {
    owedByMember.set(row.member_id, row.outstanding)
  }

  const balances: BalanceDto[] = members.results.map((member) => ({
    memberId: member.id,
    name: member.name,
    outstandingCents: owedByMember.get(member.id) ?? 0,
  }))
  return c.json({ balances })
})
