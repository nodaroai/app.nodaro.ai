// Subject of the hang probe: `i--` → `i++` spins a worker forever (sync).
export function countdown(n) {
  let i = n
  while (i > 0) i--
  return i
}
