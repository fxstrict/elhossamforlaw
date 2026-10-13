#!/usr/bin/env node
/* tools/verify-precache-sync.js — dependency-free. Fails (exit 1) if service-worker.js PRECACHE_URLS
 * drifts from the <link>/<script> tags of index.html (exact ?v= strings), or SW_VERSION is malformed.
 * Admin-only files are excluded BY DESIGN (see js/tests/verify_service_worker_legal_directories_precache.js). */
'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');
var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
var EXCLUDED = ['js/utils/DirectoryPublisher.js', 'js/modules/legal-directories-admin.js'];
var errs = [], tags = [], m, re;
re = /<link\b[^>]*>/g;
while ((m = re.exec(html))) { if (/rel="stylesheet"/.test(m[0])) { var h = /href="([^"]+)"/.exec(m[0]); if (h) tags.push(h[1]); } }
re = /<script\b[^>]*\bsrc="([^"]+)"/g; while ((m = re.exec(html))) tags.push(m[1]);
tags = tags.filter(function (t) { return !/^https?:/.test(t); });
var blk = /var PRECACHE_URLS = \[([\s\S]*?)\n\];/.exec(sw);
if (!blk) { console.error('PRECACHE_URLS not found'); process.exit(1); }
var pre = []; blk[1].split('\n').forEach(function (l) { var x = /^\s*'([^']+)'/.exec(l); if (x) pre.push(x[1]); });
function bare(u) { return u.split('?')[0]; }
tags.forEach(function (t) { if (EXCLUDED.indexOf(bare(t)) !== -1) return; if (pre.indexOf(t) === -1) errs.push('MISSING from PRECACHE_URLS: ' + t); });
pre.forEach(function (p) { if (/^assets\//.test(p) || ['index.html', 'manifest.json', 'offline.html', 'js/data/directories/legal-directories.json'].indexOf(p) !== -1) return;
  if (tags.indexOf(p) === -1) errs.push('STALE / query mismatch (not an index.html tag): ' + p); });
EXCLUDED.forEach(function (e) { pre.forEach(function (p) { if (bare(p) === e) errs.push('admin-only file must NOT be precached: ' + p); }); });
var decl = sw.match(/^var SW_VERSION = 'v(\d+)'/gm) || [];
if (decl.length !== 1) errs.push('SW_VERSION must be declared exactly once (found ' + decl.length + ')');
try { cp.execSync('node --check "' + path.join(ROOT, 'service-worker.js') + '"', { stdio: 'pipe' }); } catch (e) { errs.push('service-worker.js fails node --check'); }
var ver = /^var SW_VERSION = '(v\d+)'/m.exec(sw);
console.log('SW_VERSION=' + (ver ? ver[1] : '?') + '  index tags=' + tags.length + '  precache entries=' + pre.length);
if (errs.length) { console.error(errs.join('\n')); console.error('\nFAILED (' + errs.length + ')'); process.exit(1); }
console.log('OK: precache is in sync with index.html');
