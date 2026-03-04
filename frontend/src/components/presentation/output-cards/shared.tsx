import { toast } from "sonner"

export type OutputStatus = "idle" | "running" | "completed" | "failed"

export function StatusBadge({ status }: { status: OutputStatus }) {
  if (status === "idle") return null
  const colors: Record<string, string> = {
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] ?? ""}`}>
      {status}
    </span>
  )
}

export function copyUrl(url: string) {
  navigator.clipboard.writeText(url)
  toast.success("URL copied")
}

export function downloadFile(url: string, filename: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.target = "_blank"
  a.click()
}
