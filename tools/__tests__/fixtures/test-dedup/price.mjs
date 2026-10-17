// The subject the harness self-test mutates (sites.json holds its sites).
export function price(qty, unit) {
  if (qty <= 0) return 0
  const total = qty * unit
  return total > 100 ? total - 10 : total
}
