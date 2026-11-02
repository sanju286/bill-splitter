// Shared database row types. Column names are snake_case, the API answers in camelCase.

export type HomeRow = {
  id: string
  name: string
  created_at: string
}

export type MemberRow = {
  id: string
  home_id: string
  name: string
  seq: number
  created_at: string
}

export type BillRow = {
  id: string
  home_id: string
  title: string
  total_cents: number
  created_at: string
}

export type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  paid_key: string | null
}

// Shapes the API answers with (camelCase), mirrored by the web app.
export type MemberDto = {
  id: string
  homeId: string
  name: string
}

export type ShareDto = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

export type BillDto = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: ShareDto[]
}

export type BalanceDto = {
  memberId: string
  name: string
  outstandingCents: number
}
