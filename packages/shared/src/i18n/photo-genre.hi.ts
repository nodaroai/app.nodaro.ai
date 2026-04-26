import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Editorial / Fashion --------------------
  "fashion-editorial": { label: "Fashion Editorial", description: "उच्च-fashion magazine spread" },
  "vogue-editorial": { label: "Vogue Editorial", description: "Vogue-शैली की cover editorial" },
  "magazine-cover": { label: "Magazine Cover", description: "तंग framed cover composition" },
  "lookbook": { label: "Lookbook", description: "साफ़ lookbook outfit shot" },
  "ecommerce-flatlay": { label: "E-commerce Flat Lay", description: "Overhead product flat lay" },
  "beauty-editorial": { label: "Beauty Editorial", description: "Macro beauty / skincare close-up" },
  "campaign-advertising": { label: "Campaign / Ad", description: "Polished brand campaign image" },

  // -------------------- Brand / Editorial Reference --------------------
  "brand-vogue": { label: "Vogue Signature", description: "Vogue magazine editorial signature" },
  "brand-dior": { label: "Dior Signature", description: "Dior editorial — chiaroscuro और silhouette" },
  "brand-jil-sander": { label: "Jil Sander Minimalism", description: "Jil Sander — minimalist architectural मद्धम" },
  "brand-vivienne-tam": { label: "Vivienne Tam Style", description: "Vivienne Tam — orientalist ornate fashion" },
  "brand-jacquemus": { label: "Jacquemus Style", description: "Jacquemus — sun-soaked surrealist चंचल" },
  "brand-helmut-newton": { label: "Helmut Newton Style", description: "Helmut Newton — high-contrast B&W provocation" },
  "brand-harpers-bazaar": { label: "Harper's Bazaar Style", description: "Harper's Bazaar — high-fashion glossy" },

  // -------------------- Documentary / Candid --------------------
  "paparazzi": { label: "Paparazzi", description: "Flash-blown tabloid candid" },
  "street-photography": { label: "Street Photography", description: "Unposed urban street frame" },
  "candid-journalism": { label: "Candid Journalism", description: "Unposed photojournalist पल" },
  "photojournalism": { label: "Photojournalism", description: "Editorial news-grade reportage" },
  "documentary": { label: "Documentary", description: "Long-form documentary portrait" },
  "snapshot": { label: "Snapshot", description: "Casual amateur snapshot" },

  // -------------------- Studio / Formal --------------------
  "corporate-headshot": { label: "Corporate Headshot", description: "LinkedIn-शैली का headshot" },
  "personal-branding": { label: "Personal Branding", description: "आधुनिक personal-brand portrait" },
  "yearbook": { label: "Yearbook", description: "स्कूल yearbook portrait" },
  "id-passport": { label: "ID / Passport", description: "नियम के अनुसार passport photo" },
  "mugshot": { label: "Mugshot", description: "Police booking-शैली का portrait" },
  "wedding-portrait": { label: "Wedding Portrait", description: "Romantic bridal-शैली का portrait" },
  "family-portrait": { label: "Family Portrait", description: "Posed family group shot" },
  "glamour-portrait": { label: "Glamour Portrait", description: "Soft-focus glamour portrait" },
  "film-noir": { label: "Film Noir", description: "Hard-shadow noir portrait" },

  // -------------------- Selfie sub-types --------------------
  "mirror-selfie": { label: "Mirror Selfie", description: "Phone-in-mirror full-body selfie" },
  "gym-mirror-selfie": { label: "Gym Mirror Selfie", description: "Locker-room gym mirror selfie" },
  "front-cam-selfie": { label: "Front Cam Selfie", description: "बाँह बढ़ाकर ली गई front camera selfie" },
  "bathroom-mirror-selfie": { label: "Bathroom Mirror Selfie", description: "Flash के साथ bathroom-mirror selfie" },
  "bereal-dual": { label: "BeReal Dual", description: "आगे+पीछे simultaneous dual frame" },
  "flip-cam-selfie": { label: "Flip-Cam Selfie", description: "आकस्मिक low-quality flip cam" },
  "group-selfie": { label: "Group Selfie", description: "कई-subject phone selfie" },
  "lofi-baddie-selfie": { label: "Lo-Fi 2010s Selfie", description: "शुरुआती-iPhone low-light selfie" },

  // -------------------- Print / Context --------------------
  "album-cover": { label: "Album Cover", description: "वर्गाकार album cover composition" },
  "movie-poster": { label: "Movie Poster", description: "Cinematic theatrical poster" },
  "advertising": { label: "Advertising", description: "Glossy ad-campaign photograph" },
  "food-photography": { label: "Food Photography", description: "Overhead या 45-degree food shot" },
  "real-estate": { label: "Real Estate", description: "Wide architectural अंदरूनी" },
  "sports-action": { label: "Sports Action", description: "Telephoto frozen sports पल" },
}

export default map
