import { describe, expect, it } from "vitest"
import {
  describeProcessLimits,
  describeThreadCensus,
  parseCount,
  parsePidsEvents,
  parseUserProcessLimit,
  pidsCgroupDirs,
  programLabel,
  readProcessLimits,
  threadCensus,
} from "../process-limits.js"

/** A file source over a fixed set of files. */
const files = (map: Record<string, string>) => (path: string) => map[path]

const LIMITS_FILE = [
  "Limit                     Soft Limit           Hard Limit           Units     ",
  "Max cpu time              unlimited            unlimited            seconds   ",
  "Max processes             4096                 8192                 processes ",
  "Max open files            1048576              1048576              files     ",
].join("\n")

describe("the kernel's counter files", () => {
  it("reads a whole number and nothing else", () => {
    expect(parseCount("1000\n")).toBe(1000)
    expect(parseCount("0")).toBe(0)
    expect(parseCount("max\n")).toBeUndefined()
    expect(parseCount("12.5")).toBeUndefined()
    expect(parseCount("")).toBeUndefined()
    expect(parseCount(undefined)).toBeUndefined()
  })

  it("reads the refusals from the max line of pids.events", () => {
    expect(parsePidsEvents("max 196973\n")).toBe(196973)
    expect(parsePidsEvents("max 0\n")).toBe(0)
    expect(parsePidsEvents("something 3\nmax 7\n")).toBe(7)
    expect(parsePidsEvents("")).toBeUndefined()
    expect(parsePidsEvents(undefined)).toBeUndefined()
  })

  it("reads the per-user limit, and none when it is unlimited", () => {
    expect(parseUserProcessLimit(LIMITS_FILE)).toBe(4096)
    expect(parseUserProcessLimit(LIMITS_FILE.replace("4096", "unlimited"))).toBeUndefined()
    expect(parseUserProcessLimit("")).toBeUndefined()
    expect(parseUserProcessLimit(undefined)).toBeUndefined()
  })
})

describe("where the process limit is read", () => {
  it("a container with its own cgroup namespace reads the mount root", () => {
    expect(pidsCgroupDirs(files({ "/proc/self/cgroup": "0::/\n" }))).toEqual(["/sys/fs/cgroup", "/sys/fs/cgroup/pids"])
  })

  it("a nested cgroup is read from its own directory up to the root", () => {
    expect(pidsCgroupDirs(files({ "/proc/self/cgroup": "0::/kubepods/pod1/c1\n" }))).toEqual([
      "/sys/fs/cgroup/kubepods/pod1/c1",
      "/sys/fs/cgroup/kubepods/pod1",
      "/sys/fs/cgroup/kubepods",
      "/sys/fs/cgroup",
      "/sys/fs/cgroup/pids",
    ])
  })

  it("cgroup v1 reads the pids controller", () => {
    const self = "12:cpu,cpuacct:/docker/abc\n7:pids:/docker/abc\n1:name=systemd:/docker/abc\n"
    expect(pidsCgroupDirs(files({ "/proc/self/cgroup": self }))).toEqual(["/sys/fs/cgroup/pids/docker/abc", "/sys/fs/cgroup/pids"])
  })
})

describe("the container's process limit", () => {
  it("reads the limit, the count, the peak and the refusals of a limited container", () => {
    const read = files({
      "/proc/self/cgroup": "0::/\n",
      "/sys/fs/cgroup/pids.max": "1000\n",
      "/sys/fs/cgroup/pids.current": "143\n",
      "/sys/fs/cgroup/pids.peak": "998\n",
      "/sys/fs/cgroup/pids.events": "max 12\n",
      "/proc/self/limits": LIMITS_FILE,
    })
    expect(readProcessLimits(read)).toEqual({ pidsMax: 1000, pidsCurrent: 143, pidsPeak: 998, refusals: 12, userProcessLimit: 4096 })
  })

  it("a parent's tighter limit is the limit, and the counts are read where it is", () => {
    const read = files({
      "/proc/self/cgroup": "0::/pod/c1\n",
      "/sys/fs/cgroup/pod/c1/pids.max": "max\n",
      "/sys/fs/cgroup/pod/c1/pids.current": "40\n",
      "/sys/fs/cgroup/pod/pids.max": "500\n",
      "/sys/fs/cgroup/pod/pids.current": "220\n",
      "/sys/fs/cgroup/pod/pids.events": "max 3\n",
      "/sys/fs/cgroup/pids.max": "2000\n",
    })
    expect(readProcessLimits(read)).toMatchObject({ pidsMax: 500, pidsCurrent: 220, refusals: 3 })
  })

  it("a container without a limit still states how many it has", () => {
    const read = files({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/pids.max": "max\n", "/sys/fs/cgroup/pids.current": "75\n", "/sys/fs/cgroup/pids.events": "max 0\n" })
    expect(readProcessLimits(read)).toEqual({ pidsMax: undefined, pidsCurrent: 75, pidsPeak: undefined, refusals: 0, userProcessLimit: undefined })
  })

  it("is all unknown where nothing can be read (not Linux)", () => {
    expect(readProcessLimits(() => undefined)).toEqual({
      pidsMax: undefined, pidsCurrent: undefined, pidsPeak: undefined, refusals: undefined, userProcessLimit: undefined,
    })
  })
})

describe("who holds the threads", () => {
  it("names a process by what it runs", () => {
    expect(programLabel(["node", "dist/render-worker.js"], "node")).toBe("node render-worker.js")
    expect(programLabel(["node", "--max-old-space-size=12288", "dist/server.js"], "node")).toBe("node server.js")
    expect(programLabel(["/usr/local/bin/node"], "node")).toBe("node")
    expect(programLabel(["/home/node/.cache/chrome-headless-shell", "--type=renderer", "--no-sandbox"], "chrome")).toBe("chrome-headless-shell (renderer)")
    expect(programLabel(["/home/node/.cache/chrome-headless-shell", "--headless"], "chrome")).toBe("chrome-headless-shell")
    expect(programLabel(["caddy", "run", "--config", "/etc/caddy/Caddyfile"], "caddy")).toBe("caddy")
    expect(programLabel(["/bin/sh", "/app/start.sh"], "sh")).toBe("sh")
    // A process with no command line (it is ending) keeps the kernel's name.
    expect(programLabel([], "ffmpeg")).toBe("ffmpeg")
  })

  it("adds up the threads of every process of a program, most first", () => {
    const status = (name: string, threads: number) => `Name:\t${name}\nState:\tS (sleeping)\nThreads:\t${threads}\n`
    const proc: Record<string, string> = {
      "/proc/1/status": status("sh", 1),
      "/proc/1/cmdline": "/bin/sh\0/app/start.sh\0",
      "/proc/20/status": status("node", 21),
      "/proc/20/cmdline": "node\0dist/render-worker.js\0",
      "/proc/31/status": status("chrome-headless", 14),
      "/proc/31/cmdline": "/c/chrome-headless-shell\0--type=renderer\0",
      "/proc/32/status": status("chrome-headless", 15),
      "/proc/32/cmdline": "/c/chrome-headless-shell\0--type=renderer\0",
      "/proc/40/status": status("ffmpeg", 44),
      "/proc/40/cmdline": "ffmpeg\0-i\0-\0",
      // Ended between the listing and the read: left out.
      "/proc/50/cmdline": "gone\0",
    }
    const census = threadCensus(files(proc), () => ["1", "20", "31", "32", "40", "50", "self", "uptime"])
    expect(census).toEqual([
      { program: "ffmpeg", processes: 1, threads: 44 },
      { program: "chrome-headless-shell (renderer)", processes: 2, threads: 29 },
      { program: "node render-worker.js", processes: 1, threads: 21 },
      { program: "sh", processes: 1, threads: 1 },
    ])
    expect(describeThreadCensus(census)).toBe(
      "ffmpeg: 44, chrome-headless-shell (renderer) ×2: 29, node render-worker.js: 21, sh: 1 (95 threads in 5 processes)",
    )
    expect(describeThreadCensus(census, 2)).toBe("ffmpeg: 44, chrome-headless-shell (renderer) ×2: 29, 2 more: 22 (95 threads in 5 processes)")
  })

  it("says so when no process could be read", () => {
    expect(threadCensus(() => undefined, () => [])).toEqual([])
    expect(describeThreadCensus([])).toBe("no process could be read")
  })
})

describe("the limits in one sentence", () => {
  it("states a limited container's numbers", () => {
    expect(
      describeProcessLimits(
        { pidsMax: 1000, pidsCurrent: 143, pidsPeak: 998, refusals: 12, userProcessLimit: undefined },
        { visibleCpus: 64, cpuQuota: 32 },
      ),
    ).toBe("the container is limited to 1000 processes and threads together (pids.max): 143 now, 998 at most so far, 12 refused so far; per-user limit none; 64 CPUs visible, CPU quota 32")
  })

  it("states an unlimited container and a per-user limit", () => {
    expect(
      describeProcessLimits(
        { pidsMax: undefined, pidsCurrent: 75, pidsPeak: undefined, refusals: 0, userProcessLimit: 4096 },
        { visibleCpus: 10, cpuQuota: undefined },
      ),
    ).toBe("no process limit on the container (75 processes and threads now); per-user limit 4096; 10 CPUs visible, CPU quota none")
  })
})
