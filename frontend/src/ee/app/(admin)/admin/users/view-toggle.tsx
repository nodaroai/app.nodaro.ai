import { Loader2 } from "lucide-react"

export type UsersView = "table" | "map"

const OPTIONS: ReadonlyArray<{ readonly view: UsersView; readonly label: string }> = [
  { view: "table", label: "Table" },
  { view: "map", label: "Map" },
]

/** Table (the page as it always was) or Map (the clusters drawn as an office floor). */
export function ViewToggle({ view, onView }: { readonly view: UsersView; readonly onView: (v: UsersView) => void }) {
  return (
    <div role="group" aria-label="View" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.view}
          type="button"
          aria-pressed={view === o.view}
          onClick={() => onView(o.view)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            view === o.view ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function MapFallback() {
  return (
    <div className="flex h-[calc(100dvh-120px)] min-h-[560px] items-center justify-center rounded-xl border">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
