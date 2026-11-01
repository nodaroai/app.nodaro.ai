// "Steps" for one trend test run: what its preparation steps did — per role
// the photos' labels, what they cover, the layout and the reference sheet;
// the engine prompt an LLM wrote (the full prompt the engine was sent stays
// in "Show prompt"); the scene text; the steps it went on without. Admins
// only, never users. The same body shows on the admin Jobs page.

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CastSwapStepsView } from "../../jobs/job-generation-details"

export function StepsDialog({ jobId, onClose }: { readonly jobId: string | null; readonly onClose: () => void }) {
  return (
    <Dialog open={jobId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Steps</DialogTitle>
          <DialogDescription>
            What this run's preparation steps made of its pictures and prompt. Admins only; users never see it.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] min-w-0 overflow-y-auto overflow-x-hidden">
          <CastSwapStepsView jobId={jobId} showSkipped />
        </div>
      </DialogContent>
    </Dialog>
  )
}
