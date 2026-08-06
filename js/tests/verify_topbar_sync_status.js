// ==================================================================
// verify_topbar_sync_status.js — PHASE UX-03 HOTFIX verification
// ==================================================================
// Pure-function test harness for formatLastSyncRelative(), the single
// function responsible for all "منذ ..." relative-time phrasing used
// by the topbar's persistent last-sync widget (js/modules/settings.js).
// Run: node js/tests/verify_topbar_sync_status.js
// ==================================================================
const assert = require('assert');
const path = require('path');

const { formatLastSyncRelative } = require(path.join(__dirname, '..', 'modules', 'settings.js'));

let checks = 0;
function check(label, actual, expected) {
  checks++;
  assert.strictEqual(actual, expected, label + ' — expected "' + expected + '" got "' + actual + '"');
  console.log('  ✓ ' + label);
}

function isoSecondsAgo(sec) {
  return new Date(Date.now() - sec * 1000).toISOString();
}

console.log('PHASE UX-03 — formatLastSyncRelative() verification\n');

// --- No timestamp / invalid input -> null (caller falls back to "من البيانات المحلية") ---
check('null timestamp -> null', formatLastSyncRelative(null), null);
check('empty string -> null', formatLastSyncRelative(''), null);
check('undefined -> null', formatLastSyncRelative(undefined), null);
check('garbage string -> null', formatLastSyncRelative('not-a-date'), null);

// --- Just now / seconds ---
check('0s ago -> منذ لحظات', formatLastSyncRelative(isoSecondsAgo(0)), 'منذ لحظات');
check('30s ago -> منذ لحظات', formatLastSyncRelative(isoSecondsAgo(30)), 'منذ لحظات');
check('59s ago -> منذ لحظات', formatLastSyncRelative(isoSecondsAgo(59)), 'منذ لحظات');

// --- Minutes ---
check('60s ago -> منذ دقيقة', formatLastSyncRelative(isoSecondsAgo(60)), 'منذ دقيقة');
check('90s ago -> منذ دقيقة', formatLastSyncRelative(isoSecondsAgo(90)), 'منذ دقيقة');
check('2m ago -> منذ دقيقتين', formatLastSyncRelative(isoSecondsAgo(120)), 'منذ دقيقتين');
check('5m ago -> منذ 5 دقائق', formatLastSyncRelative(isoSecondsAgo(5 * 60)), 'منذ 5 دقائق');
check('10m ago -> منذ 10 دقائق', formatLastSyncRelative(isoSecondsAgo(10 * 60)), 'منذ 10 دقائق');
check('15m ago -> منذ 15 دقيقة', formatLastSyncRelative(isoSecondsAgo(15 * 60)), 'منذ 15 دقيقة');
check('59m ago -> منذ 59 دقيقة', formatLastSyncRelative(isoSecondsAgo(59 * 60)), 'منذ 59 دقيقة');

// --- Hours ---
check('60m ago -> منذ ساعة', formatLastSyncRelative(isoSecondsAgo(60 * 60)), 'منذ ساعة');
check('2h ago -> منذ ساعتين', formatLastSyncRelative(isoSecondsAgo(2 * 3600)), 'منذ ساعتين');
check('5h ago -> منذ 5 ساعات', formatLastSyncRelative(isoSecondsAgo(5 * 3600)), 'منذ 5 ساعات');
check('23h ago -> منذ 23 ساعة', formatLastSyncRelative(isoSecondsAgo(23 * 3600)), 'منذ 23 ساعة');

// --- Days ---
check('24h ago -> منذ يوم', formatLastSyncRelative(isoSecondsAgo(24 * 3600)), 'منذ يوم');
check('2d ago -> منذ يومين', formatLastSyncRelative(isoSecondsAgo(2 * 86400)), 'منذ يومين');
check('5d ago -> منذ 5 أيام', formatLastSyncRelative(isoSecondsAgo(5 * 86400)), 'منذ 5 أيام');
check('15d ago -> منذ 15 يوم', formatLastSyncRelative(isoSecondsAgo(15 * 86400)), 'منذ 15 يوم');

console.log('\n' + checks + '/' + checks + ' checks passed.');
