/**
 * The "Message user" action and the conversation log beneath it, as one block
 * on the user's admin detail view.
 *
 * Kept together because they are one story: what you can say, and what has
 * already been said. An admin about to send "we spotted a failure in your run"
 * needs to see that someone else sent that same message an hour ago.
 */
import { useState } from "react"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MessageUserDialog } from "./message-user-dialog"
import { MessageHistory } from "./message-history"

export function UserMessagesSection({
  userId,
  userEmail,
}: {
  readonly userId: string
  readonly userEmail: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Mail className="h-4 w-4" />
          Messages
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Mail className="mr-1.5 h-3.5 w-3.5" />
          Message user
        </Button>
      </div>

      <MessageHistory userId={userId} />

      {/* Mounted only while open so the templates query is not fired for every
          expanded row on the users table. */}
      {open && (
        <MessageUserDialog
          open={open}
          onOpenChange={setOpen}
          userId={userId}
          userEmail={userEmail}
        />
      )}
    </div>
  )
}
