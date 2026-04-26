import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Seating --------------------
  "sofa": { label: "Sofa", description: "तीन-सीटों वाला sofa, गद्देदार पीठ और सीट, नीची armrest और तटस्थ tone की upholstery" },
  "sectional-sofa": { label: "Sectional Sofa", description: "L-आकार का sectional sofa, गहरी सीटें, नरम कुशन, एक chaise सिरा और छुपा हुआ storage या recline mechanism" },
  "loveseat": { label: "Loveseat", description: "कॉम्पैक्ट दो-सीट वाला loveseat, मुड़ी हुई बाँहें, tufted पीठ और tapered लकड़ी की टाँगें" },
  "armchair": { label: "Armchair", description: "Upholstered armchair, ऊँची गद्देदार पीठ, घुमावदार armrest और चार पतली लकड़ी की टाँगें" },
  "recliner": { label: "Recliner", description: "गद्देदार recliner कुर्सी, खींचने वाला lever, बाहर निकलने वाला footrest, मोटी leather upholstery और झुकी हुई backrest" },
  "office-chair": { label: "Office Chair", description: "Ergonomic office chair, mesh पीठ, समायोज्य armrest, gas-lift ऊँचाई और पाँच-बिंदु caster base" },
  "rocking-chair": { label: "Rocking Chair", description: "लकड़ी की rocking chair, घुमावदार rockers, बुनी हुई cane पीठ और गद्देदार सीट कुशन" },
  "throne": { label: "सिंहासन", description: "अलंकृत royal सिंहासन, ऊँची नक़्क़ाशी की पीठ, gilded trim, जड़े हुए रत्न और मुलायम velvet कुशन" },
  "bean-bag": { label: "Bean Bag", description: "बड़ी ढीली bean bag कुर्सी, मुलायम कपड़े का बाहरी हिस्सा और तकिये जैसा आकार जो बदन के साथ ढल जाता है" },
  "stool": { label: "Stool", description: "साधारण backless stool, गोल लकड़ी की सीट, चार फैली हुई turned टाँगें और एक पुरानी आरामदायक patina" },
  "bench": { label: "बेंच", description: "लंबी लकड़ी की बेंच, चपटी सीट, खुली slatted पीठ और मज़बूत planked टाँगें" },
  "chaise-lounge": { label: "Chaise Lounge", description: "लालित्यपूर्ण chaise lounge, ढलवाँ headrest, लंबी upholstered सीट और turned लकड़ी की टाँगें" },
  "dining-chair": { label: "Dining Chair", description: "औपचारिक dining chair, ऊँची slatted पीठ, upholstered सीट कुशन और tapered लकड़ी की टाँगें" },

  // -------------------- Tables --------------------
  "dining-table": { label: "Dining Table", description: "बड़ी आयताकार dining table, polished लकड़ी की top, मोटा trestle base और छह से आठ लोगों के बैठने की जगह" },
  "coffee-table": { label: "Coffee Table", description: "नीची आयताकार coffee table, काँच या लकड़ी की top, साफ़ minimalist टाँगें और magazines के लिए नीचे की shelf" },
  "side-table": { label: "Side Table", description: "छोटी side table, गोल top, एक दराज़ और पतली tapered टाँगें" },
  "console-table": { label: "Console Table", description: "संकरी console table, लंबी पतली top, नाज़ुक टाँगें और apron के साथ सजावटी scrollwork" },
  "desk": { label: "Desk", description: "Writing desk, सपाट काम की सतह, बग़ल में दराज़ों का bank और पीछे cable management के लिए कटआउट" },
  "workbench": { label: "Workbench", description: "Heavy-duty workbench, मोटी butcher-block top, pegboard back panel और एक किनारे पर लगा vice clamp" },
  "vanity-table": { label: "Vanity Table", description: "Dressing vanity, चौड़ा tri-fold mirror, हर तरफ़ छोटी दराज़ें और नीचे रखी गद्देदार bench" },
  "nightstand": { label: "Nightstand", description: "छोटा बिस्तर के पास का nightstand, एक दराज़, खुली नीचे की shelf और lamp के लिए तैयार top" },
  "picnic-table": { label: "Picnic Table", description: "क्लासिक लकड़ी की picnic table, plank top, जुड़ी हुई bench सीटें और मौसम-पका outdoor finish" },

  // -------------------- Beds --------------------
  "bed-single": { label: "Single बिस्तर", description: "संकरा single बिस्तर, गद्देदार headboard, fitted चादर और पैरों पर मुड़ा हुआ throw कंबल" },
  "bed-queen": { label: "Queen बिस्तर", description: "Queen-size बिस्तर, ऊँचा upholstered headboard, layered तकिये, साफ़ duvet और पैरों पर एक runner" },
  "bed-king": { label: "King बिस्तर", description: "भव्य king-size बिस्तर, tufted headboard, कई गद्देदार तकिये, साफ़ सफ़ेद linens और मोटा quilted duvet" },
  "bunk-bed": { label: "Bunk Bed", description: "मज़बूत लकड़ी का bunk bed, दो stacked गद्दे, side सीढ़ी, सुरक्षा rails और बच्चों के लिए मेल खाते bedding" },
  "canopy-bed": { label: "Canopy Bed", description: "चार-poster canopy bed, ऊँचे नक़्क़ाशी वाले poster, ऊपर लटकता कपड़े का canopy और हर कोने पर बहते पर्दे" },
  "four-poster-bed": { label: "Four-Poster Bed", description: "चार-poster बिस्तर, हर कोने पर turned लकड़ी के स्तंभ headboard की carved profile से मेल खाते हुए ऊपर उठते हैं" },
  "daybed": { label: "Daybed", description: "Daybed, नीचा frame, तीन upholstered side जो backrest और armrest का काम करती हैं और दीवार के साथ bolster कुशन" },
  "crib": { label: "बच्चे का Crib", description: "लकड़ी का बच्चे का crib, लंबवत slatted side, छोटा fitted गद्दा और अंदर रखे मुलायम खिलौने" },
  "futon": { label: "Futon", description: "परिवर्तनीय futon, folding metal frame पर पतला गद्देदार गद्दा जो sofa से बिस्तर में बदलता है" },
  "hammock": { label: "Hammock", description: "बुना हुआ रस्सी का hammock दो supports के बीच लटकाया हुआ, कोमलता से झुकता है आकर्षक curve के साथ और हर सिरे पर रंगीन tassels" },

  // -------------------- Storage --------------------
  "bookshelf": { label: "Bookshelf", description: "ऊँची स्वतंत्र bookshelf, कई क्षैतिज shelves, लकड़ी की sides और साफ़-सुथरी रखी किताबों की पंक्तियाँ" },
  "wardrobe": { label: "Wardrobe", description: "बड़ी double-door wardrobe, पूरी लंबाई का hanging section, दराज़ों का bank और सजावटी paneled दरवाज़े" },
  "dresser": { label: "Dresser", description: "लकड़ी का dresser, चौड़ी top, दो स्तंभों में छह गहरी दराज़ें, brass pull handles और छोटी tapered टाँगें" },
  "cabinet": { label: "Cabinet", description: "Storage cabinet, paneled दरवाज़े, अंदर समायोज्य shelves और brass hardware" },
  "chest": { label: "Storage Chest", description: "मौसम से पका हुआ लकड़ी का storage chest, iron banding, hinged गुम्बदाकार ढक्कन और सामने एक भारी clasp latch" },
  "trunk": { label: "Steamer Trunk", description: "विंटेज steamer trunk, leather straps, brass corners, travel stickers और latched ढक्कन जो tray inserts प्रकट करता है" },
  "filing-cabinet": { label: "Filing Cabinet", description: "चार-दराज़ वाला metal filing cabinet, हर दराज़ पर label slots, recessed pull handles और ऊपर key lock" },
  "tv-stand": { label: "TV Stand", description: "नीचा entertainment TV stand, खुली shelves, glass-fronted cabinet दरवाज़े और cable pass-throughs" },
  "display-case": { label: "Display Case", description: "ऊँचा काँच का display case, अंदर lighting, glass shelves और lockable framed दरवाज़ा" },
  "hutch": { label: "China Hutch", description: "दो-हिस्सों वाला china hutch, glass-fronted ऊपरी cabinet किनारे पर plates दिखाता हुआ और दराज़ों और दरवाज़ों के साथ buffet base" },
  "toy-chest": { label: "Toy Chest", description: "रंगा हुआ लकड़ी का toy chest, ख़ुश decals, soft-close hinged ढक्कन और sides पर जमा हुए stickers" },

  // -------------------- Lighting --------------------
  "floor-lamp": { label: "Floor Lamp", description: "ऊँचा floor lamp, पतला metal stand, weighted base, pull-chain switch और top पर drum कपड़े का shade" },
  "table-lamp": { label: "Table Lamp", description: "क्लासिक table lamp, ceramic base, pleated कपड़े का shade और एक छोटा pull-chain switch" },
  "desk-lamp": { label: "Desk Lamp", description: "Articulating desk lamp, समायोज्य arm, hinged head और एक छोटा cone-आकार का metal shade" },
  "chandelier": { label: "Chandelier", description: "भव्य crystal chandelier, tiered cascading crystals, घुमावदार सुनहरी arms और कई flame-आकार के बल्ब" },
  "pendant-light": { label: "Pendant Light", description: "आधुनिक pendant light लंबी cord से लटकती हुई, minimalist metal या काँच के shade के साथ" },
  "sconce": { label: "Wall Sconce", description: "दीवार पर लगा sconce, सजावटी backplate, घुमावदार arm और ऊपर की ओर इशारा करता कपड़े या काँच का shade" },
  "lantern": { label: "लालटेन", description: "क्लासिक लालटेन, metal frame, काँच के panels, अंदर मोमबत्ती या टिमटिमाता बल्ब और top पर carrying ring" },
  "candelabra": { label: "Candelabra", description: "अलंकृत silver candelabra, कई घुमावदार branching arms हर एक लंबी taper मोमबत्ती धारण करता है" },
  "neon-sign": { label: "Neon Sign", description: "चमकता neon sign, मुड़े हुए काँच के tubes cursive अक्षरों या retro icon के आकार में, दीवार पर रंगीन रोशनी डालते हुए" },

  // -------------------- Kitchen & Dining --------------------
  "kitchen-island": { label: "Kitchen Island", description: "स्वतंत्र kitchen island, मोटी butcher-block top, नीचे cabinet storage, bar stool overhang और ऊपर एक rack" },
  "bar-counter": { label: "Bar Counter", description: "घर का bar counter, polished लकड़ी की top, brass footrail, backlit काँच की shelving और पीछे प्रदर्शित बोतलों की पंक्तियाँ" },
  "bar-stool": { label: "Bar Stool", description: "ऊँचा bar stool, गोल घूमने वाली सीट, footrest ring, metal frame और एक वैकल्पिक नीची backrest" },
  "pot-rack": { label: "Pot Rack", description: "ऊपर लटका pot rack, wrought-iron frame, S-hooks पर लटके pots और pans और top पर मसालों के लिए shelving" },
  "spice-rack": { label: "Spice Rack", description: "दीवार पर लगा spice rack, छोटे labelled काँच के jars की पंक्तियाँ, लकड़ी की shelves और एक ख़ुशनुमा अव्यवस्थित आकर्षण" },
  "buffet": { label: "Buffet", description: "लंबा dining-room buffet, serving platters के लिए सपाट top, linens के लिए दराज़ें और नीचे dishware के लिए cabinet दरवाज़े" },

  // -------------------- Outdoor --------------------
  "patio-chair": { label: "Patio Chair", description: "Outdoor patio chair, weather-resistant बुनी हुई wicker सीट, aluminum frame और एक weatherproof कुशन" },
  "adirondack-chair": { label: "Adirondack Chair", description: "क्लासिक लकड़ी की Adirondack कुर्सी, ढलवाँ slatted पीठ, चौड़ी सपाट armrests और एक सीट जो धीरे-धीरे पीछे झुकती है" },
  "porch-swing": { label: "Porch Swing", description: "लकड़ी की porch swing छत से चेन से लटकी हुई, slatted सीट और रंगीन outdoor कुशन की एक पंक्ति" },
  "gazebo": { label: "Gazebo", description: "स्वतंत्र outdoor gazebo, peaked shingled छत, छह खुले लकड़ी के स्तंभ, railings और उठा हुआ लकड़ी का फ़र्श" },
  "bistro-set": { label: "Bistro Set", description: "कॉम्पैक्ट outdoor bistro set, गोल wrought-iron table और दो मेल खाती कुर्सियाँ glossy weather-resistant finish में" },
  "sun-lounger": { label: "Sun Lounger", description: "Pool-side sun lounger, समायोज्य reclining पीठ, सफ़ेद vinyl straps और एक मेल खाता side table" },
  "fire-pit": { label: "Fire Pit", description: "गोल outdoor fire pit bowl, खुरदुरा-iron बाहरी हिस्सा, टिमटिमाती लपटें और सुरक्षात्मक mesh screen के नीचे चमकते अंगारे" },

  // -------------------- Decorative --------------------
  "mirror": { label: "Mirror", description: "बड़ा दीवार का mirror, अलंकृत gilded frame, carved scrollwork और काँच में थोड़ी पुरानी silvering" },
  "rug": { label: "क़ालीन", description: "बड़ा pattern वाला क़ालीन, गहरे बुने motifs, tasseled सिरे और मुलायम plush pile" },
  "vase": { label: "फूलदान", description: "ऊँचा ceramic फूलदान, गोल बदन, संकरी गर्दन, glazed finish और अंदर रखा फूलों का ताज़ा गुलदस्ता" },
  "grandfather-clock": { label: "Grandfather Clock", description: "ऊँची लकड़ी की grandfather clock, glass pendulum दरवाज़ा, brass clock face, roman अंक और एक chime mechanism" },
  "wall-art": { label: "Framed दीवार Art", description: "बड़ी framed कलाकृति gilded या minimalist frame में, gallery-शैली का matte border और एक केंद्रीय painting" },
  "pillow": { label: "Throw तकिया", description: "सजावटी throw तकिया, pattern वाला cover, piped किनारे, plush भरा हुआ और छुपा हुआ zipper" },
  "curtains": { label: "पर्दे", description: "पूरी लंबाई के पर्दे, मोटा draping कपड़ा, pleated tops metal रॉड से लटके हुए और हर तरफ़ tie-backs" },
  "sculpture": { label: "मूर्ति", description: "Pedestal पर अमूर्त मूर्ति, bronze या marble में बहते कार्बनिक रूप जो कई कोणों से रोशनी पकड़ते हैं" },

  // -------------------- Bath --------------------
  "bathtub": { label: "Bathtub", description: "स्वतंत्र clawfoot bathtub, मुड़ा हुआ rim, polished सफ़ेद enamel अंदरूनी हिस्सा और चार अलंकृत cast-iron पैर" },
  "shower": { label: "Walk-In Shower", description: "Walk-in shower, frameless काँच के panels, tiled दीवारें, rainfall showerhead और एक linear floor drain" },
  "toilet": { label: "Toilet", description: "मानक सफ़ेद ceramic toilet, अंडाकार bowl, लम्बी सीट और chrome flush handle के साथ tank" },
  "sink-vanity": { label: "Sink Vanity", description: "बाथरूम sink vanity, पत्थर का countertop, undermount basin, ऊपर चौड़ा mirror और नीचे paneled cabinet दरवाज़े" },
  "towel-rack": { label: "Towel Rack", description: "दीवार पर लगा heated towel rack, कई क्षैतिज bars और हर bar पर लटकती मुलायम मुड़ी हुई तौलिये" },
}

export default map
