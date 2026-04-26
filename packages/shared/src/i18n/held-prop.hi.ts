import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Devices / Phones --------------------
  "smartphone": { label: "Smartphone", description: "हाथ में आधुनिक phone" },
  "smartphone-raised": { label: "Phone उठाया हुआ", description: "Mid-photo में उठाया हुआ phone" },
  "polaroid-camera": { label: "Polaroid Camera", description: "विंटेज instant camera" },
  "vintage-camera": { label: "विंटेज Camera", description: "Strap के साथ पुराना film camera" },
  "dslr-camera": { label: "DSLR Camera", description: "आधुनिक DSLR / mirrorless camera" },
  "video-camera": { label: "Video Camera", description: "कंधे पर रखा video camera" },
  "microphone": { label: "Microphone", description: "हाथ में पकड़ने वाला vocal microphone" },
  "megaphone": { label: "Megaphone", description: "Bullhorn / megaphone" },
  "smartwatch": { label: "Smartwatch", description: "Watch देखने के लिए कलाई उठाई हुई" },

  // -------------------- Drinks --------------------
  "coffee-cup": { label: "Coffee Cup", description: "Ceramic coffee cup" },
  "takeaway-coffee": { label: "Takeaway Coffee", description: "Paper takeaway coffee cup" },
  "wine-glass": { label: "Wine Glass", description: "Stem वाला red wine का गिलास" },
  "champagne-flute": { label: "Champagne Flute", description: "ऊँचा champagne flute" },
  "martini-glass": { label: "Martini Glass", description: "क्लासिक martini glass" },
  "cocktail-glass": { label: "Cocktail Glass", description: "Cocktail के साथ छोटा गिलास" },
  "beer-bottle": { label: "Beer की बोतल", description: "भूरी beer की बोतल" },
  "water-bottle": { label: "पानी की बोतल", description: "पुनः उपयोग की पानी की बोतल" },

  // -------------------- Smoking --------------------
  "cigarette": { label: "Cigarette", description: "उँगलियों के बीच जलती हुई cigarette" },
  "cigar": { label: "Cigar", description: "मोटी जली हुई cigar" },
  "vape-pen": { label: "Vape Pen", description: "पतला vape pen" },
  "joint": { label: "Joint", description: "हाथ से बना joint" },

  // -------------------- Reading / Writing --------------------
  "book": { label: "किताब", description: "खुली hardback किताब" },
  "magazine": { label: "Magazine", description: "Glossy मुड़ी हुई magazine" },
  "newspaper": { label: "अख़बार", description: "मुड़ा हुआ broadsheet अख़बार" },
  "notebook": { label: "Notebook", description: "खुला lined notebook" },
  "pen": { label: "Pen", description: "लिखते समय poised pen" },
  "marker": { label: "Marker", description: "Mid-stroke में मोटा marker" },
  "paintbrush": { label: "Paintbrush", description: "रंग से भरी paintbrush" },
  "chalk": { label: "Chalk", description: "सफ़ेद chalk का टुकड़ा" },

  // -------------------- Bags / Accessories --------------------
  "handbag": { label: "Handbag", description: "Designer handbag" },
  "tote-bag": { label: "Tote Bag", description: "मुलायम canvas tote" },
  "briefcase": { label: "Briefcase", description: "Hard-shell briefcase" },
  "umbrella": { label: "छाता", description: "खुला काला छाता" },
  "fan-folding": { label: "Folding Fan", description: "खुला हाथ से रंगा हुआ पंखा" },

  // -------------------- Floral / Nature --------------------
  "bouquet": { label: "गुलदस्ता", description: "मिश्रित फूलों का गुलदस्ता" },
  "single-rose": { label: "एक गुलाब", description: "लंबे stem वाला एक गुलाब" },
  "sunflower": { label: "सूरजमुखी", description: "एक ऊँचा सूरजमुखी" },
  "leaf": { label: "पत्ता", description: "एक बड़ा पत्ता" },
  "fruit-apple": { label: "सेब", description: "एक ताज़ा सेब" },

  // -------------------- Instruments / Performance --------------------
  "guitar": { label: "Guitar", description: "बदन पर झूलता guitar" },
  "violin": { label: "Violin", description: "ठुड्डी के नीचे violin" },
  "saxophone": { label: "Saxophone", description: "होंठों तक उठा saxophone" },
  "drumsticks": { label: "Drumsticks", description: "क्रॉस की हुई drumsticks की जोड़ी" },
  "sheet-music": { label: "Sheet Music", description: "मुड़ा हुआ sheet music" },

  // -------------------- Companion --------------------
  "small-dog": { label: "छोटा कुत्ता", description: "बाँहों में पकड़ा हुआ छोटा कुत्ता" },
  "cat": { label: "बिल्ली", description: "बाँह पर लटकी बिल्ली" },
  "plush-toy": { label: "Plush खिलौना", description: "गले लगाया हुआ मुलायम plush खिलौना" },

  // -------------------- Occupational / Weapon --------------------
  "katana": { label: "Katana", description: "एकल-धार वाली जापानी तलवार" },
  "pointer-stick": { label: "Pointer Stick", description: "Telescoping pointer stick" },
  "gavel": { label: "Gavel", description: "लकड़ी का judicial gavel" },
  "wine-bottle": { label: "Wine की बोतल", description: "Foil seal के साथ पूरी बोतल" },
  "parasol": { label: "Parasol", description: "धूप से बचाने वाला सजावटी parasol" },
  "locket": { label: "Locket", description: "उँगलियों में खुला विंटेज locket pendant" },
  "lighter": { label: "Lighter", description: "लौ पर अंगूठा रखे chrome lighter" },
  "lantern": { label: "लालटेन", description: "गर्म amber चमक वाली विंटेज हाथ की लालटेन" },
  "flashlight": { label: "Flashlight", description: "आधुनिक flashlight beam, अन्वेषण / रहस्य" },
  "compass": { label: "कम्पास", description: "हाथ का nautical कम्पास, अन्वेषण" },
  "bow-and-arrow": { label: "धनुष-बाण", description: "तीर लगाया हुआ खींचा हुआ archery धनुष" },
  "shield": { label: "ढाल", description: "हाथ की ढाल, मध्यकालीन / fantasy" },
}

export default map
