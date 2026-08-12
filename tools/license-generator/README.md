# License Generator — نظام الحسام (Phase 30)

أداة سطر أوامر منفصلة تمامًا عن تطبيق الحسام، تعمل محليًا على جهازك فقط.
هي المكان الوحيد الذي يوجد فيه المفتاح الخاص للتوقيع الرقمي.

## أول استخدام

```bash
cd tools/license-generator
node generate-license.js
```

عند أول تشغيل، ستُنشئ الأداة تلقائيًا:
- `keys/private-key.pem` — المفتاح الخاص (سرّي، لا يُشارك ولا يُرفع لأي مكان، `.gitignore` يستثنيه بالفعل).
- `keys/public-key.jwk.json` — المفتاح العام. انسخ محتواه بالضبط إلى
  `js/license/license-public-key.js` في جذر المشروع (استبدل قيمة
  `window.HOSSAM_LICENSE_PUBLIC_KEY_JWK` الحالية بالكامل).

⚠️ **مهم:** إن حذفت `keys/private-key.pem` وأعدت التشغيل، ستُنشأ مفاتيح
جديدة تمامًا، وكل التراخيص الصادرة بالمفتاح القديم ستصبح غير صالحة
(لن يتحقق توقيعها بالمفتاح الجديد المُثبَّت في التطبيق). لذلك: خذ نسخة
احتياطية آمنة من `keys/private-key.pem` بعد أول توليد (مثلاً في مدير
كلمات مرور أو تخزين مشفّر — ليس في Google Drive عادي بدون تشفير).

## إصدار ترخيص جديد لعميل

### تفاعلي (الأسهل)
```bash
node generate-license.js
```
سيسألك عن اسم العميل، هاتفه، بريده، Machine ID الخاص به (يظهر في شاشة
"تفعيل نظام الحسام" عنده)، نوع النسخة، نوع الاشتراك، الوحدات الإضافية،
وعدد أيام فترة السماح. سينتج ملف `<اسم_العميل>.hsm` في نفس المجلد —
أرسله للعميل بأي وسيلة (بريد/واتساب/فلاش ميموري).

### آلي عبر ملف JSON (لدفعات من التراخيص)
أنشئ ملف `input.json`:
```json
{
  "customerName": "مكتب فلان للمحاماة",
  "customerPhone": "0100000000",
  "customerEmail": "office@example.com",
  "machineId": "HSM-8D2A-E98F-41AA",
  "edition": "Professional",
  "type": "yearly",
  "modules": ["AI", "Backup"],
  "graceDays": 15
}
```
ثم:
```bash
node generate-license.js --json input.json --out office.hsm
```

## أنواع الاشتراك المدعومة (type)
| القيمة | المدة | ملاحظة |
|---|---|---|
| `trial` | 14 يومًا | تجريبي |
| `monthly` | 30 يومًا | شهري |
| `yearly` | 365 يومًا | سنوي |
| `lifetime` | بلا انتهاء | دائم — `expiresAt: null` |

## لا حاجة لأي حزمة npm
الأداة تعتمد فقط على وحدة `crypto` المدمجة في Node.js — لا `npm install`
مطلوب إطلاقًا.
