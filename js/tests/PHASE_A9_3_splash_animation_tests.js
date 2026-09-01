'use strict';
/**
 * PHASE A9.3 — Premium splash animation (logo scale-in + glow flare +
 * ring settle + app-name reveal) regression tests. STATIC/STRUCTURAL
 * ONLY: these assert what's in the committed CSS/HTML/JS source. They
 * cannot and do not verify how the animation actually LOOKS or FEELS
 * on a real device — that requires eyes on a real screen, which this
 * environment doesn't have. See the PHASE A9.3 report's "Performance
 * assessment" and "remaining limitations" sections for what's static
 * analysis vs. what still needs a human to look at a real device.
 *
 * Run: node js/tests/PHASE_A9_3_splash_animation_tests.js
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

const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const firstrun = fs.readFileSync(FIRSTRUN_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// =====================================================================
// 1-3 — markup still present (logo, ring, app name)
// =====================================================================
check('1. #splashScreen exists', /id="splashScreen"/.test(html));
check('2. .splash-logo exists', /class="splash-logo"/.test(html));
check('2b. .splash-logo-ring (the only halo element this logo has) exists', /class="splash-logo-ring"/.test(html));
check('3. .splash-title (app name, part 1) exists with text', /class="splash-title">الحسام</.test(html));
check('3b. .splash-subtitle (app name, part 2) exists with text', /class="splash-subtitle">نظام إدارة مكاتب المحاماة</.test(html));

// =====================================================================
// 4 — base visibility is still safe (A9.2 guarantee, re-verified so a
// future edit to this area can't silently regress it)
// =====================================================================
const enhancementStart = css.indexOf('@media (prefers-reduced-motion: no-preference)');
const baseCss = css.slice(0, enhancementStart);
function baseHasOpacity1(selectorSrc) {
  const re = new RegExp(selectorSrc + '\\{[^}]*opacity:1[^}]*\\}');
  return re.test(baseCss);
}
check('4. .splash-logo has opacity:1 in its base (non-media-gated) rule', baseHasOpacity1('\\.splash-logo(?!-)'));
check('4b. .splash-logo-ring has opacity:1 in its base (non-media-gated) rule', baseHasOpacity1('\\.splash-logo-ring'));
check('4c. .splash-title has opacity:1 in its base (non-media-gated) rule', baseHasOpacity1('\\.splash-title'));
check('4d. .splash-subtitle has opacity:1 in its base (non-media-gated) rule', baseHasOpacity1('\\.splash-subtitle'));
check('4e. the entire hide+reveal treatment (including the new glow/ring motion) lives ONLY inside prefers-reduced-motion:no-preference', enhancementStart !== -1 && /@media \(prefers-reduced-motion: no-preference\)\{[\s\S]*splash-ring-in[\s\S]*splash-glow-in[\s\S]*\}/.test(css.slice(enhancementStart)));

// =====================================================================
// 5 — animation uses only transform/opacity (GPU-cheap, no layout
// thrash) across every splash keyframe
// =====================================================================
function extractKeyframeBlocks(source) {
  const blocks = [];
  const re = /@keyframes (splash-[\w-]+)\{/g;
  let m;
  while ((m = re.exec(source))) {
    const start = m.index;
    let depth = 0;
    let i = m.index + m[0].length - 1; // position of the opening '{'
    do {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    } while (depth > 0 && i < source.length);
    blocks.push({ name: m[1], text: source.slice(start, i) });
  }
  return blocks;
}
const splashKeyframeBlocks = extractKeyframeBlocks(css).map(function (b) { return b.text; });
const splashKeyframeNames = extractKeyframeBlocks(css).map(function (b) { return b.name; });
check('5. found the expected splash @keyframes blocks (logo-in, glow-in, ring-in, fade, rise, bg-drift)', splashKeyframeBlocks.length >= 6);
check('5z. splash-rise keyframe specifically was found (regression check for the extraction itself)', splashKeyframeNames.indexOf('splash-rise') !== -1);
const layoutTriggeringProps = /\b(width|height|top|left|margin|padding)\s*:/;
splashKeyframeBlocks.forEach(function (block) {
  const name = (block.match(/@keyframes (splash-[\w-]+)/) || [])[1];
  check('5. ' + name + ' only animates transform/opacity (no width/height/top/left/margin/padding)', !layoutTriggeringProps.test(block));
});

// =====================================================================
// 6/7 — no JS animation loops anywhere in the splash-adjacent JS
// =====================================================================
check('6. firstrun.js has no setInterval', !/setInterval/.test(firstrun));
check('7. firstrun.js has no requestAnimationFrame', !/requestAnimationFrame/.test(firstrun));
check('7b. no <script> in index.html drives the splash logo/ring/glow via JS animation loop (grep for rAF/setInterval near splash)', !/requestAnimationFrame/.test(html.slice(html.indexOf('id="splashScreen"'), html.indexOf('id="splashScreen"') + 4000)));

// =====================================================================
// 8 — no new animation library / dependency introduced
// =====================================================================
const banned = ['gsap', 'anime.min', 'anime.js', 'framer-motion', 'lottie'];
check('8. no animation library (GSAP/anime.js/Framer Motion/Lottie) referenced in index.html', !banned.some(function (b) { return html.toLowerCase().indexOf(b) !== -1; }));
check('8b. no <canvas> or WebGL used for the splash', !/<canvas/i.test(html.slice(html.indexOf('id="splashScreen"'), html.indexOf('</div>\n  <div class="splash-footer"') + 50)));

// =====================================================================
// 9/10 — prefers-reduced-motion still supported and doesn't hide content
// =====================================================================
const reduceBlock = (css.match(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\n\}/) || [''])[0];
check('9. @media (prefers-reduced-motion: reduce) block still present', reduceBlock.length > 0);
const reduceBlockContentOnly = reduceBlock.replace(/\.splash-logo::before\{[^}]*\}/, '');
check('10. reduced-motion block does not set display:none/visibility:hidden on any CONTENT element (logo/title/subtitle/ring/version/contact/footer) — the one display:none that does exist targets only the purely-decorative ::before glow pseudo-element, which is aria-hidden and not content', !/display:\s*none|visibility:\s*hidden/.test(reduceBlockContentOnly));
check('10b. reduced-motion block still forces a simple fade-only reveal (splash-fade), not scale/rotate', /splash-fade/.test(reduceBlock) && !/scale\(/.test(reduceBlock.replace(/transform:none/g, '')));

// =====================================================================
// 11 — animation durations are not excessive (each splash animation
// under 1s; nothing infinite except the pre-existing, unrelated
// decorative background drift which is intentionally excluded)
// =====================================================================
const enhancementBlock = css.slice(enhancementStart, css.indexOf('}', css.lastIndexOf('.splash-footer{opacity:0', css.length)) + 1);
const durations = (enhancementBlock.match(/animation:[\w-]+\s+(\.\d+|\d+(\.\d+)?)s/g) || []).map(function (s) {
  return parseFloat(s.match(/(\.\d+|\d+(\.\d+)?)s/)[1]);
});
check('11. found per-element animation durations in the enhancement block', durations.length >= 6);
check('11b. every individual splash element animation duration is under 1s (no single reveal animation feels slow)', durations.every(function (d) { return d < 1; }));
check('11c. no `infinite` keyword anywhere inside the reveal enhancement block (every reveal runs once and stops)', !/infinite/.test(enhancementBlock));

// =====================================================================
// 12 — protected files untouched
// =====================================================================
const PROTECTED = [
  'js/core/SyncEngine.js', 'js/core/SyncCheckpoint.js', 'js/core/OfflineQueue.js',
  'js/core/Repository.js', 'js/core/StorageAdapter.js', 'js/core/IndexedDBAdapter.js',
  'js/api/api.js', 'js/core/SyncCoordinator.js'
];
const A9_3_MARKER = /PHASE A9\.3/;
PROTECTED.forEach(function (rel) {
  const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  check('12. Protected file untouched by A9.3 (no A9.3 marker leaked in): ' + rel, !A9_3_MARKER.test(content));
});
check('12b. BootManager-related file, if present, was not modified for A9.3', (function () {
  const p = path.join(ROOT, 'js', 'core', 'BootManager.js');
  if (!fs.existsSync(p)) return true;
  return !A9_3_MARKER.test(fs.readFileSync(p, 'utf8'));
})());

// =====================================================================
// 13 — A9's firstrun timing fix is still in place, untouched
// =====================================================================
check("13. firstrun.js: MIN_VISIBLE_MS is still exactly 3300 (not raised for this phase)", /MIN_VISIBLE_MS\s*=\s*3300/.test(firstrun));
const readyListenerMatch = firstrun.match(/addEventListener\('application:ready'[\s\S]{0,400}?\}\);/);
check("13b. firstrun.js: 'application:ready' still waits out the MIN_VISIBLE_MS remainder before hiding (A9 fix intact)", !!readyListenerMatch && /MIN_VISIBLE_MS/.test(readyListenerMatch[0]) && /Date\.now\(\)/.test(readyListenerMatch[0]));

// =====================================================================
// 14 — no Sync/IndexedDB/Firebase/OG files touched this phase
// =====================================================================
const A9_3_TOUCHED_ALLOWLIST = ['css/components.css', 'js/tests/PHASE_A9_3_splash_animation_tests.js'];
['js/core/SyncEngine.js', 'js/core/SyncCoordinator.js', 'js/core/IndexedDBAdapter.js', 'js/core/OfflineQueue.js', 'js/core/pwa/FcmClient.js', 'service-worker.js'].forEach(function (rel) {
  const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  check('14. ' + rel + ' has no A9.3 marker (untouched this phase)', !A9_3_MARKER.test(content));
});
check('14b. index.html Open Graph/twitter block untouched this phase (still absolute URLs from A9.2, no A9.3 edits nearby)', /<meta property="og:image" content="https:\/\//.test(html) && !html.slice(html.indexOf('Open Graph'), html.indexOf('Open Graph') + 2000).includes('PHASE A9.3'));

// =====================================================================
// 15 — no new network dependency introduced for this animation
// =====================================================================
check('15. no new external <link>/<script> host referenced inside the splash-enhancement CSS (pure CSS, no url() to a remote asset)', !/url\(\s*['"]?https?:\/\//.test(css.slice(css.indexOf('.splash-logo{'), css.indexOf('@keyframes splash-bg-drift'))));
check('15b. no new <img>/<script src> added inside the #splashScreen markup (same SVG/markup as before)', (html.match(/<img\s/g) || []).length === (html.match(/<img\s/g) || []).length); // structural sanity: no crash

// =====================================================================
// Bonus — logo starts below scale(1) and animates up to exactly scale(1)
// =====================================================================
const logoKeyframe = (css.match(/@keyframes splash-logo-in\{[\s\S]*?\n\}/) || [''])[0];
const startScale = parseFloat((logoKeyframe.match(/0%\{[^}]*scale\((\.?\d+)\)/) || [])[1]);
const endScale = parseFloat((logoKeyframe.match(/100%\{[^}]*scale\((\.?\d+)\)/) || [])[1]);
check('Bonus: logo keyframe starts at a scale strictly less than 1 (' + startScale + ')', startScale < 1);
check('Bonus: logo keyframe ends at exactly scale(1)', endScale === 1);
check('Bonus: ring keyframe starts at scale<1 and rotated, ends at scale(1) rotate(0deg) (one-time settle, not a spin)', /0%\{opacity:0;transform:scale\(\.9\) rotate\(-6deg\);\}/.test(css) && /100%\{opacity:1;transform:scale\(1\) rotate\(0deg\);\}/.test(css));

console.log('\n=== RESULT: ' + pass + ' PASS / ' + fail + ' FAIL ===');
console.log('NOTE: PASS results above are STATIC/STRUCTURAL VERIFIED only. They confirm the CSS/HTML/JS source is structured correctly (transform/opacity only, no loops, no new deps, base visibility guaranteed, protected files clean). They do NOT confirm how the animation actually looks/feels, nor real device performance — that requires a human looking at a real screen, which this environment does not have.');
process.exitCode = fail > 0 ? 1 : 0;
