import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "सूर्योदय", description: "गर्म नीचा सूरज, लंबी छायाएँ" },
  "golden-hour": { label: "Golden Hour", description: "गर्म sunset glow" },
  "noon": { label: "दोपहर", description: "तीखा ऊपर का दोपहर का सूरज" },
  "harsh-midday": { label: "तीखी दोपहर", description: "Bleached सफ़ेद-सूरज zenith" },
  "overcast": { label: "बादल भरा", description: "नरम विसरित दिन की रोशनी" },
  "blue-hour": { label: "Blue Hour", description: "ठंडी शाम की twilight" },
  "twilight": { label: "Twilight", description: "Blue hour और रात के बीच" },
  "night": { label: "रात", description: "गहरी रात, कम ambient" },
  "moonlight": { label: "चाँदनी", description: "ठंडा नीला चाँदनी से भरा scene" },
  "neon-night": { label: "Neon रात", description: "संतृप्त neon city की रात" },

  // Style
  "three-point": { label: "Three-Point", description: "क्लासिक key + fill + back" },
  "rembrandt": { label: "Rembrandt", description: "गाल पर रोशनी का त्रिकोण" },
  "chiaroscuro": { label: "Chiaroscuro", description: "मज़बूत light/dark contrast" },
  "silhouette": { label: "Silhouette", description: "Subject केवल आकार के रूप में" },
  "high-key": { label: "High-Key", description: "उज्ज्वल, low-contrast" },
  "low-key": { label: "Low-Key", description: "गहरा, high-contrast" },
  "split": { label: "Split", description: "आधा-रोशन आधा-छाया चेहरा" },
  "hard": { label: "Hard", description: "तीखी-धार वाली छायाएँ" },
  "soft": { label: "Soft", description: "विसरित कोमल रोशनी" },
  "practical": { label: "Practical", description: "Scene में दिखाई देती रोशनियाँ" },
  // Modern social-video
  "ring-light": { label: "Ring Light", description: "Beauty/vlog ring catchlight" },
  "phone-screen-glow": { label: "Phone Screen Glow", description: "ठंडा screen underlight" },
  "selfie-natural": { label: "Selfie Natural", description: "खिड़की की रोशनी वाला selfie" },
  "natural": { label: "Natural", description: "उपलब्ध ambient रोशनी" },
  "volumetric": { label: "Volumetric", description: "धुंध में दिखाई देती light beams" },
  "noir": { label: "Noir", description: "High-contrast B&W film noir" },
  // Flash & camera-flash
  "on-camera-flash": { label: "On-Camera Flash", description: "Paparazzi/iPhone direct flash" },
  "mirror-bounce-flash": { label: "Mirror-Bounce Flash", description: "Mirror-selfie flash bounce" },
  "bounced-flash": { label: "Bounced Flash", description: "नरम छत-bounce वाली fill" },
  "softbox-key": { label: "Softbox Key", description: "बड़ी विसरित fashion key" },
  "beauty-dish": { label: "Beauty Dish", description: "Hero light, साफ़ falloff" },
  "gridded-snoot": { label: "Gridded Snoot", description: "तंग केंद्रित रोशनी का pool" },
  "silk-diffusion": { label: "Silk Diffusion", description: "Silk-softened कोमल key" },
  "kicker-rim": { label: "Kicker / Rim Accent", description: "नीचे-side accent separator" },
  "candlelight": { label: "मोमबत्ती की रोशनी", description: "गर्म टिमटिमाती आग की रोशनी" },
  "edison-tungsten": { label: "Edison Tungsten", description: "Cozy गर्म globe-bulb glow" },
  "dappled-light": { label: "Dappled / Leaf-Filtered", description: "धब्बेदार पत्तियों से छनी रोशनी" },
  "raking-sidelight": { label: "Raking Sidelight", description: "अत्यधिक नीची side, texture" },
  "stage-spotlight": { label: "Stage Spotlight", description: "एक तीखी ऊपर की spot" },
  "underwater-caustics": { label: "Underwater Caustics", description: "लहराते अपवर्तित patterns" },
  "bioluminescence": { label: "Bioluminescence", description: "ठंडी eerie जैविक चमक" },

  // Direction
  "front": { label: "सामने", description: "Camera की दिशा से रोशनी" },
  "three-quarter": { label: "3/4 Light", description: "क्लासिक portrait key angle" },
  "side": { label: "Side", description: "एक side से रोशनी" },
  "back-rim": { label: "Back / Rim", description: "Subject के चारों ओर backlight rim" },
  "silhouette-backlight": { label: "Silhouette Backlight", description: "उज्ज्वल halo, गहरा subject" },
  "top-overhead": { label: "Top / Overhead", description: "सीधा ऊपर से रोशनी" },
  "under-uplight": { label: "Under / Uplight", description: "नीचे से रोशनी" },
  "window": { label: "खिड़की", description: "खिड़की से नरम sidelight" },

  // Lighting ratio
  "ratio-1-1": { description: "Flat, कोई shadow contrast नहीं" },
  "ratio-1-2": { description: "नरम एक-stop falloff" },
  "ratio-1-3": { description: "मध्यम दो-stop contrast" },
  "ratio-1-4": { description: "मज़बूत editorial contrast" },
  "ratio-1-8": { description: "अत्यधिक low-key chiaroscuro" },
  "ratio-1-16": { description: "एकल-source film-noir falloff" },

  // Color temperature
  "temp-2700k": { description: "गहरा amber मोमबत्ती/tungsten" },
  "temp-3200k": { description: "गर्म पीला अंदरूनी" },
  "temp-4000k": { description: "तटस्थ सफ़ेद" },
  "temp-5600k": { description: "Daylight-संतुलित दोपहर का सूरज" },
  "temp-6500k": { description: "थोड़ा ठंडा नीला cast" },
  "temp-9000k": { description: "स्पष्ट रूप से ठंडी नीली छाँव" },
  "butterfly": { label: "Butterfly Lighting", description: "ऊपर से रोशनी नाक के नीचे butterfly छाया डालती है" },
  "loop": { label: "Loop Lighting", description: "थोड़ा side+ऊपर गाल पर छोटा loop डालता है" },
  "broad": { label: "Broad Lighting", description: "Camera की ओर रोशन side, चौड़ा चेहरा look" },
  "short": { label: "Short Lighting", description: "Camera से दूर रोशन side, slimming" },
  "hatchet": { label: "Hatchet Lighting", description: "ऊपर से skim, विपरीत side पर गहरी छाया" },
  "clamshell": { label: "Clamshell Lighting", description: "ऊपर + नीचे reflector, sandwiched beauty" },
  // Location-studio extension (PR #2505 follow-up)
  "dawn": { label: "उषाकाल", description: "सूर्योदय से पहले की पीली रोशनी" },
  "morning": { label: "सुबह", description: "ताज़ी चमकदार सुबह की रोशनी" },
  "afternoon": { label: "दोपहर बाद", description: "देर दोपहर की गर्म चमक" },
  "dusk": { label: "गोधूलि", description: "सूर्यास्त के बाद की मद्धम रोशनी" },
  "midnight": { label: "मध्यरात्रि", description: "गहरी रात, लगभग काला आकाश" },
}

export default map
