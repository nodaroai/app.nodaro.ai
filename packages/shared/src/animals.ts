/**
 * Canonical catalog of animal presets for the Object entity node.
 *
 * When the Object category is "animal", users pick a specific animal from this
 * catalog. The picker auto-fills the object's `objectName` and `description`
 * so the existing `buildObjectPrompt` pipeline just works — no backend prompt
 * changes needed.
 *
 * Organized into everyday sub-categories: cats, dogs, transport animals (the
 * rideable / working ones like horse + camel + donkey), farm, wild, birds,
 * sea, small pets, reptiles, and mythical.
 */

export type AnimalSubcategory =
  | "cats"
  | "dogs"
  | "transport"
  | "farm"
  | "wild"
  | "birds"
  | "sea"
  | "small-pets"
  | "reptiles"
  | "insects"
  | "dinosaurs"
  | "mythical"

export interface Animal {
  readonly id: string
  readonly label: string
  readonly subcategory: AnimalSubcategory
  readonly description: string
}

export const ANIMALS: ReadonlyArray<Animal> = [
  // -------------------- Cats --------------------
  { id: "cat-persian",          label: "Persian Cat",          subcategory: "cats", description: "Long-haired cat with a flat face, stocky build and luxurious fluffy coat" },
  { id: "cat-siamese",          label: "Siamese Cat",          subcategory: "cats", description: "Sleek short-haired cat with a cream body, dark points on face, ears, paws and tail, and piercing blue almond-shaped eyes" },
  { id: "cat-maine-coon",       label: "Maine Coon",           subcategory: "cats", description: "Very large long-haired cat with a shaggy ruff, tufted ears and a bushy ringed tail" },
  { id: "cat-bengal",           label: "Bengal Cat",           subcategory: "cats", description: "Muscular athletic cat with a sleek leopard-like rosetted coat in gold and brown" },
  { id: "cat-sphynx",           label: "Sphynx Cat",           subcategory: "cats", description: "Hairless wrinkled cat with large bat-like ears, prominent cheekbones and an elegant muscular frame" },
  { id: "cat-ragdoll",          label: "Ragdoll Cat",          subcategory: "cats", description: "Large semi-long-haired cat with a soft silky coat, color points and vivid blue eyes" },
  { id: "cat-british-shorthair",label: "British Shorthair",    subcategory: "cats", description: "Plush round-faced cat with a dense blue-grey coat, chubby cheeks and copper eyes" },
  { id: "cat-scottish-fold",    label: "Scottish Fold",        subcategory: "cats", description: "Round-faced cat with small folded ears, a stocky body and big round owl-like eyes" },
  { id: "cat-tabby",            label: "Tabby Cat",            subcategory: "cats", description: "Classic striped short-haired cat with an M mark on the forehead and alert green eyes" },
  { id: "cat-black",            label: "Black Cat",            subcategory: "cats", description: "Sleek all-black short-haired cat with bright yellow-green eyes and a glossy coat" },

  // -------------------- Dogs --------------------
  { id: "dog-labrador",         label: "Labrador Retriever",   subcategory: "dogs", description: "Friendly medium-large sporting dog with a short dense coat in yellow, black or chocolate and a thick otter tail" },
  { id: "dog-golden-retriever", label: "Golden Retriever",     subcategory: "dogs", description: "Medium-large dog with a luxurious wavy golden coat, feathered tail and a warm friendly face" },
  { id: "dog-german-shepherd",  label: "German Shepherd",      subcategory: "dogs", description: "Strong alert working dog with a tan and black saddle coat, erect ears and a bushy tail" },
  { id: "dog-bulldog",          label: "Bulldog",              subcategory: "dogs", description: "Stocky muscular short-haired dog with a wrinkled flat face, wide jaw and loose jowls" },
  { id: "dog-poodle",           label: "Poodle",               subcategory: "dogs", description: "Elegant curly-coated dog with a proud posture and a classic groomed silhouette" },
  { id: "dog-husky",            label: "Siberian Husky",       subcategory: "dogs", description: "Thick double-coated dog with black and white markings, piercing blue or bi-colored eyes and erect triangular ears" },
  { id: "dog-beagle",           label: "Beagle",               subcategory: "dogs", description: "Small tri-color hound with long floppy ears, a short coat and a white-tipped tail" },
  { id: "dog-dachshund",        label: "Dachshund",            subcategory: "dogs", description: "Long low-slung dog with short legs, a deep chest and long drooping ears" },
  { id: "dog-chihuahua",        label: "Chihuahua",            subcategory: "dogs", description: "Tiny toy dog with an apple-shaped head, huge upright ears and big alert eyes" },
  { id: "dog-corgi",            label: "Corgi",                subcategory: "dogs", description: "Short-legged herding dog with a fox-like face, huge upright ears and a plush double coat in red and white" },
  { id: "dog-pug",              label: "Pug",                  subcategory: "dogs", description: "Small stocky dog with a deeply wrinkled flat face, curly tail and a fawn coat with a black mask" },
  { id: "dog-border-collie",    label: "Border Collie",        subcategory: "dogs", description: "Agile medium-sized herding dog with a black and white coat, intense stare and feathered tail" },
  { id: "dog-rottweiler",       label: "Rottweiler",           subcategory: "dogs", description: "Powerful muscular dog with a short glossy black coat and distinctive mahogany markings on face, chest and legs" },
  { id: "dog-shiba-inu",        label: "Shiba Inu",            subcategory: "dogs", description: "Compact spitz-type dog with a red-orange coat, curled tail, erect triangular ears and a fox-like face" },

  // -------------------- Transport / Working --------------------
  { id: "horse",                label: "Horse",                subcategory: "transport", description: "Strong graceful horse with flowing mane and tail, sturdy hooves and a muscular frame" },
  { id: "camel",                label: "Camel",                subcategory: "transport", description: "Desert camel with a tall humped back, long legs, wide padded feet and a serene face" },
  { id: "donkey",               label: "Donkey",               subcategory: "transport", description: "Small sturdy donkey with long ears, a short upright mane and a gentle face" },
  { id: "mule",                 label: "Mule",                 subcategory: "transport", description: "Hardy pack mule with long ears, a short dark mane and a compact muscular frame" },
  { id: "ox",                   label: "Ox",                   subcategory: "transport", description: "Massive working ox with broad shoulders, curved horns and a patient stoic face" },

  // -------------------- Farm --------------------
  { id: "cow",                  label: "Cow",                  subcategory: "farm", description: "Dairy cow with a white and black patched hide, large udder and gentle brown eyes" },
  { id: "pig",                  label: "Pig",                  subcategory: "farm", description: "Stout pink farm pig with a curled tail, round snout and upright ears" },
  { id: "sheep",                label: "Sheep",                subcategory: "farm", description: "Fluffy woolly sheep with a thick cream fleece, dark face and short legs" },
  { id: "goat",                 label: "Goat",                 subcategory: "farm", description: "Nimble goat with a shaggy coat, curved horns, a tuft of beard and rectangular pupils" },
  { id: "chicken",              label: "Chicken",              subcategory: "farm", description: "Classic farm chicken with a red comb and wattles, feathered body and alert side-tilted head" },
  { id: "rooster",              label: "Rooster",              subcategory: "farm", description: "Proud rooster with a tall red comb, iridescent green-and-copper feathers and long arched tail plumes" },
  { id: "duck",                 label: "Duck",                 subcategory: "farm", description: "White-and-brown farm duck with an orange bill, webbed feet and a rounded rump" },
  { id: "rabbit",               label: "Rabbit",               subcategory: "farm", description: "Fluffy rabbit with long upright ears, a twitching nose and a cotton-ball tail" },
  { id: "turkey",               label: "Turkey",               subcategory: "farm", description: "Large turkey with a fan of dark iridescent tail feathers, a bare red head and a dangling snood" },

  // -------------------- Wild --------------------
  { id: "lion",                 label: "Lion",                 subcategory: "wild", description: "Powerful male lion with a thick golden mane framing a wide tawny face and a muscular frame" },
  { id: "tiger",                label: "Tiger",                subcategory: "wild", description: "Massive tiger with striking orange fur, bold black stripes and intense amber eyes" },
  { id: "bear",                 label: "Bear",                 subcategory: "wild", description: "Large brown bear with thick shaggy fur, a broad head, round ears and powerful clawed paws" },
  { id: "polar-bear",           label: "Polar Bear",           subcategory: "wild", description: "Massive arctic bear with thick cream-white fur, a long neck, black nose and huge padded paws" },
  { id: "wolf",                 label: "Wolf",                 subcategory: "wild", description: "Lean grey wolf with a thick double coat, upright ears, piercing yellow eyes and a bushy tail" },
  { id: "fox",                  label: "Fox",                  subcategory: "wild", description: "Slender red fox with a sharp pointed muzzle, upright ears and a long white-tipped bushy tail" },
  { id: "elephant",             label: "Elephant",             subcategory: "wild", description: "Massive elephant with a wrinkled grey hide, long trunk, wide flapping ears and curved ivory tusks" },
  { id: "zebra",                label: "Zebra",                subcategory: "wild", description: "Sturdy horse-like zebra with bold black and white stripes, a short upright mane and large dark eyes" },
  { id: "giraffe",              label: "Giraffe",              subcategory: "wild", description: "Tall graceful giraffe with an impossibly long neck, a golden patchwork coat and small ossicone horns" },
  { id: "panda",                label: "Giant Panda",          subcategory: "wild", description: "Roly-poly panda with a black-and-white coat, round ears, distinctive black eye patches and a gentle face" },
  { id: "leopard",              label: "Leopard",              subcategory: "wild", description: "Sleek spotted leopard with a tawny coat covered in rosettes, muscular shoulders and piercing pale eyes" },
  { id: "cheetah",              label: "Cheetah",              subcategory: "wild", description: "Slim fast-running cheetah with a golden coat of solid black spots and tear-track lines down the face" },
  { id: "monkey",               label: "Monkey",               subcategory: "wild", description: "Agile long-tailed monkey with expressive brown eyes, slender limbs and a soft brown-and-cream coat" },
  { id: "gorilla",              label: "Gorilla",              subcategory: "wild", description: "Massive silverback gorilla with broad shoulders, a prominent brow ridge and thick black fur" },
  { id: "kangaroo",             label: "Kangaroo",             subcategory: "wild", description: "Tall kangaroo with powerful hind legs, a thick muscular tail, small front paws and upright alert ears" },
  { id: "koala",                label: "Koala",                subcategory: "wild", description: "Fluffy grey marsupial with a round head, large fuzzy ears, a big black nose and a soft fluffy chest" },
  { id: "deer",                 label: "Deer",                 subcategory: "wild", description: "Graceful deer with a reddish-brown coat, slender legs, white throat patch and — on a stag — branched antlers" },
  { id: "raccoon",              label: "Raccoon",              subcategory: "wild", description: "Masked raccoon with a grey coat, a dark bandit mask across the eyes and a bushy ringed tail" },
  { id: "capybara",             label: "Capybara",             subcategory: "wild", description: "Large peaceful South American rodent with a barrel-shaped body, blunt muzzle and calm expression, often photographed soaking in a hot spring with citrus floating around it" },
  { id: "sloth",                label: "Sloth",                subcategory: "wild", description: "Slow-moving tree-dwelling mammal with shaggy fur, long curved claws and a permanent gentle smile, often hanging upside-down from a branch" },
  { id: "red-panda",            label: "Red Panda",            subcategory: "wild", description: "Small fox-faced bamboo eater with rich reddish-brown fur, white facial markings, ringed tail and tufted upright ears, distinct from the giant panda" },
  { id: "pangolin",             label: "Pangolin",             subcategory: "wild", description: "Scaly armored anteater, distinctive overlapping plates" },
  { id: "okapi",                label: "Okapi",                subcategory: "wild", description: "Forest giraffe with zebra-striped legs" },
  { id: "quokka",               label: "Quokka",               subcategory: "wild", description: "Smiling Australian marsupial, internet-famous selfie animal" },
  { id: "meerkat",              label: "Meerkat",              subcategory: "wild", description: "Standing African mongoose, sentinel posture" },

  // -------------------- Birds --------------------
  { id: "eagle",                label: "Eagle",                subcategory: "birds", description: "Majestic eagle with a dark brown body, white head and tail, curved yellow beak and sharp talons" },
  { id: "owl",                  label: "Owl",                  subcategory: "birds", description: "Round-faced owl with a mottled brown-and-white plumage, huge forward-facing yellow eyes and feathered ear tufts" },
  { id: "parrot",               label: "Parrot",               subcategory: "birds", description: "Vibrant tropical parrot with saturated red, green, yellow and blue plumage and a hooked beak" },
  { id: "peacock",              label: "Peacock",              subcategory: "birds", description: "Iridescent blue peacock with an enormous fanned tail of shimmering eye-patterned feathers" },
  { id: "flamingo",             label: "Flamingo",             subcategory: "birds", description: "Tall slender flamingo with bright pink plumage, a long curved neck and a bent beak dipping toward the water" },
  { id: "penguin",              label: "Penguin",              subcategory: "birds", description: "Upright tuxedoed penguin with a black back, white belly and small flipper-like wings" },
  { id: "swan",                 label: "Swan",                 subcategory: "birds", description: "Elegant white swan with a long curved neck, orange beak and delicately folded wings" },
  { id: "sparrow",              label: "Sparrow",              subcategory: "birds", description: "Small brown-and-grey sparrow with a streaked back, tidy round body and alert black eye" },
  { id: "crow",                 label: "Crow",                 subcategory: "birds", description: "Glossy all-black crow with a thick straight beak, intelligent dark eyes and sleek iridescent feathers" },
  { id: "hummingbird",          label: "Hummingbird",          subcategory: "birds", description: "Tiny jewel-toned hummingbird with iridescent emerald and ruby plumage and a long needle-like beak" },
  { id: "raven",                label: "Raven",                subcategory: "birds", description: "Large glossy all-black raven with a heavy wedge-shaped beak, shaggy throat hackles and an intelligent piercing gaze, often perched in a cinematic mysterious mood" },
  { id: "emu",                  label: "Emu",                  subcategory: "birds", description: "Large flightless Australian ratite bird" },

  // -------------------- Sea --------------------
  { id: "dolphin",              label: "Dolphin",              subcategory: "sea", description: "Sleek grey dolphin with a playful smiling face, curved dorsal fin and powerful tail flukes" },
  { id: "whale",                label: "Whale",                subcategory: "sea", description: "Massive humpback whale with a dark blue-grey body, long pectoral fins and barnacled knobby head" },
  { id: "shark",                label: "Shark",                subcategory: "sea", description: "Powerful great white shark with a torpedo-shaped grey body, white underside and rows of sharp teeth" },
  { id: "octopus",              label: "Octopus",              subcategory: "sea", description: "Curious octopus with a bulbous head, large intelligent eyes and eight long suckered arms" },
  { id: "sea-turtle",           label: "Sea Turtle",           subcategory: "sea", description: "Graceful sea turtle with a patterned green-and-brown shell, flipper-like limbs and a wise wrinkled face" },
  { id: "jellyfish",            label: "Jellyfish",            subcategory: "sea", description: "Translucent jellyfish with a glowing bell-shaped body and long trailing filamentous tentacles" },
  { id: "crab",                 label: "Crab",                 subcategory: "sea", description: "Red-shelled crab with a wide armored carapace, large pincer claws and skittering side-stepping legs" },
  { id: "seahorse",             label: "Seahorse",             subcategory: "sea", description: "Tiny seahorse with a curled prehensile tail, horse-like head and delicate dorsal fin" },
  { id: "axolotl",              label: "Axolotl",              subcategory: "sea", description: "Pink-fleshed aquatic salamander with feathery external gills fanning out from the head, tiny clawed limbs and a distinctive smiling face" },

  // -------------------- Small Pets --------------------
  { id: "hamster",              label: "Hamster",              subcategory: "small-pets", description: "Round fluffy hamster with chubby cheek pouches, tiny paws and bright black bead eyes" },
  { id: "guinea-pig",           label: "Guinea Pig",           subcategory: "small-pets", description: "Plump guinea pig with a soft tri-color coat, no visible tail and a sweet alert face" },
  { id: "ferret",               label: "Ferret",               subcategory: "small-pets", description: "Sleek long-bodied ferret with a cream-and-sable coat, a dark bandit mask and a playful posture" },
  { id: "parakeet",             label: "Parakeet",             subcategory: "small-pets", description: "Small bright green-and-yellow parakeet with a striped head, dark eye spots and a long tapered tail" },
  { id: "gerbil",               label: "Gerbil",               subcategory: "small-pets", description: "Slender sandy-brown gerbil with large dark eyes, upright ears and a long tufted tail" },

  // -------------------- Reptiles --------------------
  { id: "snake",                label: "Snake",                subcategory: "reptiles", description: "Coiled snake with a smooth scaled body, diamond-patterned skin, slit pupils and a flickering forked tongue" },
  { id: "lizard",               label: "Lizard",               subcategory: "reptiles", description: "Agile lizard with a slender scaled body, long whip-like tail, clawed feet and keen side-facing eyes" },
  { id: "turtle",               label: "Turtle",               subcategory: "reptiles", description: "Friendly land turtle with a domed patterned shell, stout scaly legs and a wise wrinkled face" },
  { id: "crocodile",            label: "Crocodile",            subcategory: "reptiles", description: "Massive crocodile with armored olive-green scales, a long toothy snout and powerful clawed limbs" },
  { id: "chameleon",            label: "Chameleon",            subcategory: "reptiles", description: "Color-shifting chameleon with a tall casqued head, independently swiveling eyes and a tightly curled prehensile tail" },
  { id: "gecko",                label: "Gecko",                subcategory: "reptiles", description: "Small gecko with a plump spotted body, large lidless eyes and wide sticky toe pads" },

  // -------------------- Insects --------------------
  { id: "butterfly",            label: "Butterfly",            subcategory: "insects", description: "Delicate butterfly with wide patterned wings in vivid colors, a slender body and long antennae" },
  { id: "bee",                  label: "Bee",                  subcategory: "insects", description: "Fuzzy honey bee with yellow and black stripes, translucent wings and pollen-dusted legs" },
  { id: "ant",                  label: "Ant",                  subcategory: "insects", description: "Busy ant with a segmented dark body, six thin legs, bent antennae and strong mandibles" },
  { id: "spider",               label: "Spider",               subcategory: "insects", description: "Eight-legged spider with a bulbous abdomen, clustered dark eyes and fine hairs across its body" },
  { id: "ladybug",              label: "Ladybug",              subcategory: "insects", description: "Tiny red ladybug with a glossy rounded shell, bold black spots and delicate legs peeking out" },
  { id: "dragonfly",            label: "Dragonfly",            subcategory: "insects", description: "Slender dragonfly with iridescent blue-green body, huge faceted eyes and four long transparent wings" },
  { id: "beetle",               label: "Beetle",               subcategory: "insects", description: "Armored beetle with a glossy hard shell, ridged wing covers, sturdy legs and short antennae" },
  { id: "grasshopper",          label: "Grasshopper",          subcategory: "insects", description: "Green grasshopper with long powerful hind legs, folded wings along its back and long whip-like antennae" },
  { id: "praying-mantis",       label: "Praying Mantis",       subcategory: "insects", description: "Elongated praying mantis with a triangular head, large compound eyes and spiked raptorial forelegs held in a prayer pose" },
  { id: "mosquito",             label: "Mosquito",             subcategory: "insects", description: "Slender mosquito with long thin legs, narrow transparent wings and a needle-like proboscis" },
  { id: "scorpion",             label: "Scorpion",             subcategory: "insects", description: "Desert scorpion with armored segments, large pincer claws and a curled stinger-tipped tail raised over its back" },
  { id: "caterpillar",          label: "Caterpillar",          subcategory: "insects", description: "Plump segmented caterpillar with soft tufts, tiny legs and a cheerful munching posture on a green leaf" },
  { id: "tarantula",            label: "Tarantula",            subcategory: "insects", description: "Large hairy hunting spider" },

  // -------------------- Dinosaurs --------------------
  { id: "t-rex",                label: "Tyrannosaurus Rex",    subcategory: "dinosaurs", description: "Massive T-Rex with powerful hind legs, tiny clawed arms, a huge jaw full of dagger teeth and thick scaly hide" },
  { id: "velociraptor",         label: "Velociraptor",         subcategory: "dinosaurs", description: "Lean feathered velociraptor with sickle claws, a long stiff tail and a predatory forward-lean posture" },
  { id: "triceratops",          label: "Triceratops",          subcategory: "dinosaurs", description: "Armored triceratops with a large bony frill, three sharp horns on its face and a heavy four-legged stance" },
  { id: "brachiosaurus",        label: "Brachiosaurus",        subcategory: "dinosaurs", description: "Towering brachiosaurus with an impossibly long neck reaching into treetops, a small head and pillar-like legs" },
  { id: "stegosaurus",          label: "Stegosaurus",          subcategory: "dinosaurs", description: "Hulking stegosaurus with two rows of tall diamond-shaped plates along its back and a spiked tail" },
  { id: "pterodactyl",          label: "Pterodactyl",          subcategory: "dinosaurs", description: "Flying pterodactyl with vast leathery wings, a long toothed beak and a swept-back head crest" },
  { id: "spinosaurus",          label: "Spinosaurus",          subcategory: "dinosaurs", description: "Predatory spinosaurus with a tall sail fin down its back, a long crocodile-like snout and powerful clawed arms" },
  { id: "diplodocus",           label: "Diplodocus",           subcategory: "dinosaurs", description: "Enormous long-bodied diplodocus with a whip-thin tail balancing an equally long neck, peg-like teeth and sturdy legs" },
  { id: "ankylosaurus",         label: "Ankylosaurus",         subcategory: "dinosaurs", description: "Tank-like ankylosaurus covered in thick armored plates and spikes, with a massive bony club at the end of its tail" },
  { id: "brontosaurus",         label: "Brontosaurus",         subcategory: "dinosaurs", description: "Gentle giant brontosaurus with a long sweeping neck, a small head, a thick body and a tapering whip tail" },
  { id: "parasaurolophus",      label: "Parasaurolophus",      subcategory: "dinosaurs", description: "Duck-billed parasaurolophus with a long curved tubular crest sweeping back from its head and a slender bipedal body" },
  { id: "allosaurus",           label: "Allosaurus",           subcategory: "dinosaurs", description: "Fierce allosaurus predator with a large head, small brow horns, serrated teeth and powerful grasping arms" },

  // -------------------- Mythical --------------------
  { id: "dragon",               label: "Dragon",               subcategory: "mythical", description: "Towering dragon with leathery wings, ridged scales, curved horns, glowing eyes and smoke curling from its nostrils" },
  { id: "unicorn",              label: "Unicorn",              subcategory: "mythical", description: "Pure white unicorn with a flowing pastel mane and tail and a single spiraling pearlescent horn on its forehead" },
  { id: "phoenix",              label: "Phoenix",              subcategory: "mythical", description: "Majestic phoenix with fiery red, orange and gold plumage, long trailing tail feathers and flames licking its wingtips" },
  { id: "griffin",              label: "Griffin",              subcategory: "mythical", description: "Hybrid griffin with the head, wings and taloned front legs of an eagle and the muscular hind body of a lion" },
  { id: "pegasus",              label: "Pegasus",              subcategory: "mythical", description: "Pure white winged horse with feathered wings, a flowing mane and an otherworldly presence" },
  { id: "kraken",               label: "Kraken",               subcategory: "mythical", description: "Colossal sea-beast kraken with a massive head, glowing eyes and enormous suckered tentacles writhing from the deep" },
] as const

const animalById = new Map<string, Animal>(ANIMALS.map((a) => [a.id, a]))

export function getAnimal(id: string | undefined | null): Animal | undefined {
  if (!id) return undefined
  return animalById.get(id)
}

export function getAnimalLabel(id: string | undefined | null, fallback?: string): string {
  const a = getAnimal(id)
  if (a) return a.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export const ANIMAL_IDS: ReadonlyArray<string> = ANIMALS.map((a) => a.id)

export const ANIMAL_SUBCATEGORY_LABELS: Readonly<Record<AnimalSubcategory, string>> = {
  cats: "Cats",
  dogs: "Dogs",
  transport: "Transport & Working",
  farm: "Farm",
  wild: "Wild",
  birds: "Birds",
  sea: "Sea Life",
  "small-pets": "Small Pets",
  reptiles: "Reptiles",
  insects: "Insects",
  dinosaurs: "Dinosaurs",
  mythical: "Mythical",
}

export const ANIMAL_SUBCATEGORY_ORDER: ReadonlyArray<AnimalSubcategory> = [
  "cats",
  "dogs",
  "transport",
  "farm",
  "wild",
  "birds",
  "sea",
  "small-pets",
  "reptiles",
  "insects",
  "dinosaurs",
  "mythical",
]
