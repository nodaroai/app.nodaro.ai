import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

export function SortHeader<TField extends string>({
  label,
  field,
  align = "left",
  active,
  dir,
  onSort,
}: {
  readonly label: string
  readonly field: TField
  readonly align?: "left" | "right"
  readonly active: boolean
  readonly dir: "asc" | "desc"
  readonly onSort: (field: TField) => void
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown
  return (
    <th className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground" : "text-muted-foreground"
        } ${align === "right" ? "justify-end w-full" : ""}`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  )
}
