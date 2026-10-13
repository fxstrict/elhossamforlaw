#!/usr/bin/env node
/* tools/build-icon-sprite.js — dependency-free (Node >= 12).
 * Reads assets/icons/ui/src/<category>/<name>.svg, validates, then writes
 *   1) assets/icons/ui/sprite.svg            (generated artifact, for QA/preview)
 *   2) the region between the GENERATED SPRITE markers in js/ui/UiIcon.js
 * Usage: node tools/build-icon-sprite.js [--check]   (--check = no writes, exit 1 on drift) */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'assets', 'icons', 'ui', 'src');
var OUT = path.join(ROOT, 'assets', 'icons', 'ui', 'sprite.svg');
var JS = path.join(ROOT, 'js', 'ui', 'UiIcon.js');
var PREFIX = { navigation: 'nav', actions: 'act', status: 'status', system: 'sys' };
var BEGIN = '/* BEGIN GENERATED SPRITE */', END = '/* END GENERATED SPRITE */';
var check = process.argv.indexOf('--check') !== -1, errors = [], symbols = [], seen = {};

Object.keys(PREFIX).forEach(function (cat) {
  var dir = path.join(SRC, cat);
  if (!fs.existsSync(dir)) { errors.push('missing dir: ' + dir); return; }
  fs.readdirSync(dir).filter(function (f) { return /\.svg$/.test(f); }).sort().forEach(function (f) {
    var name = f.replace(/\.svg$/, ''), src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (name.indexOf(PREFIX[cat] + '-') !== 0) errors.push(cat + '/' + f + ': name must start with "' + PREFIX[cat] + '-"');
    if (!/^[a-z0-9-]+$/.test(name)) errors.push(f + ': kebab-case only');
    if (seen[name]) errors.push(f + ': duplicate name'); seen[name] = 1;
    var m = /<svg\b[^>]*viewBox="0 0 24 24"[^>]*>([\s\S]*?)<\/svg>/.exec(src);
    if (!m) { errors.push(f + ': needs <svg viewBox="0 0 24 24">…</svg>'); return; }
    var inner = m[1].replace(/\s*\n\s*/g, '').trim();
    if (/#[0-9a-fA-F]{3,8}\b|\bstyle=|<script|<image|<text|href=|xlink:/.test(inner)) errors.push(f + ': hard-coded colour/style/script/image is forbidden');
    symbols.push('<symbol id="ui-' + name + '" viewBox="0 0 24 24">' + inner + '</symbol>');
  });
});
if (errors.length) { console.error('BUILD FAILED:\n  ' + errors.join('\n  ')); process.exit(1); }
var body = symbols.join('');
var sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + body + '</svg>\n';
var js = fs.readFileSync(JS, 'utf8'), a = js.indexOf(BEGIN), b = js.indexOf(END);
if (a < 0 || b < a) { console.error('UiIcon.js markers not found'); process.exit(1); }
var next = js.slice(0, a + BEGIN.length) + '\n  var SPRITE = ' + JSON.stringify(body) + ';\n  ' + js.slice(b);
var drift = next !== js || !fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== sprite;
if (check) { console.log(drift ? 'DRIFT: run node tools/build-icon-sprite.js' : 'OK: ' + symbols.length + ' icons in sync'); process.exit(drift ? 1 : 0); }
fs.writeFileSync(OUT, sprite); fs.writeFileSync(JS, next);
console.log('built ' + symbols.length + ' icons -> sprite.svg + UiIcon.js (' + body.length + ' bytes)');
