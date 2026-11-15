/**
 * The ffmpeg demuxers that read a media file from the file itself — never a
 * second file, a URL or a transport named inside it (their n8.1.2 sources
 * read: no `io_open`, no nested `avformat_open_input`). MP3 (and MP2), WAV (and
 * RF64), Wave64, AIFF, CAF, Sun AU, MP4/M4A/MOV, ADTS AAC, AC-3 / E-AC-3, AMR,
 * Ogg (Vorbis, Opus, FLAC), FLAC, Matroska/WebM, WMV/WMA (ASF), MPEG-TS, AVI,
 * MPEG-PS (MPG, VOB), FLV, raw DTS, WavPack, Monkey's Audio, TTA, Musepack
 * (SV7, SV8) and LOAS/LATM AAC.
 *
 * A playlist, a stream manifest or a concat script (HLS, DASH, IMF, ffconcat)
 * is none of these, so a `-format_whitelist` of this list refuses it before
 * any link inside it is opened. One exception to watch: a MOV CAN name another
 * file to read its samples from (a data-reference alias); the mov demuxer's
 * `enable_drefs` option, off by default, is what stops ffmpeg following it.
 *
 * Before adding a name here, read its demuxer for a second open. `vobsub`
 * (which opens a .sub beside its .idx) is a demuxer of its own and not listed.
 */
export const SINGLE_FILE_DEMUXERS: readonly string[] = [
  "mp3", "wav", "w64", "aiff", "caf", "au", "mov", "aac", "ac3", "eac3", "amr", "ogg", "flac", "matroska", "asf", "mpegts", "avi",
  "mpeg", "flv", "dts", "wv", "ape", "tta", "mpc", "mpc8", "loas",
]
