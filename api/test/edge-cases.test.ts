// Extra edge-case tests beyond the visible set: races, small splits,
// malformed input, and JSON error guarantee.
import { describe, expect, it } from 'vitest'
import { call, createBill, createHome } from './helpers'

describe('edge cases', () => {
  it('splits 1 cent between 3 members as 1, 0, 0', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, 1)

    expect(bill.status).toBe(201)
    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([1, 0, 0])
  })

  it('lets only one of two racing payments succeed with different keys', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')

    const results = await Promise.all([
      call('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'key-a' },
      }),
      call('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'key-b' },
      }),
    ])

    const statuses = results.map((result) => result.status).sort()
    expect(statuses).toEqual([200, 409])

    const outstanding = await call<{ balances: { outstandingCents: number }[] }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )
    // Exactly one share was paid (Asha 0, Ben still owes), not two.
    expect(outstanding.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])
  })

  it('answers the same for the same key even when sent at the same time', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')

    const [a, b] = await Promise.all([
      call<{ paidAt: string | null }>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'same-key' },
      }),
      call<{ paidAt: string | null }>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'same-key' },
      }),
    ])

    expect([a.status, b.status]).toEqual([200, 200])
    expect(b.body.paidAt).toBe(a.body.paidAt)

    const outstanding = await call<{ balances: { outstandingCents: number }[] }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )
    expect(outstanding.body.balances.map((balance) => balance.outstandingCents)).toEqual([0, 500])
  })

  it('gives a 400 for a malformed JSON body and a 422 for an empty object', async () => {
    const home = await call('POST', '/api/homes', { body: 'not-json-parseable' })
    expect(home.status).toBe(400)

    const empty = await call('POST', '/api/homes', { body: {} })
    expect(empty.status).toBe(422)
  })

  it('answers every unknown path with a JSON error', async () => {
    const response = await call('GET', '/api/nope')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'Not found' })
  })

  it('lists members and bills the page can read', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 1000)
    await createBill(homeId, 301)

    const membersList = await call<{ members: { name: string }[] }>(
      'GET',
      `/api/homes/${homeId}/members`,
    )
    expect(membersList.body.members.map((m) => m.name)).toEqual(['Asha', 'Ben'])

    const billsList = await call<{
      bills: { totalCents: number; shares: { amountCents: number }[] }[]
    }>('GET', `/api/homes/${homeId}/bills`)
    expect(billsList.body.bills.map((bill) => bill.totalCents)).toEqual([1000, 301])
    expect(billsList.body.bills[1]?.shares.map((s) => s.amountCents)).toEqual([151, 150])
  })

  it('shows zero balances for a home with members but no bills', async () => {
    const { homeId, members } = await createHome(['Asha'])

    const balances = await call<{
      balances: { memberId: string; outstandingCents: number }[]
    }>('GET', `/api/homes/${homeId}/balances`)

    expect(balances.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 0 },
    ])
  })
})
