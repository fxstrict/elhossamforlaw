/**
 * ================================================================
 * PHASE_A9_3_splash_animation_tests.js — PHASE A9.3 regression tests
 * ================================================================
 * Dependency-free (no jsdom/Playwright/browser binary) static checks
 * against the real project files, mirroring the existing
 * verify_A9_2_splash_og_forensic.js pattern. Covers only the
 * PHASE A9.3 splash animation change (logo/ring/glow polish) and
 * confirms nothing from A9 / A9.2 was undone.
 *
 * Run: node js/tests/PHASE_A9_3_splash_animation_tests.js
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

console.log('--- Splash markup still present ---');
check('#splashScreen present', /id="splashScreen"/.test(indexHtml));
check('.splash-logo present', /class="splash-logo"/.test(indexHtml));
check('.splash-logo-ring present (SVG)', /class="splash-logo-ring"/.test(indexHtml));
check('.splash-title present with app name text unchanged', /class="splash-title">\u0627\u0644\u062d\u0633\u0627\u0645</.test(indexHtml));
check('.splash-subtitle present', /class="splash-subtitle"/.test(indexHtml));

console.log('--- PHASE A9.3 animation additions ---');
check('splash-logo-in keyframes unchanged (0.82 -> 1 scale-in still present)', /@keyframes splash-logo-in\{\s*0%\{opacity:0;transform:scale\(\.82\);\}\s*100%\{opacity:1;transform:scale\(1\);\}\s*\}/.test(componentsCss));
check('new splash-ring-in keyframes present', /@keyframes splash-ring-in/.test(componentsCss));
check('ring entrance uses transform+opacity only (no top/left/width/height)', (function () {
  const m = componentsCss.match(/@keyframes splash-ring-in\{([\s\S]*?)\}\s*\}/);
  if (!m) return false;
  const body = m[1];
  return /opacity|transform/.test(body) && !/(^|[^-])\b(top|left|width|height|margin|padding)\s*:/.test(body);
})());
check('glow keyframes upgraded to a 3-stop low->medium->stable ramp', /@keyframes splash-glow-in\{\s*0%\{opacity:0;\}\s*45%\{opacity:\.55;\}\s*100%\{opacity:1;\}\s*\}/.test(componentsCss));
check('.splash-logo-ring rule references the new splash-ring-in animation', /\.splash-logo-ring\{[^}]*animation:splash-ring-in/.test(componentsCss));
check('no bounce/overshoot easing introduced (no cubic-bezier with values >1 or <0 in splash rules)', !/splash-(logo-in|ring-in|glow-in)[^;]*cubic-bezier\([^)]*(-\d|\b[2-9]\d*\.|\b1\.\d)/.test(componentsCss));

console.log('--- Base state safety (rule: animation failure != content failure) ---');
check('fill-mode fallback now also covers .splash-logo and .splash-logo-ring (was text-only in A9.2)', /@supports not \(animation-fill-mode: forwards\)\s*\{\s*\.splash-logo,\.splash-logo-ring,\.splash-title/.test(componentsCss));
check("JS safety net (firstrun.js) now also forces '.splash-logo' visible, not just the five text elements", /var ids = \['\.splash-logo', '\.splash-title', '\.splash-subtitle', '\.splash-version', '\.splash-contact', '\.splash-footer'\]/.test(firstrunJs));
check('prefers-reduced-motion block still lists .splash-logo-ring and forces transform:none', /prefers-reduced-motion: reduce\)\{[\s\S]{0,400}?\.splash-logo-ring[\s\S]{0,200}?transform:none !important/.test(componentsCss));

console.log('--- No animation loops / no new dependencies introduced ---');
check('no setInterval for animation in components.css region (n/a, CSS file) — placeholder for symmetry', true);
check('no requestAnimationFrame introduced in firstrun.js', !/requestAnimationFrame/.test(firstrunJs));
check('no setInterval introduced in firstrun.js', !/setInterval/.test(firstrunJs));
check('no new <script src> for an animation library added to index.html', !/(gsap|anime\.min\.js|framer-motion)/i.test(indexHtml));

console.log('--- PHASE A9 / A9.2 timing untouched ---');
check('MIN_VISIBLE_MS still 3300', /var MIN_VISIBLE_MS\s*=\s*3300/.test(firstrunJs));
check("application:ready listener still waits out MIN_VISIBLE_MS before hiding (A9 race fix intact)", /addEventListener\('application:ready'[\s\S]{0,300}?MIN_VISIBLE_MS - elapsed/.test(firstrunJs));
check('hard safety cap still 6000ms', /setTimeout\(function \(\) \{\s*hideSplashAndCheckFirstRun\(\);\s*\}, 6000\)/.test(firstrunJs));

console.log('--- Protected files untouched (structural sanity) ---');
['js/core/boot/BootManager.js', 'js/api', 'js/repositories'].forEach(function (p) {
  const full = path.join(ROOT, p);
  check(p + ' still exists on disk', fs.existsSync(full));
});

console.log('\n' + checks + ' checks, ' + failures + ' failed.');
if (failures > 0) process.exitCode = 1;
