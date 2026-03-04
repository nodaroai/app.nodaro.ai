import { Textarea } from "@/components/ui/textarea"

interface TextInputCardProps {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}

export function TextInputCard({ label, value, placeholder, onChange }: TextInputCardProps) {
  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[80px] resize-y"
      />
    </div>
  )
}
