import type { FixtureEchoData } from "./types"

export function NodeComponent({ data }: { data: FixtureEchoData }) {
  return <div>{data.label}</div>
}
