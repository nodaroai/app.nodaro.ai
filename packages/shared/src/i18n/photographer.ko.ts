import type { LocaleCatalogMap } from "./types.js"

// Photographer names are personal proper names — keep all labels in canonical
// English / Latin script. Only descriptions are translated.
const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "tim-walker": { description: "회화적인 동화 같은 패션입니다" },
  "paolo-roversi": { description: "부드럽고 환상적인 폴라로이드 글로우입니다" },
  "marta-bevacqua": { description: "꿈결 같은 회화적 인물 사진입니다" },
  "patrick-demarchelier": { description: "세련된 클래식 패션 인물 사진입니다" },
  "nick-knight": { description: "고광택의 아방가르드 패션입니다" },
  "mario-testino": { description: "햇살 가득한 화려한 패션입니다" },
  "steven-meisel": { description: "세련된 미드센추리 에디토리얼입니다" },
  "helmut-newton": { description: "대담한 흑백의 도발적 사진입니다" },
  "mario-sorrenti": { description: "친밀하고 그레인 가득한 패션입니다" },
  "annie-leibovitz": { description: "시네마틱한 셀러브리티 인물 사진입니다" },
  "felicia-simion": { description: "초현실적인 목가적 파인 아트입니다" },
  "oleg-oprisco": { description: "시네마틱한 필름 그레인 스토리텔링입니다" },
  "bella-kotak": { description: "마법 같은 환상-민속 인물 사진입니다" },
  "yigal-ozeri": { description: "하이퍼리얼한 회화적 인물 사진입니다" },
  "jimmy-marble": { description: "파스텔 톤의 캔디처럼 밝은 에디토리얼입니다" },
  "rinko-kawauchi": { description: "조용히 빛으로 가득 찬 일상의 사진입니다" },
  "ellen-von-unwerth": { description: "장난기 가득한 레트로 핀업 에너지입니다" },

  // Documentary / Street
  "henri-cartier-bresson": { description: "결정적 순간의 스트리트 포토그래피입니다" },
  "vivian-maier": { description: "미드센추리 미국 거리 사진입니다" },
  "saul-leiter": { description: "유리 너머 회화적인 컬러 거리 사진입니다" },
  "daido-moriyama": { description: "그레인 가득한 고대비 도쿄 거리 사진입니다" },
  "robert-capa": { description: "생생한 전투 포토저널리즘입니다" },
  "sebastiao-salgado": { description: "장엄한 흑백 사회 다큐멘터리입니다" },
  "diane-arbus": { description: "가차없이 직시하는 인물 사진입니다" },

  // Cinematographers
  "roger-deakins": { description: "회화적인 시네마틱 자연주의입니다" },
  "emmanuel-lubezki": { description: "떠다니는 자연광 시네마토그래피입니다" },
  "greig-fraser": { description: "풍성하고 촉각적인 장르 시네마토그래피입니다" },
  "christopher-doyle": { description: "채도 높은 핸드헬드 네온 무드입니다" },

  // Concept / Digital Painters
  "greg-rutkowski": { description: "장엄한 회화적 판타지 콘셉트 아트입니다" },
  "magali-villeneuve": { description: "영웅적인 판타지 캐릭터 아트입니다" },
  "charlie-bowater": { description: "분위기 있는 디지털 인물 사진입니다" },
  "sam-spratt": { description: "우의적인 하이퍼리얼 인물 사진입니다" },
  "ruan-jia": { description: "풍성하고 회화적인 판타지 인물 사진입니다" },
  "ilya-kuvshinov": { description: "애니메이션 풍의 양식화된 인물 사진입니다" },
  "wlop": { description: "환상적이고 회화적인 판타지입니다" },
  "artgerm": { description: "세련된 코믹북 풍의 핀업입니다" },

  // Illustrators / Animators
  "makoto-shinkai": { description: "시네마틱한 애니메이션 하늘과 빛입니다" },
  "studio-ghibli": { description: "손으로 그린 지브리의 따뜻함입니다" },
  "alphonse-mucha": { description: "아르누보 장식 패널입니다" },
  "carne-griffiths": { description: "잉크가 번지는 식물 인물 사진입니다" },
  "conrad-roset": { description: "부드러운 수채화 피겨입니다" },
  "akihito-yoshida": { description: "조용한 잉크와 그레인의 흑백 사진입니다" },
  "karol-bak": { description: "상징주의적인 회화적 뮤즈입니다" },
  "ismail-inceoglu": { description: "신화적인 회화적 풍경입니다" },
  "stefan-gesell": { description: "어두운 초현실주의 인물 사진입니다" },
  "andrew-atroshenko": { description: "낭만적인 인상주의 피겨 페인팅입니다" },
  "peter-gric": { description: "건축적인 초현실주의 풍경입니다" },
  "ingrid-baars": { description: "조각적인 패션 아트 콜라주입니다" },
  "guido-van-helten": { description: "거대한 벽화 인물 사진입니다" },

  // Newly added
  "mapplethorpe": { description: "흑백 스튜디오 인물 사진, 클래식한 누드와 꽃입니다" },
  "sherman": { description: "개념적인 셀프 포트레이트와 캐릭터 연구입니다" },
  "crewdson": { description: "시네마틱한 교외, 불안한 분위기입니다" },
  "lachapelle": { description: "초현실적인 셀러브리티와 채도 높은 캠프입니다" },
  "klein": { description: "하이패션의 날카로움, 드라마틱한 그림자 조명입니다" },
  "lindbergh": { description: "미니멀한 흑백 패션, 꾸밈없는 아름다움입니다" },
  "tillmans": { description: "동시대의 캔디드, 퀴어한 친밀함입니다" },
  "teller": { description: "캐주얼한 플래시 패션, 안티 글래머입니다" },
  "penn": { description: "미드센추리 스튜디오 인물 사진, 패션과 스틸라이프입니다" },
}

export default map
