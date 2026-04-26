import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto": { label: "स्वतः", description: "model को उपयुक्त camera motion चुनने दें" },
  "static": { label: "स्थिर", description: "स्थिर camera, कोई गति नहीं" },
  "handheld": { label: "Handheld", description: "स्वाभाविक handheld कम्पन" },
  "steadicam": { label: "Steadicam", description: "चिकनी स्थिर चलते हुए की shot" },

  // Pan
  "pan-left": { label: "Pan बाएँ", description: "camera को क्षैतिज रूप से बाएँ घुमाएँ" },
  "pan-right": { label: "Pan दाएँ", description: "camera को क्षैतिज रूप से दाएँ घुमाएँ" },
  "whip-pan-left": { label: "Whip Pan बाएँ", description: "Motion blur के साथ तेज़ whip pan बाएँ" },
  "whip-pan-right": { label: "Whip Pan दाएँ", description: "Motion blur के साथ तेज़ whip pan दाएँ" },

  // Tilt
  "tilt-up": { label: "Tilt ऊपर", description: "camera को ऊपर की ओर tilt करें" },
  "tilt-down": { label: "Tilt नीचे", description: "camera को नीचे की ओर tilt करें" },

  // Zoom
  "zoom-in": { label: "Zoom In", description: "Lens का subject की ओर zoom" },
  "zoom-out": { label: "Zoom Out", description: "Lens का subject से दूर zoom" },
  "crash-zoom-in": { label: "Crash Zoom In", description: "तेज़ whip-शैली का zoom in" },
  "crash-zoom-out": { label: "Crash Zoom Out", description: "तेज़ whip-शैली का zoom out" },

  // Dolly
  "dolly-in": { label: "Dolly In", description: "camera को subject की ओर धकेलें (parallax)" },
  "dolly-out": { label: "Dolly Out", description: "camera को दूर खींचें (parallax)" },
  "dolly-zoom": { label: "Dolly Zoom", description: "Vertigo प्रभाव: dolly zoom के विपरीत" },
  "push-in": { label: "Push In", description: "subject की ओर धीमा सूक्ष्म push" },
  "pull-out": { label: "Pull Out", description: "subject से धीमा सूक्ष्म pull back" },
  "breathing": { label: "Breathing Camera", description: "सूक्ष्म निरंतर push-in / pull-out दोलन, organic handheld अनुभव" },
  "push-pull": { label: "Push-Pull / Swing", description: "Camera subject की ओर बढ़ता है फिर पीछे, झूलता हुआ approach-and-retreat" },
  "creep-in": { label: "Creep-In", description: "अदृश्य रूप से धीमा push-in जो भय या तनाव बढ़ाता है" },
  "creep-out": { label: "Creep-Out", description: "अदृश्य रूप से धीमा pull-out जो subject को space में अकेला कर देता है" },

  // Truck
  "truck-left": { label: "Truck बाएँ", description: "camera body को बग़ल में बाएँ खिसकाएँ" },
  "truck-right": { label: "Truck दाएँ", description: "camera body को बग़ल में दाएँ खिसकाएँ" },

  // Pedestal
  "pedestal-up": { label: "Pedestal ऊपर", description: "camera body को लंबवत उठाएँ" },
  "pedestal-down": { label: "Pedestal नीचे", description: "camera body को लंबवत नीचे करें" },

  // Roll
  "roll-left": { label: "Roll बाएँ", description: "camera को counterclockwise घुमाएँ" },
  "roll-right": { label: "Roll दाएँ", description: "camera को clockwise घुमाएँ" },
  "dutch-angle": { label: "Dutch Angle", description: "तनाव के लिए स्थिर tilted frame" },

  // Orbit / Arc
  "orbit-left": { label: "Orbit बाएँ", description: "subject के चारों ओर बाएँ पूरा वृत्त" },
  "orbit-right": { label: "Orbit दाएँ", description: "subject के चारों ओर दाएँ पूरा वृत्त" },
  "spin-360": { label: "Full 360 Spin", description: "Camera अपनी धुरी पर पूरे 360 degree घूमता है" },
  "orbit-360": { label: "Full 360 Orbit", description: "Camera subject के चारों ओर पूरे 360 degree का arc बनाता है" },
  "arc-left": { label: "Arc बाएँ", description: "subject के चारों ओर बाएँ आंशिक arc" },
  "arc-right": { label: "Arc दाएँ", description: "subject के चारों ओर दाएँ आंशिक arc" },

  // Crane / Jib
  "crane-up": { label: "Crane ऊपर", description: "scene को प्रकट करता झूलता crane का उठाव" },
  "crane-down": { label: "Crane नीचे", description: "झूलता crane का उतरना" },
  "boom-up": { label: "Boom ऊपर", description: "Boom arm का उठाव" },
  "boom-down": { label: "Boom नीचे", description: "Boom arm का उतरना" },

  // Tracking / Follow
  "tracking-shot": { label: "Tracking Shot", description: "camera चलते हुए subject के साथ-साथ track करता है" },
  "follow": { label: "Follow", description: "subject का पीछा पीछे से करें" },
  "lead": { label: "Lead", description: "आगे बढ़ते subject के आगे बढ़ें" },
  "drone-follow": { label: "Drone Follow", description: "ऊँचा drone subject को track करता है" },
  "dolly-track": { label: "Dolly Track", description: "subject के साथ समानांतर track पर dolly" },
  "gimbal-walk": { label: "Gimbal Walk", description: "3-axis gimbal पर smooth walking shot, floating steady forward motion" },
  "ronin-glide": { label: "Ronin Glide", description: "Ronin / Movi gimbal पर धीमी gliding move, बिना shake के cinematic float" },
  "serpentine": { label: "Serpentine Track", description: "Camera obstacles के बीच S-curves में बल खाते हुए snaking forward path बनाता है" },

  // Special angles / rigs
  "pov": { label: "POV", description: "प्रथम-व्यक्ति point of view" },
  "over-the-shoulder": { label: "Over The Shoulder", description: "किसी पात्र के कंधे के पीछे से frame" },
  "birds-eye": { label: "Bird's Eye", description: "सीधा ऊपर से नीचे देखने वाला view" },
  "worms-eye": { label: "Worm's Eye", description: "अत्यधिक नीचे का कोण ऊपर देखता" },
  "aerial": { label: "Aerial", description: "उच्च ऊँचाई की drone-शैली की shot" },
  "helicopter": { label: "Helicopter", description: "चौड़ी ऊँची ऊँचाई की झूलती aerial" },
  "fly-over": { label: "Fly Over", description: "scene के ऊपर से नीची तेज़ aerial pass" },
  "flythrough": { label: "Flythrough", description: "camera अंतरिक्ष से होकर उड़ती है" },
  "reveal": { label: "Reveal", description: "धीरे-धीरे चौड़े scene को प्रकट करें" },
  "snorricam": { label: "Snorricam", description: "बदन-mounted camera (subject frame से बंधा)" },
  "rack-focus": { label: "Rack Focus", description: "अग्रभूमि और पृष्ठभूमि के बीच focus खींचें" },

  // Modern / social-video vocabulary
  "handheld-vlog": { label: "Handheld Vlog", description: "Casual vlog-शैली का handheld" },
  "pov-walk": { label: "POV Walk", description: "प्रथम-व्यक्ति चलते हुए POV" },
  "velocity-edit": { label: "Velocity Edit", description: "TikTok speed-ramp pacing" },
  "match-cut-zoom": { label: "Match Cut Zoom", description: "Cut के लिए beat-समय वाला zoom" },
  "screen-tap": { label: "Screen Tap", description: "On-screen finger-tap transition" },
  "phone-flip": { label: "Phone Flip", description: "आगे/पीछे camera flip" },
}

export default map
