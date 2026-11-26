// @reads-none classifies an error message; reads no file
/**
 * Whether ffmpeg or ffprobe REFUSED A FILE, as opposed to the machine failing
 * the tool (decided 2026-11-23). A positive rule: only a message that names
 * the input as invalid or undecodable counts, and never one that also names
 * the environment (memory, disk, threads, files, the network). Anything else —
 * a message this list does not know — is the machine's, and retried: an
 * unknown failure never condemns a paid video.
 */

/** What the tools say about input they cannot use. */
const INPUT_REFUSED: readonly RegExp[] = [
  /Invalid data found when processing input/i,
  /moov atom not found/i,
  /Invalid NAL unit size/i,
  /Error splitting the input into NAL units/i,
  /No start code is found/i,
  /could not find codec parameters/i,
  /Decode error rate [\d.e+-]+ exceeds/i,
  /Nothing was written into output file/i,
  /Output file is empty, nothing was encoded/i,
  /does not contain any stream/i,
  /Cannot determine format of input/i,
]

/** What the tools say when the machine, not the file, failed them. */
const ENVIRONMENT: readonly RegExp[] = [
  /Cannot allocate memory/i,
  /No space left on device/i,
  /Resource temporarily unavailable/i,
  /Too many open files/i,
  /Input\/output error/i,
  /Disk quota exceeded/i,
  /Broken pipe/i,
  /Connection (refused|reset|timed out)/i,
  /Server returned/i,
  /timed out/i,
]

/** Whether `message` (a failure's text, carrying the tool's stderr) says the tool refused its input, and nothing says the machine failed it. */
export function toolRefusedInput(message: string | undefined): boolean {
  if (!message) return false
  if (ENVIRONMENT.some((re) => re.test(message))) return false
  return INPUT_REFUSED.some((re) => re.test(message))
}
