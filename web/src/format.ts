// Display-only formatting. Money is stored as whole cents; the division here
// is on integers, so there is no floating point drift.

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const whole = Math.floor(Math.abs(cents) / 100)
  const remainder = Math.abs(cents) % 100
  return `${sign}$${whole}.${String(remainder).padStart(2, '0')}`
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}
