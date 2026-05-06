/**
 * Canonical catalog of Person / subject-appearance choices.
 *
 * Multi-dimension parameter node. Unlike Setting / Style / Camera-Motion
 * (single pick) or Framing (5 dims, all shot composition), Person describes
 * *who the subject is*. Each of the 10 dimensions is mutually exclusive
 * within itself (pick one Type, one Age, one Hair Color, etc.) and all are
 * independently optional.
 *
 *   1.  type                 — primary descriptor (Man, Beautiful Woman, Rugged Man…)
 *   2.  age                  — age range (baby, 30s, 40s, teen, elderly…)
 *   3.  ethnicity            — cultural / demographic background
 *   4.  build                — body silhouette + size (slim, athletic, curvy, tall-lean…)
 *   5.  hair-color           — natural / dyed color
 *   6.  hair-style           — length + texture combo (short, long wavy, braids…)
 *   7.  skin-tone            — skin color
 *   8.  eye-color            — iris color
 *   9.  facial-hair          — beard / mustache style
 *   10. distinctive-features — glasses, freckles, tattoos, scar, dimples, piercing
 *
 * Non-empty selections from each dimension are joined as a compound hint and
 * injected as cinematography context into downstream image/video prompts:
 *   "a beautiful woman, in her 30s, East Asian, slim build, long wavy hair,
 *    brown hair, fair skin, green eyes"
 *
 * Applies to BOTH image and video consumers (a person description is not
 * video-specific, unlike camera-motion / temporal). Not in
 * STILL_IMAGE_EXCLUDE_TYPES.
 *
 * Shared between the picker UI, the standalone Person parameter node, and
 * the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

export type PersonDimension =
  | "type"
  | "age"
  | "ethnicity"
  | "regional-aesthetic"
  | "build"
  | "body-proportions"
  | "face-shape"
  | "jawline"
  | "eye-shape"
  | "nose"
  | "lips"
  | "lip-state"
  | "hair-color"
  | "hair-base"
  | "eyebrows"
  | "skin-tone"
  | "skin-texture"
  | "eye-color"
  | "eye-state"
  | "facial-hair"
  | "distinctive-features"

export interface Person {
  readonly id: string
  readonly label: string
  readonly dimension: PersonDimension
  readonly description: string
  readonly promptHint: string
  /** Optional sub-grouping within a dimension. Used by the picker to render
   *  two-level selection (e.g. ethnicity grouped by region → specific). */
  readonly group?: string
  /** Optional shorter label for the picker chip. When a dimension renders
   *  with group headers (e.g. ethnicity), the group name already supplies
   *  context — so a chip under the "Asian" header shows "East (any)"
   *  instead of the redundant "East Asian (any)". Node cards + tooltips
   *  keep the full `label` / `description`. */
  readonly shortLabel?: string
}

export const PEOPLE: ReadonlyArray<Person> = [
  // -------------------- Type (primary subject descriptor) --------------------
  // Type captures identity / archetype / species. Pure-age subjects (baby,
  // child, teenager) belong in the Age dimension. Entries are tagged with a
  // `group` so the picker renders Type as collapsible sub-sections — the
  // catalog is large enough that flat scrolling isn't usable.
  //
  // Gender policy:
  //  - For species/creatures whose silhouette doesn't depend strongly on
  //    gender, entries are gender-neutral. The user can pair Build / Hair /
  //    Lips for masculine/feminine cues.
  //  - For archetypes with canonical gendered forms (wizard/witch,
  //    sorcerer/sorceress, god/goddess, prince/princess, mer-man/mermaid),
  //    we ship paired entries.

  // ----- Realistic — Plain -----
  { id: "man",               label: "Man",                group: "Realistic",            dimension: "type", description: "Adult man",                     promptHint: "a man" },
  { id: "woman",             label: "Woman",              group: "Realistic",            dimension: "type", description: "Adult woman",                   promptHint: "a woman" },
  // "Not defined" is the open / unspecified slot — distinct from non-binary.
  // Use this when gender shouldn't be pinned in the prompt; the model gets
  // "a person" and ethnicity / build / hair drive the rest.
  { id: "not-defined",       label: "Not Defined",        group: "Realistic",            dimension: "type", description: "Gender not specified — left open", promptHint: "a person" },

  // ----- Realistic — Aesthetic / archetype -----
  { id: "beautiful-woman",   label: "Beautiful Woman",    group: "Realistic — Style",    dimension: "type", description: "Classically beautiful woman",   promptHint: "a beautiful woman" },
  { id: "girl-next-door",    label: "Girl Next Door",     group: "Realistic — Style",    dimension: "type", description: "Friendly, approachable, wholesome", promptHint: "a girl-next-door type — friendly, approachable, natural beauty with wholesome charm" },
  { id: "handsome-man",      label: "Handsome Man",       group: "Realistic — Style",    dimension: "type", description: "Classically handsome man",      promptHint: "a handsome man" },
  { id: "boy-next-door",     label: "Boy Next Door",      group: "Realistic — Style",    dimension: "type", description: "Friendly, approachable, wholesome", promptHint: "a boy-next-door type — friendly, approachable, with wholesome charm" },
  { id: "gentleman",         label: "Gentleman",          group: "Realistic — Style",    dimension: "type", description: "Refined, classic, polished man", promptHint: "a refined gentleman with classic elegance and polished presence" },
  { id: "elegant-woman",     label: "Elegant Woman",      group: "Realistic — Style",    dimension: "type", description: "Poised, refined woman",         promptHint: "an elegant, poised woman" },
  { id: "rugged-man",        label: "Rugged Man",         group: "Realistic — Style",    dimension: "type", description: "Weathered, rugged man",         promptHint: "a rugged, weathered man" },
  { id: "bad-boy",           label: "Bad Boy",            group: "Realistic — Style",    dimension: "type", description: "Rebellious, edgy masculine",    promptHint: "a bad boy with rebellious, edgy attitude and a dangerous charm" },
  { id: "graceful-woman",    label: "Graceful Woman",     group: "Realistic — Style",    dimension: "type", description: "Gentle, graceful woman",        promptHint: "a graceful woman" },
  { id: "baddie",            label: "Baddie",             group: "Realistic — Style",    dimension: "type", description: "Confident, trendy, styled woman", promptHint: "a baddie — a confident, trendy woman with styled makeup and a fashion-forward look" },
  { id: "stylish-influencer", label: "Stylish Influencer", group: "Realistic — Style",   dimension: "type", description: "Polished social-media tastemaker", promptHint: "a stylish social-media influencer — polished personal-brand styling, trend-forward outfit, expressive natural posing for the camera, the curated put-together look of a content creator" },
  { id: "stunning-model",    label: "Stunning Model",     group: "Realistic — Style",    dimension: "type", description: "Fashion-model aesthetic",         promptHint: "a stunning fashion model with editorial poise, refined features, and high-fashion presence" },
  { id: "supermodel",        label: "Supermodel",         group: "Realistic — Style",    dimension: "type", description: "Iconic, top-tier runway and cover star", promptHint: "a supermodel — iconic top-tier presence with magnetic statement features, a striking silhouette and the unmistakable runway-and-cover aura that commands attention" },
  { id: "femme-fatale",      label: "Femme Fatale",       group: "Realistic — Style",    dimension: "type", description: "Alluring, dangerous noir seductress", promptHint: "a femme fatale — alluring, mysterious, and dangerous with classic noir seduction" },
  { id: "tough-guy",         label: "Tough Guy",          group: "Realistic — Style",    dimension: "type", description: "Hardened, tough man",           promptHint: "a tough, hardened man" },
  // Aesthetic archetypes that traditionally read older — hints kept gender +
  // look-focused so the Age dimension stays in control of the literal age.
  { id: "wise-elder",        label: "Wise Elder",         group: "Realistic — Style",    dimension: "type", description: "Knowing, sage presence",        promptHint: "a wise, sage figure with a knowing, contemplative presence" },
  { id: "silver-fox",        label: "Silver Fox",         group: "Realistic — Style",    dimension: "type", description: "Distinguished man with silver-gray hair", promptHint: "a silver fox — a distinguished man with silver-gray hair and a confident, magnetic presence" },
  { id: "mysterious-figure", label: "Mysterious Figure",  group: "Realistic — Style",    dimension: "type", description: "Enigmatic figure",              promptHint: "a mysterious figure" },
  { id: "femboy",            label: "Femboy",             group: "Realistic — Style",    dimension: "type", description: "Soft-feminine masculine type, gender-fluid styling", promptHint: "a femboy — soft-feminine masculine presentation with gender-fluid styling" },
  { id: "twink",             label: "Twink",              group: "Realistic — Style",    dimension: "type", description: "Slim, smooth, soft gay-male type", promptHint: "a twink — slim, smooth, soft masculine presence with a delicate, gender-fluid vibe" },
  { id: "soft-butch",        label: "Soft Butch",         group: "Realistic — Style",    dimension: "type", description: "Gentle masculine-of-center woman", promptHint: "a soft-butch woman — gentle masculine-of-center styling and energy" },
  { id: "tomboy",            label: "Tomboy",             group: "Realistic — Style",    dimension: "type", description: "Boyish styling and energy on a feminine body", promptHint: "a tomboy — boyish styling and energy on a feminine body" },
  { id: "thick",             label: "Thick",              group: "Realistic — Style",    dimension: "type", description: "Voluptuous body-positive figure with curves", promptHint: "a thick, voluptuous body-positive figure with full curves" },
  { id: "bear",              label: "Bear",               group: "Realistic — Style",    dimension: "type", description: "Big, bearded, hairy masculine type", promptHint: "a bear — a big, bearded, hairy man with a warm masculine presence" },

  // ----- Primitive / Wild -----
  { id: "caveman",           label: "Caveman",            group: "Primitive / Wild",     dimension: "type", description: "Stone Age primitive man",       promptHint: "a caveman — Stone Age primitive in animal furs, with shaggy hair, a heavy brow and a sturdy frame" },
  { id: "cavewoman",         label: "Cavewoman",          group: "Primitive / Wild",     dimension: "type", description: "Stone Age primitive woman",     promptHint: "a cavewoman — Stone Age primitive in animal furs, with shaggy hair and a sturdy frame" },
  { id: "apeman",            label: "Apeman",             group: "Primitive / Wild",     dimension: "type", description: "Half-human half-ape hybrid",    promptHint: "an apeman — half-human half-ape hybrid with simian features, broad shoulders and a heavy stooped build" },
  { id: "feral-wildman",     label: "Feral Wild-Human",   group: "Primitive / Wild",     dimension: "type", description: "Overgrown, primal feral human", promptHint: "a feral wild-human — overgrown matted hair, primal eyes and a near-naked, bestial bearing" },
  { id: "neanderthal",       label: "Neanderthal",        group: "Primitive / Wild",     dimension: "type", description: "Pre-modern human species",      promptHint: "a neanderthal — heavy brow, broad nose, stocky pre-modern human build with weather-toughened skin" },

  // ----- Fantasy (humanoid) -----
  { id: "elf-man",           label: "Elf (Male)",         group: "Fantasy",              dimension: "type", description: "Masculine pointed-ear humanoid", promptHint: "a male elf — slender masculine humanoid with delicately pointed ears, fine sharp features and an ethereal poise" },
  { id: "elf-woman",         label: "Elf (Female)",       group: "Fantasy",              dimension: "type", description: "Feminine pointed-ear humanoid", promptHint: "a female elf — slender feminine humanoid with delicately pointed ears, fine elegant features and an ethereal poise" },
  { id: "elf",               label: "Elf",                group: "Fantasy",              dimension: "type", description: "Slender humanoid with pointed ears", promptHint: "an elf — slender humanoid with delicately pointed ears, fine features and an ethereal poise" },
  { id: "half-elf",          label: "Half-Elf",           group: "Fantasy",              dimension: "type", description: "Mixed elven-human heritage",    promptHint: "a half-elf with subtly pointed ears and a graceful blend of human and elven features" },
  { id: "dwarf",             label: "Dwarf",              group: "Fantasy",              dimension: "type", description: "Stocky mountain-folk humanoid", promptHint: "a dwarf — stocky, broad-shouldered humanoid with a thick beard and a hardy mountain-folk look" },
  { id: "orc",               label: "Orc",                group: "Fantasy",              dimension: "type", description: "Heavyset tusked humanoid",      promptHint: "an orc — heavyset humanoid with greenish skin, jutting tusks and a brutish, battle-scarred build" },
  { id: "goblin",            label: "Goblin",             group: "Fantasy",              dimension: "type", description: "Small, wiry humanoid",          promptHint: "a goblin — small, wiry humanoid with sharp features, oversized ears and a mischievous look" },
  { id: "tiefling",          label: "Tiefling",           group: "Fantasy",              dimension: "type", description: "Horned humanoid with infernal heritage", promptHint: "a tiefling — humanoid with curling horns, a tail and faintly otherworldly skin tones" },
  { id: "faun",              label: "Faun / Satyr",       group: "Fantasy",              dimension: "type", description: "Goat-legged horned humanoid",   promptHint: "a faun — humanoid with goat legs, small curling horns and a woodland presence" },
  { id: "centaur",           label: "Centaur",            group: "Fantasy",              dimension: "type", description: "Human torso on a horse body",   promptHint: "a centaur — human torso fused to the body of a horse" },
  { id: "vampire-man",       label: "Vampire (Male)",     group: "Fantasy",              dimension: "type", description: "Masculine fanged immortal",     promptHint: "a male vampire — pale, fanged immortal man in formal evening wear with gothic elegance and a quiet predatory poise" },
  { id: "vampire-woman",     label: "Vampire (Female)",   group: "Fantasy",              dimension: "type", description: "Feminine fanged immortal",      promptHint: "a female vampire — pale, fanged immortal woman in flowing gothic attire with seductive elegance and a quiet predatory poise" },
  { id: "vampire",           label: "Vampire",            group: "Fantasy",              dimension: "type", description: "Pale, fanged immortal",         promptHint: "a vampire — pale, fanged immortal with a pristine gothic elegance and a quiet predatory poise" },
  { id: "werewolf",          label: "Werewolf",           group: "Fantasy",              dimension: "type", description: "Partially transformed lycanthrope", promptHint: "a werewolf — partially transformed humanoid with wolfish snout, fur, claws and a feral musculature" },
  { id: "mermaid",           label: "Mermaid",            group: "Fantasy",              dimension: "type", description: "Female humanoid with a fish tail", promptHint: "a mermaid — humanoid woman from the waist up with a long iridescent fish tail below" },
  { id: "merman",            label: "Merman",             group: "Fantasy",              dimension: "type", description: "Male humanoid with a fish tail", promptHint: "a merman — humanoid man from the waist up with a long iridescent fish tail below" },
  { id: "dragonkin",         label: "Dragonkin",          group: "Fantasy",              dimension: "type", description: "Scaled draconic humanoid",      promptHint: "dragonkin — humanoid with scaled skin, ridged horns and reptilian draconic features" },
  { id: "wizard",            label: "Wizard",             group: "Fantasy",              dimension: "type", description: "Robed male spellcaster",        promptHint: "a wizard — robed male spellcaster with arcane symbols, a long staff and a contemplative bearing" },
  { id: "witch",             label: "Witch",              group: "Fantasy",              dimension: "type", description: "Robed female spellcaster",      promptHint: "a witch — robed female spellcaster with arcane sigils, a knowing gaze and a quietly powerful air" },
  { id: "sorcerer",          label: "Sorcerer",           group: "Fantasy",              dimension: "type", description: "Magical man in flowing robes",  promptHint: "a sorcerer — magical man in flowing robes wreathed in arcane glow" },
  { id: "sorceress",         label: "Sorceress",          group: "Fantasy",              dimension: "type", description: "Magical woman in flowing robes", promptHint: "a sorceress — magical woman in flowing robes wreathed in arcane glow" },
  { id: "knight-man",        label: "Knight (Male)",      group: "Fantasy",              dimension: "type", description: "Plate-armoured male warrior",   promptHint: "a male knight in full plate armour with a heraldic surcoat, broad-shouldered build and a steady warrior's stance" },
  { id: "knight-woman",      label: "Knight (Female)",    group: "Fantasy",              dimension: "type", description: "Plate-armoured female warrior", promptHint: "a female knight — warrior maiden in full plate armour with a heraldic surcoat, a poised stance and steady warrior's bearing" },
  { id: "knight",            label: "Knight",             group: "Fantasy",              dimension: "type", description: "Plate-armoured warrior",        promptHint: "a knight in full plate armour with a heraldic surcoat and a steady warrior's stance" },
  { id: "barbarian-man",     label: "Barbarian (Male)",   group: "Fantasy",              dimension: "type", description: "Brawny male fur-clad warrior", promptHint: "a male barbarian — brawny masculine warrior in furs and tribal markings, weathered and battle-ready" },
  { id: "barbarian-woman",   label: "Barbarian (Female)", group: "Fantasy",              dimension: "type", description: "Strong female fur-clad warrior", promptHint: "a female barbarian — strong woman warrior in furs and tribal markings, weathered and battle-ready" },
  { id: "barbarian",         label: "Barbarian",          group: "Fantasy",              dimension: "type", description: "Brawny fur-clad warrior",       promptHint: "a barbarian — brawny warrior in furs and tribal markings, weathered and battle-ready" },
  { id: "druid",             label: "Druid",              group: "Fantasy",              dimension: "type", description: "Nature-bound robed mystic",     promptHint: "a druid — robed nature-binder wreathed in foliage, antler accents and earthy ornaments" },
  { id: "ranger",            label: "Ranger",             group: "Fantasy",              dimension: "type", description: "Cloaked archer / wilderness scout", promptHint: "a ranger — cloaked archer in muted leather and forest greens, alert wilderness bearing" },
  { id: "necromancer",       label: "Necromancer",        group: "Fantasy",              dimension: "type", description: "Pale dark-arts spellcaster",    promptHint: "a necromancer — pale robed figure with dark sigils and a corpse-cold aura" },
  { id: "prince",            label: "Prince",             group: "Fantasy",              dimension: "type", description: "Royal young man",               promptHint: "a prince — royal young man in tailored regalia with a poised, courtly bearing" },
  { id: "princess",          label: "Princess",           group: "Fantasy",              dimension: "type", description: "Royal young woman",             promptHint: "a princess — royal young woman in flowing regalia with a poised, courtly bearing" },

  // ----- Warriors / Martial -----
  { id: "ninja",             label: "Ninja",              group: "Warriors / Martial",   dimension: "type", description: "Stealth-clad shinobi assassin", promptHint: "a ninja — masked shinobi in a black hooded shozoku with face wrap, lean athletic build, twin sword on the back and a stealthy combat-ready stance" },
  { id: "kunoichi",          label: "Kunoichi",           group: "Warriors / Martial",   dimension: "type", description: "Female ninja",                  promptHint: "a kunoichi — female ninja in a fitted black hooded shozoku with face wrap, lean athletic build and a stealthy combat-ready stance" },
  { id: "samurai-man",       label: "Samurai (Male)",     group: "Warriors / Martial",   dimension: "type", description: "Male Japanese armoured warrior", promptHint: "a male samurai — Japanese warrior in lacquered lamellar yoroi armour with shoulder guards, kabuto helmet, top-knot under the helmet, katana at the hip and a disciplined battle-ready stance" },
  { id: "samurai-woman",     label: "Samurai (Female)",   group: "Warriors / Martial",   dimension: "type", description: "Female samurai (onna-musha)",   promptHint: "a female samurai — onna-musha warrior in lacquered lamellar yoroi armour with shoulder guards, hair tied up, naginata or katana in hand and a disciplined battle-ready stance" },
  { id: "samurai",           label: "Samurai",            group: "Warriors / Martial",   dimension: "type", description: "Japanese armoured warrior",     promptHint: "a samurai — Japanese warrior in lacquered lamellar yoroi armour with shoulder guards, kabuto helmet, katana at the hip and a disciplined battle-ready stance" },
  { id: "karate-fighter",    label: "Karate Fighter",     group: "Warriors / Martial",   dimension: "type", description: "Karate practitioner in gi",     promptHint: "a karate practitioner in a crisp white karate gi tied with a black belt, barefoot, in a focused fighting stance" },
  { id: "kung-fu-master",    label: "Kung Fu Master",     group: "Warriors / Martial",   dimension: "type", description: "Chinese martial-arts adept",    promptHint: "a kung fu master in a flowing silk changshan tunic with frog-button closures, slippers and a poised martial stance, decades-of-training discipline" },
  { id: "shaolin-monk",      label: "Shaolin Monk",       group: "Warriors / Martial",   dimension: "type", description: "Buddhist warrior monk",         promptHint: "a Shaolin warrior monk with a shaved head, ochre and saffron robes wrapped over the shoulder, prayer beads, calloused hands and a centred meditative martial bearing" },
  { id: "sumo-wrestler",     label: "Sumo Wrestler",      group: "Warriors / Martial",   dimension: "type", description: "Japanese sumo competitor",      promptHint: "a sumo wrestler — heavy-set Japanese fighter in a thick mawashi loincloth, top-knot chonmage hairstyle, broad imposing build planted in a low ready stance" },
  { id: "gladiator",         label: "Gladiator",          group: "Warriors / Martial",   dimension: "type", description: "Roman arena fighter",           promptHint: "a gladiator — Roman arena fighter in a leather subligaculum, manica arm guard, greaves and a galea helmet, gladius and scutum shield, scarred and battle-hardened" },
  { id: "spartan-warrior",   label: "Spartan Warrior",    group: "Warriors / Martial",   dimension: "type", description: "Ancient Greek hoplite",         promptHint: "a Spartan hoplite — bronze Corinthian helmet with horsehair crest, crimson cloak, round aspis shield, dory spear, leather kilt and greaves, disciplined warrior bearing" },
  { id: "viking-warrior",    label: "Viking Warrior",     group: "Warriors / Martial",   dimension: "type", description: "Norse raider",                  promptHint: "a Viking warrior — bearded Norse raider in a chainmail hauberk over a leather tunic, fur cloak, round wooden shield with iron boss, axe in hand and a horned-or-conical iron helm" },
  { id: "mongol-warrior",    label: "Mongol Warrior",     group: "Warriors / Martial",   dimension: "type", description: "Steppe horse archer",           promptHint: "a Mongol warrior — steppe horse archer in lamellar leather armour over a quilted coat, fur-trimmed conical helmet, recurve bow and quiver, weathered nomadic bearing" },
  { id: "centurion",         label: "Centurion",          group: "Warriors / Martial",   dimension: "type", description: "Roman legionary officer",       promptHint: "a Roman centurion in segmented lorica armour, transverse-crested galea helmet, red tunic and cape, gladius at the hip, vine staff in hand and a commanding bearing" },
  { id: "crusader",          label: "Crusader Knight",    group: "Warriors / Martial",   dimension: "type", description: "Medieval crusader",             promptHint: "a Crusader knight — chainmail hauberk under a white surcoat with a red cross emblem, conical helm, longsword and kite shield, devout warrior bearing" },
  { id: "pirate",            label: "Pirate",             group: "Warriors / Martial",   dimension: "type", description: "Golden-age pirate / buccaneer", promptHint: "a pirate — Golden-Age buccaneer in a tricorn hat, weathered long coat, cutlass at the hip, flintlock pistol tucked in the belt, eyepatch or beaded beard, salty seafarer's swagger" },
  { id: "musketeer",         label: "Musketeer",          group: "Warriors / Martial",   dimension: "type", description: "17th-century French swordsman", promptHint: "a 17th-century French musketeer in a wide-brimmed feathered hat, blue tabard with white cross, leather doublet, rapier at the hip, dashing swordsman's bearing" },

  // ----- Mythic / Divine -----
  { id: "angel",             label: "Angel",              group: "Mythic / Divine",      dimension: "type", description: "Winged divine humanoid",        promptHint: "an angel — humanoid with luminous feathered wings, a soft halo of light and a serene divine presence" },
  { id: "demon",             label: "Demon",              group: "Mythic / Divine",      dimension: "type", description: "Horned infernal humanoid",      promptHint: "a demon — horned humanoid with red or charcoal skin, infernal eyes and a smouldering aura" },
  { id: "ghost",             label: "Ghost",              group: "Mythic / Divine",      dimension: "type", description: "Translucent spectral figure",   promptHint: "a ghost — translucent humanoid figure with a faint pale glow and a haunting drifting silhouette" },
  { id: "valkyrie",          label: "Valkyrie",           group: "Mythic / Divine",      dimension: "type", description: "Norse warrior-spirit woman",    promptHint: "a valkyrie — armoured warrior woman with metal-feathered wings and a shield-maiden's bearing" },
  { id: "god",               label: "God",                group: "Mythic / Divine",      dimension: "type", description: "Male deity",                    promptHint: "a god — male deity with a radiant divine aura, idealised features and an aura of immense power" },
  { id: "goddess",           label: "Goddess",            group: "Mythic / Divine",      dimension: "type", description: "Female deity",                  promptHint: "a goddess — female deity with a radiant divine aura, idealised features and an aura of immense power" },

  // ----- Sci-Fi -----
  { id: "android-man",       label: "Android (Male)",     group: "Sci-Fi",               dimension: "type", description: "Masculine humanoid robot",      promptHint: "an android — humanoid robot with a masculine sculpt, smooth synthetic skin and visible mechanical seams" },
  { id: "android-woman",     label: "Android (Female)",   group: "Sci-Fi",               dimension: "type", description: "Feminine humanoid robot",       promptHint: "an android — humanoid robot with a feminine sculpt, smooth synthetic skin and visible mechanical seams" },
  { id: "android-neutral",   label: "Android",            group: "Sci-Fi",               dimension: "type", description: "Humanoid robot, gender unspecified", promptHint: "an androgynous android — humanoid robot with a neutral sculpt and exposed precision servos" },
  { id: "cyborg-man",        label: "Cyborg (Male)",      group: "Sci-Fi",               dimension: "type", description: "Masculine human-machine hybrid", promptHint: "a male cyborg — masculine human body fused with mechanical augmentations, cybernetic limbs and partial exposed circuitry" },
  { id: "cyborg-woman",      label: "Cyborg (Female)",    group: "Sci-Fi",               dimension: "type", description: "Feminine human-machine hybrid", promptHint: "a female cyborg — feminine human body fused with mechanical augmentations, cybernetic limbs and partial exposed circuitry" },
  { id: "cyborg",            label: "Cyborg",             group: "Sci-Fi",               dimension: "type", description: "Human-machine hybrid",          promptHint: "a cyborg — human body fused with mechanical augmentations, cybernetic limbs and partial exposed circuitry" },
  { id: "robot",             label: "Robot",              group: "Sci-Fi",               dimension: "type", description: "Fully mechanical humanoid",     promptHint: "a robot — fully mechanical humanoid with metal plating, articulated joints and glowing optical sensors" },
  { id: "alien",             label: "Alien",              group: "Sci-Fi",               dimension: "type", description: "Non-human humanoid",            promptHint: "an alien — non-human humanoid with otherworldly facial features, unusual skin tone and unfamiliar proportions" },
  { id: "astronaut",         label: "Astronaut",          group: "Sci-Fi",               dimension: "type", description: "Suited space explorer",         promptHint: "an astronaut in a sealed pressure suit and reflective helmet visor with mission patches across the chest" },
  { id: "space-marine",      label: "Space Marine",       group: "Sci-Fi",               dimension: "type", description: "Power-armoured soldier",        promptHint: "a space marine in heavy power armour with a sealed helmet, reinforced shoulder pauldrons and a slung weapon harness" },
  { id: "ai-hologram",       label: "AI Hologram",        group: "Sci-Fi",               dimension: "type", description: "Volumetric light figure",       promptHint: "an AI hologram — humanoid figure rendered as translucent volumetric light with subtle scanline shimmer" },

  // ----- Heroes & Villains -----
  { id: "superhero",         label: "Superhero",          group: "Heroes & Villains",    dimension: "type", description: "Masked caped male hero",        promptHint: "a superhero — masked, caped, in a fitted spandex suit with a chest emblem and a heroic ready stance" },
  { id: "superheroine",      label: "Superheroine",       group: "Heroes & Villains",    dimension: "type", description: "Masked caped female hero",      promptHint: "a superheroine — masked, caped, in a fitted spandex suit with a chest emblem and a heroic ready stance" },
  { id: "masked-vigilante",  label: "Masked Vigilante",   group: "Heroes & Villains",    dimension: "type", description: "Dark-suited masked hero",       promptHint: "a masked vigilante — dark tactical bodysuit with a half-mask covering the eyes, urban gritty aesthetic" },
  { id: "supervillain",      label: "Supervillain",       group: "Heroes & Villains",    dimension: "type", description: "Theatrical evil archetype",     promptHint: "a supervillain — theatrical menacing costume with a sinister emblem, dramatic cape and a commanding villain bearing" },
  { id: "caped-crusader-man",   label: "Caped Crusader (Male)",   group: "Heroes & Villains", dimension: "type", description: "Armored cowled male dark hero",   promptHint: "a male caped crusader — armoured cowled masculine hero in dark colors with reinforced gauntlets, utility belt and a heavy cape" },
  { id: "caped-crusader-woman", label: "Caped Crusader (Female)", group: "Heroes & Villains", dimension: "type", description: "Armored cowled female dark hero", promptHint: "a female caped crusader — armoured cowled feminine hero in dark colors with reinforced gauntlets, utility belt and a heavy cape" },
  { id: "caped-crusader",       label: "Caped Crusader",        group: "Heroes & Villains", dimension: "type", description: "Armored cowled dark hero",      promptHint: "a caped crusader — armoured cowled hero in dark colors with reinforced gauntlets, utility belt and a heavy cape" },
  { id: "super-soldier",     label: "Super-Soldier",      group: "Heroes & Villains",    dimension: "type", description: "Patriotic exo-armoured warrior", promptHint: "a super-soldier — military-grade exo-armour with patriotic markings, reinforced helm and a star-spangled emblem" },
  { id: "mutant",            label: "Mutant",             group: "Heroes & Villains",    dimension: "type", description: "Human with one or two visible mutations", promptHint: "a mutant — human-baseline body with one or two visible mutations such as unusual skin pigmentation, glowing eyes, claws or gills" },
  { id: "magical-girl",      label: "Magical Girl",       group: "Heroes & Villains",    dimension: "type", description: "Transforming-heroine archetype",  promptHint: "a magical girl — transforming heroine in a frilled costume with sparkles, ribbons, ornamented accessories and a transformation aura" },

  // ----- Professions / Roles -----
  { id: "police-officer",    label: "Police Officer",     group: "Professions / Roles",  dimension: "type", description: "Uniformed officer of the law",  promptHint: "a police officer in a navy-blue uniform with badge, duty belt with holstered sidearm and radio, peaked cap or service hat, professional law-enforcement bearing" },
  { id: "policeman",         label: "Policeman",          group: "Professions / Roles",  dimension: "type", description: "Male police officer",           promptHint: "a male police officer in a navy-blue uniform with badge, duty belt with holstered sidearm, peaked cap, professional law-enforcement bearing" },
  { id: "policewoman",       label: "Policewoman",        group: "Professions / Roles",  dimension: "type", description: "Female police officer",         promptHint: "a female police officer in a navy-blue uniform with badge, duty belt with holstered sidearm, hair tucked under a service cap, professional law-enforcement bearing" },
  { id: "firefighter",       label: "Firefighter",        group: "Professions / Roles",  dimension: "type", description: "Bunker-gear emergency responder", promptHint: "a firefighter in heavy yellow-and-tan turnout gear with reflective stripes, helmet with visor, suspenders and rubber boots, soot-streaked and ready for action" },
  { id: "doctor",            label: "Doctor",             group: "Professions / Roles",  dimension: "type", description: "Physician in white coat",       promptHint: "a doctor in a white medical coat over scrubs with a stethoscope around the neck, professional clinical bearing" },
  { id: "surgeon",           label: "Surgeon",            group: "Professions / Roles",  dimension: "type", description: "Operating-room surgeon",        promptHint: "a surgeon in teal or blue surgical scrubs with a surgical mask pulled down to the neck, scrub cap and gloved hands, focused operating-room bearing" },
  { id: "nurse",             label: "Nurse",              group: "Professions / Roles",  dimension: "type", description: "Hospital nurse in scrubs",      promptHint: "a nurse in coloured medical scrubs with an ID badge, stethoscope around the neck and a warm professional caregiver bearing" },
  { id: "chef",              label: "Chef",               group: "Professions / Roles",  dimension: "type", description: "Kitchen-uniformed cook",        promptHint: "a chef in a crisp white double-breasted chef's coat with a tall white toque hat, knotted neckerchief and an apron, focused culinary bearing" },
  { id: "teacher",           label: "Teacher",            group: "Professions / Roles",  dimension: "type", description: "Classroom educator",            promptHint: "a teacher in smart-casual professional attire — a button-down or blouse with a cardigan or blazer, holding a book or marker, warm patient educator bearing" },
  { id: "priest",            label: "Priest",             group: "Professions / Roles",  dimension: "type", description: "Catholic clergyman",            promptHint: "a priest in a black cassock with a white Roman collar, hands folded, calm devout clerical bearing" },
  { id: "nun",               label: "Nun",                group: "Professions / Roles",  dimension: "type", description: "Catholic woman religious",      promptHint: "a nun in a black habit and white wimple framing the face, scapular and rosary at the waist, hands folded in serene devout bearing" },
  { id: "soldier",           label: "Soldier",            group: "Professions / Roles",  dimension: "type", description: "Modern military service member", promptHint: "a soldier in modern camouflage combat fatigues with body armour, helmet, slung rifle and tactical gear, disciplined military bearing" },
  { id: "lawyer",            label: "Lawyer",             group: "Professions / Roles",  dimension: "type", description: "Suited attorney",               promptHint: "a lawyer in a sharp tailored business suit with a dress shirt and tie or blouse, holding a leather portfolio, polished professional courtroom bearing" },
  { id: "judge",             label: "Judge",              group: "Professions / Roles",  dimension: "type", description: "Robed judicial officer",        promptHint: "a judge in a long black judicial robe over a shirt and collar, gavel in hand, an authoritative impartial courtroom bearing" },
  { id: "scientist",         label: "Scientist",          group: "Professions / Roles",  dimension: "type", description: "Lab-coated researcher",         promptHint: "a scientist in a white lab coat with safety goggles around the neck, holding a clipboard or beaker, focused inquisitive research bearing" },
  { id: "pilot",             label: "Pilot",              group: "Professions / Roles",  dimension: "type", description: "Commercial-airline pilot",      promptHint: "a commercial airline pilot in a navy-blue uniform with gold stripes on the sleeves, peaked cap with airline insignia, white shirt and black tie, confident captain's bearing" },
  { id: "flight-attendant",  label: "Flight Attendant",   group: "Professions / Roles",  dimension: "type", description: "Cabin-crew member",             promptHint: "a flight attendant in a tailored airline uniform with neck scarf or tie, name tag and wings pin, polished hospitable cabin-crew bearing" },
  { id: "construction-worker", label: "Construction Worker", group: "Professions / Roles", dimension: "type", description: "Hard-hatted builder",          promptHint: "a construction worker in a high-visibility safety vest over a work shirt, hard hat, work jeans and steel-toed boots, tool belt at the waist, hands-on builder bearing" },
  { id: "businessman",       label: "Businessman",        group: "Professions / Roles",  dimension: "type", description: "Suited corporate man",          promptHint: "a businessman in a sharp tailored two-piece suit with a crisp dress shirt and tie, polished leather shoes, briefcase in hand, confident corporate bearing" },
  { id: "businesswoman",     label: "Businesswoman",      group: "Professions / Roles",  dimension: "type", description: "Suited corporate woman",        promptHint: "a businesswoman in a tailored skirt or trouser suit with a blouse, heels or smart flats, holding a portfolio, confident corporate bearing" },
  { id: "farmer",            label: "Farmer",             group: "Professions / Roles",  dimension: "type", description: "Agricultural worker",           promptHint: "a farmer in worn denim overalls over a flannel shirt, a wide-brimmed straw or trucker hat, work boots and weathered hands, rustic agricultural bearing" },
  { id: "mechanic",          label: "Mechanic",           group: "Professions / Roles",  dimension: "type", description: "Auto / industrial mechanic",    promptHint: "a mechanic in oil-stained navy coveralls or work shirt with rolled sleeves, grease-streaked hands, a wrench in hand and a name patch on the chest" },
  { id: "artist",            label: "Artist",             group: "Professions / Roles",  dimension: "type", description: "Painter / visual artist",       promptHint: "an artist in paint-spattered casual clothing with rolled-up sleeves, brush or palette in hand, an inquisitive creative bearing" },
  { id: "musician",          label: "Musician",           group: "Professions / Roles",  dimension: "type", description: "Performer with instrument",     promptHint: "a musician holding their instrument in a stylish performance outfit, expressive performer's bearing" },
  { id: "athlete",           label: "Athlete",            group: "Professions / Roles",  dimension: "type", description: "Pro-sport competitor",          promptHint: "an athlete in technical performance sportswear with a defined athletic build, focused competitive bearing" },
  { id: "detective",         label: "Detective",          group: "Professions / Roles",  dimension: "type", description: "Plain-clothes investigator",    promptHint: "a plain-clothes detective in a rumpled trench coat or sport jacket over a dress shirt, badge clipped to the belt, sharp investigative bearing" },
  { id: "journalist",        label: "Journalist",         group: "Professions / Roles",  dimension: "type", description: "Reporter with notebook / camera", promptHint: "a journalist with a press lanyard, notebook and pen or microphone in hand, smart-casual professional attire, alert reporter's bearing" },
  { id: "barista",           label: "Barista",            group: "Professions / Roles",  dimension: "type", description: "Coffee-shop server",            promptHint: "a barista in a dark apron over a casual t-shirt, name tag, behind-the-counter bearing with a friendly café-staff vibe" },

  // ----- Hybrid / Anthro -----
  // Person archetypes — visual style (anime, realistic, painterly…) is
  // chosen separately via the Style node, so prompts here describe the
  // creature without baking in any specific art style.
  { id: "catgirl",           label: "Catgirl",            group: "Hybrid / Anthro",      dimension: "type", description: "Woman with cat ears and tail",  promptHint: "a catgirl — humanoid woman with cat ears on her head and a soft cat tail" },
  { id: "catboy",            label: "Catboy",             group: "Hybrid / Anthro",      dimension: "type", description: "Man with cat ears and tail",    promptHint: "a catboy — humanoid man with cat ears on his head and a soft cat tail" },
  { id: "anthro",            label: "Anthropomorphic",    group: "Hybrid / Anthro",      dimension: "type", description: "Bipedal animal-headed humanoid", promptHint: "an anthropomorphic animal humanoid — bipedal body in human stance with an animal head, fur and animal tail" },

  // ----- Iconic / Public Domain -----
  // Only public-domain figures — modern trademarked characters (Superman,
  // Spider-Man, Yoda, Mickey, etc.) are deliberately NOT shipped as named
  // entries. Users wanting them can type the name into the prompt; we don't
  // ship a button.
  { id: "sherlock-holmes",      label: "Sherlock Holmes",       group: "Iconic / Public Domain", dimension: "type", description: "Victorian consulting detective",   promptHint: "Sherlock Holmes — Victorian consulting detective in a tweed deerstalker hat and Inverness cape, pipe in hand, sharp analytical gaze" },
  { id: "dracula",              label: "Count Dracula",         group: "Iconic / Public Domain", dimension: "type", description: "Stoker's gothic vampire count",    promptHint: "Count Dracula — gothic vampire count in formal black evening wear with a long opera cape, pale aristocratic features and pronounced fangs" },
  { id: "frankenstein-monster", label: "Frankenstein's Monster", group: "Iconic / Public Domain", dimension: "type", description: "Shelley's reanimated creature",   promptHint: "Frankenstein's Monster — tall reanimated humanoid with a flat-topped head, bolts in the neck, sutured greenish skin and a heavy stooped frame" },
  { id: "phantom-opera",        label: "Phantom of the Opera",  group: "Iconic / Public Domain", dimension: "type", description: "Leroux's masked operatic recluse", promptHint: "the Phantom of the Opera — masked operatic figure in formal evening wear with a stark white half-mask covering one side of the face" },
  { id: "mr-hyde",              label: "Mr Hyde",               group: "Iconic / Public Domain", dimension: "type", description: "Stevenson's monstrous alter ego",  promptHint: "Mr Hyde — bestial transformed alter ego with a hunched ape-like frame, brutish features and a sneer of malevolent glee" },
  { id: "king-arthur",          label: "King Arthur",           group: "Iconic / Public Domain", dimension: "type", description: "Legendary medieval king",          promptHint: "King Arthur — armoured medieval king in plate and chainmail with a regal crown, the legendary sword Excalibur at his side" },
  { id: "merlin",               label: "Merlin",                group: "Iconic / Public Domain", dimension: "type", description: "Arthurian wizard advisor",         promptHint: "Merlin — Arthurian wizard with a long flowing white beard, deep blue robes embroidered with stars, a tall pointed hat and a gnarled wooden staff" },
  { id: "robin-hood",           label: "Robin Hood",            group: "Iconic / Public Domain", dimension: "type", description: "Forest outlaw archer",             promptHint: "Robin Hood — forest outlaw archer in green tunic and hood with a longbow and quiver of arrows, leather boots and a roguish grin" },
  { id: "joan-of-arc",          label: "Joan of Arc",           group: "Iconic / Public Domain", dimension: "type", description: "Medieval warrior-maid in armour",  promptHint: "Joan of Arc — medieval warrior-maid in shining plate armour over a white surcoat, holding a banner, short cropped hair and a determined holy expression" },
  { id: "cleopatra",            label: "Cleopatra",             group: "Iconic / Public Domain", dimension: "type", description: "Last pharaoh of Egypt",            promptHint: "Cleopatra — Egyptian pharaoh-queen in pleated white linen and a broad gold collar, kohl-lined almond eyes, a black bobbed wig and a golden uraeus diadem" },
  { id: "captain-nemo",         label: "Captain Nemo",          group: "Iconic / Public Domain", dimension: "type", description: "Verne's submarine captain",        promptHint: "Captain Nemo — 19th-century submarine captain in a dark double-breasted naval coat, peaked cap and a stern mariner's bearing" },
  { id: "alice-wonderland",     label: "Alice (Wonderland)",    group: "Iconic / Public Domain", dimension: "type", description: "Carroll's Wonderland girl",        promptHint: "Alice from Wonderland — young girl in a blue dress with a white pinafore apron, long blonde hair tied back with a black bow and white knee-high stockings" },
  { id: "peter-pan",            label: "Peter Pan",             group: "Iconic / Public Domain", dimension: "type", description: "Boy who never grew up",            promptHint: "Peter Pan — boyish figure in a green tunic and tights with a pointed feathered cap, mischievous grin and a youthful adventurous bearing" },
  { id: "dorothy-oz",           label: "Dorothy (Oz)",          group: "Iconic / Public Domain", dimension: "type", description: "Oz girl in blue gingham",          promptHint: "Dorothy from Oz — young girl in a blue and white gingham dress with brown pigtail braids tied with ribbons and ruby slippers" },
  { id: "tin-man",              label: "Tin Man",               group: "Iconic / Public Domain", dimension: "type", description: "Oz tin woodsman",                  promptHint: "the Tin Man from Oz — humanoid figure made of riveted tin plates with a funnel-shaped hat, an axe in hand and an oil-can at the belt" },
  { id: "scarecrow-oz",         label: "Scarecrow (Oz)",        group: "Iconic / Public Domain", dimension: "type", description: "Oz straw scarecrow",               promptHint: "the Scarecrow from Oz — straw-stuffed humanoid in a ragged farmer's outfit and floppy pointed hat with a painted burlap face and patched clothes" },
  { id: "cowardly-lion",        label: "Cowardly Lion",         group: "Iconic / Public Domain", dimension: "type", description: "Oz anthropomorphic lion",          promptHint: "the Cowardly Lion from Oz — anthropomorphic bipedal lion with a thick mane, expressive humanlike face and a fretful, timid posture" },
  { id: "santa-claus",          label: "Santa Claus",           group: "Iconic / Public Domain", dimension: "type", description: "Christmas gift-giver",              promptHint: "Santa Claus — jolly bearded old man in a red coat trimmed with white fur, a wide black belt, red trousers and tall black boots, carrying a sack of toys" },
  { id: "grim-reaper",          label: "Grim Reaper",           group: "Iconic / Public Domain", dimension: "type", description: "Personification of Death",         promptHint: "the Grim Reaper — tall hooded skeletal figure in a tattered black robe, bony hands gripping a long wooden scythe, face hidden in shadow" },

  // -------------------- Age --------------------
  // Young ages get finer splits — a 2yo, 5yo, and 8yo look very different;
  // 14yo vs 18yo vs 22yo vs 28yo all read distinct on screen. From 30 onward
  // a single decade bucket reads close enough. Custom age lets the user
  // dial in any specific number for full control.
  { id: "age-baby",         label: "Baby",            dimension: "age", description: "Newborn / infant under 1",  promptHint: "a baby under 1 year old" },
  { id: "age-toddler",      label: "Toddler",         dimension: "age", description: "Around 2-3 years old",      promptHint: "a toddler around 2-3 years old" },
  { id: "age-young-child",  label: "Young Child",     dimension: "age", description: "Around 4-6 years old",      promptHint: "a young child around 5 years old" },
  { id: "age-child",        label: "Child",           dimension: "age", description: "Around 7-9 years old",      promptHint: "a child around 8 years old" },
  { id: "age-pre-teen",     label: "Pre-Teen",        dimension: "age", description: "Around 10-12 years old",    promptHint: "a pre-teen around 11 years old" },
  { id: "age-early-teen",   label: "Early Teen",      dimension: "age", description: "Around 13-15 years old",    promptHint: "in their early teens, around 14 years old" },
  { id: "age-late-teen",    label: "Late Teen",       dimension: "age", description: "Around 16-19 years old",    promptHint: "in their late teens, around 17 years old" },
  { id: "age-teen",         label: "Teenager (any)",  dimension: "age", description: "Anywhere in 13-19",         promptHint: "a teenager, somewhere in their teens" },
  { id: "age-early-20s",    label: "Early 20s",       dimension: "age", description: "Around 20-23 years old",    promptHint: "in their early 20s, around 21 years old" },
  { id: "age-late-20s",     label: "Late 20s",        dimension: "age", description: "Around 24-29 years old",    promptHint: "in their late 20s, around 27 years old" },
  { id: "age-20s",          label: "20s (any)",       dimension: "age", description: "Anywhere in their twenties", promptHint: "in their 20s" },
  { id: "age-30s",          label: "30s",             dimension: "age", description: "Thirties",                  promptHint: "in their 30s" },
  { id: "age-40s",          label: "40s",             dimension: "age", description: "Forties",                   promptHint: "in their 40s" },
  { id: "age-50s",          label: "50s",             dimension: "age", description: "Fifties",                   promptHint: "in their 50s" },
  { id: "age-60s",          label: "60s",             dimension: "age", description: "Sixties",                   promptHint: "in their 60s" },
  { id: "age-elderly",      label: "Elderly",         dimension: "age", description: "70 and older",              promptHint: "elderly, in their 70s or older" },
  { id: "age-custom",       label: "Custom age...",   dimension: "age", description: "Specify an exact age in years", promptHint: "" },

  // -------------------- Ethnicity --------------------
  // Asian (generic + East / South / Southeast breakouts + national-level splits)
  { id: "asian-any",          label: "Asian (any)",         shortLabel: "any",              group: "Asian", dimension: "ethnicity", description: "Any Asian — unspecified region", promptHint: "of Asian descent" },
  { id: "east-asian",         label: "East Asian (any)",    shortLabel: "East (any)",       group: "Asian", dimension: "ethnicity", description: "East Asian features (broad)",   promptHint: "East Asian" },
  { id: "chinese",            label: "Chinese",             group: "Asian", dimension: "ethnicity", description: "Han Chinese features",          promptHint: "of Chinese descent" },
  { id: "japanese",           label: "Japanese",            group: "Asian", dimension: "ethnicity", description: "Japanese features",             promptHint: "of Japanese descent" },
  { id: "korean",             label: "Korean",              group: "Asian", dimension: "ethnicity", description: "Korean features",               promptHint: "of Korean descent" },
  { id: "mongolian-tibetan",  label: "Mongolian / Tibetan", shortLabel: "Mongol / Tibetan", group: "Asian", dimension: "ethnicity", description: "Mongolian / Tibetan features", promptHint: "of Mongolian or Tibetan descent" },
  { id: "south-asian",        label: "South Asian / Indian", shortLabel: "South / Indian", group: "Asian", dimension: "ethnicity", description: "Indian / Pakistani / Bangladeshi / Sri Lankan", promptHint: "South Asian" },
  { id: "southeast-asian",    label: "Southeast Asian (any)", shortLabel: "Southeast (any)", group: "Asian", dimension: "ethnicity", description: "Southeast Asian (broad)",    promptHint: "Southeast Asian" },
  { id: "thai",               label: "Thai",                group: "Asian", dimension: "ethnicity", description: "Thai features",                 promptHint: "of Thai descent" },
  { id: "vietnamese",         label: "Vietnamese",          group: "Asian", dimension: "ethnicity", description: "Vietnamese features",           promptHint: "of Vietnamese descent" },
  { id: "indonesian-malay",   label: "Indonesian / Malay",  shortLabel: "Indo / Malay",     group: "Asian", dimension: "ethnicity", description: "Indonesian / Malay features",   promptHint: "of Indonesian or Malay descent" },
  { id: "khmer",              label: "Khmer / Cambodian",   shortLabel: "Khmer",            group: "Asian", dimension: "ethnicity", description: "Khmer / Cambodian features",    promptHint: "of Khmer Cambodian descent" },
  { id: "filipino",           label: "Filipino",            group: "Asian", dimension: "ethnicity", description: "Filipino features (Asian + Spanish heritage)", promptHint: "Filipino" },
  // Middle East & North Africa
  { id: "mena-any",           label: "Middle Eastern / N. African (any)", shortLabel: "any", group: "Middle East & N. Africa", dimension: "ethnicity", description: "Any MENA — unspecified", promptHint: "of Middle Eastern or North African descent" },
  { id: "middle-eastern",     label: "Middle Eastern (Arab)", shortLabel: "Arab",           group: "Middle East & N. Africa", dimension: "ethnicity", description: "Arab / Levantine / Gulf features", promptHint: "Middle Eastern" },
  { id: "turkish",            label: "Turkish",             group: "Middle East & N. Africa", dimension: "ethnicity", description: "Anatolian Turkish features",        promptHint: "of Turkish descent" },
  { id: "persian",            label: "Persian / Iranian",   shortLabel: "Persian",          group: "Middle East & N. Africa", dimension: "ethnicity", description: "Indo-Iranian features",             promptHint: "of Persian Iranian descent" },
  // African
  { id: "african",            label: "African (any)",       shortLabel: "any",              group: "African", dimension: "ethnicity", description: "Any Sub-Saharan African — unspecified region", promptHint: "of African descent" },
  { id: "west-african",       label: "West African",        shortLabel: "West",             group: "African", dimension: "ethnicity", description: "Yoruba / Igbo / Akan / Wolof",     promptHint: "of West African descent" },
  { id: "east-african",       label: "East African",        shortLabel: "East",             group: "African", dimension: "ethnicity", description: "Somali / Ethiopian / Swahili",     promptHint: "of East African descent" },
  { id: "central-african",    label: "Central African",     shortLabel: "Central",          group: "African", dimension: "ethnicity", description: "Bantu / Congolese / Angolan",       promptHint: "of Central African descent" },
  { id: "southern-african",   label: "Southern African",    shortLabel: "Southern",         group: "African", dimension: "ethnicity", description: "Zulu / Xhosa / Sotho",              promptHint: "of Southern African descent" },
  { id: "afro-caribbean",     label: "Afro-Caribbean",      group: "African", dimension: "ethnicity", description: "Anglophone Caribbean (Jamaica / Trinidad / Barbados)", promptHint: "of Afro-Caribbean descent" },
  // European
  { id: "european-any",       label: "European (any)",      shortLabel: "any",              group: "European", dimension: "ethnicity", description: "Any European — unspecified region", promptHint: "of European descent" },
  { id: "nordic",             label: "Nordic (any)",        shortLabel: "Nordic",           group: "European", dimension: "ethnicity", description: "Any Scandinavian / Northern European — unspecified region", promptHint: "of Nordic Scandinavian descent" },
  { id: "swedish",            label: "Swedish",             group: "European", dimension: "ethnicity", description: "Sweden — tall, often blonde, fine features", promptHint: "of Swedish descent" },
  { id: "norwegian",          label: "Norwegian",           group: "European", dimension: "ethnicity", description: "Norway — fair-skinned, often light-eyed",   promptHint: "of Norwegian descent" },
  { id: "danish",             label: "Danish",              group: "European", dimension: "ethnicity", description: "Denmark — soft features, ash-blonde common", promptHint: "of Danish descent" },
  { id: "finnish",            label: "Finnish",             group: "European", dimension: "ethnicity", description: "Finland — Uralic features, high cheekbones", promptHint: "of Finnish descent" },
  { id: "icelandic",          label: "Icelandic",           group: "European", dimension: "ethnicity", description: "Iceland — Norse + Celtic blend, sharp angular features", promptHint: "of Icelandic descent" },
  { id: "celtic",             label: "Celtic",              group: "European", dimension: "ethnicity", description: "British / Irish features",          promptHint: "of Celtic British descent" },
  { id: "mediterranean",      label: "Mediterranean",       shortLabel: "Mediter.",         group: "European", dimension: "ethnicity", description: "Southern European (broad)",         promptHint: "of Mediterranean descent" },
  { id: "slavic",             label: "Slavic",              group: "European", dimension: "ethnicity", description: "Eastern European features",         promptHint: "of Slavic Eastern European descent" },
  { id: "italian",            label: "Italian",             group: "European", dimension: "ethnicity", description: "Italian features",                  promptHint: "of Italian descent" },
  { id: "iberian",            label: "Iberian (Spanish / Portuguese)", shortLabel: "Iberian", group: "European", dimension: "ethnicity", description: "Spanish / Portuguese with Celtiberian + Moorish heritage", promptHint: "of Iberian Spanish or Portuguese descent" },
  { id: "french",             label: "French",              group: "European", dimension: "ethnicity", description: "French features (varies north to south)", promptHint: "of French descent" },
  { id: "germanic",           label: "Germanic",            group: "European", dimension: "ethnicity", description: "German / Austrian / Dutch / Swiss-German", promptHint: "of Germanic descent" },
  { id: "greek",              label: "Greek",               group: "European", dimension: "ethnicity", description: "Greek features",                    promptHint: "of Greek descent" },
  { id: "baltic",             label: "Baltic",              group: "European", dimension: "ethnicity", description: "Lithuanian / Latvian / Estonian",   promptHint: "of Baltic descent" },
  // Latin American
  { id: "latin-american",     label: "Latin American (any)", shortLabel: "any",             group: "Latin American", dimension: "ethnicity", description: "Any Latin American — unspecified region", promptHint: "Latin American" },
  { id: "mexican-mesoamerican", label: "Mexican / Mesoamerican", shortLabel: "Mexican",     group: "Latin American", dimension: "ethnicity", description: "Mexican / Guatemalan / Central American Mestizo", promptHint: "of Mexican or Mesoamerican heritage" },
  { id: "caribbean-latino",   label: "Caribbean Latin",     shortLabel: "Caribbean",        group: "Latin American", dimension: "ethnicity", description: "Cuban / Dominican / Puerto Rican",  promptHint: "of Caribbean Latin heritage" },
  { id: "brazilian",          label: "Brazilian",           group: "Latin American", dimension: "ethnicity", description: "Brazilian (Portuguese + African + Indigenous)", promptHint: "of Brazilian heritage" },
  { id: "andean-indigenous",  label: "Andean / Indigenous Latin", shortLabel: "Andean",     group: "Latin American", dimension: "ethnicity", description: "Quechua / Aymara / Maya / Nahua", promptHint: "of Andean or Indigenous Latin American heritage" },
  { id: "southern-cone",      label: "Southern Cone European", shortLabel: "Southern Cone", group: "Latin American", dimension: "ethnicity", description: "Argentinian / Uruguayan / Chilean (largely European descent)", promptHint: "of Southern Cone European descent" },
  // Indigenous
  { id: "indigenous-any",     label: "Indigenous (any)",    shortLabel: "any",              group: "Indigenous", dimension: "ethnicity", description: "Any Indigenous — unspecified group", promptHint: "of Indigenous descent" },
  { id: "native-american",    label: "Native American",     shortLabel: "Native American",  group: "Indigenous", dimension: "ethnicity", description: "Native American / First Nations",   promptHint: "Native American" },
  { id: "aboriginal-australian", label: "Aboriginal Australian", shortLabel: "Aboriginal",  group: "Indigenous", dimension: "ethnicity", description: "Aboriginal Australian / Torres Strait", promptHint: "Aboriginal Australian" },
  { id: "pacific-islander",   label: "Pacific Islander",    shortLabel: "Pacific Isl.",     group: "Indigenous", dimension: "ethnicity", description: "Polynesian / Maori / Samoan / Hawaiian", promptHint: "Pacific Islander" },
  { id: "inuit",              label: "Inuit / Arctic",      shortLabel: "Inuit",            group: "Indigenous", dimension: "ethnicity", description: "Inuit / Yupik / Aleut",             promptHint: "of Inuit Arctic descent" },
  // Other
  { id: "mixed",              label: "Mixed",              group: "Other", dimension: "ethnicity", description: "Mixed heritage",                    promptHint: "of mixed heritage" },

  // -------------------- Build (silhouette + height) --------------------
  { id: "petite",        label: "Petite",         dimension: "build", description: "Short and small-framed", promptHint: "petite" },
  { id: "slim",          label: "Slim",           dimension: "build", description: "Thin, slender build",    promptHint: "slim build" },
  { id: "average-build", label: "Average",        dimension: "build", description: "Average build",          promptHint: "of average build" },
  { id: "athletic",      label: "Athletic",       dimension: "build", description: "Toned, athletic",        promptHint: "athletic build" },
  { id: "muscular",      label: "Muscular",       dimension: "build", description: "Muscular, powerful",     promptHint: "muscular build" },
  { id: "curvy",         label: "Curvy",          dimension: "build", description: "Curvy figure",           promptHint: "curvy figure" },
  { id: "heavy-set",     label: "Heavy-set",      dimension: "build", description: "Large, heavy-set",       promptHint: "heavy-set build" },
  { id: "tall-lean",     label: "Tall & Lean",    dimension: "build", description: "Tall, lean frame",       promptHint: "tall and lean" },
  { id: "voluptuous",    label: "Voluptuous",     dimension: "build", description: "Full-figured, curvy",    promptHint: "voluptuous, full-figured curvy build" },
  { id: "hourglass",     label: "Hourglass",      dimension: "build", description: "Narrow waist, full bust + hips", promptHint: "an hourglass build with a narrow waist and full hips and bust" },
  { id: "pear-build",    label: "Pear",           dimension: "build", description: "Narrower upper body, fuller hips", promptHint: "a pear-shaped build with a narrower upper body and fuller hips" },
  { id: "apple-build",   label: "Apple",          dimension: "build", description: "Fuller midsection, slimmer legs", promptHint: "an apple-shaped build with a fuller midsection and slimmer legs" },
  { id: "rectangular",   label: "Rectangular / Boyish", dimension: "build", description: "Straight up-and-down silhouette", promptHint: "a rectangular boyish build with a straight up-and-down silhouette" },
  { id: "plus-size",     label: "Plus-size",      dimension: "build", description: "Plus-size body type",    promptHint: "a plus-size build" },
  { id: "lanky",         label: "Lanky",          dimension: "build", description: "Tall and thin, long limbs", promptHint: "a lanky build, tall and thin with long limbs" },

  // -------------------- Body Proportions (ratio, distinct from Build's silhouette+size) --------------------
  { id: "proportions-balanced",     label: "Balanced",       dimension: "body-proportions", description: "Even legs-to-torso ratio",   promptHint: "balanced body proportions, even legs-to-torso ratio" },
  { id: "proportions-long-legged",  label: "Long-Legged",    dimension: "body-proportions", description: "Notably long legs",           promptHint: "long legs in proportion to a shorter torso" },
  { id: "proportions-short-legged", label: "Short-Legged",   dimension: "body-proportions", description: "Shorter legs, longer torso",  promptHint: "shorter legs in proportion to a longer torso" },
  { id: "proportions-long-torso",   label: "Long Torso",     dimension: "body-proportions", description: "Notably long torso",          promptHint: "a notably long torso" },
  { id: "proportions-hourglass",    label: "Hourglass",      dimension: "body-proportions", description: "Defined waist, balanced bust + hips", promptHint: "an hourglass figure with a defined waist and balanced bust and hips" },
  { id: "proportions-pear",         label: "Pear",           dimension: "body-proportions", description: "Wider hips than shoulders",   promptHint: "a pear-shaped figure with hips wider than shoulders" },
  { id: "proportions-apple",        label: "Apple",          dimension: "body-proportions", description: "Fuller midsection",           promptHint: "an apple-shaped figure carrying weight in the midsection" },
  { id: "proportions-inverted",     label: "Inverted Triangle", dimension: "body-proportions", description: "Broad shoulders, narrow hips", promptHint: "an inverted triangle figure with broad shoulders and narrow hips" },

  // -------------------- Face Shape --------------------
  { id: "face-oval",       label: "Oval",       dimension: "face-shape", description: "Slightly longer than wide, soft curves",     promptHint: "an oval face shape" },
  { id: "face-round",      label: "Round",      dimension: "face-shape", description: "Soft circular face",                         promptHint: "a round face shape" },
  { id: "face-square",     label: "Square",     dimension: "face-shape", description: "Strong jaw, equal width forehead and jaw",   promptHint: "a square face shape with a strong jaw" },
  { id: "face-heart",      label: "Heart",      dimension: "face-shape", description: "Wider forehead, pointed chin",               promptHint: "a heart-shaped face with a wide forehead and pointed chin" },
  { id: "face-diamond",    label: "Diamond",    dimension: "face-shape", description: "Narrow forehead and chin, wide cheekbones",  promptHint: "a diamond face shape with a narrow forehead and chin and wide cheekbones" },
  { id: "face-oblong",     label: "Oblong",     dimension: "face-shape", description: "Long and narrow",                            promptHint: "an oblong face shape, long and narrow" },
  { id: "face-triangular", label: "Triangular", dimension: "face-shape", description: "Narrow forehead, wide jaw",                  promptHint: "a triangular face shape with a narrow forehead and wide jaw" },

  // -------------------- Jawline --------------------
  { id: "jaw-strong",  label: "Strong",  dimension: "jawline", description: "Sharp, defined jawline",     promptHint: "a strong, sharply defined jawline" },
  { id: "jaw-soft",    label: "Soft",    dimension: "jawline", description: "Soft, rounded jaw",          promptHint: "a soft rounded jawline" },
  { id: "jaw-pointed", label: "Pointed", dimension: "jawline", description: "Pointed chin, narrow jaw",   promptHint: "a pointed chin with a narrow jawline" },
  { id: "jaw-wide",    label: "Wide",    dimension: "jawline", description: "Wide, broad jaw",            promptHint: "a wide broad jaw" },
  { id: "jaw-double",  label: "Double Chin", dimension: "jawline", description: "Visible double chin",    promptHint: "a visible double chin" },

  // -------------------- Eye Shape --------------------
  { id: "eye-almond",      label: "Almond",     dimension: "eye-shape", description: "Almond-shaped, slightly upturned",  promptHint: "almond-shaped eyes" },
  { id: "eye-round",       label: "Round",      dimension: "eye-shape", description: "Wide, round eyes",                  promptHint: "wide round eyes" },
  { id: "eye-hooded",      label: "Hooded",     dimension: "eye-shape", description: "Upper lid partially covers crease", promptHint: "hooded eyes with the upper lid partially covering the crease" },
  { id: "eye-monolid",     label: "Monolid",    dimension: "eye-shape", description: "No visible crease, smooth lid",     promptHint: "monolid eyes with no visible crease" },
  { id: "eye-double-eyelid", label: "Double Eyelid", dimension: "eye-shape", description: "Defined upper-eyelid crease",  promptHint: "double-eyelid eyes with a clearly defined upper crease" },
  { id: "eye-deep-set",    label: "Deep-set",   dimension: "eye-shape", description: "Set deeper into the socket",        promptHint: "deep-set eyes" },
  { id: "eye-downturned",  label: "Downturned", dimension: "eye-shape", description: "Outer corners angle down",          promptHint: "downturned eyes with outer corners angled down" },
  { id: "eye-upturned",    label: "Upturned",   dimension: "eye-shape", description: "Outer corners lift up",             promptHint: "upturned eyes with outer corners lifted" },
  { id: "eye-wide-set",    label: "Wide-set",   dimension: "eye-shape", description: "Eyes spaced widely apart",          promptHint: "wide-set eyes" },
  { id: "eye-close-set",   label: "Close-set",  dimension: "eye-shape", description: "Eyes set close together",           promptHint: "close-set eyes" },

  // -------------------- Nose --------------------
  { id: "nose-straight",  label: "Straight",  dimension: "nose", description: "Straight bridge",                 promptHint: "a straight nose" },
  { id: "nose-aquiline",  label: "Aquiline",  dimension: "nose", description: "Curved hooked bridge",            promptHint: "an aquiline nose with a curved bridge" },
  { id: "nose-roman",     label: "Roman",     dimension: "nose", description: "Prominent bridge with slight bump", promptHint: "a Roman nose with a prominent bridge" },
  { id: "nose-snub",      label: "Snub",      dimension: "nose", description: "Short, slightly upturned",        promptHint: "a snub nose, short and slightly upturned" },
  { id: "nose-button",    label: "Button",    dimension: "nose", description: "Small, rounded tip",              promptHint: "a small button nose with a rounded tip" },
  { id: "nose-broad",     label: "Broad",     dimension: "nose", description: "Wide nostrils, broad bridge",     promptHint: "a broad nose with wide nostrils" },
  { id: "nose-narrow",    label: "Narrow",    dimension: "nose", description: "Thin, narrow",                    promptHint: "a narrow thin nose" },
  { id: "nose-hooked",    label: "Hooked",    dimension: "nose", description: "Strongly curved hooked tip",      promptHint: "a hooked nose with a strongly curved tip" },

  // -------------------- Lips --------------------
  { id: "lips-thin",       label: "Thin",        dimension: "lips", description: "Thin lips",                         promptHint: "thin lips" },
  { id: "lips-medium",     label: "Medium",      dimension: "lips", description: "Average fullness",                  promptHint: "medium lips of average fullness" },
  { id: "lips-full",       label: "Full",        dimension: "lips", description: "Full plump lips",                   promptHint: "full plump lips" },
  { id: "lips-wide",       label: "Wide",        dimension: "lips", description: "Wide mouth shape",                  promptHint: "a wide mouth" },
  { id: "lips-cupids-bow", label: "Cupid's Bow", dimension: "lips", description: "Pronounced cupid's bow on upper lip", promptHint: "a pronounced cupid's bow on the upper lip" },
  { id: "lips-small",      label: "Small",       dimension: "lips", description: "Petite mouth",                      promptHint: "a small petite mouth" },

  // -------------------- Lip State (what the lips are doing / wearing) --------------------
  { id: "lip-state-chapped",   label: "Chapped",   dimension: "lip-state", description: "Cracked, dry, weather-worn lips", promptHint: "with chapped, cracked, weather-worn dry lips" },
  { id: "lip-state-glossy",    label: "Glossy",    dimension: "lip-state", description: "High-shine, wet-look lips",       promptHint: "with high-shine glossy wet-look lips" },
  { id: "lip-state-bare",      label: "Bare",      dimension: "lip-state", description: "Natural, untreated, no makeup",   promptHint: "with bare, natural, untreated lips" },
  { id: "lip-state-bold-red",  label: "Bold Red",  dimension: "lip-state", description: "Saturated red lipstick statement", promptHint: "with a bold, saturated red lipstick statement" },
  { id: "lip-state-bitten",    label: "Bitten",    dimension: "lip-state", description: "Slight playful lip-bite, lower lip caught", promptHint: "playfully biting the lower lip" },
  { id: "lip-state-parted",    label: "Parted",    dimension: "lip-state", description: "Lips slightly parted, breath of air", promptHint: "with lips slightly parted, taking a soft breath" },
  { id: "lip-state-pursed",    label: "Pursed",    dimension: "lip-state", description: "Lips pressed and pushed forward", promptHint: "with lips pursed, pressed and pushed forward" },
  { id: "lip-state-pouting",   label: "Pouting",   dimension: "lip-state", description: "Full pout",                       promptHint: "with a full pouting expression" },

  // -------------------- Hair Color --------------------
  // Blonde family (light → warm → cool)
  { id: "hair-platinum",    label: "Platinum",     dimension: "hair-color", description: "Very pale, icy platinum",   promptHint: "platinum blonde hair, very pale and icy" },
  { id: "hair-creamy",      label: "Creamy",       dimension: "hair-color", description: "Warm creamy / vanilla blonde", promptHint: "creamy vanilla blonde hair" },
  { id: "hair-blonde",      label: "Blonde",       dimension: "hair-color", description: "Classic blonde hair",       promptHint: "blonde hair" },
  { id: "hair-honey",       label: "Honey",        dimension: "hair-color", description: "Warm honey-gold blonde",    promptHint: "honey-gold blonde hair with warm golden tones" },
  { id: "hair-strawberry",  label: "Strawberry Blonde", dimension: "hair-color", description: "Blonde with pinkish-red tone", promptHint: "strawberry blonde hair with a pinkish-red tint" },
  { id: "hair-ash-blonde",  label: "Ash Blonde",   dimension: "hair-color", description: "Cool, ashy blonde",         promptHint: "ash blonde hair with cool, muted tones" },
  // Red / warm family
  { id: "hair-ginger",      label: "Ginger",       dimension: "hair-color", description: "Bright ginger (reddish-orange)", promptHint: "bright ginger hair, reddish-orange" },
  { id: "hair-copper",      label: "Copper",       dimension: "hair-color", description: "Vibrant copper orange-red", promptHint: "vibrant copper hair with orange-red metallic shine" },
  { id: "hair-red",         label: "Red",          dimension: "hair-color", description: "Classic red hair",          promptHint: "red hair" },
  { id: "hair-auburn",      label: "Auburn",       dimension: "hair-color", description: "Rich reddish-brown",        promptHint: "auburn hair, rich reddish-brown" },
  { id: "hair-burgundy",    label: "Burgundy",     dimension: "hair-color", description: "Dark wine-red",             promptHint: "burgundy hair, deep wine-red" },
  // Brown family (light → dark)
  { id: "hair-light-brown", label: "Light Brown",  dimension: "hair-color", description: "Light brown hair",          promptHint: "light brown hair" },
  { id: "hair-caramel",     label: "Caramel",      dimension: "hair-color", description: "Warm caramel brown",        promptHint: "caramel brown hair with warm golden undertones" },
  { id: "hair-brown",       label: "Brown",        dimension: "hair-color", description: "Medium brown hair",         promptHint: "brown hair" },
  { id: "hair-chestnut",    label: "Chestnut",     dimension: "hair-color", description: "Warm reddish-brown chestnut", promptHint: "chestnut brown hair with warm reddish undertones" },
  { id: "hair-chocolate",   label: "Chocolate",    dimension: "hair-color", description: "Rich dark chocolate brown",  promptHint: "rich chocolate brown hair" },
  { id: "hair-dark-brown",  label: "Dark Brown",   dimension: "hair-color", description: "Dark brown hair",           promptHint: "dark brown hair" },
  // Black family
  { id: "hair-black",       label: "Black",        dimension: "hair-color", description: "Classic black hair",        promptHint: "black hair" },
  { id: "hair-jet-black",   label: "Jet Black",    dimension: "hair-color", description: "Deep black with blue undertones", promptHint: "jet black hair with deep blue-black undertones and glossy shine" },
  // Gray / neutral
  { id: "hair-gray",        label: "Gray",         dimension: "hair-color", description: "Gray hair",                 promptHint: "gray hair" },
  { id: "hair-salt-pepper", label: "Salt & Pepper", dimension: "hair-color", description: "Mixed black and gray hair", promptHint: "salt-and-pepper hair" },
  { id: "hair-white",       label: "White",        dimension: "hair-color", description: "White hair",                promptHint: "white hair" },
  // Silver / Metallic
  { id: "hair-silver",      label: "Silver",       dimension: "hair-color", description: "Bright metallic silver",     promptHint: "bright metallic silver hair with a clean reflective sheen" },
  { id: "hair-rose-gold",   label: "Rose Gold",    dimension: "hair-color", description: "Soft pink-gold metallic",    promptHint: "rose gold hair, soft pink-gold metallic warmth" },
  // Dyed (catch-all + specific fantasy / cosplay colors)
  { id: "hair-dyed",        label: "Colorful (any)", dimension: "hair-color", description: "Dyed vibrant colors — unspecified", promptHint: "vibrantly dyed colorful hair" },
  { id: "hair-blue",        label: "Blue",         dimension: "hair-color", description: "Bold blue dyed hair",        promptHint: "bold blue dyed hair" },
  { id: "hair-pastel-blue", label: "Pastel Blue",  dimension: "hair-color", description: "Soft pastel sky-blue",       promptHint: "soft pastel sky-blue hair" },
  { id: "hair-teal",        label: "Teal",         dimension: "hair-color", description: "Saturated teal blue-green",  promptHint: "saturated teal blue-green hair" },
  { id: "hair-mint",        label: "Mint",         dimension: "hair-color", description: "Pale mint green",            promptHint: "pale mint-green hair" },
  { id: "hair-green",       label: "Green",        dimension: "hair-color", description: "Bold green dyed hair",       promptHint: "bold green dyed hair" },
  { id: "hair-lavender",    label: "Lavender",     dimension: "hair-color", description: "Soft lavender violet",       promptHint: "soft lavender violet hair" },
  { id: "hair-purple",      label: "Purple",       dimension: "hair-color", description: "Bold deep purple",           promptHint: "bold deep purple dyed hair" },
  { id: "hair-magenta",     label: "Magenta",      dimension: "hair-color", description: "Vivid magenta pink-purple",  promptHint: "vivid magenta pink-purple hair" },
  { id: "hair-pink",        label: "Pink",         dimension: "hair-color", description: "Bold pink dyed hair",        promptHint: "bold pink dyed hair" },
  { id: "hair-pastel-pink", label: "Pastel Pink",  dimension: "hair-color", description: "Soft pastel cotton-candy pink", promptHint: "soft pastel cotton-candy pink hair" },
  { id: "hair-peach",       label: "Peach",        dimension: "hair-color", description: "Warm peach blonde-pink",     promptHint: "warm peach hair, blonde-pink with soft warmth" },
  { id: "hair-mermaid",     label: "Mermaid",      dimension: "hair-color", description: "Blue-green-purple ocean blend", promptHint: "mermaid hair blending blue, green, and purple in flowing waves" },
  { id: "hair-rainbow",     label: "Rainbow",      dimension: "hair-color", description: "Multi-color rainbow streaks", promptHint: "rainbow hair with streaks of multiple bright dyed colors" },

  // -------------------- Hair Style (length + texture) --------------------
  // -------------------- Hair Base (natural texture + length) --------------------
  // Cut/styling choices live in Styling.hair-cut (separate dimension); this is
  // about what hair the character has, not what was done to it today.
  { id: "base-bald",             label: "Bald / Shaved",   dimension: "hair-base", description: "Bald or fully shaved head",        promptHint: "a shaved bald head" },
  { id: "base-buzz",             label: "Buzz",            dimension: "hair-base", description: "Very short cropped hair",          promptHint: "very short buzzed hair" },
  { id: "base-short-straight",   label: "Short Straight",  dimension: "hair-base", description: "Short, straight texture",          promptHint: "short straight hair" },
  { id: "base-short-wavy",       label: "Short Wavy",      dimension: "hair-base", description: "Short, wavy texture",              promptHint: "short wavy hair" },
  { id: "base-short-curly",      label: "Short Curly",     dimension: "hair-base", description: "Short, curly texture",             promptHint: "short curly hair" },
  { id: "base-short-coily",      label: "Short Coily",     dimension: "hair-base", description: "Short, tightly coiled texture",    promptHint: "short tightly coiled hair" },
  { id: "base-medium-straight",  label: "Medium Straight", dimension: "hair-base", description: "Shoulder-length, straight",        promptHint: "medium-length straight hair" },
  { id: "base-medium-wavy",      label: "Medium Wavy",     dimension: "hair-base", description: "Shoulder-length, wavy",            promptHint: "medium-length wavy hair" },
  { id: "base-medium-curly",     label: "Medium Curly",    dimension: "hair-base", description: "Shoulder-length, curly",           promptHint: "medium-length curly hair" },
  { id: "base-medium-coily",     label: "Medium Coily",    dimension: "hair-base", description: "Shoulder-length, tightly coiled",  promptHint: "medium-length tightly coiled hair" },
  { id: "base-long-straight",    label: "Long Straight",   dimension: "hair-base", description: "Mid-back, straight",               promptHint: "long straight hair" },
  { id: "base-long-wavy",        label: "Long Wavy",       dimension: "hair-base", description: "Mid-back, wavy",                   promptHint: "long wavy hair" },
  { id: "base-long-curly",       label: "Long Curly",      dimension: "hair-base", description: "Mid-back, curly",                  promptHint: "long curly hair" },
  { id: "base-long-coily",       label: "Long Coily",      dimension: "hair-base", description: "Mid-back, tightly coiled",         promptHint: "long tightly coiled hair" },
  { id: "base-very-long-straight", label: "Very Long Straight", dimension: "hair-base", description: "Waist-length, straight",      promptHint: "very long straight hair down to the waist" },
  { id: "base-very-long-wavy",   label: "Very Long Wavy",  dimension: "hair-base", description: "Waist-length, wavy",               promptHint: "very long wavy hair down to the waist" },
  { id: "base-very-long-curly",  label: "Very Long Curly", dimension: "hair-base", description: "Waist-length, curly",              promptHint: "very long curly hair down to the waist" },
  { id: "base-afro",             label: "Afro",            dimension: "hair-base", description: "Voluminous rounded afro",          promptHint: "voluminous afro hair" },
  { id: "base-thinning",         label: "Thinning / Receding", dimension: "hair-base", description: "Visibly thinning or receding hairline", promptHint: "thinning hair with a receding hairline" },
  { id: "base-wet",              label: "Wet",             dimension: "hair-base", description: "Wet, slick hair",                  promptHint: "wet, slick hair" },

  // -------------------- Eyebrows --------------------
  { id: "brows-natural",         label: "Natural",         dimension: "eyebrows", description: "Natural, untouched brows",          promptHint: "natural eyebrows" },
  { id: "brows-thick",           label: "Thick / Bushy",   dimension: "eyebrows", description: "Thick, bushy brows",                promptHint: "thick bushy eyebrows" },
  { id: "brows-thin",            label: "Thin / Pencil",   dimension: "eyebrows", description: "Thin, pencil-shaped brows",         promptHint: "thin pencil-shaped eyebrows" },
  { id: "brows-arched",          label: "Arched",          dimension: "eyebrows", description: "Strongly arched, dramatic curve",   promptHint: "strongly arched eyebrows with a dramatic curve" },
  { id: "brows-straight",        label: "Straight",        dimension: "eyebrows", description: "Flat, horizontal brows",            promptHint: "flat straight eyebrows" },
  { id: "brows-bold",            label: "Bold",            dimension: "eyebrows", description: "Defined, dark, full brows",         promptHint: "bold defined dark full eyebrows" },
  { id: "brows-soft",            label: "Soft / Faded",    dimension: "eyebrows", description: "Soft, light, faded brows",          promptHint: "soft, light, faded eyebrows" },
  { id: "brows-microbladed",     label: "Microbladed",     dimension: "eyebrows", description: "Drawn / microbladed crisp shape",   promptHint: "microbladed crisply drawn eyebrows" },
  { id: "brows-tinted",          label: "Tinted",          dimension: "eyebrows", description: "Tinted a different color than hair", promptHint: "eyebrows tinted a different color from the hair" },
  { id: "brows-unibrow",         label: "Unibrow",         dimension: "eyebrows", description: "Connected unibrow",                 promptHint: "a connected unibrow" },

  // -------------------- Skin Tone --------------------
  { id: "skin-very-fair", label: "Very Fair", dimension: "skin-tone", description: "Very fair / pale skin", promptHint: "very fair pale skin" },
  { id: "skin-fair",      label: "Fair",      dimension: "skin-tone", description: "Fair skin",             promptHint: "fair skin" },
  { id: "skin-medium",    label: "Medium",    dimension: "skin-tone", description: "Medium skin tone",      promptHint: "medium skin tone" },
  { id: "skin-olive",     label: "Olive",     dimension: "skin-tone", description: "Olive skin",            promptHint: "olive skin" },
  { id: "skin-tan",       label: "Tan",       dimension: "skin-tone", description: "Tan skin",              promptHint: "tan skin" },
  { id: "skin-brown",     label: "Brown",     dimension: "skin-tone", description: "Brown skin",            promptHint: "brown skin" },
  { id: "skin-dark",      label: "Dark",      dimension: "skin-tone", description: "Dark skin",             promptHint: "dark skin" },

  // -------------------- Eye Color --------------------
  { id: "eyes-brown",  label: "Brown",  dimension: "eye-color", description: "Brown eyes",  promptHint: "brown eyes" },
  { id: "eyes-blue",   label: "Blue",   dimension: "eye-color", description: "Blue eyes",   promptHint: "blue eyes" },
  { id: "eyes-green",  label: "Green",  dimension: "eye-color", description: "Green eyes",  promptHint: "green eyes" },
  { id: "eyes-hazel",  label: "Hazel",  dimension: "eye-color", description: "Hazel eyes",  promptHint: "hazel eyes" },
  { id: "eyes-gray",   label: "Gray",   dimension: "eye-color", description: "Gray eyes",   promptHint: "gray eyes" },
  { id: "eyes-amber",     label: "Amber",     dimension: "eye-color", description: "Amber eyes",                          promptHint: "amber eyes" },
  { id: "eyes-violet",    label: "Violet",    dimension: "eye-color", description: "Rare violet eyes (Liz Taylor)",       promptHint: "rare violet eyes with a deep purple iris" },
  { id: "eyes-gold",      label: "Gold",      dimension: "eye-color", description: "Bright gold iris",                    promptHint: "bright gold eyes with luminous metallic warmth" },
  { id: "eyes-silver",    label: "Silver",    dimension: "eye-color", description: "Pale silver-gray iris",               promptHint: "pale silver eyes with a luminous reflective sheen" },
  { id: "eyes-red",       label: "Red",       dimension: "eye-color", description: "Red iris (albinism / fantasy)",       promptHint: "red eyes, albinism or fantasy red iris" },
  { id: "eyes-pink",      label: "Pink",      dimension: "eye-color", description: "Soft pink iris (albino / fantasy)",   promptHint: "soft pink eyes, albino or fantasy pink iris" },
  { id: "eyes-turquoise", label: "Turquoise", dimension: "eye-color", description: "Vivid turquoise blue-green iris",     promptHint: "vivid turquoise blue-green eyes" },

  // -------------------- Eye State (what the eyes are doing / where they look) --------------------
  { id: "eye-state-closed",         label: "Closed",            dimension: "eye-state", description: "Eyes fully closed, peaceful",       promptHint: "with eyes fully closed in a peaceful expression" },
  { id: "eye-state-half-lidded",    label: "Half-lidded",       dimension: "eye-state", description: "Heavy-lidded sleepy gaze",          promptHint: "with heavy half-lidded sleepy eyes" },
  { id: "eye-state-wide-eyed",      label: "Wide-eyed",         dimension: "eye-state", description: "Eyes wide open, alert / surprised", promptHint: "with eyes wide open, alert and surprised" },
  { id: "eye-state-staring-camera", label: "Staring at Camera", dimension: "eye-state", description: "Direct unbroken eye contact with the lens", promptHint: "staring directly at the camera with unbroken eye contact" },
  { id: "eye-state-gazing-away",    label: "Gazing Away",       dimension: "eye-state", description: "Looking off-camera, contemplative", promptHint: "gazing off-camera with a contemplative expression" },
  { id: "eye-state-gazing-up",      label: "Gazing Up",         dimension: "eye-state", description: "Eyes raised toward something above", promptHint: "with eyes gazing upward toward something above" },
  { id: "eye-state-gazing-down",    label: "Gazing Down",       dimension: "eye-state", description: "Eyes downcast",                     promptHint: "with eyes downcast, gazing softly downward" },
  { id: "eye-state-glassy",         label: "Glassy",            dimension: "eye-state", description: "Eyes wet / tear-glazed",            promptHint: "with glassy, tear-glazed wet eyes" },

  // -------------------- Facial Hair --------------------
  { id: "face-clean-shaven", label: "Clean-shaven", dimension: "facial-hair", description: "Clean-shaven face", promptHint: "clean-shaven" },
  { id: "face-stubble",      label: "Stubble",      dimension: "facial-hair", description: "Light stubble",     promptHint: "light stubble" },
  { id: "face-mustache",     label: "Mustache",     dimension: "facial-hair", description: "Mustache",          promptHint: "a mustache" },
  { id: "face-goatee",       label: "Goatee",       dimension: "facial-hair", description: "Goatee",            promptHint: "a goatee" },
  { id: "face-short-beard",  label: "Short Beard",  dimension: "facial-hair", description: "Short trimmed beard", promptHint: "a short trimmed beard" },
  { id: "face-full-beard",   label: "Full Beard",   dimension: "facial-hair", description: "Thick full beard",  promptHint: "a full beard" },

  // -------------------- Skin Texture --------------------
  { id: "texture-smooth",     label: "Smooth",      dimension: "skin-texture", description: "Flawless, silky smooth skin", promptHint: "with flawless, silky smooth skin" },
  { id: "texture-wrinkled",   label: "Wrinkled",    dimension: "skin-texture", description: "Aged, deeply lined skin",     promptHint: "with deep wrinkles and aged skin texture" },
  { id: "texture-goosebumps", label: "Goosebumps",  dimension: "skin-texture", description: "Raised goosebumps on skin",   promptHint: "with goosebumps raised on the skin" },
  { id: "texture-dewy",       label: "Dewy",        dimension: "skin-texture", description: "Glowing, dewy fresh skin",    promptHint: "with dewy, glowing skin and a fresh sheen" },
  { id: "texture-glistening", label: "Glistening",  dimension: "skin-texture", description: "Sweat or oil sheen",          promptHint: "with glistening skin, sweat or oil catching the light" },
  { id: "texture-weathered",  label: "Weathered",   dimension: "skin-texture", description: "Sun-aged rough skin",         promptHint: "with weathered, sun-worn rough skin" },
  { id: "texture-porcelain",  label: "Porcelain",   dimension: "skin-texture", description: "Flawless near-translucent porcelain", promptHint: "with flawless, near-translucent porcelain skin" },
  { id: "texture-sun-kissed", label: "Sun-kissed",  dimension: "skin-texture", description: "Warm tan with healthy glow",  promptHint: "with sun-kissed skin, warmly tanned with a healthy glow" },
  { id: "texture-tanned",     label: "Tanned",      dimension: "skin-texture", description: "Deeply, evenly tanned skin",  promptHint: "with deeply, evenly bronzed tanned skin" },
  { id: "texture-tan-lines",  label: "Tan Lines",   dimension: "skin-texture", description: "Visible tan lines from swimwear", promptHint: "with visible swimwear tan lines on the skin" },
  { id: "texture-freckled",   label: "Freckled",    dimension: "skin-texture", description: "Freckles across cheeks and nose", promptHint: "with visible freckles scattered across cheeks and the bridge of the nose" },
  { id: "texture-ruddy",      label: "Ruddy",       dimension: "skin-texture", description: "Pink-flushed cheeks and nose", promptHint: "with ruddy, warm pink-flushed cheeks and nose" },
  { id: "texture-ashen",      label: "Ashen / Pale", dimension: "skin-texture", description: "Cool pale, near-bloodless undertone", promptHint: "with ashen, cool pale, near-bloodless skin" },
  { id: "texture-oily",       label: "Oily / Shiny", dimension: "skin-texture", description: "Slight oil sheen on T-zone", promptHint: "with a slight oily sheen across the T-zone" },
  { id: "texture-matte",      label: "Matte",       dimension: "skin-texture", description: "Poreless matte finish",       promptHint: "with a poreless, matte skin finish" },
  { id: "texture-blemished",  label: "Blemished",   dimension: "skin-texture", description: "Visible blemishes, real-skin imperfections", promptHint: "with visible blemishes and natural real-skin imperfections" },
  { id: "texture-baby-soft",  label: "Baby-soft",   dimension: "skin-texture", description: "Smooth, fine-pored youthful skin", promptHint: "with baby-soft, fine-pored, youthful smooth skin" },
  { id: "texture-shower-fresh-wet", label: "Shower-Fresh Wet", dimension: "skin-texture", description: "Just-out-of-shower wet skin with water beads", promptHint: "with just-out-of-the-shower wet skin, water beading on the surface and rolling in slow droplets down the curves of the body" },

  // -------------------- Distinctive Features --------------------
  { id: "feature-glasses",   label: "Glasses",      dimension: "distinctive-features", description: "Wears glasses",        promptHint: "wearing glasses" },
  { id: "feature-freckles",  label: "Freckles",     dimension: "distinctive-features", description: "Visible freckles",     promptHint: "with freckles" },
  { id: "feature-tattoos",   label: "Tattoos",      dimension: "distinctive-features", description: "Visible tattoos",      promptHint: "with visible tattoos" },
  { id: "feature-scar",      label: "Scar",         dimension: "distinctive-features", description: "Facial scar",          promptHint: "with a facial scar" },
  { id: "feature-dimples",   label: "Dimples",      dimension: "distinctive-features", description: "Dimpled cheeks",       promptHint: "with dimples" },
  { id: "feature-piercing",  label: "Piercing",     dimension: "distinctive-features", description: "Visible piercing",     promptHint: "with a visible piercing" },
  { id: "feature-birthmark", label: "Birthmark",    dimension: "distinctive-features", description: "Visible birthmark on face or shoulder", promptHint: "with a visible birthmark on the face or shoulder" },
  { id: "feature-mole",      label: "Mole / Beauty Mark", dimension: "distinctive-features", description: "One prominent mole, often near upper lip", promptHint: "with a prominent beauty mark mole near the upper lip" },
  { id: "feature-gap-teeth", label: "Gap Teeth",    dimension: "distinctive-features", description: "Gap between front teeth", promptHint: "with a gap between the front teeth" },
  { id: "feature-aegyo-sal", label: "Aegyo Sal",    dimension: "distinctive-features", description: "Puffy under-eye fold prized in K-beauty", promptHint: "with aegyo sal, the soft puffy under-eye fold" },
  { id: "feature-eye-bags",  label: "Eye Bags",     dimension: "distinctive-features", description: "Mild dark under-eye circles", promptHint: "with mild dark circles and under-eye bags" },
  { id: "feature-dimpled-chin", label: "Dimpled Chin", dimension: "distinctive-features", description: "Soft dimple in the chin", promptHint: "with a soft dimple in the chin" },
  { id: "feature-cleft-chin", label: "Cleft Chin",  dimension: "distinctive-features", description: "Defined vertical chin cleft", promptHint: "with a defined vertical cleft chin" },
  { id: "feature-heterochromia", label: "Heterochromia", dimension: "distinctive-features", description: "Each iris a different color", promptHint: "with heterochromia, each iris a different color" },
  { id: "feature-vitiligo",  label: "Vitiligo",     dimension: "distinctive-features", description: "Patches of depigmented skin", promptHint: "with vitiligo, visible patches of depigmented skin" },
  { id: "feature-sleeve-tattoo", label: "Sleeve Tattoo", dimension: "distinctive-features", description: "Full one-arm tattoo sleeve", promptHint: "with a full tattoo sleeve covering one arm in intricate ink" },
  { id: "feature-face-tattoo", label: "Face Tattoo", dimension: "distinctive-features", description: "Small face tattoo near eye or cheekbone", promptHint: "with a small face tattoo near the eye or cheekbone" },
  { id: "feature-hand-tattoos", label: "Hand Tattoos", dimension: "distinctive-features", description: "Knuckle / finger tattoos", promptHint: "with hand tattoos across knuckles and fingers" },
  { id: "feature-back-tattoo", label: "Back Tattoo", dimension: "distinctive-features", description: "Large piece across the back", promptHint: "with a large back-piece tattoo across the upper back" },
  { id: "feature-chest-tattoo", label: "Chest Tattoo", dimension: "distinctive-features", description: "Tattoo across chest / décolletage", promptHint: "with a tattoo across the chest and décolletage" },
  { id: "feature-leg-tattoo", label: "Leg Tattoo", dimension: "distinctive-features", description: "Visible tattoo on leg / calf / thigh", promptHint: "with a visible tattoo on the leg, running across the calf or thigh" },
  { id: "feature-forearm-tattoo", label: "Forearm Tattoo", dimension: "distinctive-features", description: "Tattoo on inner or outer forearm", promptHint: "with a tattoo on the forearm, visible on the inner or outer side" },
  { id: "feature-visible-piercings", label: "Visible Piercings", dimension: "distinctive-features", description: "Multiple visible piercings (septum, nose, lip, multi-ear)", promptHint: "with multiple visible piercings — septum, nose, lip, and multi-ear" },
  { id: "feature-ear-piercings", label: "Ear Piercings", dimension: "distinctive-features", description: "Multiple stacked ear piercings (cartilage, helix, conch)", promptHint: "with multiple stacked ear piercings — cartilage, helix, and conch" },
  { id: "feature-lip-piercing", label: "Lip Piercing", dimension: "distinctive-features", description: "Lip ring / labret stud", promptHint: "with a lip piercing, a small ring or labret stud at the lip" },
  { id: "feature-nostril-piercing", label: "Nostril Piercing", dimension: "distinctive-features", description: "Single nostril stud or ring", promptHint: "with a single nostril piercing, a small stud or ring at the nostril" },
  { id: "feature-bare-shoulders", label: "Bare Shoulders", dimension: "distinctive-features", description: "Bare shoulders exposed", promptHint: "with bare shoulders exposed, the line of the collarbone and shoulder muscles uncovered" },
  { id: "feature-collarbone-visible", label: "Collarbone Visible", dimension: "distinctive-features", description: "Prominent collarbone catching light", promptHint: "with a prominent collarbone clearly defined and catching the light" },
  { id: "feature-midriff-visible", label: "Midriff Visible", dimension: "distinctive-features", description: "Exposed midriff between top and bottom", promptHint: "with the midriff exposed, a strip of bare stomach visible between the top and the bottom" },
  { id: "feature-navel-visible", label: "Navel Visible", dimension: "distinctive-features", description: "Visible navel on bare stomach", promptHint: "with a visible navel on a bare stomach" },
  { id: "feature-elongated-neck", label: "Elongated Neck", dimension: "distinctive-features", description: "Long swan-like neck", promptHint: "with an elongated, swan-like neck, long and gracefully extended" },

  // -------------------- Regional Aesthetic --------------------
  // Vibe layer (composes with Ethnicity, Skin Tone, Hair, Styling — never
  // hard-codes them). Sub-grouped via `group` so the picker can render
  // collapsible sections by region. Multi-pick supported (up to 2).
  //
  // promptHint invariant: VIBE-ONLY. Do not mention skin tone, hair color,
  // hair style, or specific wardrobe — those compete with the user's
  // explicit picks in other dimensions.
  //
  // Sub-Saharan African entries use 🇬🇧 / 🇫🇷 / 🇵🇹 in the description to
  // call out the dominant colonial-cultural overlay (Anglophone /
  // Francophone / Lusophone) — this drives sartorial + media-diet
  // differences. Ethiopia is intentionally untagged (never colonized).

  // ----- USA — Mainstream -----
  { id: "cali-beach",          label: "California Beach", group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Laid-back beach-town California aesthetic", promptHint: "a California beach aesthetic — laid-back beach-town vibe, golden-hour sun-warmed energy, easy carefree mood" },
  { id: "valley-girl",         label: "Valley Girl",      group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Southern California valley aesthetic (feminine)", promptHint: "a Valley Girl aesthetic — Southern California suburban-chic vibe, polished and sun-kissed" },
  { id: "norcal-hippie",       label: "NorCal Hippie",    group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Northern California Berkeley / Bay-Area hippie aesthetic", promptHint: "a Northern California hippie aesthetic — laid-back Berkeley / Bay-Area mood, gentle counter-culture vibe" },
  { id: "boho-la",             label: "Boho LA",          group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Los Angeles canyon-bohemian aesthetic (feminine)", promptHint: "a Boho LA aesthetic — Los Angeles canyon-bohemian vibe, free-spirited Laurel Canyon mood" },
  { id: "texas-cowgirl",       label: "Texas Cowgirl",    group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Texas Western ranch-country aesthetic (feminine)", promptHint: "a Texas cowgirl aesthetic — Western ranch-country vibe, warm Lone-Star confidence" },
  { id: "texas-cowboy",        label: "Texas Cowboy",     group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Texas Western ranch-country aesthetic (masculine)", promptHint: "a Texas cowboy aesthetic — Western ranch-country vibe, weathered Lone-Star presence" },
  { id: "southern-belle",      label: "Southern Belle",   group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Charleston / Savannah antebellum-gentility aesthetic (feminine)", promptHint: "a Southern Belle aesthetic — Charleston / Savannah gentility, gracious antebellum charm" },
  { id: "southern-gentleman",  label: "Southern Gentleman", group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Old-South gentility aesthetic (masculine)", promptHint: "a Southern Gentleman aesthetic — old-South gentility, gracious Charleston / Savannah charm" },
  { id: "miami-latina",        label: "Miami Latina",     group: "USA — Mainstream", dimension: "regional-aesthetic", description: "South Beach Caribbean-Latin aesthetic (feminine)", promptHint: "a Miami Latina aesthetic — South Beach Caribbean-Latin energy, sun-and-neon vibrance" },
  { id: "miami-latino",        label: "Miami Latino",     group: "USA — Mainstream", dimension: "regional-aesthetic", description: "South Beach Caribbean-Latin aesthetic (masculine)", promptHint: "a Miami Latino aesthetic — South Beach Caribbean-Latin energy, sun-and-neon confidence" },
  { id: "hawaii-island",       label: "Hawaii Island",    group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Polynesian-Pacific Hawaiian aesthetic", promptHint: "a Hawaiian island aesthetic — Polynesian-Pacific vibe, gentle ocean-warmed presence" },
  { id: "nyc-fashion",         label: "NYC Fashion",      group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Manhattan editorial-fashion aesthetic (feminine)", promptHint: "a New York fashion-girl aesthetic — Manhattan editorial vibe, urban-sharp confident energy" },
  { id: "nyc-sharp",           label: "NYC Sharp",        group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Manhattan power-tailored aesthetic (masculine)", promptHint: "a New York sharp-dressed aesthetic — Manhattan power-and-pace vibe, urban-tailored presence" },
  { id: "brooklyn-hipster",    label: "Brooklyn Hipster", group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Williamsburg creative-class aesthetic", promptHint: "a Brooklyn hipster aesthetic — Williamsburg creative-class vibe, considered bohemian-urban energy" },
  { id: "new-england-prep",    label: "New England Prep", group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Cape Cod / Nantucket old-money preppy aesthetic", promptHint: "a New England prep aesthetic — Cape Cod / Nantucket old-money vibe, classic Ivy-coast polish" },
  { id: "pnw-granola",         label: "PNW Granola",      group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Portland / Seattle outdoorsy aesthetic", promptHint: "a Pacific Northwest granola aesthetic — Portland / Seattle outdoorsy vibe, mossy mountain-coffee mood" },
  { id: "nashville-country",   label: "Nashville Country", group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Music-City modern country-pop aesthetic (feminine)", promptHint: "a Nashville country-pop aesthetic — Music-City warmth, Southern modern-country charm" },
  { id: "nashville-cowboy",    label: "Nashville Cowboy", group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Music-City modern-cowboy aesthetic (masculine)", promptHint: "a Nashville modern-cowboy aesthetic — Music-City warmth, modern-Western charm" },
  { id: "vegas-glam",          label: "Vegas Glam",       group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Las Vegas Strip-glamour aesthetic (feminine)", promptHint: "a Las Vegas glam aesthetic — Strip-glamour vibe, high-shine showroom presence" },
  { id: "vegas-suit",          label: "Vegas Suit",       group: "USA — Mainstream", dimension: "regional-aesthetic", description: "Las Vegas Strip suited aesthetic (masculine)", promptHint: "a Las Vegas suit-and-shine aesthetic — Strip-glamour vibe, high-roller charisma" },

  // ----- USA — African-American -----
  { id: "harlem-classic",      label: "Harlem Classic",     group: "USA — African-American", dimension: "regional-aesthetic", description: "Black-New-York heritage aesthetic, jazz-age elegance", promptHint: "a Harlem classic aesthetic — Black-New-York heritage vibe, jazz-age elegance and modern-uptown polish" },
  { id: "atl-southern",        label: "ATL Southern",       group: "USA — African-American", dimension: "regional-aesthetic", description: "Atlanta Black-South hip-hop / R&B aesthetic", promptHint: "an Atlanta Black-South aesthetic — Southern hip-hop / R&B capital vibe, peach-tree confident-and-warm mood" },
  { id: "nola-creole",         label: "NOLA Creole",        group: "USA — African-American", dimension: "regional-aesthetic", description: "New Orleans Louisiana French-Caribbean-African aesthetic", promptHint: "a New Orleans Creole aesthetic — Louisiana French-Caribbean-African vibe, jazz-and-second-line warmth" },
  { id: "dmv-go-go",           label: "DMV Go-Go",          group: "USA — African-American", dimension: "regional-aesthetic", description: "DC / Maryland / Virginia Black-DMV go-go aesthetic", promptHint: "a DC / Maryland / Virginia Black-DMV aesthetic — go-go-music capital vibe, polished East-Coast confidence" },
  { id: "west-coast-hip-hop",  label: "West Coast",         group: "USA — African-American", dimension: "regional-aesthetic", description: "South Central / Compton West Coast hip-hop aesthetic", promptHint: "a West Coast Black-LA aesthetic — South Central / Compton hip-hop vibe, sun-warmed laid-back swagger" },
  { id: "chicago-south-side",  label: "Chicago South Side", group: "USA — African-American", dimension: "regional-aesthetic", description: "Midwest Black-urban Chicago aesthetic", promptHint: "a Chicago South Side aesthetic — Midwest Black-urban vibe, drill-era street-sharp presence" },

  // ----- Europe -----
  { id: "parisienne",           label: "Parisienne",          group: "Europe", dimension: "regional-aesthetic", description: "Left-Bank Paris French-chic aesthetic (feminine)", promptHint: "a Parisienne aesthetic — Left-Bank Paris vibe, effortless French-chic mood, je-ne-sais-quoi confidence" },
  { id: "parisian-flaneur",     label: "Parisian Flâneur",    group: "Europe", dimension: "regional-aesthetic", description: "Left-Bank Paris French-chic aesthetic (masculine)", promptHint: "a Parisian flâneur aesthetic — Left-Bank Paris vibe, contemplative French-chic mood, refined city-walker air" },
  { id: "milanese-fashion",     label: "Milanese Fashion",    group: "Europe", dimension: "regional-aesthetic", description: "Italian Milanese high-fashion aesthetic", promptHint: "a Milanese fashion aesthetic — Italian high-fashion polish, Quadrilatero confident sleekness" },
  { id: "sicilian-beach",       label: "Sicilian Beach",      group: "Europe", dimension: "regional-aesthetic", description: "Mediterranean southern-Italian beach aesthetic", promptHint: "a Sicilian beach aesthetic — Mediterranean sun-and-salt vibe, warm southern-Italian ease" },
  { id: "madrileña",            label: "Madrileña",           group: "Europe", dimension: "regional-aesthetic", description: "Madrid Spanish aesthetic (feminine)", promptHint: "a Madrileña aesthetic — Madrid Spanish vibe, sun-and-confidence Iberian energy" },
  { id: "madrileño",            label: "Madrileño",           group: "Europe", dimension: "regional-aesthetic", description: "Madrid Spanish aesthetic (masculine)", promptHint: "a Madrileño aesthetic — Madrid Spanish vibe, sun-and-confidence Iberian presence" },
  { id: "catalan-modern",       label: "Catalan Modern",      group: "Europe", dimension: "regional-aesthetic", description: "Barcelona Mediterranean-design aesthetic", promptHint: "a Catalan modern aesthetic — Barcelona Mediterranean-design vibe, easygoing creative coast" },
  { id: "greek-mediterranean",  label: "Greek Mediterranean", group: "Europe", dimension: "regional-aesthetic", description: "Aegean island Greek aesthetic", promptHint: "a Greek Mediterranean aesthetic — Aegean island vibe, sun-bleached limestone-and-sea mood" },
  { id: "scandi-minimal",       label: "Scandi Minimal",      group: "Europe", dimension: "regional-aesthetic", description: "Nordic clean-line minimal aesthetic", promptHint: "a Scandinavian minimal aesthetic — Nordic clean-line vibe, hygge-and-quiet-confidence mood" },
  { id: "english-rose",         label: "English Rose",        group: "Europe", dimension: "regional-aesthetic", description: "Countryside English aesthetic (feminine)", promptHint: "an English Rose aesthetic — countryside English vibe, gentle rose-garden refinement" },
  { id: "london-prep",          label: "London Prep",         group: "Europe", dimension: "regional-aesthetic", description: "Mayfair / Chelsea refined British aesthetic (masculine)", promptHint: "a London prep aesthetic — Mayfair / Chelsea vibe, refined British polish" },
  { id: "manchester-indie",     label: "Manchester Indie",    group: "Europe", dimension: "regional-aesthetic", description: "North-England gig-and-rain working-class-cool aesthetic", promptHint: "a Manchester indie aesthetic — North-England gig-and-rain vibe, working-class cool" },
  { id: "berlin-alt",           label: "Berlin Alt",          group: "Europe", dimension: "regional-aesthetic", description: "Kreuzberg techno-and-art counterculture aesthetic", promptHint: "a Berlin alt aesthetic — Kreuzberg techno-and-art vibe, edgy considered counterculture" },
  { id: "munich-traditional",   label: "Munich Traditional",  group: "Europe", dimension: "regional-aesthetic", description: "Bavarian Oktoberfest-traditional aesthetic", promptHint: "a Munich Bavarian-traditional aesthetic — Oktoberfest warmth, alpine-folk pride" },
  { id: "eastern-european-glam", label: "Eastern European Glam", group: "Europe", dimension: "regional-aesthetic", description: "Moscow / Kyiv winter-glamour aesthetic (feminine)", promptHint: "an Eastern European glam aesthetic — Moscow / Kyiv vibe, statement-confident winter-glamour" },
  { id: "eastern-european-stoic", label: "Eastern European Stoic", group: "Europe", dimension: "regional-aesthetic", description: "Moscow / Kyiv weathered-confidence aesthetic (masculine)", promptHint: "an Eastern European stoic aesthetic — Moscow / Kyiv vibe, weathered confidence, winter-hardened presence" },

  // ----- Asia -----
  { id: "tokyo-harajuku",        label: "Tokyo Harajuku",       group: "Asia", dimension: "regional-aesthetic", description: "Tokyo playful expressive Japanese street aesthetic", promptHint: "a Tokyo Harajuku aesthetic — playful expressive Japanese street vibe, color-and-character mood" },
  { id: "ginza-office",          label: "Ginza Office",         group: "Asia", dimension: "regional-aesthetic", description: "Tokyo Ginza Japanese corporate-elegant aesthetic", promptHint: "a Ginza Tokyo office aesthetic — buttoned-up Japanese corporate-elegant vibe" },
  { id: "shibuya-streetwear",    label: "Shibuya Streetwear",   group: "Asia", dimension: "regional-aesthetic", description: "Tokyo Shibuya street-fashion aesthetic", promptHint: "a Shibuya streetwear aesthetic — Tokyo street-fashion vibe, layered post-modern mood" },
  { id: "osaka-everyday",        label: "Osaka Everyday",       group: "Asia", dimension: "regional-aesthetic", description: "Osaka warm casual Kansai aesthetic", promptHint: "an Osaka everyday aesthetic — warm casual Kansai vibe, easygoing humor-and-warmth" },
  { id: "seoul-k-pop",           label: "Seoul K-Pop",          group: "Asia", dimension: "regional-aesthetic", description: "Seoul Korean-pop polished aesthetic", promptHint: "a Seoul K-pop aesthetic — Korean-pop polish vibe, idol-grade brightness" },
  { id: "gangnam-glam",          label: "Gangnam Glam",         group: "Asia", dimension: "regional-aesthetic", description: "Seoul Gangnam Korean luxury-district aesthetic", promptHint: "a Gangnam Seoul glam aesthetic — Korean luxury-district vibe, polished beauty-statement" },
  { id: "shanghai-modern",       label: "Shanghai Modern",      group: "Asia", dimension: "regional-aesthetic", description: "Shanghai Chinese metropolitan aesthetic", promptHint: "a Shanghai modern aesthetic — Chinese metropolitan vibe, Bund-skyline cosmopolitan polish" },
  { id: "beijing-hutong",        label: "Beijing Hutong",       group: "Asia", dimension: "regional-aesthetic", description: "Beijing old-courtyard traditional-meets-modern aesthetic", promptHint: "a Beijing hutong aesthetic — old-Beijing courtyard vibe, traditional-meets-modern mood" },
  { id: "hong-kong-cinematic",   label: "Hong Kong Cinematic",  group: "Asia", dimension: "regional-aesthetic", description: "Hong Kong neon-noir Wong-Kar-Wai aesthetic", promptHint: "a Hong Kong cinematic aesthetic — neon-mid-century vibe, Wong-Kar-Wai mood" },
  { id: "mumbai-bollywood",      label: "Mumbai Bollywood",     group: "Asia", dimension: "regional-aesthetic", description: "Mumbai Indian film-industry aesthetic", promptHint: "a Mumbai Bollywood aesthetic — Indian film-industry vibe, vibrant statement-glamour" },
  { id: "south-india-traditional", label: "South India Traditional", group: "Asia", dimension: "regional-aesthetic", description: "Tamil / Kerala temple-town classical aesthetic", promptHint: "a South Indian traditional aesthetic — Tamil / Kerala temple-town vibe, classical refinement" },
  { id: "bangkok-street",        label: "Bangkok Street",       group: "Asia", dimension: "regional-aesthetic", description: "Bangkok Thai night-market neon-urban aesthetic", promptHint: "a Bangkok street aesthetic — Thai night-market energy, neon-and-warmth urban vibe" },

  // ----- Latin America -----
  { id: "carioca-rio",           label: "Carioca (Rio)",       group: "Latin America", dimension: "regional-aesthetic", description: "Rio de Janeiro beach-and-favela-music Brazilian aesthetic", promptHint: "a Carioca aesthetic — Rio de Janeiro beach-and-favela-music vibe, sun-warmed Brazilian energy" },
  { id: "paulista",              label: "Paulista (São Paulo)", group: "Latin America", dimension: "regional-aesthetic", description: "São Paulo metropolitan Brazilian creative-class aesthetic", promptHint: "a Paulista aesthetic — São Paulo metropolitan vibe, urban-Brazilian creative-class polish" },
  { id: "buenos-aires-tango",    label: "Buenos Aires Tango",  group: "Latin America", dimension: "regional-aesthetic", description: "Buenos Aires Recoleta / San Telmo tango aesthetic (feminine)", promptHint: "a Buenos Aires tango aesthetic — Recoleta / San Telmo vibe, sultry porteña confidence" },
  { id: "porteño",               label: "Porteño",             group: "Latin America", dimension: "regional-aesthetic", description: "Buenos Aires refined milonguero aesthetic (masculine)", promptHint: "a Porteño aesthetic — Buenos Aires vibe, refined milonguero presence" },
  { id: "mexico-city-chic",      label: "Mexico City Chic",    group: "Latin America", dimension: "regional-aesthetic", description: "CDMX Roma / Polanco modern-Mexican aesthetic", promptHint: "a Mexico City chic aesthetic — CDMX Roma / Polanco vibe, modern-Mexican polish" },
  { id: "chilango-traditional",  label: "Chilango Traditional", group: "Latin America", dimension: "regional-aesthetic", description: "Mexico City warm folk-and-feast aesthetic", promptHint: "a Chilango traditional aesthetic — Mexico City vibe, warm folk-and-feast mood" },
  { id: "bogota-cosmopolitan",   label: "Bogotá Cosmopolitan", group: "Latin America", dimension: "regional-aesthetic", description: "Bogotá Colombian capital refined Andean aesthetic", promptHint: "a Bogotá cosmopolitan aesthetic — Colombian capital vibe, refined Andean polish" },

  // ----- Middle East -----
  { id: "beirut-riviera",        label: "Beirut Riviera",      group: "Middle East", dimension: "regional-aesthetic", description: "Lebanese Mediterranean cosmopolitan aesthetic", promptHint: "a Beirut Riviera aesthetic — Lebanese Mediterranean vibe, cosmopolitan-glamour mood" },
  { id: "tel-aviv-beach",        label: "Tel Aviv Beach",      group: "Middle East", dimension: "regional-aesthetic", description: "Tel Aviv Mediterranean coastal-city startup-energy aesthetic", promptHint: "a Tel Aviv beach aesthetic — Mediterranean coastal-city vibe, easygoing sun-and-sea startup-energy mood" },
  { id: "jerusalem-stone",       label: "Jerusalem Stone",     group: "Middle East", dimension: "regional-aesthetic", description: "Jerusalem old-city limestone-heritage aesthetic", promptHint: "a Jerusalem old-city aesthetic — limestone-warmth heritage vibe, layered ancient-and-modern presence" },
  { id: "sabra",                 label: "Sabra",               group: "Middle East", dimension: "regional-aesthetic", description: "Native-Israeli direct-and-warm Sabra aesthetic", promptHint: "a Sabra aesthetic — native-Israeli vibe, sun-warmed direct-and-warm energy, prickly-outside-sweet-inside mood" },
  { id: "dubai-modern",          label: "Dubai Modern",        group: "Middle East", dimension: "regional-aesthetic", description: "Gulf-luxury Dubai cosmopolitan-emirate aesthetic", promptHint: "a Dubai modern aesthetic — Gulf-luxury vibe, polished cosmopolitan-emirate presence" },
  { id: "persian-glam",          label: "Persian Glam",        group: "Middle East", dimension: "regional-aesthetic", description: "Iranian heritage-and-glamour Persian aesthetic", promptHint: "a Persian glam aesthetic — Iranian heritage-and-glamour vibe, refined statement mood" },
  { id: "istanbul-bosphorus",    label: "Istanbul Bosphorus",  group: "Middle East", dimension: "regional-aesthetic", description: "Istanbul east-meets-west Bosphorus Ottoman-and-modern aesthetic", promptHint: "an Istanbul Bosphorus aesthetic — east-meets-west Turkish vibe, layered Ottoman-and-modern strait-city presence" },

  // ----- North Africa -----
  { id: "cairene-cosmopolitan",  label: "Cairene Cosmopolitan", group: "North Africa", dimension: "regional-aesthetic", description: "Cairo Egyptian-Arab metropolitan aesthetic", promptHint: "a Cairene cosmopolitan aesthetic — Cairo metropolitan vibe, layered Egyptian-Arab modern-and-historical mood" },
  { id: "maghreb-coastal",       label: "Maghreb Coastal",      group: "North Africa", dimension: "regional-aesthetic", description: "Tunis / Algiers French-Mediterranean-North-African colonial-port aesthetic", promptHint: "a Maghreb coastal aesthetic — Tunis / Algiers French-Mediterranean-North-African vibe, sun-bleached colonial-port mood" },
  { id: "marrakech-bohemian",    label: "Marrakech Bohemian",   group: "North Africa", dimension: "regional-aesthetic", description: "Marrakech Moroccan medina warm-spice aesthetic", promptHint: "a Marrakech bohemian aesthetic — Moroccan medina vibe, warm-spice and -textile mood" },

  // ----- Sub-Saharan Africa -----
  // 🇬🇧 Anglophone, 🇫🇷 Francophone, 🇵🇹 Lusophone — colonial-cultural overlay
  // drives sartorial / media-diet differences. Ethiopia untagged (never colonized).
  { id: "lagos-afro-glam",       label: "Lagos Afro-Glam",         group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇬🇧 Lagos Nigerian Anglophone-West-African metropolitan aesthetic", promptHint: "a Lagos Afro-glam aesthetic — Nigerian Anglophone-West-African metropolitan vibe, vibrant statement-fashion mood" },
  { id: "accra-afro-fashion",    label: "Accra Afro-Fashion",      group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇬🇧 Accra Ghanaian Anglophone-West-African kente-meets-modern aesthetic", promptHint: "an Accra Afro-fashion aesthetic — Ghanaian Anglophone-West-African vibe, kente-meets-modern statement" },
  { id: "dakar-francophone",     label: "Dakar Francophone",       group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇫🇷 Dakar Senegalese Francophone-West-African coastal-cosmopolitan aesthetic", promptHint: "a Dakar aesthetic — Senegalese Francophone-West-African coastal-cosmopolitan vibe, refined boubou-and-Paris-pull mood" },
  { id: "abidjan-cosmopolitan",  label: "Abidjan Cosmopolitan",    group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇫🇷 Abidjan Ivoirian Francophone-West-African urban aesthetic", promptHint: "an Abidjan aesthetic — Ivoirian Francophone-West-African urban vibe, lagoon-city polish" },
  { id: "kinshasa-sape",         label: "Kinshasa SAPE",           group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇫🇷 Kinshasa Congolese Francophone-Central-African SAPE dandy aesthetic", promptHint: "a Kinshasa SAPE aesthetic — Congolese Francophone-Central-African dandy vibe, Society-of-Ambianceurs hyper-tailored statement" },
  { id: "nairobi-cosmopolitan",  label: "Nairobi Cosmopolitan",    group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇬🇧 Nairobi Kenyan Anglophone-East-African modern-urban aesthetic", promptHint: "a Nairobi cosmopolitan aesthetic — Kenyan Anglophone-East-African modern-urban vibe, considered creative-class polish" },
  { id: "addis-habesha",         label: "Addis Habesha",           group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "Addis Ababa Ethiopian Habesha highland-heritage aesthetic (Ethiopia was never colonized)", promptHint: "an Addis Ababa Habesha aesthetic — Ethiopian highland heritage vibe, refined coffee-ceremony-and-modern-Addis polish" },
  { id: "swahili-coast",         label: "Swahili Coast",           group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇬🇧 Zanzibar / Mombasa Anglophone-East-African coastal-Swahili aesthetic", promptHint: "a Swahili-Coast aesthetic — Zanzibar / Mombasa Anglophone-East-African coastal vibe, Indian-Ocean-trade-route warmth" },
  { id: "johannesburg-urban",    label: "Johannesburg Urban",      group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇬🇧 Johannesburg South-African Anglophone-Southern-African Black-metropolitan aesthetic", promptHint: "a Johannesburg urban aesthetic — South-African Anglophone-Southern-African Black-metropolitan vibe, post-Soweto urban-creative confidence" },
  { id: "cape-town-cosmopolitan", label: "Cape Town Cosmopolitan", group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇬🇧 Cape Town South-African Anglophone-Southern-African coastal-city aesthetic", promptHint: "a Cape Town cosmopolitan aesthetic — South-African Anglophone-Southern-African coastal-city vibe, easygoing creative polish" },
  { id: "luanda-lusophone",      label: "Luanda Lusophone",        group: "Sub-Saharan Africa", dimension: "regional-aesthetic", description: "🇵🇹 Luanda Angolan Lusophone-Southern-African kizomba-and-Atlantic-coast aesthetic", promptHint: "a Luanda aesthetic — Angolan Lusophone-Southern-African vibe, kizomba-and-Atlantic-coast statement-presence" },

  // ----- Oceania -----
  { id: "bondi-beach",           label: "Bondi Beach",         group: "Oceania", dimension: "regional-aesthetic", description: "Bondi Australian coastal salt-and-sun aesthetic", promptHint: "a Bondi Beach aesthetic — Australian coastal vibe, salt-and-sun easygoing presence" },
  { id: "australian-outback",    label: "Outback",             group: "Oceania", dimension: "regional-aesthetic", description: "Rural Australian Outback aesthetic (feminine)", promptHint: "an Australian Outback aesthetic — rural Australian vibe, weathered sun-burnt confidence" },
  { id: "outback-stockman",      label: "Outback Stockman",    group: "Oceania", dimension: "regional-aesthetic", description: "Rural Australian Outback aesthetic (masculine)", promptHint: "an Outback Stockman aesthetic — rural Australian vibe, weathered station-hand presence" },
  { id: "auckland-coastal",      label: "Auckland Coastal",    group: "Oceania", dimension: "regional-aesthetic", description: "Auckland New Zealand harbor-city Pacific aesthetic", promptHint: "an Auckland coastal aesthetic — New Zealand harbor-city vibe, considered Pacific polish" },
] as const

export const PERSON_DIMENSION_ORDER: ReadonlyArray<PersonDimension> = [
  // Identity
  "type",
  "age",
  "ethnicity",
  "regional-aesthetic",
  // Body
  "build",
  "body-proportions",
  // Face structure
  "face-shape",
  "jawline",
  "eye-shape",
  "nose",
  "lips",
  "lip-state",
  // Hair
  "hair-base",
  "hair-color",
  "eyebrows",
  // Skin & eyes
  "skin-tone",
  "skin-texture",
  "eye-color",
  "eye-state",
  "facial-hair",
  "distinctive-features",
]

export const PERSON_DIMENSION_LABELS: Readonly<Record<PersonDimension, string>> = {
  type: "Type",
  age: "Age",
  ethnicity: "Ethnicity",
  "regional-aesthetic": "Regional Aesthetic",
  build: "Build",
  "body-proportions": "Body Proportions",
  "face-shape": "Face Shape",
  jawline: "Jawline",
  "eye-shape": "Eye Shape",
  nose: "Nose",
  lips: "Lips",
  "lip-state": "Lip State",
  "hair-color": "Hair Color",
  "hair-base": "Hair (Texture & Length)",
  eyebrows: "Eyebrows",
  "skin-tone": "Skin Tone",
  "skin-texture": "Skin Texture",
  "eye-color": "Eye Color",
  "eye-state": "Eye State",
  "facial-hair": "Facial Hair",
  "distinctive-features": "Distinctive Features",
}

/**
 * Maps each PersonDimension to the consumer data field name holding the
 * selected entry id. Multi-dimension model: a consumer (PersonData) may
 * independently set a value in each of the dimensions.
 */
export const PERSON_FIELD_BY_DIMENSION: Record<
  PersonDimension,
  | "type" | "age" | "ethnicity" | "regionalAesthetic" | "build" | "bodyProportions"
  | "faceShape" | "jawline" | "eyeShape" | "nose" | "lips" | "lipState"
  | "hairColor" | "hairBase" | "eyebrows"
  | "skinTone" | "skinTexture" | "eyeColor" | "eyeState" | "facialHair" | "distinctiveFeature"
> = {
  type: "type",
  age: "age",
  ethnicity: "ethnicity",
  "regional-aesthetic": "regionalAesthetic",
  build: "build",
  "body-proportions": "bodyProportions",
  "face-shape": "faceShape",
  jawline: "jawline",
  "eye-shape": "eyeShape",
  nose: "nose",
  lips: "lips",
  "lip-state": "lipState",
  "hair-color": "hairColor",
  "hair-base": "hairBase",
  eyebrows: "eyebrows",
  "skin-tone": "skinTone",
  "skin-texture": "skinTexture",
  "eye-color": "eyeColor",
  "eye-state": "eyeState",
  "facial-hair": "facialHair",
  "distinctive-features": "distinctiveFeature",
}

/**
 * Shape of the per-dimension person fields. All optional — user may set
 * zero, one, or all ten dimensions.
 */
export interface PersonValue {
  type?: string
  /** Selected age preset id (e.g. `"age-30s"`). When set to the special
   *  `"age-custom"` sentinel, the literal age in years is read from
   *  `customAge` and the hint is generated at build time. */
  age?: string
  /** Specific age in years. Only consulted when `age === "age-custom"`. */
  customAge?: number
  /** Single id, or an array of up to 2 ids for mixed heritage (e.g.
   *  ["slavic","mediterranean"] → "of mixed Slavic and Mediterranean heritage"). */
  ethnicity?: string | ReadonlyArray<string>
  /** Regional / cultural aesthetic vibe (e.g. `"cali-beach"`, `"parisienne"`,
   *  `"kinshasa-sape"`). Composes with ethnicity, skin tone, hair, and
   *  styling — the dimension's promptHints are vibe-only and never hard-code
   *  the visuals those other dimensions own. Single id or up to 2 ids for
   *  hybrid looks (e.g. ["nyc-fashion","parisienne"]). */
  regionalAesthetic?: string | ReadonlyArray<string>
  build?: string
  /** Body shape ratio (long-legged, hourglass, pear…). Independent from
   *  Build, which describes silhouette + size. */
  bodyProportions?: string
  /** Face silhouette (oval, round, square, heart…). */
  faceShape?: string
  /** Jaw shape (strong, soft, pointed, wide). */
  jawline?: string
  /** Eye shape (almond, hooded, monolid, deep-set…). */
  eyeShape?: string
  /** Nose shape (straight, aquiline, snub, broad…). */
  nose?: string
  /** Lip fullness / shape (thin, full, wide, cupid's bow…). */
  lips?: string
  /** Lip state — what the lips are doing right now (chapped, glossy,
   *  parted, biting, pursed, bold-red…). Distinct from `lips` which is
   *  anatomical shape. Single id or up to 2 (e.g. glossy + parted). */
  lipState?: string | ReadonlyArray<string>
  /** Single id or up to 2 ids for two-tone / ombre / highlighted hair
   *  (e.g. ["hair-black","hair-platinum"]). */
  hairColor?: string | ReadonlyArray<string>
  /** Natural hair texture + length (texture×length combos). The actual cut
   *  / styling choice (bob, wolf cut, braids…) lives in Styling.hair-cut. */
  hairBase?: string
  eyebrows?: string
  skinTone?: string
  /** Skin texture (smooth, porcelain, freckled, …). Single id or up to 2
   *  combined (e.g. porcelain + freckled, sun-kissed + dewy). */
  skinTexture?: string | ReadonlyArray<string>
  /** Single id or up to 2 ids for heterochromia (e.g.
   *  ["eyes-blue","eyes-green"]). */
  eyeColor?: string | ReadonlyArray<string>
  /** Eye state — what the eyes are doing (closed, half-lidded, wide-eyed,
   *  staring at camera, gazing away/up/down, glassy). Distinct from
   *  `eyeShape` (anatomy) and `eyeColor`. Single id or up to 2 (e.g.
   *  half-lidded + glassy). */
  eyeState?: string | ReadonlyArray<string>
  facialHair?: string
  /** Single id or up to 3 ids for combined features (e.g. freckles +
   *  glasses + sleeve tattoo). */
  distinctiveFeature?: string | ReadonlyArray<string>
  /** Free-text appended BEFORE the dimension compound. Use when you want
   * context/framing to come first (e.g. "wet-haired" or "covered in paint"). */
  preText?: string
  /** Free-text appended AFTER the dimension compound. Use for extra
   * specifics that dimensions can't capture (e.g. "wearing a leather
   * jacket", "with a silver necklace"). */
  postText?: string
}

const personById = new Map<string, Person>(PEOPLE.map((p) => [p.id, p]))

export function getPerson(id: string | undefined | null): Person | undefined {
  if (!id) return undefined
  return personById.get(id)
}

export function getPersonLabel(id: string | undefined | null, fallback?: string): string {
  const p = getPerson(id)
  if (p) return p.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getPersonPromptHint(id: string | undefined | null): string {
  return getPerson(id)?.promptHint ?? ""
}

export const PERSON_IDS: ReadonlyArray<string> = PEOPLE.map((p) => p.id)

/**
 * Aggregate all enabled per-dimension person prompt hints from a consumer's
 * data, in canonical dimension order (type, age, ethnicity, build, hair
 * style, hair color, skin tone, eye color, facial hair, distinctive
 * features).
 *
 * Accepts a loosely typed record (the helper is shared between strongly
 * typed frontend node data and the backend's `Record<string, unknown>`
 * workflow data). Non-string values are ignored.
 *
 * Returns array of fragment strings — caller joins on ", " for the
 * compound description ("a beautiful woman, in their 30s, East Asian, slim
 * build, long wavy hair, brown hair, fair skin, green eyes, wearing
 * glasses").
 */
/**
 * Build the ethnicity hint clause. Single pick → "of {Group} descent"
 * (the entry's own promptHint). Two picks → mixed-heritage clause that
 * names both backgrounds. We use the entry label rather than re-running
 * promptHint, since "of mixed X and Y heritage" is a different grammar
 * from concatenating two "of X descent" / "of Y descent" sentences.
 */
function normalizePickIds(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : []
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v === "string" && v && !out.includes(v)) out.push(v)
  }
  return out
}

function buildEthnicityHint(value: unknown): string {
  const ids = normalizePickIds(value)
  if (ids.length === 0) return ""
  if (ids.length === 1) return getPersonPromptHint(ids[0])
  const labels = ids
    .slice(0, 2)
    .map((id) => getPerson(id)?.shortLabel ?? getPerson(id)?.label ?? "")
    .filter((s): s is string => Boolean(s))
  if (labels.length < 2) return getPersonPromptHint(ids[0])
  return `of mixed ${labels[0]} and ${labels[1]} heritage`
}

/**
 * Hair color: single → entry's hint ("blonde hair", "auburn hair"). Two →
 * "two-tone X and Y hair" using lowercased entry labels (covers ombre,
 * balayage, highlights, dyed two-tone styles).
 */
function buildHairColorHint(value: unknown): string {
  const ids = normalizePickIds(value)
  if (ids.length === 0) return ""
  if (ids.length === 1) return getPersonPromptHint(ids[0])
  const labels = ids
    .slice(0, 2)
    .map((id) => getPerson(id)?.label?.toLowerCase() ?? "")
    .filter((s): s is string => Boolean(s))
  if (labels.length < 2) return getPersonPromptHint(ids[0])
  return `two-tone ${labels[0]} and ${labels[1]} hair`
}

/**
 * Eye color: single → entry's hint ("blue eyes"). Two → independent emit
 * like distinctive-features. We deliberately avoid hard-coding a
 * heterochromia interpretation because users also pick two colors to
 * mean "natural eye color + tinted contacts" or "sectoral / mixed iris".
 * Letting both hints stand side-by-side lets the diffusion model
 * resolve from the rest of the prompt context. Users wanting an explicit
 * heterochromia look should add the `feature-heterochromia` distinctive
 * feature alongside the two color picks.
 */
function buildEyeColorHints(value: unknown): string[] {
  return emitIndependentHints(value)
}

/**
 * Age hint with optional custom-numeric override. When the user picks the
 * "age-custom" sentinel and provides a specific number, generate a phrase
 * tuned to the life stage (toddler / child / teen wording for the lower
 * ranges, plain "{N} years old" for adults). Otherwise return the catalog
 * entry's static promptHint.
 *
 * Custom number is clamped to a sane range and rejected if non-finite.
 */
export function buildAgeHint(
  ageId: string | undefined | null,
  customAge: number | undefined | null,
): string {
  if (ageId !== "age-custom") return getPersonPromptHint(ageId)
  if (typeof customAge !== "number" || !Number.isFinite(customAge)) return ""
  const n = Math.max(0, Math.min(120, Math.round(customAge)))
  if (n === 0) return "a newborn under 1 year old"
  if (n === 1) return "around 1 year old"
  if (n < 4) return `a toddler around ${n} years old`
  if (n < 7) return `a young child around ${n} years old`
  if (n < 10) return `a child around ${n} years old`
  if (n < 13) return `a pre-teen around ${n} years old`
  if (n < 20) return `${n} years old, in their teens`
  return `${n} years old`
}

/**
 * Multi-pick "state" dims (distinctive-features, lip-state, eye-state,
 * skin-texture) — independent flags rather than mutually exclusive. Each
 * entry's promptHint is a standalone "with X" / "wearing X" / "staring X"
 * clause, so we emit them all separately and let buildPersonHints'
 * comma-join read naturally.
 */
function emitIndependentHints(value: unknown): string[] {
  const ids = normalizePickIds(value)
  const out: string[] = []
  for (const id of ids) {
    const hint = getPersonPromptHint(id)
    if (hint) out.push(hint)
  }
  return out
}

export function buildPersonHints(
  data: Record<string, unknown> & PersonValue,
): string[] {
  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  for (const dimension of PERSON_DIMENSION_ORDER) {
    const field = PERSON_FIELD_BY_DIMENSION[dimension]
    const raw = data[field]
    if (dimension === "age") {
      const ageId = typeof raw === "string" ? raw : undefined
      const customAge = typeof data.customAge === "number" ? data.customAge : undefined
      const h = buildAgeHint(ageId, customAge)
      if (h) hints.push(h)
      continue
    }
    if (dimension === "ethnicity") {
      const h = buildEthnicityHint(raw)
      if (h) hints.push(h)
      continue
    }
    if (dimension === "hair-color") {
      const h = buildHairColorHint(raw)
      if (h) hints.push(h)
      continue
    }
    if (dimension === "eye-color") {
      for (const h of buildEyeColorHints(raw)) hints.push(h)
      continue
    }
    if (
      dimension === "distinctive-features" ||
      dimension === "lip-state" ||
      dimension === "eye-state" ||
      dimension === "skin-texture" ||
      dimension === "regional-aesthetic"
    ) {
      for (const h of emitIndependentHints(raw)) hints.push(h)
      continue
    }
    if (typeof raw !== "string" || raw.length === 0) continue
    const hint = getPersonPromptHint(raw)
    if (hint) hints.push(hint)
  }

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}
