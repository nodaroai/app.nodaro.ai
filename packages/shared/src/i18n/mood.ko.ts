import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Positive
  "happy": { label: "행복", description: "따뜻한 미소가 번지는 행복한 표정" },
  "joyful": { label: "기쁨", description: "환하게 빛나는 거리낌 없는 기쁨" },
  "serene": { label: "평온", description: "고요하고 평화로운 만족감" },
  "playful": { label: "장난스러움", description: "장난기 어린 활기찬 에너지" },
  "confident": { label: "자신감 있는", description: "자신감 있고 당당한 표정" },
  "loving": { label: "애정 어린", description: "다정하고 애정 어린 표정" },
  "amused": { label: "재미있어하는", description: "은근히 재미있어하며 미소 짓는 표정" },
  "smirking": { label: "능글맞게 웃는", description: "거만하고 자신만만한 즐거움" },
  "eccentric": { label: "엉뚱한", description: "독특하고 틀에 얽매이지 않는 분위기" },
  "hopeful": { label: "희망찬", description: "눈을 반짝이는 낙관적인 표정" },

  // Negative
  "sad": { label: "슬픈", description: "조용히 슬퍼하며 풀 죽은 표정" },
  "angry": { label: "화난", description: "분명한 분노와 긴장" },
  "afraid": { label: "두려워하는", description: "겁에 질려 휘둥그레진 눈" },
  "anxious": { label: "불안한", description: "긴장하고 걱정스러운 표정" },
  "melancholy": { label: "우울한", description: "아련한 슬픔" },
  "devastated": { label: "망연자실한", description: "마음이 무너진 비탄" },
  "grieving": { label: "비탄에 잠긴", description: "깊은 슬픔과 상실감" },
  "caught-off-guard": { label: "허를 찔린", description: "반응하던 중 깜짝 놀란 표정" },
  "aloof": { label: "냉담한", description: "거리를 두는 무관심한 표정" },
  "vulnerable": { label: "취약한", description: "감정이 그대로 드러난 무방비한 표정" },
  "coy": { label: "수줍은", description: "수줍게 시선을 떨군 표정" },
  "bored": { label: "지루한", description: "흥미를 잃은 무덤덤한 표정" },
  "embarrassed": { label: "당황한", description: "얼굴을 붉히며 시선을 피하는 표정" },
  "disgusted": { label: "혐오스러워하는", description: "역겨워 움찔 물러나는 표정" },
  "bewildered": { label: "당혹스러운", description: "혼란스러워 어쩔 줄 모르는 표정" },

  // Neutral / Contemplative
  "thoughtful": { label: "사색적인", description: "깊은 생각에 잠긴 표정" },
  "stoic": { label: "담담한", description: "감정을 읽을 수 없는 무표정" },
  "calm": { label: "차분한", description: "흔들림 없이 동요하지 않는 표정" },
  "curious": { label: "호기심 어린", description: "흥미를 느끼며 주의를 기울이는 표정" },
  "mysterious": { label: "신비로운", description: "헤아릴 수 없는 수수께끼 같은 표정" },
  "dazed": { label: "멍한", description: "꿈꾸는 듯 반쯤 넋을 놓은 표정" },
  "sleepy": { label: "졸린", description: "졸려서 눈꺼풀이 무거운 표정" },
  "unbothered": { label: "신경 쓰지 않는", description: "여유 있게 침착한 표정" },

  // Intense / Dramatic
  "fierce": { label: "강렬한", description: "강렬하고 위엄 있는 표정" },
  "determined": { label: "결연한", description: "단호하고 집중된 의지" },
  "passionate": { label: "열정적인", description: "타오르는 열정" },
  "brooding": { label: "어두운 생각에 잠긴", description: "어둡게 가라앉은 우울" },
  "seductive": { label: "유혹적인", description: "매혹적이고 유혹적인 표정" },
  "defiant": { label: "반항적인", description: "반항적이고 굴하지 않는 표정" },
  "sultry": { label: "관능적인", description: "은근히 달아오른 듯 나른하게 눈을 내리깐 표정" },
  "smoldering": { label: "은근히 타오르는", description: "응축된 채 서서히 타오르는 강렬함" },
  "sinister": { label: "사악한", description: "어둡고 악의적이며 위협적인 표정" },
  "wiccan-mystical": { label: "위칸 / 신비로운", description: "고요하게 신비롭고 오컬트적인 분위기" },
  "lazy-shy": { label: "나른하고 수줍은", description: "졸린 듯 부드럽고 반쯤 수줍은 표정" },
  "awe": { label: "경이로움", description: "경이로움과 경건한 경외감" },
  "shocked": { label: "충격받은", description: "놀라서 입을 벌린 표정" },

  // Additional moods
  "flirty": { label: "플러팅하는", description: "장난스러운 플러팅, 여운이 남는 미소, 오래 머무는 눈맞춤" },
  "suspicious": { label: "의심하는", description: "경계하는 불신, 가늘게 뜬 눈, 곁눈질" },
  "resigned": { label: "체념한", description: "불쾌한 상황을 한숨과 함께 조용히 받아들이는 표정" },
  "conflicted": { label: "갈등하는", description: "미간을 찌푸리고 초점 잃은 눈빛에 내면의 갈등이 드러나는 표정" },
  "relieved": { label: "안도", description: "긴장이 풀리며 차분해짐" },
}

export default map
