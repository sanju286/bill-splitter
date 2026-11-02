import { Hono } from 'hono'
import { isNonEmptyText, readJsonObject } from './http'
import type { MemberDto, MemberRow } from './types'

export const homesRoutes = new Hono<{ Bindings: Env }>()

function toMemberDto(row: MemberRow): MemberDto {
  return { id: row.id, homeId: row.home_id, name: row.name }
}

// POST /api/homes  { name } -> 201 { id, name }
homesRoutes.post('/', async (c) => {
  const parsed = await readJsonObject(c)
  if (!parsed.ok) {
    return c.json({ error: 'Body must be a JSON object' }, 400)
  }
  const { name } = parsed.body
  if (!isNonEmptyText(name)) {
    return c.json({ error: 'name must be a non-empty string' }, 422)
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const home = await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, createdAt)
    .run()

  if (!home.success) {
    throw new Error('insert home failed')
  }
  return c.json({ id, name }, 201)
})

// POST /api/homes/:homeId/members  { name } -> 201 { id, homeId, name }
homesRoutes.post('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const parsed = await readJsonObject(c)
  if (!parsed.ok) {
    return c.json({ error: 'Body must be a JSON object' }, 400)
  }
  const { name } = parsed.body
  if (!isNonEmptyText(name)) {
    return c.json({ error: 'name must be a non-empty string' }, 422)
  }

  const exists = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!exists) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const member = await addMemberWithNextSeq(c.env.DB, homeId, name)
  return c.json(toMemberDto(member), 201)
})

// GET /api/homes/:homeId  -> 200 { id, name }
homesRoutes.get('/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }
  return c.json({ id: home.id, name: home.name })
})

// GET /api/homes/:homeId/members -> 200 { members: [...] } in the order they were added
homesRoutes.get('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const exists = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!exists) {
    return c.json({ error: 'Home not found' }, 404)
  }
  const members = await c.env.DB.prepare('SELECT * FROM members WHERE home_id = ? ORDER BY seq')
    .bind(homeId)
    .all<MemberRow>()
  return c.json({ members: members.results.map(toMemberDto) })
})

// Adds a member with the next free position (`seq`) in the home.
// Two concurrent "add member" requests could compute the same seq; the
// UNIQUE (home_id, seq) constraint rejects one of them. The insert is then
// retried with a fresh seq, so both members end up in the home.
async function addMemberWithNextSeq(
  db: Env['DB'],
  homeId: string,
  name: string,
): Promise<MemberRow> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    const maxSeq = await db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM members WHERE home_id = ?')
      .bind(homeId)
      .first<{ max_seq: number }>()
    const seq = (maxSeq?.max_seq ?? 0) + 1

    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    try {
      await db
        .prepare('INSERT INTO members (id, home_id, name, seq, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, homeId, name, seq, createdAt)
        .run()
    } catch (error) {
      // UNIQUE (home_id, seq) was hit by a concurrent add — retry with a new seq.
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        lastError = error
        continue
      }
      throw error
    }
    return { id, home_id: homeId, name, seq, created_at: createdAt }
  }
  throw new Error('could not assign a unique member sequence', {
    cause: lastError,
  })
}
