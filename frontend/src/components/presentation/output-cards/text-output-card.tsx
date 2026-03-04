import { Loader2, Copy, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { StatusBadge, type OutputStatus } from "./shared"

interface TextOutputCardProps {
  label: string
  status: OutputStatus
  text?: string
}

export function TextOutputCard({ label, status, text }: TextOutputCardProps) {
  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <StatusBadge status={status} />
      </div>
      {status === "running" ? (
        <div className="flex items-center justify-center h-20 bg-gray-100 dark:bg-[#2D2D2D] rounded-md">
          <Loader2 className="h-6 w-6 animate-spin text-[#ff0073]" />
        </div>
      ) : text ? (
        <>
          <div className="bg-gray-50 dark:bg-[#2D2D2D] rounded-md p-3 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
            {text}
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast.success("Text copied") }}>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-20 bg-gray-100 dark:bg-[#2D2D2D] rounded-md text-gray-400">
          <div className="text-center">
            <FileText className="h-6 w-6 mx-auto mb-1" />
            <span className="text-xs">{status === "failed" ? "Generation failed" : "Awaiting generation"}</span>
          </div>
        </div>
      )}
    </div>
  )
}
