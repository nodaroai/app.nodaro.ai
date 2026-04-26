import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Classic Cars --------------------
  "muscle-car": { label: "Muscle Car", description: "आक्रामक American muscle car, लंबा hood, चौड़ा stance, दोहरे chrome exhausts और गहरी V8 की उपस्थिति" },
  "car-57-chevy": { description: "1957 की प्रतिष्ठित Chevrolet Bel Air, tail fins, chrome bumpers, two-tone paint और whitewall tires के साथ" },
  "hot-rod": { label: "Hot Rod", description: "Chopped और channeled hot rod, flame paint, खुला chrome engine, मोटे पीछे के tires और पतले सामने" },
  "vintage-roadster": { label: "विंटेज Roadster", description: "Pre-war खुली-top roadster, झूलते fenders, running boards, wire-spoke wheels और लंबा polished hood" },
  "model-t": { description: "20वीं सदी के शुरुआती की काली Model T, बक्से जैसा सीधा बदन, brass headlamps, spoked wheels और cranked engine" },
  "vw-beetle": { description: "गोल pastel-रंगी Volkswagen Beetle, घुमावदार hood, air-cooled rear engine और ख़ुश bug-जैसा चेहरा" },
  "checker-cab": { label: "Checker Cab", description: "क्लासिक पीली New York checker taxi, बक्से जैसा बदन, काली-सफ़ेद checker पट्टी और छत की रोशनी" },
  "woody-wagon": { label: "Woody Wagon", description: "Surf-era station wagon, लकड़ी-paneled side दरवाज़े, chrome bumpers और लंबा tailgate" },
  "lowrider": { label: "Lowrider", description: "Candy-painted lowrider, hydraulic suspension, chrome spoke wheels, whitewall tires और airbrushed murals" },

  // -------------------- Everyday Cars --------------------
  "sedan": { label: "Sedan", description: "चार-दरवाज़ों वाली midsize sedan, streamlined silhouette, chrome accents और आधुनिक LED headlights" },
  "suv": { label: "SUV", description: "बड़ा sport utility vehicle, ऊँचा stance, roof rails, बड़े alloy wheels और मांसल चौकोर बदन" },
  "hatchback": { label: "Hatchback", description: "कॉम्पैक्ट hatchback, छोटा rear, lift-up tailgate, फुर्तीला अनुपात और चमकीला paint" },
  "minivan": { label: "Minivan", description: "Family minivan, sliding side दरवाज़े, ऊँचा विशाल cabin, tinted rear windows और विशाल rear hatch" },
  "station-wagon": { label: "Station Wagon", description: "लंबी छत वाली station wagon, बढ़ा हुआ cargo क्षेत्र, rear quarter windows और family-oriented silhouette" },
  "crossover": { label: "Crossover", description: "मध्यम आकार का crossover SUV, उठी हुई ride height, car-जैसी styling और aerodynamic LED accents" },
  "electric-car": { label: "Electric Car", description: "Sleek आधुनिक electric car, चिकना grille-less front, flush door handles और aerodynamic साफ़ रेखाएँ" },
  "hatchback-econobox": { label: "Econobox", description: "नन्ही सस्ती दो-दरवाज़ों वाली city car, छोटा hood, छोटे wheels और साधारण कॉम्पैक्ट styling" },

  // -------------------- Performance / Exotic --------------------
  "sports-car": { label: "Sports Car", description: "नीची दो-दरवाज़ों वाली sports car, चौड़ा आक्रामक stance, aerodynamic bodywork और चमकीला glossy paint" },
  "supercar": { label: "Supercar", description: "Exotic mid-engined supercar, scissor दरवाज़े, अति-नीचा hood, बड़े rear intakes और carbon-fiber rear wing" },
  "convertible": { label: "Convertible", description: "दो-सीटों वाली convertible, soft top नीचे, लंबा sculpted hood और low-cut दरवाज़ों के पास से बहती हवा" },
  "grand-tourer": { label: "Grand Tourer", description: "लालित्यपूर्ण grand-touring coupe, लंबा बहता hood, चार exhausts और शानदार अनुपात" },
  "roadster": { label: "Roadster", description: "कॉम्पैक्ट दो-सीटों वाली roadster, wraparound windshield, soft top छुपा हुआ और क्लासिक top-down silhouette" },
  "racing-car": { label: "Racing Car", description: "Open-wheel formula racing car, slick tires, बड़ा rear wing, halo cockpit और sponsor logos से ढके aerodynamic sidepods" },
  "rally-car": { label: "Rally Car", description: "मिट्टी से सनी rally hatchback, knobby tires, बड़े mud flaps, छत पर लगी lights और race liveries" },
  "drift-car": { label: "Drift Car", description: "आक्रामक drift-tuned coupe, चौड़ा body kit, बड़ा rear wing, neon underglow और पीछे जाते tire के धुएँ के निशान" },

  // -------------------- Motorcycles --------------------
  "sportbike": { label: "Sportbike", description: "Aerodynamic sport motorcycle, झुकी riding मुद्रा, पूरी fairings, चिपचिपे tires और चमकीले race-शैली graphics" },
  "cruiser": { label: "Cruiser", description: "नीचा cruiser motorcycle, लंबा teardrop tank, swept-back handlebars, chrome exhausts और मोटा rear tire" },
  "chopper": { label: "Chopper", description: "Stretched custom chopper, raked-out front end, ऊँचे ape-hanger handlebars, पतला front wheel और हर तरफ़ chrome" },
  "dirt-bike": { label: "Dirt Bike", description: "Off-road dirt bike, knobby tires, ऊँची suspension, चमकीले रंगों में plastic fairings और ऊँचे handlebars" },
  "scooter": { label: "Scooter", description: "कॉम्पैक्ट step-through scooter, चिकनी बदन की shell, छोटे wheels, सपाट footrest और सीट के नीचे storage का bump" },
  "moped": { label: "Moped", description: "छोटा pedal-start moped, साधारण steel frame, सामने basket और सीट के नीचे छोटा gas engine" },
  "cafe-racer": { label: "Cafe Racer", description: "Stripped-down cafe racer motorcycle, clip-on bars, humped solo seat, खुला frame और minimalist tank" },

  // -------------------- Bicycles & Human-Powered --------------------
  "road-bike": { label: "Road Bike", description: "हल्की road bike, drop handlebars, पतले high-pressure tires और aerodynamic carbon frame" },
  "mountain-bike": { label: "Mountain Bike", description: "मज़बूत mountain bike, knobby tires, front suspension fork, flat handlebars और मिट्टी से सना frame" },
  "bmx": { label: "BMX Bike", description: "Stunt BMX bike, छोटा frame, axles पर pegs, मोटे tires और cross-brace handlebar" },
  "cruiser-bike": { label: "Beach Cruiser", description: "आराम की beach cruiser bicycle, घुमावदार frame, swept-back handlebars, चौड़ी सीट और balloon tires" },
  "penny-farthing": { label: "Penny Farthing", description: "Victorian penny-farthing bicycle, बहुत बड़ा front wheel, नन्हा rear wheel और ऊँचे लगा leather saddle" },
  "unicycle": { label: "Unicycle", description: "एक-pahiye वाली unicycle, ऊँची सीट post, hub पर साधारण pedals और minimalist circus look" },
  "skateboard": { label: "Skateboard", description: "लकड़ी का skateboard deck, ऊपर grip tape, चार polyurethane wheels और नीचे रंगीन graphic art" },
  "kick-scooter": { label: "Kick Scooter", description: "दो-pahiyon वाला kick scooter, ऊँचा T-handle, संकरा deck और छोटे सख़्त wheels" },

  // -------------------- Trucks --------------------
  "pickup-truck": { label: "Pickup Truck", description: "Full-size pickup truck, ऊँची crew cab, खुली पीछे की bed, chrome grille और आक्रामक off-road tires" },
  "semi-truck": { label: "Semi Truck", description: "Long-haul semi truck, sleeper cab, ऊँचे chrome exhaust stacks और पीछे विशाल articulated trailer" },
  "dump-truck": { label: "Dump Truck", description: "Heavy-duty dump truck, उठा हुआ tipping bed, बड़े off-road tires और पीली construction livery" },
  "tow-truck": { label: "Tow Truck", description: "Tow truck, hydraulic boom, hook और सपाट recovery bed, घूमती amber warning lights और bold signage" },
  "delivery-van": { label: "Delivery Van", description: "सफ़ेद delivery van, बक्से जैसा cargo hold, sliding side दरवाज़ा, छत पर racks और corporate livery decals" },
  "ice-cream-truck": { label: "Ice Cream Truck", description: "ख़ुश ice cream truck, pastel paint, treats दिखाती window counter, रंगीन decals और cone-आकार का छत का ornament" },
  "food-truck": { label: "Food Truck", description: "Stylized food truck, folding service window, chalkboard menu, string lights और चमकीला custom wrap" },
  "box-truck": { label: "Box Truck", description: "मध्यम box truck, साधारण आयताकार cargo box, roll-up पीछे का दरवाज़ा और सामने cab" },

  // -------------------- Transit --------------------
  "city-bus": { label: "City Bus", description: "आधुनिक articulated city bus, नीचा फ़र्श, sliding दरवाज़े, सामने destination sign और advertising wrap" },
  "school-bus": { label: "School Bus", description: "क्लासिक पीली American school bus, काली trim, चमकती लाल stop signs, बाहर stop-arm और काले stenciled अंक" },
  "double-decker": { label: "Double-Decker Bus", description: "प्रतिष्ठित लाल double-decker bus, गोल छत, अंदर खुली सीढ़ी और सामने destination scroll" },
  "coach-bus": { label: "Coach Bus", description: "लंबी दूरी की coach bus, tinted panoramic windows, नीचे luggage bays और streamlined bodywork" },
  "train": { label: "Train", description: "आधुनिक passenger train, sleek streamlined नाक, panoramic windows और चमकती cars की पंक्ति" },
  "steam-locomotive": { label: "Steam Locomotive", description: "काली steam locomotive, ऊँचा smokestack भाप उगलता हुआ, boiler, connecting rods और पीछे coal tender" },
  "bullet-train": { label: "Bullet Train", description: "उच्च-गति की bullet train, aerodynamic नुकीली नाक, चिकनी सफ़ेद-नीली livery और संकरी windows" },
  "subway": { label: "Subway Train", description: "Stainless-steel subway car, graffiti-resistant panels, sliding दरवाज़े और अंदर fluorescent lights की पंक्तियाँ" },
  "tram": { label: "Tram", description: "क्लासिक city tram car, बक्से जैसा लकड़ी का बदन, ऊपर pantograph और नीचे चलती rails" },
  "stagecoach": { label: "Stagecoach", description: "Wild-west stagecoach, लकड़ी का बदन, leaf-spring suspension, छत पर luggage rack और सामने जुते घोड़ों की team" },
  "horse-carriage": { label: "घोड़ा-गाड़ी", description: "अलंकृत घोड़ा-गाड़ी, polished लकड़ी के panels, बड़े spoked wheels और velvet-upholstered cabin" },

  // -------------------- Aircraft --------------------
  "airliner": { label: "Airliner", description: "Wide-body commercial airliner, swept wings के नीचे जुड़वाँ jet engines, अंडाकार windows की पंक्तियाँ और ऊँची swept tail fin" },
  "biplane": { label: "Biplane", description: "विंटेज biplane, struts और wire bracing से जुड़े दो stacked पंख, खुला cockpit और लकड़ी का propeller" },
  "propeller-plane": { label: "Propeller Plane", description: "छोटा single-engine propeller plane, घूमती नाक की prop, ऊँचे पंख, fixed landing gear और bubble cockpit" },
  "helicopter": { label: "Helicopter", description: "Utility helicopter, ऊपर बड़ा main rotor, पतला tail boom, नीचे skids और bubble-front cockpit" },
  "seaplane": { label: "Seaplane", description: "Seaplane, wheels के बजाय जुड़वाँ pontoon floats, ऊँचे पंख और propeller, शांत पानी पर खड़ा" },
  "hot-air-balloon": { label: "Hot Air Balloon", description: "विशाल hot-air balloon, रंगीन धारीदार envelope, ऊपर भड़कता flame burner और नीचे wicker basket" },
  "blimp": { label: "Blimp", description: "Sausage-आकार का blimp airship, sleek silver envelope, छोटे rear fins और slung gondola" },
  "glider": { label: "Glider", description: "लालित्यपूर्ण sailplane glider, अति-लंबे संकरे पंख, कोई engine नहीं और teardrop cockpit pod" },
  "drone": { label: "Drone", description: "Quadcopter camera drone, पतले arms पर चार घूमते rotors, केंद्रीय बदन और नीचे gimbaled camera" },

  // -------------------- Watercraft --------------------
  "yacht": { label: "Yacht", description: "Sleek luxury motor yacht, कई decks, tinted windows, radar mast और glossy सफ़ेद hull नीले पानी को काटता हुआ" },
  "sailboat": { label: "Sailboat", description: "ग्रेसफुल sailboat, ऊँचा mast, हवा पकड़ते कसे सफ़ेद sails और संकरा fiberglass hull" },
  "speedboat": { label: "Speedboat", description: "तेज़ powerboat, नुकीला deep-V hull, नीची windshield और गरजता outboard motor" },
  "cruise-ship": { label: "Cruise Ship", description: "विशाल cruise ship, कई ऊँचे decks, balconies की पंक्तियाँ, चमकीले funnels और नुकीला bow" },
  "cargo-ship": { label: "Cargo Ship", description: "विशाल container cargo ship, इंद्रधनुषी रंगों के shipping containers से ढका, stern पर bridge tower" },
  "canoe": { label: "Canoe", description: "क्लासिक लकड़ी की canoe, नुकीली bow और stern, cedar-ribbed अंदरूनी और अंदर एक paddle" },
  "kayak": { label: "Kayak", description: "पतला plastic kayak, low profile, बंद cockpit और double-bladed paddle" },
  "rowboat": { label: "Rowboat", description: "छोटी लकड़ी की rowboat, सपाट-bottom planks, gunwales पर oarlocks और दो लकड़ी के oars" },
  "jet-ski": { label: "Jet Ski", description: "Stand-up personal watercraft, आक्रामक fairing, handlebars, एक सीट और jet-propulsion nozzle" },
  "submarine": { label: "Submarine", description: "Military submarine, लंबा cylindrical hull, periscopes वाला conning tower और गहरे पानी में डुबकी लगाता bulbous bow" },
  "pirate-ship": { label: "Pirate Ship", description: "लकड़ी का pirate galleon, ऊँचे masts, square sails, bow पर figurehead, hull के साथ cannons और फटा काला झंडा" },

  // -------------------- Military --------------------
  "tank": { label: "Tank", description: "भारी battle tank, लंबा cannon barrel, घूमता turret, मोटा ढलवाँ कवच और चौड़े continuous tracks" },
  "humvee": { label: "Humvee", description: "Military Humvee, चौड़ा stance, कवचदार angular bodywork, off-road tires और छत पर turret" },
  "armored-personnel-carrier": { label: "Armored Personnel Carrier", description: "Tracked armored personnel carrier, बक्से जैसा hull, पीछे ramp और ऊपर छोटा turret" },
  "fighter-jet": { label: "Fighter Jet", description: "Supersonic fighter jet, swept delta wings, तीखी नुकीली नाक, जुड़वाँ tail fins और wing pylons पर missiles" },
  "stealth-bomber": { label: "Stealth Bomber", description: "Flying-wing stealth bomber, matte काली त्रिकोणीय silhouette, कोई tail fins नहीं और faceted radar-absorbing सतहें" },
  "destroyer": { label: "Destroyer", description: "Sleek naval destroyer, लंबा धूसर hull, gun turrets, missile launchers और radar-bristling superstructure" },
  "aircraft-carrier": { label: "Aircraft Carrier", description: "विशाल aircraft carrier, सपाट flight deck, radar arrays वाला island tower और पंक्तियों में खड़े fighter jets" },

  // -------------------- Construction --------------------
  "bulldozer": { label: "Bulldozer", description: "पीला construction bulldozer, सामने विशाल push blade, भारी tracks और ऊँचा exhaust stack" },
  "excavator": { label: "Excavator", description: "Hydraulic excavator, articulated arm, दाँतेदार bucket, घूमता cab और भारी tracked base" },
  "crane-truck": { label: "Crane Truck", description: "Mobile crane truck, ऊपर तक फैला विशाल telescoping boom, stabilizer outriggers और भारी counterweight" },
  "cement-mixer": { label: "Cement Mixer", description: "Cement mixer truck, बड़ा घूमता drum, पीछे chute और बक्से जैसा cab" },
  "forklift": { label: "Forklift", description: "Warehouse forklift, सामने उठी जुड़वाँ steel fork tines, ड्राइवर के ऊपर roll cage और कॉम्पैक्ट counterweight rear" },
  "backhoe": { label: "Backhoe", description: "Backhoe loader, scooping के लिए सामने bucket और दाँतेदार digging bucket वाली पीछे articulated arm" },
  "tractor": { label: "Tractor", description: "Farm tractor, बड़े knobby पीछे के tires, छोटे सामने के tires, छत का canopy और पीछे towing hitch" },

  // -------------------- Sci-Fi / Fantasy --------------------
  "spaceship": { label: "Spaceship", description: "Sleek interstellar spaceship, घुमावदार fuselage, चमकते engine nozzles, antenna arrays और command bridge की window" },
  "starfighter": { label: "Starfighter", description: "फुर्तीला single-pilot starfighter, swept wings, wingtips पर laser cannons, bubble cockpit और चमकते thrusters" },
  "hovercar": { label: "Hovercar", description: "भविष्यवादी hovercar ज़मीन के ऊपर तैरती हुई, कोई wheels नहीं, चमकते underside thrusters, seamless bodywork और घुमावदार canopy" },
  "mech": { label: "Mech", description: "विशाल bipedal mech robot, कवचदार plating, hydraulic pistons, धड़ में cockpit और बाँहों पर लगे भारी हथियार" },
  "flying-saucer": { label: "Flying Saucer", description: "क्लासिक UFO flying saucer, metallic disc बदन, rim पर चमकती porthole lights और ऊपर domed cockpit" },
  "space-shuttle": { label: "Space Shuttle", description: "Space shuttle orbiter, सफ़ेद delta wings, काला heat-shield underbelly और पीछे विशाल rocket nozzles" },
  "rocket": { label: "Rocket", description: "ऊँचा cylindrical rocket, नुकीला nose cone, tail fins, booster stages और launch पर engines से गर्जती लपटें" },
  "hoverboard": { label: "Hoverboard", description: "भविष्यवादी hoverboard ज़मीन के ऊपर इंच भर तैरती हुई, चमकते underside jets और sleek single-plank बदन" },
}

export default map
