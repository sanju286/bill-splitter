import { Hono } from 'hono'
import { billsRoutes } from './bills'
import { homesRoutes } from './homes'
import { payRoutes } from './payments'

const app = new Hono<{ Bindings: Env }>()

// Any unhandled error becomes a JSON error response, never a plain-text
// crash page. The stack trace goes to the logs, not to the API caller.
app.onError((error, c) => {
  console.error('Unhandled API error:', error)
  return c.json({ error: 'Internal server error' }, 500)
})

// Unknown paths (and unknown methods) also answer in the JSON error form.
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.route('/api/homes', homesRoutes)
app.route('/api/homes', billsRoutes)
app.route('/api/bills', payRoutes)

export default app
