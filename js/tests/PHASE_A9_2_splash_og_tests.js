'use strict';
/**
 * PHASE A9.2 — Splash robustness + Open Graph / Twitter Card / canonical
 * regression tests. STATIC VERIFIED ONLY: these assert what's in the
 * committed source files (structure, absolute-URL shape, file existence
 * on disk, real on-disk image dimensions). They do NOT and cannot verify
 * live crawler behavior (Facebook/WhatsApp), real device rendering, or
 * that a URL actually resolves over HTTPS from the public internet —
 * those require live testing this environment cannot perform (no
 * outbound access to the deployed domain, no physical devices). See the
 * PHASE A9.2 final report, sections T/V, for exactly what remains
 * manual-verification-only.
 *
 * Run: node js/tests/PHASE_A9_2_splash_og_tests.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS -', name); }
  else { fail++; console.log('FAIL -', name); }
}

const ROOT = path.join(__dirname, '..', '..');
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const FIRSTRUN_PATH = path.join(ROOT, 'js', 'modules', 'firstrun.js');
const CSS_PATH = path.join(ROOT, 'css', 'components.css');
const SW_PATH = path.join(ROOT, 'service-worker.js');

const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const firstrun = fs.readFileSync(FIRSTRUN_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const sw = fs.readFileSync(SW_PATH, 'utf8');

// =====================================================================
// SECTION 1 — Splash markup / structure still intact (nothing deleted)
// =====================================================================
check('index.html still has #splashScreen', /id="splashScreen"/.test(html));
check('index.html still has .splash-logo', /class="splash-logo"/.test(html));
check('index.html still has .splash-title with app name text', /class="splash-title">الحسام</.test(html));
check('index.html still has .splash-subtitle with app name text', /class="splash-subtitle">نظام إدارة مكاتب المحاماة</.test(html));

// =====================================================================
// SECTION 2 — application:ready cannot cut the splash short (A9 fix,
// re-verified here so a future edit to this area cannot silently
// regress it without this suite catching it too).
// =====================================================================
check("firstrun.js: MIN_VISIBLE_MS constant still present", /MIN_VISIBLE_MS\s*=\s*3300/.test(firstrun));
const readyListenerMatch = firstrun.match(/addEventListener\('application:ready'[\s\S]{0,400}?\}\);/);
check("firstrun.js: 'application:ready' listener exists", !!readyListenerMatch);
check("firstrun.js: 'application:ready' listener computes a remaining/elapsed wait against MIN_VISIBLE_MS (cannot hide immediately)", !!readyListenerMatch && /MIN_VISIBLE_MS/.test(readyListenerMatch[0]) && /Date\.now\(\)/.test(readyListenerMatch[0]));
check("firstrun.js: no setInterval was introduced anywhere in this file", !/setInterval/.test(firstrun));

// =====================================================================
// SECTION 3 — splash text/logo visibility no longer depends solely on
// an animation firing (PHASE A9.2 structural fix). Base rules for each
// element must declare opacity:1 OUTSIDE any @media block; the hidden+
// animate treatment must live inside prefers-reduced-motion:no-preference.
// =====================================================================
function baseRuleOpacityOne(selectorRegexSrc) {
  // Matches "<selector>{...opacity:1...}" at top level (not inside a @media block)
  // by checking it appears before the first "@media (prefers-reduced-motion: no-preference){"
  const enhancementStart = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  const base = css.slice(0, enhancementStart);
  const re = new RegExp(selectorRegexSrc + '\\{[^}]*opacity:1[^}]*\\}');
  return re.test(base);
}
check('CSS: .splash-logo has opacity:1 in its base (non-media-gated) rule', baseRuleOpacityOne('\\.splash-logo(?!-)'));
check('CSS: .splash-title has opacity:1 in its base (non-media-gated) rule', baseRuleOpacityOne('\\.splash-title'));
check('CSS: .splash-subtitle has opacity:1 in its base (non-media-gated) rule', baseRuleOpacityOne('\\.splash-subtitle'));
check('CSS: .splash-version has opacity:1 in its base (non-media-gated) rule', baseRuleOpacityOne('\\.splash-version(?!-)'));
check('CSS: .splash-contact has opacity:1 in its base (non-media-gated) rule', baseRuleOpacityOne('\\.splash-contact(?!-)'));
check('CSS: .splash-footer has opacity:1 in its base (non-media-gated) rule', baseRuleOpacityOne('\\.splash-footer'));
check('CSS: the hidden+reveal treatment is scoped inside prefers-reduced-motion:no-preference', /@media \(prefers-reduced-motion: no-preference\)\{[\s\S]*splash-logo-in[\s\S]*\}/.test(css));
check('CSS: prefers-reduced-motion:reduce block is still present and untouched (existing accessibility behavior preserved)', /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*splash-fade[\s\S]*\}/.test(css));
// NOTE: the glow delay (.1s) was intentionally changed to .2s in PHASE
// A9.3, per that phase's explicit "halo stabilizes 0.20s->0.80s"
// timing spec — this is a deliberate, requested change, not a
// regression, so this assertion was updated to match. The other
// delays (title/subtitle/version/contact/footer stagger) are
// unaffected and still asserted below.
check('CSS: reveal timeline delays intact (.6s/.05s/.2s[glow, A9.3]/1.05s/1.5s/1.95s/2.4s all still present)', ['forwards;', '.6s', '.05s', '.2s', '1.05s', '1.5s', '1.95s', '2.4s'].every(function (t) { return css.indexOf(t) !== -1; }));

// =====================================================================
// SECTION 4 — Open Graph / Twitter Card absolute-URL fix
// =====================================================================
function metaContent(propOrName, key) {
  const re = new RegExp('<meta ' + propOrName + '="' + key + '" content="([^"]+)">');
  const m = html.match(re);
  return m ? m[1] : null;
}
const ogImage = metaContent('property', 'og:image');
const ogImageSecure = metaContent('property', 'og:image:secure_url');
const twitterImage = metaContent('name', 'twitter:image');
const canonical = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
const ogUrl = metaContent('property', 'og:url');

check('index.html: og:image is present', !!ogImage);
check('index.html: og:image is an absolute https:// URL (not relative — this was the confirmed root cause of broken WhatsApp/Facebook previews)', !!ogImage && /^https:\/\//.test(ogImage));
check('index.html: og:image:secure_url is present and absolute https://', !!ogImageSecure && /^https:\/\//.test(ogImageSecure));
check('index.html: twitter:image is present and absolute https://', !!twitterImage && /^https:\/\//.test(twitterImage));
check('index.html: og:image and canonical share the same origin+path prefix (no invented domain)', !!ogImage && !!canonical && ogImage.indexOf(canonical.replace(/\/$/, '')) === 0);
check('index.html: og:image and og:url use the same host (internally consistent)', !!ogImage && !!ogUrl && new URL(ogImage).host === new URL(ogUrl).host);
check("index.html: og:image:width is '1200'", metaContent('property', 'og:image:width') === '1200');
check("index.html: og:image:height is '630'", metaContent('property', 'og:image:height') === '630');

// =====================================================================
// SECTION 5 — the OG image file itself: exists, correct case-sensitive
// name, matches the declared dimensions, is a reasonable file size.
// =====================================================================
const ogImagePath = path.join(ROOT, 'assets', 'og', 'og-image.png');
check('assets/og/og-image.png exists on disk with this exact case-sensitive name', fs.existsSync(ogImagePath));
if (fs.existsSync(ogImagePath)) {
  const stat = fs.statSync(ogImagePath);
  check('assets/og/og-image.png is a PNG (magic bytes)', fs.readFileSync(ogImagePath).slice(1, 4).toString('ascii') === 'PNG');
  check('assets/og/og-image.png is under 1MB (previous file was ~1.7MB, a real risk factor for crawler fetch reliability)', stat.size < 1024 * 1024);
  // PNG IHDR width/height are the first 8 bytes after the 8-byte signature + 4-byte length + 4-byte "IHDR"
  const buf = fs.readFileSync(ogImagePath);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  check('assets/og/og-image.png actual pixel width is 1200 (matches declared og:image:width)', width === 1200);
  check('assets/og/og-image.png actual pixel height is 630 (matches declared og:image:height)', height === 630);
}

// =====================================================================
// SECTION 6 — canonical sanity (no localhost/127.0.0.1/raw repo URL)
// =====================================================================
check('canonical is present', !!canonical);
check('canonical is not localhost/127.0.0.1', !!canonical && !/localhost|127\.0\.0\.1/.test(canonical));
check('canonical is not a raw github.com repo URL (must be the published Pages URL, not the source repo)', !!canonical && !/^https:\/\/github\.com\//.test(canonical));
check('canonical is HTTPS', !!canonical && canonical.indexOf('https://') === 0);

// =====================================================================
// SECTION 7 — no meta tag depends on JavaScript to exist (WhatsApp/
// Facebook crawlers do not execute JS) — the whole OG/Twitter block
// must be static text already in the HTML served for the initial
// request, not injected by a <script>.
// =====================================================================
const headSlice = html.slice(0, html.indexOf('</head>') !== -1 ? html.indexOf('</head>') : html.length);
check('og:title/og:image/og:url/canonical all appear as static <meta>/<link> tags inside <head> (not injected by script)', /<meta property="og:title"/.test(headSlice) && /<meta property="og:image"/.test(headSlice) && /<meta property="og:url"/.test(headSlice) && /<link rel="canonical"/.test(headSlice));

// =====================================================================
// SECTION 8 — icon/manifest/favicon namespaces were not confused with
// the OG image (Facebook/WhatsApp do not read manifest icons)
// =====================================================================
check('favicon/manifest/apple-touch-icon tags are untouched and distinct from og:image (different files)', ogImage !== 'assets/icons/icon-192.png' && !/msapplication-TileImage" content="assets\/og/.test(html));

// =====================================================================
// SECTION 9 — protected files untouched by this phase
// =====================================================================
const PROTECTED = [
  'js/core/SyncEngine.js', 'js/core/SyncCheckpoint.js', 'js/core/OfflineQueue.js',
  'js/core/Repository.js', 'js/core/StorageAdapter.js', 'js/core/IndexedDBAdapter.js',
  'js/api/api.js', 'js/core/SyncCoordinator.js'
];
const A9_2_MARKERS = /PHASE A9\.2/;
PROTECTED.forEach(function (rel) {
  const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  check('Protected file untouched by A9.2 (no A9.2 marker leaked in): ' + rel, !A9_2_MARKERS.test(content));
});
check('ui-utils.js and print-utils.js were NOT moved/renamed in this phase (still at js/ root, per explicit instruction)', fs.existsSync(path.join(ROOT, 'js', 'ui-utils.js')) && fs.existsSync(path.join(ROOT, 'js', 'print-utils.js')));

// =====================================================================
// SECTION 10 — no polling / no new network dependency introduced into
// the splash timing path itself (the Google Fonts <link> is pre-
// existing and unrelated to this section; it already uses
// display=swap, which does not block splash paint).
// =====================================================================
check('firstrun.js still has no setInterval (repeat of the A9 guarantee)', !/setInterval/.test(firstrun));
check("index.html's Cairo font <link> still uses display=swap (does not block splash text from painting while the font downloads)", /fonts\.googleapis\.com\/css2\?family=Cairo[^"]*display=swap/.test(html));

console.log('\n=== RESULT: ' + pass + ' PASS / ' + fail + ' FAIL ===');
console.log('NOTE: PASS results above are STATIC VERIFIED only. They confirm the source structure/URLs/on-disk image are correct and internally consistent. They do NOT confirm a live Facebook/WhatsApp crawler actually renders the preview, nor that any real device shows the splash text/animation correctly — those require live testing against the deployed URL and real devices, which this environment cannot perform.');
process.exitCode = fail > 0 ? 1 : 0;
