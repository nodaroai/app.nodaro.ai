import type { LocaleCatalogMap } from "./types.js"

// Photographer names are personal proper names — keep all labels in canonical
// English / Latin script. Only descriptions are translated.
const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "tim-walker": { description: "회화적인 동화 같은 패션" },
  "paolo-roversi": { description: "부드럽고 몽환적인 폴라로이드 글로우" },
  "marta-bevacqua": { description: "꿈결 같은 회화적 인물 사진" },
  "patrick-demarchelier": { description: "세련된 클래식 패션 인물 사진" },
  "nick-knight": { description: "고광택의 아방가르드 패션" },
  "mario-testino": { description: "햇살 가득한 화려한 패션" },
  "steven-meisel": { description: "세련된 미드센추리 에디토리얼" },
  "helmut-newton": { description: "대담하고 도발적인 흑백 사진" },
  "mario-sorrenti": { description: "친밀하고 그레인 가득한 패션" },
  "annie-leibovitz": { description: "시네마틱한 셀러브리티 인물 사진" },
  "felicia-simion": { description: "초현실적인 목가적 파인 아트" },
  "oleg-oprisco": { description: "시네마틱한 필름 그레인 스토리텔링" },
  "bella-kotak": { description: "마법 같은 판타지 민속풍 인물 사진" },
  "yigal-ozeri": { description: "하이퍼리얼한 인물화" },
  "jimmy-marble": { description: "파스텔 톤의 캔디처럼 밝은 에디토리얼" },
  "rinko-kawauchi": { description: "빛이 스며든 고요한 일상" },
  "ellen-von-unwerth": { description: "장난기 가득한 레트로 핀업 에너지" },

  // Documentary / Street
  "henri-cartier-bresson": { description: "결정적 순간의 스트리트 포토그래피" },
  "vivian-maier": { description: "미드센추리 미국 거리 사진" },
  "saul-leiter": { description: "유리 너머 회화적인 컬러 거리 사진" },
  "daido-moriyama": { description: "그레인 가득한 고대비 도쿄 거리 사진" },
  "robert-capa": { description: "생생한 전투 포토저널리즘" },
  "sebastiao-salgado": { description: "장엄한 흑백 사회 다큐멘터리" },
  "diane-arbus": { description: "가차 없이 직시하는 인물 사진" },

  // Cinematographers
  "roger-deakins": { description: "회화적인 시네마틱 자연주의" },
  "emmanuel-lubezki": { description: "유영하는 카메라의 자연광 시네마토그래피" },
  "greig-fraser": { description: "풍성하고 촉각적인 장르 시네마토그래피" },
  "christopher-doyle": { description: "채도 높은 핸드헬드 네온 무드" },

  // Concept / Digital Painters
  "greg-rutkowski": { description: "장엄한 회화적 판타지 콘셉트 아트" },
  "magali-villeneuve": { description: "영웅적인 판타지 캐릭터 아트" },
  "charlie-bowater": { description: "분위기 있는 디지털 포트레이트" },
  "sam-spratt": { description: "우의적인 하이퍼리얼 포트레이트" },
  "ruan-jia": { description: "풍성하고 회화적인 판타지 포트레이트" },
  "ilya-kuvshinov": { description: "애니메이션 풍의 양식화된 포트레이트" },
  "wlop": { description: "몽환적이고 회화적인 판타지" },
  "artgerm": { description: "세련된 코믹북 풍의 핀업" },

  // Illustrators / Animators
  "makoto-shinkai": { description: "시네마틱한 애니메이션 하늘과 빛" },
  "studio-ghibli": { description: "손으로 그린 Ghibli 특유의 따뜻함" },
  "alphonse-mucha": { description: "아르누보 장식 패널" },
  "carne-griffiths": { description: "잉크가 번지는 보태니컬 포트레이트" },
  "conrad-roset": { description: "부드러운 수채화 인물화" },
  "akihito-yoshida": { description: "잉크와 그레인이 어우러진 고요한 모노크롬" },
  "karol-bak": { description: "상징주의적인 회화적 뮤즈" },
  "ismail-inceoglu": { description: "신화적인 회화적 풍경" },
  "stefan-gesell": { description: "어두운 초현실주의 인물 사진" },
  "andrew-atroshenko": { description: "낭만적인 인상주의 인물화" },
  "peter-gric": { description: "건축적인 초현실주의 풍경" },
  "ingrid-baars": { description: "조각적인 패션 아트 콜라주" },
  "guido-van-helten": { description: "기념비적인 벽화 포트레이트" },

  // Newly added
  "mapplethorpe": { description: "형식미를 살린 흑백 스튜디오 누드와 꽃" },
  "sherman": { description: "개념적인 셀프 포트레이트와 캐릭터 연구" },
  "crewdson": { description: "불안이 감도는 시네마틱한 교외 연출 사진" },
  "lachapelle": { description: "초현실적이고 채도가 극도로 높은 셀러브리티 캠프 미학" },
  "klein": { description: "날 선 글래머와 절제된 공격성" },
  "lindbergh": { description: "미니멀한 흑백 자연광 패션" },
  "tillmans": { description: "캔디드한 퀴어의 친밀함과 가벼운 플래시" },
  "teller": { description: "안티 글래머 다이렉트 플래시 스냅샷" },
  "penn": { description: "절제된 미드센추리 스튜디오 인물 사진" },

  // Additional photographers
  "mcginley": { description: "자연스러운 청춘과 누드를 풍경 속에 담은 햇살 가득한 캔디드 사진" },
  "mitchell": { description: "동시대 흑인 인물 사진, 부드러운 자연광, 패션과 다큐멘터리의 만남" },
  "collins": { description: "핑크빛으로 물든 몽환적인 여성 시선의 패션, 뿌연 35mm 필름" },
  "weston": { description: "모더니즘 흑백 정물, 조각 같은 누드, 선명한 형식미" },
  "beaton": { description: "고전 할리우드 시대의 인물 사진, 연극적인 연출, 화려한 배경" },
}

export default map
