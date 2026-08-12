/**
 * PUBLIC key only — آمن تمامًا أن يُنشر مع التطبيق، لا يمكن به توقيع تراخيص.
 * تم توليده تلقائيًا من Hossam License Manager Pro بتاريخ 2026-08-05.
 *
 * طريقة التركيب: استبدل به الملف القديم بنفس هذا الاسم بالضبط في مشروع
 * الحسام على المسار: js/license/license-public-key.js
 * (لا حاجة لتعديل أي محتوى يدويًا — هذا الملف جاهز للاستخدام كما هو).
 */
(typeof window !== 'undefined' ? window : globalThis).HOSSAM_LICENSE_PUBLIC_KEY_JWK = {
  "crv": "P-256",
  "ext": true,
  "key_ops": [
    "verify"
  ],
  "kty": "EC",
  "x": "4bRUV2S1l0dtGIuoLvzzRVq1G1vHuEgVwQHB7IKMi5k",
  "y": "RgfTwWzVeSopdl8ZrMsIjbXz8-afDnlr3R1VdSOkMUg"
};
