import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Indoor --------------------
  "coffee-shop": { label: "Coffee Shop", description: "Cozy café का अंदरूनी" },
  "library": { label: "पुस्तकालय", description: "ऊँची shelves वाला भव्य पुस्तकालय" },
  "office": { label: "आधुनिक Office", description: "उज्ज्वल काँच वाला आधुनिक office" },
  "home-office": { label: "Home Office", description: "Cozy home workspace" },
  "bedroom": { label: "शयनकक्ष", description: "अंतरंग शयनकक्ष" },
  "living-room": { label: "Living Room", description: "Cozy घरेलू living room" },
  "kitchen": { label: "रसोई", description: "सुबह की रोशनी वाली गर्म घरेलू रसोई" },
  "hotel-room": { label: "Hotel Room", description: "City view वाला लालित्यपूर्ण hotel room" },
  "restaurant": { label: "Restaurant", description: "अंतरंग candlelit restaurant" },
  "nightclub": { label: "Nightclub", description: "Lasers और धुएँ वाला गहरा club" },
  "gym": { label: "Gym", description: "आधुनिक fitness gym" },
  "classroom": { label: "Classroom", description: "उज्ज्वल स्कूल classroom" },
  "hospital": { label: "अस्पताल", description: "Sterile अस्पताल का गलियारा" },
  "laboratory": { label: "Laboratory", description: "चमकते उपकरणों वाला research lab" },
  "courtroom": { label: "Courtroom", description: "लकड़ी-paneled courtroom" },
  "warehouse": { label: "Industrial Warehouse", description: "Skylights वाला विशाल warehouse" },
  "subway-car": { label: "Subway Car", description: "चलती हुई subway का अंदरूनी" },
  "taxi": { label: "Taxi का अंदरूनी", description: "रात में city taxi की पिछली सीट" },
  "cathedral": { label: "Cathedral", description: "Gothic cathedral का अंदरूनी" },
  "art-gallery": { label: "Art Gallery", description: "Minimalist white-cube gallery" },

  // -------------------- Urban --------------------
  "city-street": { label: "शहर की सड़क", description: "व्यस्त शहर की सड़क" },
  "rooftop": { label: "Rooftop", description: "Skyline के ऊपर rooftop terrace" },
  "back-alley": { label: "पिछली गली", description: "Gritty संकरी गली" },
  "neon-alley": { label: "Neon गली", description: "बारिश से भीगी neon गली" },
  "park": { label: "शहरी Park", description: "रास्तों वाला हरा-भरा शहरी park" },
  "backyard": { label: "Backyard Patio", description: "String lights वाला deck patio" },
  "highway": { label: "खुला Highway", description: "क्षितिज तक फैला highway" },
  "bridge": { label: "Suspension Bridge", description: "पानी के ऊपर लंबा suspension bridge" },
  "train-station": { label: "Train Station", description: "Waiting train के साथ platform" },
  "airport": { label: "Airport Terminal", description: "घुमावदार काँच वाला विशाल terminal" },
  "parking-lot": { label: "Parking Lot", description: "शाम को suburban parking lot" },
  "penthouse": { label: "Penthouse", description: "Skyline view वाला luxury penthouse" },
  "gas-station": { label: "Gas Station", description: "रात में अकेला highway gas station" },

  // -------------------- Nature --------------------
  "forest": { label: "जंगल का Clearing", description: "धूप से भरा काई से ढका clearing" },
  "beach": { label: "समुद्र तट", description: "लहरों के साथ चौड़ा रेतीला समुद्र तट" },
  "mountain-peak": { label: "पहाड़ की चोटी", description: "चट्टानी alpine चोटी" },
  "desert": { label: "रेगिस्तानी Dunes", description: "हवा से बने रेगिस्तानी dunes" },
  "jungle": { label: "जंगल", description: "घना नम jungle का अंदरूनी" },
  "grassland": { label: "Grassland", description: "खुला हवा भरा grassland" },
  "snowy-tundra": { label: "बर्फ़ीला Tundra", description: "जमा हुआ हवा-कटा tundra" },
  "lake-shore": { label: "झील का किनारा", description: "स्थिर पहाड़ी झील का किनारा" },
  "riverbank": { label: "नदी का किनारा", description: "Willow पेड़ों वाली घुमावदार नदी" },
  "waterfall": { label: "Waterfall", description: "काई से ढकी चट्टानों पर गिरता cascade" },
  "cave": { label: "गुफा", description: "दिन की रोशनी की shafts वाली चट्टानी गुफा" },
  "western-canyon": { label: "Western Canyon", description: "घुमावदार नदी वाला लाल-चट्टान mesa" },

  // -------------------- Fantastical --------------------
  "alien-planet": { label: "Alien ग्रह", description: "जुड़वाँ चाँदों वाला अन्य-दुनिया का landscape" },
  "spaceship-interior": { label: "Spaceship का अंदरूनी", description: "चिकना starship corridor" },
  "underwater": { label: "पानी के अंदर", description: "धूप से भरा गहरा-समुद्र scene" },
  "fantasy-castle": { label: "Fantasy Castle", description: "विशाल castle का आँगन" },
  "medieval-village": { label: "मध्यकालीन गाँव", description: "Cobblestone गाँव का चौक" },
  "ancient-ruins": { label: "प्राचीन खंडहर", description: "बेलों से ढके पत्थर के खंडहर" },
  "cyberpunk-city": { label: "Cyberpunk शहर", description: "Neon megacity skyline" },
  "haunted-mansion": { label: "Haunted Mansion", description: "टूटा-फूटा gothic घर" },
  "dreamscape": { label: "Dreamscape", description: "Surreal तैरते द्वीप" },
  "wasteland": { label: "Post-Apocalyptic Wasteland", description: "जंग लगा बादल भरा wasteland" },
}

export default map
