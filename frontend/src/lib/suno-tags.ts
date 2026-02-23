import type { AudioTag } from "./audio-tags"
import type { SuggestionItem } from "@/components/editor/config-panels/tag-textarea"

export const SUNO_TAGS: AudioTag[] = [
  // Structure
  { tag: "[Intro]", label: "Intro", category: "Structure" },
  { tag: "[Verse]", label: "Verse", category: "Structure" },
  { tag: "[Verse 2]", label: "Verse 2", category: "Structure" },
  { tag: "[Pre-Chorus]", label: "Pre-Chorus", category: "Structure" },
  { tag: "[Chorus]", label: "Chorus", category: "Structure" },
  { tag: "[Post-Chorus]", label: "Post-Chorus", category: "Structure" },
  { tag: "[Bridge]", label: "Bridge", category: "Structure" },
  { tag: "[Outro]", label: "Outro", category: "Structure" },
  { tag: "[Hook]", label: "Hook", category: "Structure" },
  { tag: "[Interlude]", label: "Interlude", category: "Structure" },
  { tag: "[Instrumental]", label: "Instrumental", category: "Structure" },
  { tag: "[Solo]", label: "Solo", category: "Structure" },
  { tag: "[Break]", label: "Break", category: "Structure" },
  { tag: "[Drop]", label: "Drop", category: "Structure" },
  { tag: "[Buildup]", label: "Buildup", category: "Structure" },
  { tag: "[Fade Out]", label: "Fade Out", category: "Structure" },
  { tag: "[Fade In]", label: "Fade In", category: "Structure" },
  { tag: "[Chorus x2]", label: "Chorus x2", category: "Structure" },
  { tag: "[Refrain]", label: "Refrain", category: "Structure" },
  { tag: "[Coda]", label: "Coda", category: "Structure" },
  { tag: "[Big Finish]", label: "Big Finish", category: "Structure" },
  { tag: "[End]", label: "End", category: "Structure" },

  // Genre
  { tag: "[Rock]", label: "Rock", category: "Genre" },
  { tag: "[Pop]", label: "Pop", category: "Genre" },
  { tag: "[Hip Hop]", label: "Hip Hop", category: "Genre" },
  { tag: "[R&B]", label: "R&B", category: "Genre" },
  { tag: "[Jazz]", label: "Jazz", category: "Genre" },
  { tag: "[Blues]", label: "Blues", category: "Genre" },
  { tag: "[Country]", label: "Country", category: "Genre" },
  { tag: "[Folk]", label: "Folk", category: "Genre" },
  { tag: "[Electronic]", label: "Electronic", category: "Genre" },
  { tag: "[EDM]", label: "EDM", category: "Genre" },
  { tag: "[House]", label: "House", category: "Genre" },
  { tag: "[Techno]", label: "Techno", category: "Genre" },
  { tag: "[Dubstep]", label: "Dubstep", category: "Genre" },
  { tag: "[Trap]", label: "Trap", category: "Genre" },
  { tag: "[Lo-fi]", label: "Lo-fi", category: "Genre" },
  { tag: "[Ambient]", label: "Ambient", category: "Genre" },
  { tag: "[Metal]", label: "Metal", category: "Genre" },
  { tag: "[Punk]", label: "Punk", category: "Genre" },
  { tag: "[Grunge]", label: "Grunge", category: "Genre" },
  { tag: "[Indie]", label: "Indie", category: "Genre" },
  { tag: "[Soul]", label: "Soul", category: "Genre" },
  { tag: "[Funk]", label: "Funk", category: "Genre" },
  { tag: "[Reggae]", label: "Reggae", category: "Genre" },
  { tag: "[Latin]", label: "Latin", category: "Genre" },
  { tag: "[Bossa Nova]", label: "Bossa Nova", category: "Genre" },
  { tag: "[Afrobeat]", label: "Afrobeat", category: "Genre" },
  { tag: "[K-Pop]", label: "K-Pop", category: "Genre" },
  { tag: "[Classical]", label: "Classical", category: "Genre" },
  { tag: "[Gospel]", label: "Gospel", category: "Genre" },
  { tag: "[Disco]", label: "Disco", category: "Genre" },
  { tag: "[Alternative]", label: "Alternative", category: "Genre" },
  { tag: "[Prog Rock]", label: "Prog Rock", category: "Genre" },
  { tag: "[Surf Rock]", label: "Surf Rock", category: "Genre" },
  { tag: "[Post-Rock]", label: "Post-Rock", category: "Genre" },
  { tag: "[Emo]", label: "Emo", category: "Genre" },
  { tag: "[Hardcore]", label: "Hardcore", category: "Genre" },
  { tag: "[Screamo]", label: "Screamo", category: "Genre" },
  { tag: "[Industrial]", label: "Industrial", category: "Genre" },
  { tag: "[Reggaeton]", label: "Reggaeton", category: "Genre" },
  { tag: "[Dancehall]", label: "Dancehall", category: "Genre" },
  { tag: "[Cumbia]", label: "Cumbia", category: "Genre" },
  { tag: "[Flamenco]", label: "Flamenco", category: "Genre" },
  { tag: "[Synthwave]", label: "Synthwave", category: "Genre" },
  { tag: "[Trance]", label: "Trance", category: "Genre" },
  { tag: "[Drum and Bass]", label: "Drum and Bass", category: "Genre" },
  { tag: "[Grime]", label: "Grime", category: "Genre" },
  { tag: "[Drill]", label: "Drill", category: "Genre" },
  { tag: "[Phonk]", label: "Phonk", category: "Genre" },
  { tag: "[Ska]", label: "Ska", category: "Genre" },
  { tag: "[Swing]", label: "Swing", category: "Genre" },
  { tag: "[Bluegrass]", label: "Bluegrass", category: "Genre" },
  { tag: "[New Wave]", label: "New Wave", category: "Genre" },
  { tag: "[Dream Pop]", label: "Dream Pop", category: "Genre" },
  { tag: "[Shoegaze]", label: "Shoegaze", category: "Genre" },
  { tag: "[Psychedelic]", label: "Psychedelic", category: "Genre" },

  // Vocal Style
  { tag: "[Whisper]", label: "Whisper", category: "Vocal Style" },
  { tag: "[Spoken Word]", label: "Spoken Word", category: "Vocal Style" },
  { tag: "[Rap]", label: "Rap", category: "Vocal Style" },
  { tag: "[Falsetto]", label: "Falsetto", category: "Vocal Style" },
  { tag: "[Belting]", label: "Belting", category: "Vocal Style" },
  { tag: "[Growl]", label: "Growl", category: "Vocal Style" },
  { tag: "[Screaming]", label: "Screaming", category: "Vocal Style" },
  { tag: "[Crooning]", label: "Crooning", category: "Vocal Style" },
  { tag: "[Operatic]", label: "Operatic", category: "Vocal Style" },
  { tag: "[Harmonies]", label: "Harmonies", category: "Vocal Style" },
  { tag: "[Vocal Ad-libs]", label: "Vocal Ad-libs", category: "Vocal Style" },
  { tag: "[Scat]", label: "Scat", category: "Vocal Style" },
  { tag: "[Humming]", label: "Humming", category: "Vocal Style" },
  { tag: "[Acapella]", label: "Acapella", category: "Vocal Style" },

  // Vocal Gender
  { tag: "[Male Vocal]", label: "Male Vocal", category: "Vocal Gender" },
  { tag: "[Female Vocal]", label: "Female Vocal", category: "Vocal Gender" },
  { tag: "[Duet]", label: "Duet", category: "Vocal Gender" },
  { tag: "[Choir]", label: "Choir", category: "Vocal Gender" },
  { tag: "[Boy]", label: "Boy", category: "Vocal Gender" },
  { tag: "[Girl]", label: "Girl", category: "Vocal Gender" },

  // Vocal Effects
  { tag: "[Reverb]", label: "Reverb", category: "Vocal Effects" },
  { tag: "[AutoTune]", label: "AutoTune", category: "Vocal Effects" },
  { tag: "[Distorted Vocals]", label: "Distorted Vocals", category: "Vocal Effects" },
  { tag: "[Vocoder]", label: "Vocoder", category: "Vocal Effects" },
  { tag: "[Telephone Effect]", label: "Telephone Effect", category: "Vocal Effects" },

  // Vocal Emotion
  { tag: "[Vulnerable]", label: "Vulnerable", category: "Vocal Emotion" },
  { tag: "[Powerful]", label: "Powerful", category: "Vocal Emotion" },
  { tag: "[Soft]", label: "Soft", category: "Vocal Emotion" },
  { tag: "[Aggressive]", label: "Aggressive", category: "Vocal Emotion" },
  { tag: "[Melancholic]", label: "Melancholic", category: "Vocal Emotion" },
  { tag: "[Joyful]", label: "Joyful", category: "Vocal Emotion" },
  { tag: "[Sultry]", label: "Sultry", category: "Vocal Emotion" },
  { tag: "[Defiant]", label: "Defiant", category: "Vocal Emotion" },

  // Sound Effects
  { tag: "[Applause]", label: "Applause", category: "Sound Effects" },
  { tag: "[Cheering]", label: "Cheering", category: "Sound Effects" },
  { tag: "[Clapping]", label: "Clapping", category: "Sound Effects" },
  { tag: "[Audience Laughing]", label: "Audience Laughing", category: "Sound Effects" },
  { tag: "[Chuckles]", label: "Chuckles", category: "Sound Effects" },
  { tag: "[Giggles]", label: "Giggles", category: "Sound Effects" },
  { tag: "[Sighs]", label: "Sighs", category: "Sound Effects" },
  { tag: "[Whispers]", label: "Whispers", category: "Sound Effects" },
  { tag: "[Whistling]", label: "Whistling", category: "Sound Effects" },
  { tag: "[Screams]", label: "Screams", category: "Sound Effects" },
  { tag: "[Cough]", label: "Cough", category: "Sound Effects" },
  { tag: "[Clears Throat]", label: "Clears Throat", category: "Sound Effects" },
  { tag: "[Silence]", label: "Silence", category: "Sound Effects" },
  { tag: "[Birds Chirping]", label: "Birds Chirping", category: "Sound Effects" },
  { tag: "[Rain]", label: "Rain", category: "Sound Effects" },
  { tag: "[Thunder]", label: "Thunder", category: "Sound Effects" },
  { tag: "[Record Scratch]", label: "Record Scratch", category: "Sound Effects" },

  // Instruments
  { tag: "[Piano]", label: "Piano", category: "Instruments" },
  { tag: "[Electric Guitar]", label: "Electric Guitar", category: "Instruments" },
  { tag: "[Acoustic Guitar]", label: "Acoustic Guitar", category: "Instruments" },
  { tag: "[Guitar Solo]", label: "Guitar Solo", category: "Instruments" },
  { tag: "[Bass Guitar]", label: "Bass Guitar", category: "Instruments" },
  { tag: "[Drums]", label: "Drums", category: "Instruments" },
  { tag: "[808s]", label: "808s", category: "Instruments" },
  { tag: "[Synth]", label: "Synth", category: "Instruments" },
  { tag: "[Violin]", label: "Violin", category: "Instruments" },
  { tag: "[Cello]", label: "Cello", category: "Instruments" },
  { tag: "[Strings]", label: "Strings", category: "Instruments" },
  { tag: "[Saxophone]", label: "Saxophone", category: "Instruments" },
  { tag: "[Trumpet]", label: "Trumpet", category: "Instruments" },
  { tag: "[Flute]", label: "Flute", category: "Instruments" },
  { tag: "[Harmonica]", label: "Harmonica", category: "Instruments" },
  { tag: "[Organ]", label: "Organ", category: "Instruments" },
  { tag: "[Harp]", label: "Harp", category: "Instruments" },
  { tag: "[Percussion]", label: "Percussion", category: "Instruments" },
  { tag: "[Orchestra]", label: "Orchestra", category: "Instruments" },

  // Mood
  { tag: "[Mood: Euphoric]", label: "Mood: Euphoric", category: "Mood" },
  { tag: "[Mood: Melancholic]", label: "Mood: Melancholic", category: "Mood" },
  { tag: "[Mood: Aggressive]", label: "Mood: Aggressive", category: "Mood" },
  { tag: "[Mood: Dark]", label: "Mood: Dark", category: "Mood" },
  { tag: "[Mood: Chill]", label: "Mood: Chill", category: "Mood" },
  { tag: "[Mood: Romantic]", label: "Mood: Romantic", category: "Mood" },
  { tag: "[Mood: Nostalgic]", label: "Mood: Nostalgic", category: "Mood" },
  { tag: "[Mood: High Energy]", label: "Mood: High Energy", category: "Mood" },

  // Production
  { tag: "[Effect: Lo-fi]", label: "Effect: Lo-fi", category: "Production" },
  { tag: "[Effect: Reverb: Hall]", label: "Effect: Reverb: Hall", category: "Production" },
  { tag: "[Effect: Distortion]", label: "Effect: Distortion", category: "Production" },
  { tag: "[Effect: Fade Out]", label: "Effect: Fade Out", category: "Production" },
  { tag: "[Tempo: 120 BPM]", label: "Tempo: 120 BPM", category: "Production" },
  { tag: "[Tempo: 140 BPM]", label: "Tempo: 140 BPM", category: "Production" },
  { tag: "[Tempo: 90 BPM]", label: "Tempo: 90 BPM", category: "Production" },
  { tag: "[Ritardando]", label: "Ritardando", category: "Production" },
  { tag: "[Accelerando]", label: "Accelerando", category: "Production" },
]

/** All Suno tags as SuggestionItems (with brackets) — for prompt fields */
export const SUNO_SUGGESTION_ITEMS: SuggestionItem[] = SUNO_TAGS.map((t) => ({
  tag: t.tag,
  label: t.label,
  category: t.category,
}))

/**
 * Lyrics-field suggestions (with brackets) — excludes Mood and Production
 * categories which are style descriptors, not lyrics metatags.
 * Vocal Emotion tags ([Powerful], [Joyful]) cover mood in a lyrics-appropriate way.
 */
const LYRICS_EXCLUDED = new Set(["Mood", "Production"])

export const SUNO_LYRICS_SUGGESTION_ITEMS: SuggestionItem[] = SUNO_TAGS
  .filter((t) => !LYRICS_EXCLUDED.has(t.category))
  .map((t) => ({ tag: t.tag, label: t.label, category: t.category }))

/**
 * Style-field suggestions (plain text, no brackets) — for style/negativeStyle fields.
 * Includes Genre, Mood, Instruments, Production, Vocal Style, Vocal Gender.
 * Strips bracket wrappers and "Mood: " / "Effect: " / "Tempo: " prefixes.
 */
const STYLE_CATEGORIES = new Set(["Genre", "Mood", "Instruments", "Production", "Vocal Style", "Vocal Gender"])

export const SUNO_STYLE_SUGGESTION_ITEMS: SuggestionItem[] = SUNO_TAGS
  .filter((t) => STYLE_CATEGORIES.has(t.category))
  .map((t) => {
    // Strip brackets: "[Rock]" → "Rock"
    let plain = t.tag.slice(1, -1)
    // Strip category prefixes: "Mood: Euphoric" → "Euphoric", "Effect: Lo-fi" → "Lo-fi"
    plain = plain.replace(/^(Mood|Effect|Tempo): /, "")
    return { tag: plain, label: plain, category: t.category }
  })
