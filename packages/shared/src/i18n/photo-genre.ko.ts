import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "fashion-editorial": { label: "패션 에디토리얼", description: "하이패션 매거진 스프레드입니다" },
  "vogue-editorial": { label: "Vogue 에디토리얼", description: "Vogue 스타일의 표지 에디토리얼입니다" },
  "magazine-cover": { label: "매거진 표지", description: "타이트하게 프레임된 표지 구도입니다" },
  "lookbook": { label: "룩북", description: "깔끔한 룩북 아웃핏 샷입니다" },
  "ecommerce-flatlay": { label: "이커머스 플랫 레이", description: "오버헤드 제품 플랫 레이입니다" },
  "beauty-editorial": { label: "뷰티 에디토리얼", description: "매크로 뷰티/스킨케어 클로즈업입니다" },
  "campaign-advertising": { label: "캠페인 / 광고", description: "세련된 브랜드 캠페인 이미지입니다" },

  // Brand / Editorial Reference
  "brand-vogue": { label: "Vogue 시그니처", description: "Vogue 매거진 에디토리얼의 시그니처입니다" },
  "brand-dior": { label: "Dior 시그니처", description: "Dior 에디토리얼 — 키아로스쿠로와 실루엣입니다" },
  "brand-jil-sander": { label: "Jil Sander 미니멀리즘", description: "Jil Sander — 미니멀하고 건축적인 무채색 톤입니다" },
  "brand-vivienne-tam": { label: "Vivienne Tam 스타일", description: "Vivienne Tam — 동양적 모티프의 화려한 패션입니다" },
  "brand-jacquemus": { label: "Jacquemus 스타일", description: "Jacquemus — 햇살 가득한 초현실적 장난기입니다" },
  "brand-helmut-newton": { label: "Helmut Newton 스타일", description: "Helmut Newton — 고대비 흑백의 도발입니다" },
  "brand-harpers-bazaar": { label: "Harper's Bazaar 스타일", description: "Harper's Bazaar — 하이패션 광택 스타일입니다" },

  // Documentary / Candid
  "paparazzi": { label: "파파라치", description: "플래시가 터진 타블로이드 캔디드입니다" },
  "street-photography": { label: "스트리트 포토그래피", description: "포즈 없는 도시 거리 프레임입니다" },
  "candid-journalism": { label: "캔디드 저널리즘", description: "포즈 없는 포토저널리스트의 순간입니다" },
  "photojournalism": { label: "포토저널리즘", description: "에디토리얼 뉴스급 보도 사진입니다" },
  "documentary": { label: "다큐멘터리", description: "장기 다큐멘터리 인물 사진입니다" },
  "snapshot": { label: "스냅샷", description: "캐주얼한 아마추어 스냅샷입니다" },

  // Studio / Formal
  "corporate-headshot": { label: "코퍼레이트 헤드샷", description: "LinkedIn 스타일 헤드샷입니다" },
  "personal-branding": { label: "퍼스널 브랜딩", description: "모던한 퍼스널 브랜드 인물 사진입니다" },
  "yearbook": { label: "이어북", description: "학교 이어북 인물 사진입니다" },
  "id-passport": { label: "신분증 / 여권", description: "규정 여권 사진입니다" },
  "mugshot": { label: "머그샷", description: "경찰 입건 스타일 인물 사진입니다" },
  "wedding-portrait": { label: "웨딩 포트레이트", description: "낭만적인 신부 스타일 인물 사진입니다" },
  "family-portrait": { label: "패밀리 포트레이트", description: "포즈를 취한 가족 단체 사진입니다" },
  "glamour-portrait": { label: "글래머 포트레이트", description: "소프트 포커스 글래머 인물 사진입니다" },
  "film-noir": { label: "필름 느와르", description: "강한 그림자의 느와르 인물 사진입니다" },

  // Selfie
  "mirror-selfie": { label: "거울 셀카", description: "거울 속 휴대폰이 보이는 전신 셀카입니다" },
  "gym-mirror-selfie": { label: "헬스장 거울 셀카", description: "라커룸 헬스장 거울 셀카입니다" },
  "front-cam-selfie": { label: "전면 카메라 셀카", description: "팔을 뻗은 전면 카메라 셀카입니다" },
  "bathroom-mirror-selfie": { label: "욕실 거울 셀카", description: "플래시가 터진 욕실 거울 셀카입니다" },
  "bereal-dual": { label: "BeReal 듀얼", description: "전·후면 동시 듀얼 프레임입니다" },
  "flip-cam-selfie": { label: "플립캠 셀카", description: "우연히 찍힌 저화질 플립캠입니다" },
  "group-selfie": { label: "단체 셀카", description: "여러 명이 함께 찍는 폰 셀카입니다" },
  "lofi-baddie-selfie": { label: "로파이 2010s 셀카", description: "초기 아이폰의 저조도 셀카입니다" },

  // Print / Context
  "album-cover": { label: "앨범 커버", description: "정사각형 앨범 커버 구도입니다" },
  "movie-poster": { label: "영화 포스터", description: "시네마틱 극장 포스터입니다" },
  "advertising": { label: "광고", description: "광택 있는 광고 캠페인 사진입니다" },
  "food-photography": { label: "푸드 포토그래피", description: "오버헤드 또는 45도 음식 샷입니다" },
  "real-estate": { label: "부동산", description: "광각의 건축적 인테리어입니다" },
  "sports-action": { label: "스포츠 액션", description: "망원으로 정지된 스포츠 순간입니다" },
  "point-and-shoot": { label: "포인트 앤 슛 / 일회용", description: "일회용 카메라 미학, 강한 플래시, 캐주얼한 분위기입니다" },
  "lifestyle-blog": { label: "라이프스타일 블로그", description: "부드러운 자연광의 홈 / 카페 블로거 감성입니다" },
  "product-shot": { label: "제품 샷", description: "중성 배경에 분리된 깨끗한 제품, 이커머스 스타일입니다" },
}

export default map
