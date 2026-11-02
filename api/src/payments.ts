import { Hono } from 'hono'

export const payRoutes = new Hono<{ Bindings: Env }>()

// POST /api/bills/:billId/shares/:shareId/pay  (header: Idempotency-Key)
// -> 200 { id, memberId, amountCents, paidAt }
//
// How this stays correct when requests repeat or race:
//
// 1. The payment itself is a single conditional UPDATE ... WHERE paid_at IS
//    NULL. SQLite serializes writes, so exactly one request "wins" the
//    update; a concurrent payer's update changes 0 rows and never overwrites
//    the winner. The share can only end up paid once.
// 2. The share row remembers paid_key = the Idempotency-Key of the winner.
//    - Same key sent again  -> 200 with the stored paidAt (the same answer).
//    - Different key, already paid -> 409.
// 3. Read-after-write: we always SELECT the share after the UPDATE, so the
//    answer reflects this UPDATE (or the one that beat us).
payRoutes.post('/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const key = c.req.header('Idempotency-Key')
  if (key === undefined || key.trim() === '') {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const paidAt = new Date().toISOString()
  await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, paid_key = ? ' +
      'WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, key, shareId, billId)
    .run()

  // bill_id = ? in the WHERE clause covers both "share does not exist" and
  // "share exists but belongs to another bill": no row -> 404 either way.
  const share = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, paid_key FROM shares ' +
      'WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      paid_key: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Bill or share not found' }, 404)
  }
  if (share.paid_at === null) {
    // Cannot happen: an unpaid share is always set by the UPDATE above.
    // Guarded so a bug can never answer "paid" for an unpaid share.
    throw new Error('share still unpaid after payment update')
  }
  if (share.paid_key === key) {
    return c.json({
      id: share.id,
      memberId: share.member_id,
      amountCents: share.amount_cents,
      paidAt: share.paid_at,
    })
  }
  return c.json({ error: 'Share already paid with a different key' }, 409)
})
