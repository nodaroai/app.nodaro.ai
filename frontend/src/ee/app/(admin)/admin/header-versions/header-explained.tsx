import { AnatomyFigureView } from "./figure-anatomy"
import { ContractFigureView } from "./figure-contract"
import { PhoneFigureView } from "./figure-phone"
import { ReleaseFigureView } from "./figure-release"
import { WorldsFigureView } from "./figure-worlds"
import { NewTabLink } from "./product-card"
import type { HeaderVersionsReport } from "./types"

/**
 * How the header works: the map's figures, drawn here, in the words the
 * header's repository keeps beside its code (read as they stand). The first
 * of them — the header, the products and what they reach — is the product map
 * at the top of the page; these are the rest, in the map's order.
 */

export function HeaderExplained({ report }: { report: HeaderVersionsReport }) {
  const map = report.headerMap
  if (map.status === "not_configured") return null
  const newest = report.latest.status === "ok" ? report.latest.version : null
  const { anatomy, worlds, release, phone, contract } = map.status === "ok" ? map.figures : {}
  return (
    <section aria-labelledby="header-explained-title" className="mt-8 rounded-xl border bg-card px-5 py-4">
      <h2 id="header-explained-title" className="text-base font-bold">
        How the header works
      </h2>
      {map.status === "missing" && (
        <p className="mt-1 text-sm text-muted-foreground">No explanations found in the header's repository (or the GitHub token cannot see it).</p>
      )}
      {map.status === "error" && <p className="mt-1 text-sm text-destructive">{map.message}</p>}
      {map.status === "ok" && (
        <>
          <p className="text-sm text-muted-foreground">
            In the header's own words, kept beside its code. Written for <span className="font-mono">{map.asOf}</span>
            {newest !== null && newest !== map.asOf && (
              <>
                ; the newest release is <span className="font-mono">{newest}</span>
              </>
            )}
            . <NewTabLink href={map.url}>Edit them in the header's repository</NewTabLink>.
          </p>
          <div className="mt-5 space-y-9">
            {anatomy && <AnatomyFigureView figure={anatomy} worlds={map.worlds} />}
            {worlds && <WorldsFigureView figure={worlds} worlds={map.worlds} products={report.products} />}
            {release && <ReleaseFigureView figure={release} />}
            {phone && <PhoneFigureView figure={phone} />}
            {contract && <ContractFigureView figure={contract} />}
          </div>
        </>
      )}
    </section>
  )
}
