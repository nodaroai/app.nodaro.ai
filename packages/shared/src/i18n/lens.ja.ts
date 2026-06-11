import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "超広角（14mm）", description: "極端な広角、誇張された遠近感" },
  "wide-24mm": { label: "広角（24mm）", description: "広い視野、環境を含む" },
  "standard-35mm": { label: "標準（35mm）", description: "自然な遠近感、ドキュメンタリー的" },
  "normal-50mm": { label: "ノーマル（50mm）", description: "人間の目に最も近い知覚" },
  "portrait-85mm": { label: "ポートレート（85mm）", description: "顔を引き締める圧縮、クリーミーなボケ" },
  "telephoto-135mm": { label: "望遠（135mm）", description: "圧縮された奥行き、被写体を分離" },
  "super-telephoto-400mm": { label: "超望遠（400mm）", description: "極端な圧縮、遠くの被写体" },
  "fisheye": { label: "魚眼", description: "180°の半球状歪み" },
  "anamorphic": { label: "アナモルフィック", description: "シネマ的ワイドスクリーン、楕円形のボケ" },
  "macro": { label: "マクロ", description: "小さなディテールの極端なクローズアップ" },
  "tilt-shift": { label: "ティルトシフト", description: "選択的フォーカス、ミニチュア効果" },
  "shallow-dof": { label: "浅い被写界深度", description: "極薄のフォーカス、夢のようなボケ" },
  "canon-k35": { description: "ヴィンテージなシネマ調、暖かく柔らかな肌" },
  "cooke-s4": { description: "Cooke独特の表情 — 絵画的でクリーミーな肌" },
  "helios-44": { description: "ヴィンテージのソビエト製スワール（渦巻き）ボケ" },
  "petzval": { label: "ペッツバール・ポートレート", description: "極端にヴィンテージな渦巻き、劇的な周辺減光" },
  "probe": { label: "プローブレンズ", description: "チューブ型マクロ——穴や狭い隙間を通り抜ける" },
  "cctv": { label: "監視カメラ", description: "防犯カメラ映像風" },
}

export default map
