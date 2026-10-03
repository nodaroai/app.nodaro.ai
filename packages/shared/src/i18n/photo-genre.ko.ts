import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "fashion-editorial": { label: "패션 에디토리얼", description: "하이패션 매거진 화보" },
  "vogue-editorial": { label: "Vogue 에디토리얼", description: "Vogue 스타일의 표지 에디토리얼" },
  "magazine-cover": { label: "매거진 표지", description: "타이트하게 잡은 표지 구도" },
  "lookbook": { label: "룩북", description: "깔끔한 룩북 아웃핏 샷" },
  "ecommerce-flatlay": { label: "이커머스 플랫 레이", description: "오버헤드 제품 플랫 레이" },
  "beauty-editorial": { label: "뷰티 에디토리얼", description: "매크로 뷰티 / 스킨케어 클로즈업" },
  "campaign-advertising": { label: "캠페인 / 광고", description: "세련된 브랜드 캠페인 이미지" },

  // Brand / Editorial Reference
  "brand-vogue": { label: "Vogue 시그니처", description: "Vogue 매거진 에디토리얼 시그니처" },
  "brand-dior": { label: "Dior 시그니처", description: "Dior 에디토리얼 — 키아로스쿠로와 실루엣" },
  "brand-jil-sander": { label: "Jil Sander 미니멀리즘", description: "Jil Sander — 미니멀하고 건축적인 차분한 톤" },
  "brand-vivienne-tam": { label: "Vivienne Tam 스타일", description: "Vivienne Tam — 동양적 모티프의 화려한 패션" },
  "brand-jacquemus": { label: "Jacquemus 스타일", description: "Jacquemus — 햇살 가득한 초현실적 장난기" },
  "brand-helmut-newton": { label: "Helmut Newton 스타일", description: "Helmut Newton — 고대비 흑백의 도발" },
  "brand-harpers-bazaar": { label: "Harper's Bazaar 스타일", description: "Harper's Bazaar — 하이패션 광택 스타일" },

  // Documentary / Candid
  "paparazzi": { label: "파파라치", description: "플래시가 터진 타블로이드 캔디드 사진" },
  "street-photography": { label: "스트리트 포토그래피", description: "연출 없는 도시 거리의 한 컷" },
  "candid-journalism": { label: "캔디드 저널리즘", description: "연출 없이 포착한 포토저널리즘의 순간" },
  "photojournalism": { label: "포토저널리즘", description: "언론 보도 수준의 르포 사진" },
  "documentary": { label: "다큐멘터리", description: "장기 다큐멘터리 인물 사진" },
  "snapshot": { label: "스냅샷", description: "캐주얼한 아마추어 스냅샷" },

  // Studio / Formal
  "corporate-headshot": { label: "비즈니스 헤드샷", description: "LinkedIn 스타일 헤드샷" },
  "personal-branding": { label: "퍼스널 브랜딩", description: "모던한 퍼스널 브랜드 인물 사진" },
  "yearbook": { label: "졸업 앨범", description: "졸업 앨범 인물 사진" },
  "id-passport": { label: "신분증 / 여권", description: "규격에 맞춘 여권 사진" },
  "mugshot": { label: "머그샷", description: "경찰 입건 스타일 인물 사진" },
  "wedding-portrait": { label: "웨딩 포트레이트", description: "낭만적인 신부 스타일 인물 사진" },
  "family-portrait": { label: "패밀리 포트레이트", description: "포즈를 취한 가족 단체 사진" },
  "glamour-portrait": { label: "글래머 포트레이트", description: "소프트 포커스 글래머 인물 사진" },
  "film-noir": { label: "필름 느와르", description: "강한 그림자의 느와르 인물 사진" },

  // Selfie
  "mirror-selfie": { label: "거울 셀카", description: "거울 속 휴대폰이 보이는 전신 셀카" },
  "gym-mirror-selfie": { label: "헬스장 거울 셀카", description: "헬스장 라커룸 거울 셀카" },
  "front-cam-selfie": { label: "전면 카메라 셀카", description: "팔을 뻗어 찍은 전면 카메라 셀카" },
  "bathroom-mirror-selfie": { label: "욕실 거울 셀카", description: "플래시가 터진 욕실 거울 셀카" },
  "bereal-dual": { label: "BeReal 듀얼", description: "전면과 후면을 동시에 담은 듀얼 프레임" },
  "flip-cam-selfie": { label: "플립캠 셀카", description: "우연히 찍힌 저화질 플립캠 사진" },
  "group-selfie": { label: "단체 셀카", description: "여러 명이 함께 찍은 폰 셀카" },
  "lofi-baddie-selfie": { label: "로파이 2010년대 셀카", description: "초기 iPhone의 저조도 셀카" },

  // Print / Context
  "album-cover": { label: "앨범 커버", description: "정사각형 앨범 커버 구도" },
  "movie-poster": { label: "영화 포스터", description: "시네마틱한 극장 포스터" },
  "advertising": { label: "광고", description: "광택 있는 광고 캠페인 사진" },
  "food-photography": { label: "푸드 포토그래피", description: "오버헤드 또는 45도 음식 샷" },
  "real-estate": { label: "부동산", description: "광각으로 담은 건축 인테리어" },
  "sports-action": { label: "스포츠 액션", description: "망원 렌즈로 멈춰 세운 스포츠의 순간" },
  "point-and-shoot": { label: "컴팩트 / 일회용 카메라", description: "일회용 카메라 / 컴팩트 카메라의 캐주얼한 미감" },
  "lifestyle-blog": { label: "라이프스타일 블로그", description: "부드러운 자연광의 홈 블로거 감성" },
  "product-shot": { label: "제품 샷", description: "배경을 분리한 깔끔한 이커머스 제품 사진" },
}

export default map
