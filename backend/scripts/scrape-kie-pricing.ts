/**
 * Fetch KIE.ai model pricing from their internal API
 *
 * Endpoint: POST https://api.kie.ai/client/v1/model-pricing/page
 * Body: { pageNum: 1, pageSize: 100, interfaceType: "" }
 * Response: { code: 200, data: { records: [...], pages, total } }
 *
 * Each record has: modelDescription, interfaceType, provider, creditPrice, creditUnit, usdPrice, falPrice, discountRate, anchor
 */
import https from "https"

function postJSON(url: string, body: unknown): Promise<{ status: number; body: string }> {
  const data = JSON.stringify(body)
  const parsed = new URL(url)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let d = ""
        res.on("data", (c: Buffer) => (d += c.toString()))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: d }))
        res.on("error", reject)
      }
    )
    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

interface PricingRecord {
  modelDescription: string
  interfaceType: string
  provider: string
  creditPrice: number | string
  creditUnit: string
  usdPrice: number | string
  falPrice?: number | string
  discountPrice?: number | string
  discountRate?: number
  anchor?: string
}

async function main() {
  console.log("Fetching KIE.ai model pricing...\n")

  // Fetch all pages
  const allRecords: PricingRecord[] = []
  let page = 1
  const pageSize = 100

  while (true) {
    const { status, body } = await postJSON(
      "https://api.kie.ai/client/v1/model-pricing/page",
      { pageNum: page, pageSize, interfaceType: "" }
    )

    if (status !== 200) {
      console.error(`HTTP ${status}: ${body.substring(0, 200)}`)
      break
    }

    const parsed = JSON.parse(body)
    if (parsed.code !== 200 || !parsed.data?.records) {
      console.error(`API error: ${JSON.stringify(parsed).substring(0, 200)}`)
      break
    }

    const { records, pages, total } = parsed.data
    allRecords.push(...records)
    console.log(`Page ${page}/${pages} — ${records.length} records (total: ${total})`)

    if (page >= pages) break
    page++
  }

  console.log(`\n=== ALL KIE.AI MODEL PRICING (${allRecords.length} models) ===\n`)

  // Group by interface type
  const grouped: Record<string, PricingRecord[]> = {}
  for (const r of allRecords) {
    const type = r.interfaceType || "Other"
    if (!grouped[type]) grouped[type] = []
    grouped[type].push(r)
  }

  for (const [type, records] of Object.entries(grouped)) {
    console.log(`\n--- ${type} ---`)
    console.log(
      "Model".padEnd(55) +
      "Credits".padEnd(10) +
      "USD".padEnd(10) +
      "Provider"
    )
    console.log("-".repeat(90))

    for (const r of records) {
      console.log(
        String(r.modelDescription).padEnd(55) +
        String(r.creditPrice).padEnd(10) +
        (r.usdPrice ? `$${r.usdPrice}` : "-").padEnd(10) +
        String(r.provider || "")
      )
    }
  }

  // Also output as JSON for easy processing
  const jsonPath = "backend/scripts/kie-pricing-data.json"
  const fs = await import("fs")
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(allRecords, null, 2)
  )
  console.log(`\nFull data saved to ${jsonPath}`)
}

main().catch(console.error)
