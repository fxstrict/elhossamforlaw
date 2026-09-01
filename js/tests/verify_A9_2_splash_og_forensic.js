/**
 * ================================================================
 * verify_A9_2_splash_og_forensic.js — PHASE A9.2 regression tests
 * ================================================================
 * Dependency-free (no jsdom/Playwright — those need a browser binary
 * download this sandbox's network allowlist does not include) static
 * checks against the real project files for:
 *   1. Splash markup/CSS/JS structure (still present, unmoved).
 *   2. MIN_VISIBLE_MS still guards application:ready from truncating
 *      the reveal animation (PHASE A9 race fix not undone).
 *   3. No setInterval was introduced.
 *   4. prefers-reduced-motion support still present.
 *   5. The new PHASE A9.2 splash-text-visibility JS safety net exists
 *      and is timed between the animation's completion and the
 *      earliest possible hide.
 *   6. og:image / og:image:secure_url / twitter:image are absolute
 *      https:// URLs (the confirmed root cause of the missing
 *      WhatsApp/Facebook preview image) — not relative paths.
 *   7. og:image / twitter:image point at an asset that actually
 *      exists on disk, with a real, non-empty PNG file.
 *   8. canonical / og:url still absolute, still non-localhost.
 *
 * Run: node js/tests/verify_A9_2_splash_og_forensic.js
 * ================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const componentsCss = fs.readFileSync(path.join(ROOT, 'css', 'components.css'), 'utf8');
const firstrunJs = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'firstrun.js'), 'utf8');

let checks = 0;
let failures = 0;
function check(label, cond) {
  checks++;
  if (cond) {
    console.log('  \u2713 ' + label);
  } else {
    failures++;
    console.log('  \u2717 ' + label);
  }
}

console.log('--- Splash structure ---');
check('#splashScreen present', /id="splashScreen"/.test(indexHtml));
check('.splash-logo present', /class="splash-logo"/.test(indexHtml));
check('.splash-title present', /class="splash-title"/.test(indexHtml));
check('.splash-subtitle present', /class="splash-subtitle"/.test(indexHtml));
check('splash-logo-in keyframes present (logo scale-up animation)', /@keyframes splash-logo-in/.test(componentsCss));
check('splash-rise keyframes present (title/subtitle reveal)', /@keyframes splash-rise/.test(componentsCss));
check('prefers-reduced-motion block present', /@media \(prefers-reduced-motion: reduce\)/.test(componentsCss));

console.log('--- Splash timing / race guard (PHASE A9, must remain intact) ---');
check('MIN_VISIBLE_MS still defined', /var MIN_VISIBLE_MS\s*=\s*3300/.test(firstrunJs));
check("application:ready listener still waits out MIN_VISIBLE_MS before hiding", /addEventListener\('application:ready'[\s\S]{0,300}?MIN_VISIBLE_MS - elapsed/.test(firstrunJs));
check('no setInterval introduced in firstrun.js', !/setInterval/.test(firstrunJs));

console.log('--- PHASE A9.2 splash-text visibility safety net ---');
check('safety-net block present', /SPLASH TEXT VISIBILITY GUARANTEE/.test(firstrunJs));
check('safety-net checks computed opacity of all 5 staged elements', /\.splash-title[\s\S]{0,40}\.splash-subtitle[\s\S]{0,40}\.splash-version[\s\S]{0,40}\.splash-contact[\s\S]{0,40}\.splash-footer/.test(firstrunJs));
check('safety-net fires after the last keyframe completes (>=2900ms) and before MIN_VISIBLE_MS hide (<3300ms)', (function () {
  const m = firstrunJs.match(/getComputedStyle[\s\S]*?\}, (\d+)\);/);
  if (!m) return false;
  const t = parseInt(m[1], 10);
  return t >= 2900 && t < 3300;
})());
check('@supports fallback for animation-fill-mode present in CSS', /@supports not \(animation-fill-mode: forwards\)/.test(componentsCss));

console.log('--- Open Graph / Twitter Card (PHASE A9.2 forensic fix) ---');
const ogImageMatch = indexHtml.match(/<meta property="og:image" content="([^"]+)">/);
const ogImageSecureMatch = indexHtml.match(/<meta property="og:image:secure_url" content="([^"]+)">/);
const twitterImageMatch = indexHtml.match(/<meta name="twitter:image" content="([^"]+)">/);
const canonicalMatch = indexHtml.match(/<link rel="canonical" href="([^"]+)">/);
const ogUrlMatch = indexHtml.match(/<meta property="og:url" content="([^"]+)">/);

check('og:image tag found', !!ogImageMatch);
check('og:image is an absolute https:// URL (not relative)', !!ogImageMatch && /^https:\/\//.test(ogImageMatch[1]));
check('og:image:secure_url is an absolute https:// URL', !!ogImageSecureMatch && /^https:\/\//.test(ogImageSecureMatch[1]));
check('twitter:image is an absolute https:// URL', !!twitterImageMatch && /^https:\/\//.test(twitterImageMatch[1]));
check('og:image and twitter:image point at the same file', !!ogImageMatch && !!twitterImageMatch && ogImageMatch[1] === twitterImageMatch[1]);

check('canonical is absolute and not localhost/127.0.0.1', !!canonicalMatch && /^https:\/\//.test(canonicalMatch[1]) && !/localhost|127\.0\.0\.1/.test(canonicalMatch[1]));
check('og:url is absolute and not localhost/127.0.0.1', !!ogUrlMatch && /^https:\/\//.test(ogUrlMatch[1]) && !/localhost|127\.0\.0\.1/.test(ogUrlMatch[1]));
check('og:image domain matches canonical domain', !!ogImageMatch && !!canonicalMatch && ogImageMatch[1].indexOf(new URL(canonicalMatch[1]).origin) === 0);

console.log('--- OG image asset on disk ---');
if (ogImageMatch) {
  const canonicalOrigin = canonicalMatch ? new URL(canonicalMatch[1]).origin : '';
  const canonicalBasePath = canonicalMatch ? new URL(canonicalMatch[1]).pathname : '/';
  const ogUrlObj = new URL(ogImageMatch[1]);
  // ogUrlObj.pathname is e.g. "/elhossamforlaw/assets/og/og-image.png";
  // canonicalBasePath is the GitHub Pages project-site prefix, e.g.
  // "/elhossamforlaw/" — strip that prefix to get the path relative to
  // this repo's own root on disk.
  let ogPath = ogUrlObj.pathname;
  if (canonicalBasePath !== '/' && ogPath.indexOf(canonicalBasePath) === 0) {
    ogPath = ogPath.slice(canonicalBasePath.length);
  } else {
    ogPath = ogPath.replace(/^\//, '');
  }
  const absPath = path.join(ROOT, ogPath);
  const exists = fs.existsSync(absPath);
  check('OG image file exists on disk at referenced relative path (' + ogPath + ')', exists);
  if (exists) {
    const stat = fs.statSync(absPath);
    check('OG image file is non-empty', stat.size > 0);
    check('OG image file is under 2MB (fast crawler fetch)', stat.size < 2 * 1024 * 1024);
    const buf = fs.readFileSync(absPath);
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    check('OG image is a valid PNG (magic bytes)', isPng);
    if (isPng) {
      // IHDR width/height are the first 8 bytes after the 8-byte PNG
      // signature + 4-byte length + 4-byte "IHDR" chunk type = offset 16.
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      const widthMeta = indexHtml.match(/<meta property="og:image:width" content="(\d+)">/);
      const heightMeta = indexHtml.match(/<meta property="og:image:height" content="(\d+)">/);
      check('actual PNG width matches declared og:image:width (' + width + ' vs ' + (widthMeta && widthMeta[1]) + ')', !!widthMeta && parseInt(widthMeta[1], 10) === width);
      check('actual PNG height matches declared og:image:height (' + height + ' vs ' + (heightMeta && heightMeta[1]) + ')', !!heightMeta && parseInt(heightMeta[1], 10) === height);
    }
  }
}

console.log('--- Protected files untouched (file presence only, not modification) ---');
const protectedFiles = [
  'js/core/SyncEngine.js', 'js/core/SyncCheckpoint.js', 'js/core/OfflineQueue.js',
  'js/core/DatabaseService.js', 'js/core/IndexedDBAdapter.js', 'js/core/LocalStorageAdapter.js'
];
protectedFiles.forEach(function (f) {
  check(f + ' still present', fs.existsSync(path.join(ROOT, f)));
});

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed.');
if (failures > 0) {
  console.log(failures + ' FAILURE(S).');
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED.');
  process.exit(0);
}
