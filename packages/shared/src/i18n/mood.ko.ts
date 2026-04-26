import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Positive
  "happy": { label: "행복", description: "따뜻하고 미소 짓는 행복한 표정입니다" },
  "joyful": { label: "기쁨", description: "거리낌없는 빛나는 기쁨입니다" },
  "serene": { label: "평온", description: "고요하고 평화로운 만족감입니다" },
  "playful": { label: "장난스러움", description: "장난기 어린 활기찬 에너지입니다" },
  "confident": { label: "자신감 있는", description: "자신감 있고 당당한 표정입니다" },
  "loving": { label: "사랑스러운", description: "다정하고 애정 어린 표정입니다" },
  "amused": { label: "재미있어하는", description: "은은하게 재미있어하며 미소 짓는 표정입니다" },
  "smirking": { label: "비웃는", description: "거만하고 자신만만한 즐거움입니다" },
  "eccentric": { label: "엉뚱한", description: "독특하고 비관습적인 분위기입니다" },
  "hopeful": { label: "희망찬", description: "반짝이는 눈의 낙관적인 표정입니다" },

  // Negative
  "sad": { label: "슬픈", description: "조용히 슬프고 풀 죽은 표정입니다" },
  "angry": { label: "화난", description: "분명한 분노와 긴장입니다" },
  "afraid": { label: "두려워하는", description: "겁먹은 휘둥그레진 눈입니다" },
  "anxious": { label: "불안한", description: "긴장하고 걱정스러운 표정입니다" },
  "melancholy": { label: "우울한", description: "아련한 슬픔입니다" },
  "devastated": { label: "망연자실한", description: "마음이 무너진 비탄입니다" },
  "grieving": { label: "비탄에 잠긴", description: "깊은 슬픔과 상실감입니다" },
  "caught-off-guard": { label: "허를 찔린", description: "놀라서 반응 중인 표정입니다" },
  "aloof": { label: "냉담한", description: "위축되고 무관심한 표정입니다" },
  "vulnerable": { label: "취약한", description: "노출되고 무방비한 표정입니다" },
  "coy": { label: "수줍은", description: "수줍고 시선을 떨군 표정입니다" },
  "bored": { label: "지루한", description: "흥미를 잃은 무덤덤한 표정입니다" },
  "embarrassed": { label: "당황한", description: "얼굴이 붉어지고 시선을 피하는 표정입니다" },
  "disgusted": { label: "혐오스러워하는", description: "혐오해 움찔하는 표정입니다" },
  "bewildered": { label: "당혹스러운", description: "혼란스럽고 길을 잃은 표정입니다" },

  // Neutral / Contemplative
  "thoughtful": { label: "사색적인", description: "깊이 생각에 잠긴 표정입니다" },
  "stoic": { label: "스토익한", description: "냉정하고 읽을 수 없는 표정입니다" },
  "calm": { label: "차분한", description: "중심 잡힌 무반응의 표정입니다" },
  "curious": { label: "호기심 있는", description: "흥미를 느끼며 기민한 표정입니다" },
  "mysterious": { label: "신비로운", description: "헤아릴 수 없고 수수께끼 같은 표정입니다" },
  "dazed": { label: "멍한", description: "꿈꾸는 듯 반쯤 정신이 나간 표정입니다" },
  "sleepy": { label: "졸린", description: "졸리고 눈꺼풀이 무거운 표정입니다" },
  "unbothered": { label: "신경 쓰지 않는", description: "차분한 자기 절제의 표정입니다" },

  // Intense / Dramatic
  "fierce": { label: "맹렬한", description: "맹렬하고 위엄 있는 표정입니다" },
  "determined": { label: "결연한", description: "단호하고 집중된 의지입니다" },
  "passionate": { label: "열정적인", description: "타오르는 열정입니다" },
  "brooding": { label: "어두운 생각에 잠긴", description: "어둡고 침울한 우울입니다" },
  "seductive": { label: "유혹적인", description: "매혹적이고 유혹적인 표정입니다" },
  "defiant": { label: "반항적인", description: "반항적이고 굴하지 않는 표정입니다" },
  "sultry": { label: "관능적인", description: "타오르는 듯 눈꺼풀이 무거운 표정입니다" },
  "smoldering": { label: "타오르는", description: "응축된, 천천히 타오르는 강렬함입니다" },
  "sinister": { label: "음흉한", description: "어둡고 악의적이며 위협적인 표정입니다" },
  "wiccan-mystical": { label: "위칸 / 신비로운", description: "조용히 이세계적이고 오컬트적인 분위기입니다" },
  "lazy-shy": { label: "게으르고 수줍은", description: "졸리고 부드러우며 반쯤 수줍은 표정입니다" },
  "awe": { label: "경이로움", description: "경건한 경외의 감정입니다" },
  "shocked": { label: "충격받은", description: "놀라서 입을 벌린 표정입니다" },
}

export default map
