// The same for TSX: blocks, calls and literals inside JSX.
export function View({ items, on }: { items: string[]; on?: (s: string) => void }) {
  const shown = items.filter((i) => i.length > 0)
  return (
    <ul className={shown.length > 2 ? "many" : "few"} data-n={shown.length + 1}>
      {shown.map((i) => <li key={i} onClick={() => on?.(i)}>{i.trim()}</li>)}
      {shown.length === 0 && <li>{"none"}</li>}
    </ul>
  )
}
