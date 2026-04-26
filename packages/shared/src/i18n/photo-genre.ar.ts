import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "fashion-editorial": { label: "إعلان أزياء تحريري", description: "إعلان مجلة أزياء راق" },
  "vogue-editorial": { label: "إعلان Vogue التحريري", description: "إعلان غلاف بأسلوب Vogue" },
  "magazine-cover": { label: "غلاف مجلة", description: "تأطير غلاف مضغوط" },
  "lookbook": { label: "Lookbook", description: "لقطة ملابس Lookbook نظيفة" },
  "ecommerce-flatlay": { label: "Flat Lay للتجارة الإلكترونية", description: "Flat Lay علوي للمنتج" },
  "beauty-editorial": { label: "إعلان جمال تحريري", description: "تقريب ماكرو للجمال / العناية بالبشرة" },
  "campaign-advertising": { label: "حملة / إعلان", description: "صورة حملة علامة تجارية مصقولة" },

  "brand-vogue": { label: "Vogue Signature", description: "توقيع إعلاني تحريري لمجلة Vogue" },
  "brand-dior": { label: "Dior Signature", description: "إعلان Dior — Chiaroscuro وصورة ظلية" },
  "brand-jil-sander": { label: "بساطة Jil Sander", description: "Jil Sander — معماري مبسط هادئ" },
  "brand-vivienne-tam": { label: "أسلوب Vivienne Tam", description: "Vivienne Tam — أزياء استشراقية مزخرفة" },
  "brand-jacquemus": { label: "أسلوب Jacquemus", description: "Jacquemus — سوريالي مرح مشمس" },
  "brand-helmut-newton": { label: "أسلوب Helmut Newton", description: "Helmut Newton — استفزاز أبيض وأسود تباين عال" },
  "brand-harpers-bazaar": { label: "أسلوب Harper's Bazaar", description: "Harper's Bazaar — أزياء راقية لامعة" },

  "paparazzi": { label: "Paparazzi", description: "Tabloid عفوي بفلاش محروق" },
  "street-photography": { label: "تصوير الشارع", description: "إطار شارع حضري غير مرتب" },
  "candid-journalism": { label: "صحافة عفوية", description: "لحظة مصور صحفي غير مرتبة" },
  "photojournalism": { label: "صحافة تصوير", description: "تقرير تحريري بمستوى أخبار" },
  "documentary": { label: "وثائقي", description: "بورتريه وثائقي طويل الشكل" },
  "snapshot": { label: "Snapshot", description: "Snapshot هاو كاجوال" },

  "corporate-headshot": { label: "Headshot شركات", description: "Headshot بأسلوب LinkedIn" },
  "personal-branding": { label: "علامة تجارية شخصية", description: "بورتريه علامة تجارية شخصية حديث" },
  "yearbook": { label: "كتاب سنوي", description: "بورتريه كتاب سنوي مدرسي" },
  "id-passport": { label: "هوية / جواز سفر", description: "صورة جواز سفر نظامية" },
  "mugshot": { label: "Mugshot", description: "بورتريه بأسلوب حجز شرطة" },
  "wedding-portrait": { label: "بورتريه زفاف", description: "بورتريه رومانسي بأسلوب عروس" },
  "family-portrait": { label: "بورتريه عائلي", description: "لقطة عائلية مرتبة" },
  "glamour-portrait": { label: "بورتريه Glamour", description: "بورتريه Glamour ناعم التركيز" },
  "film-noir": { label: "Film Noir", description: "بورتريه Noir بظلال صلبة" },

  "mirror-selfie": { label: "سيلفي بالمرآة", description: "سيلفي بالمرآة بهاتف بكامل الجسم" },
  "gym-mirror-selfie": { label: "سيلفي بالمرآة في الصالة الرياضية", description: "سيلفي بمرآة Locker-room" },
  "front-cam-selfie": { label: "سيلفي بكاميرا أمامية", description: "سيلفي بكاميرا أمامية بطول الذراع" },
  "bathroom-mirror-selfie": { label: "سيلفي بمرآة الحمام", description: "سيلفي بمرآة الحمام بفلاش" },
  "bereal-dual": { label: "BeReal مزدوج", description: "إطار مزدوج أمامي + خلفي متزامن" },
  "flip-cam-selfie": { label: "سيلفي بكاميرا قلابة", description: "كاميرا قلابة منخفضة الجودة عرضية" },
  "group-selfie": { label: "سيلفي جماعي", description: "سيلفي بهاتف لعدة مواضيع" },
  "lofi-baddie-selfie": { label: "سيلفي ألفينيات منخفض الجودة", description: "سيلفي iPhone مبكر بإضاءة منخفضة" },

  "album-cover": { label: "غلاف ألبوم", description: "تأليف غلاف ألبوم مربع" },
  "movie-poster": { label: "ملصق فيلم", description: "ملصق سينمائي مسرحي" },
  "advertising": { label: "إعلانات", description: "صورة حملة إعلانية لامعة" },
  "food-photography": { label: "تصوير طعام", description: "لقطة طعام علوية أو 45 درجة" },
  "real-estate": { label: "عقارات", description: "داخلي معماري عريض" },
  "sports-action": { label: "حركة رياضية", description: "لحظة رياضية مجمدة بالتيليفوتو" },

  "point-and-shoot": { label: "Point-and-Shoot / كاميرا للاستعمال الواحد", description: "جمالية كاميرا للاستعمال الواحد، فلاش قاس، عفوي" },
  "lifestyle-blog": { label: "مدونة Lifestyle", description: "إحساس مدون منزلي / قهوة بضوء طبيعي ناعم" },
  "product-shot": { label: "لقطة منتج", description: "منتج معزول نظيف على خلفية محايدة، تجارة إلكترونية" },
}

export default map
