"use client"

import { useT } from "@/lib/i18n"

export function JobsTab() {
  const t = useT()
  return (
    <div className="text-sm text-muted-foreground py-8 text-center">
      {t("dash.jobsComingSoon")}
    </div>
  )
}
