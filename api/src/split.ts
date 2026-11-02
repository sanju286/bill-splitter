// Splits a bill total into per-member amounts.
//
// Every member gets floor(total / members). If the division leaves a
// remainder, the extra cents go to the first members one by one — that is,
// in the order the members were added to the home. The amounts always
// add up to the total.
//
// Example: 1000 between 3 members -> [334, 333, 333].
export function splitCents(totalCents: number, memberCount: number): number[] {
  const base = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount
  return Array.from({ length: memberCount }, (_, index) => (index < remainder ? base + 1 : base))
}
