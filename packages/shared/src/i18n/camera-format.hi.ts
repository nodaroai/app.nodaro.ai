import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Film stocks
  "35mm-film": { description: "क्लासिक cinema film grain" },
  "16mm-film": { description: "Indie / documentary grain" },
  "super-8": { description: "विंटेज 8mm home-movie look" },
  "imax-70mm": { description: "Large-format pristine clarity" },
  "anamorphic-scope": { description: "2.39:1 widescreen cinema look" },
  // Modern digital
  "arri-alexa": { description: "Premium digital cinema" },
  "dslr": { description: "Crisp video-DSLR look" },
  "mirrorless-a7iii": { description: "आधुनिक hybrid mirrorless" },
  "canon-r5": { description: "उच्च-resolution fashion-editorial mirrorless" },
  "hasselblad-medium-format": { description: "Editorial medium format" },
  "leica-m-rangefinder": { description: "क्लासिक 35mm rangefinder" },
  "voigtlander": { description: "Boutique rangefinder character" },
  "fuji-xt4": { description: "Film-emulating Fuji color" },
  // Aerial / action
  "drone-aerial": { label: "Drone (Aerial)", description: "ऊपर से gimbal-स्थिर aerial" },
  "gopro-action-cam": { description: "Fisheye-wide action camera" },
  // Lo-fi modern
  "webcam-facetime": { label: "Webcam / FaceTime", description: "कम-resolution video call" },
  // Vintage / lo-fi
  "vhs": { description: "Tape distortion + scanlines" },
  "camcorder": { description: "उपभोक्ता 90s video" },
  "polaroid": { description: "Instant film tonality" },
  "fuji-instax": { description: "आधुनिक instant film" },
  "disposable-camera": { description: "एक-बार उपयोग 90s/2000s film" },
  "toy-camera-holga": { label: "Toy Camera (Holga)", description: "Lo-fi Holga / Lomo plastic-lens" },
  "tintype-wet-plate": { label: "Tintype / Wet Plate", description: "विंटेज wet-plate collodion" },
  "daguerreotype": { description: "1840 के दशक की silver-mirror process" },
  "security-cam": { label: "Security Cam (CCTV)", description: "CCTV fisheye + timestamp overlay" },
  "bw-film": { label: "B&W Film", description: "श्वेत-श्याम film stock" },
  "iphone": { description: "आधुनिक phone-camera look" },
}

export default map
