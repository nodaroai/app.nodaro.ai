import type { SetupView } from "./types"

/** What is missing, and the four one-time steps that finish the setup. */
export function SetupPanel({ setup }: { setup: SetupView }) {
  return (
    <section className="border border-amber-500/40 bg-amber-500/5 rounded-lg p-5 space-y-3 text-sm">
      <h2 className="text-base font-semibold">Finish the setup</h2>
      <ul className="list-disc ps-5 space-y-1">
        {setup.problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      <ol className="list-decimal ps-5 space-y-1 text-muted-foreground">
        <li>
          In Google Cloud, create a service account and download a JSON key for it. In the same project, turn on the
          “Google Analytics Data API” and the “Google Search Console API”.
        </li>
        <li>In Google Analytics, Admin → Property access management: add the service account’s email as a Viewer.</li>
        <li>In Search Console, Settings → Users and permissions: add the same email (Restricted is enough).</li>
        <li>
          On the server, set <code className="font-mono">SITE_ANALYTICS_SERVICE_ACCOUNT_JSON</code> (the key file),{" "}
          <code className="font-mono">SITE_ANALYTICS_GA4_PROPERTY_ID</code> (the property number) and{" "}
          <code className="font-mono">SITE_ANALYTICS_SEARCH_CONSOLE_SITE</code> (for example{" "}
          <code className="font-mono">sc-domain:example.com</code>), then redeploy.
        </li>
      </ol>
      {setup.serviceAccountEmail && (
        <p>
          Service account: <span className="font-mono select-all">{setup.serviceAccountEmail}</span>
        </p>
      )}
    </section>
  )
}
