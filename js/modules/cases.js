/**
 * ================================================================
 * js/modules/cases.js — وحدة القضايا | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Cases-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.3 — Cases Restore Pilot
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.13 below: a new
 * `restoreCase(id)` function (see its own doc comment, next to
 * `deleteCase()`) that calls the `casesRepository.restore(id)` Core
 * capability added in SUB-PHASE 10.2 (js/core/Repository.js, itself
 * NOT modified by this phase). No existing function in this file was
 * changed. See docs/Cases_Restore_Integration_Report.md for the full
 * audit, design rationale, and verification evidence.
 *
 * PHASE 9 — SUB-PHASE 9.13 — Repository Integration
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * CasesRepository.js instead of the legacy global `data.cases` array
 * directly. Nothing else in the project was changed to make this happen:
 * CasesRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This mirrors the pattern
 * already proven in Sub-Phase 9.11 (js/modules/clients.js) and seven
 * other sibling modules — see docs/Cases_Repository_Integration_Audit.md
 * for the full pre-migration analysis this phase executes, and
 * docs/Cases_Repository_Integration_Report.md for what changed and why.
 *
 * WHY `data.cases` STILL EXISTS BELOW
 *   js/modules/dashboard.js (`data.cases.filter(...)`/`data.cases.length`,
 *   three reads) and js/modules/clients.js (`buildClientReport()`'s
 *   `linkedCases` filter) both read the global `data.cases` array
 *   directly, and this phase's mandate is "Modify ONLY cases.js" — neither
 *   of those files may be touched. So `data.cases` is kept alive as a
 *   read-only MIRROR of `CasesRepository.getAll()`, refreshed after every
 *   Repository read/write this file performs. Every other module keeps
 *   working unmodified and unaware that Cases moved to the Repository.
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderCases`) call the Repository's SYNCHRONOUS methods only
 *     (`search()`) — no unnecessary async.
 *   - Writes (`saveCase`, `deleteCase`) are the ONLY functions in this
 *     file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *   - `editCase`/`viewCase`/`quickPrintCase`/`quickCaseQR`/`getCaseStats`/
 *     `searchCases`/`filterCases`/`buildCaseReport`/`populateCaseDropdown`/
 *     `autofillSessionFromCase`/`autofillFeeFromCase`, all four embedded-
 *     children functions, and the three `collectForm`/`fillForm`/
 *     `resetForm` overrides stay 100% SYNCHRONOUS and unchanged: they
 *     only read the already-synced `data.cases` mirror, exactly like
 *     before. `editCase()`, `viewCase()`, and `resetForm()` MUST remain
 *     synchronous — js/modules/clients.js (out of scope for this phase)
 *     wraps all three a second time, synchronously, on top of this file's
 *     own override chain, and depends on their DOM/state effects being
 *     already visible the instant the wrapped call returns (audit §16.1).
 *
 * NATURAL-KEY ID — THE ONE STRUCTURAL DIFFERENCE FROM CLIENTS/DOCUMENTS/…
 *   Unlike every previously-migrated module (which all use an
 *   auto-generated id), `رقم_القضية` is USER-ENTERED and is Cases'
 *   natural key (`CasesRepository`'s own `idField`, no `uid()` fallback).
 *   `Repository.prototype.create()` therefore rejects a second record
 *   with a case number that already exists — something the old
 *   `data.cases.push(obj)` never did. `saveCase()` below surfaces that
 *   rejection as a new, specific Arabic toast rather than failing
 *   silently (audit §5/§17.1) — see the `saveCase()` doc comment.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editCase(N)"` / `onclick="viewCase(N)"` /
 *   `onclick="quickPrintCase(N)"` / `onclick="quickCaseQR(N)"` /
 *   `onclick="deleteCase(N)"` attributes (index.html's row templates
 *   were not changed, per this phase's rule "Do NOT modify HTML").
 *   Because `CasesRepository.search()`/`getAll()` return CLONED records
 *   (not the same object references `data.cases` used to hold), the old
 *   `data.cases.indexOf(c)` reference-equality trick no longer works.
 *   `resolveCaseIndex()` below is the smallest possible replacement: it
 *   looks a record up in the current mirror by its identifier field
 *   (`رقم_القضية`) instead of by reference. `editCase(i)`/`viewCase(i)`/
 *   `quickPrintCase(i)`/`quickCaseQR(i)` continue to receive a plain
 *   mirror index exactly as before (they are unmodified), and only
 *   `renderCases()`'s two `indexOf()` call sites needed replacing.
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   `CasesRepository` is configured with `softDelete: true` (unchanged,
 *   not this phase's decision). `delete(id)` therefore keeps the record
 *   in storage with a `deletedAt` stamp instead of physically removing
 *   it, unlike the original `data.cases.splice(i,1)`. `getAll()`/
 *   `search()` both exclude soft-deleted records by default, so nothing
 *   deleted ever reappears anywhere `data.cases` is read (this file,
 *   dashboard.js, clients.js) — the UI-observable behavior is therefore
 *   identical to a hard delete. See
 *   docs/Cases_Repository_Integration_Report.md §5 for the full analysis.
 *
 * KNOWN ARCHITECTURAL LIMITATION — NOT FIXED THIS PHASE (audit §14, same
 * R-06 class already documented for Clients in Sub-Phase 9.11)
 *   `ApiService.deleteData()`/`syncRow()` send a 0-based `rowIndex` on
 *   the assumption that the frontend array position equals the backend
 *   sheet row. Now that soft-delete semantics apply, `data.cases`
 *   (sourced from `getAll()`) omits soft-deleted rows while the
 *   Repository's own underlying storage array still contains them at
 *   their original position. This phase does NOT change what value is
 *   passed to ApiService for Cases — the drift is accepted as an
 *   already-latent, pre-existing architectural gap and documented here
 *   and in the integration report, not silently patched.
 *
 * NOT IMPLEMENTED — THIRD CONSECUTIVE PHASE TO DOCUMENT THIS GAP (audit §8)
 *   "Children" means two entirely separate things in this codebase:
 *   the embedded `أطفال_القضية` JSON field on a Case record (four
 *   `cases.js`-local functions below, untouched by this migration), and
 *   the fully separate standalone Children entity (`data.children`,
 *   `js/modules/children.js`, `ChildrenRepository.js`). A proposed
 *   `getChildrenSummary(caseId)` reconciling the two is intentionally
 *   NOT implemented here, consistent with every prior phase that has
 *   touched either side of this boundary.
 *
 * VIEW/PRINT BACKFILL ASYMMETRY — PRESERVED AS-IS (audit §7)
 *   `viewCase()` back-fills missing client detail fields from
 *   `data.clients` on a shallow copy before building its report;
 *   `quickPrintCase()` deliberately does NOT perform the same backfill.
 *   This pre-existing asymmetry is unchanged by this migration.
 *
 * Depends on (globals expected from index.html):
 *   - data          : shared app data object  { cases, sessions, documents, clients, … }
 *   - editIdx       : shared edit-index map   { cases: -1 }
 *   - ApiService    : api.js layer
 *   - saveLocal()   : localStorage persistence helper
 *   - toast()       : UI notification helper
 *   - updateBadges(): badge counter updater
 *   - closeModal()  : modal close helper
 *   - formatDate()  : date formatter
 *   - formatTime()  : time formatter
 *   - parseLocalDate(): date parser
 *   - urgencyBadge(): urgency badge builder
 *   - statusBadge() : status badge builder
 *   - val()         : getElementById + .value helper
 *   - collectForm() : overridden below for cases children
 *   - fillForm()    : overridden below for cases children
 *   - resetForm()   : overridden below (case dropdown repopulation)
 *   - populateCaseDropdown() : defined at bottom of this file
 *   - genClientQR() : defined in clients module / third <script> block
 *   - CasesRepository : js/repositories/CasesRepository.js (new this
 *                       phase — loaded the same dual Node/browser way
 *                       every Repository file already loads its own
 *                       dependencies)
 *
 * Sheet name (GAS):  'القضايا'
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (clients, sessions, documents, tasks, fees, …)
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/CasesRepository.js
 * ================================================================
 */

'use strict';

// ================================================================
// PHASE 13.17 — SECURITY PART 2/4 — XSS HARDENING
// ================================================================
// escapeHtml() — local-only escaping helper, same pattern already used
// by js/modules/historypanel-ui.js. No external library, no DOMPurify,
// no import — a small self-contained function scoped to this file.
// Every value read from CasesRepository / data.cases / data.sessions /
// data.documents / the DOM / embedded-children JSON that gets injected
// into an HTML string (as text OR inside an attribute) below is passed
// through this first. Business logic, Repository calls, API calls,
// save behavior, element ordering, CSS and page structure are all
// unchanged — this phase only ever wraps existing values in
// escapeHtml() before they reach innerHTML/outerHTML/attribute strings.
// ================================================================
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, function (ch) {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default:  return ch;
    }
  });
}

// ================================================================
// FIELDS & MAP — cases slice only
// (Full FIELDS/MAP objects live in index.html; these are the
//  cases-specific entries referenced by renderCases helpers.)
// ================================================================

var CASES_FIELDS = [
  'fCaseNum','fCaseCircuit','fCaseRoom','fCaseDocketNum','fCaseType','fCaseCourt','fCaseTitle',
  'fCaseClientType','fCaseClient','fCaseClientNID','fCaseClientPhone',
  'fCaseClientAddr','fCaseClientJob','fCaseClientEmployer',
  'fCaseOpponent','fCaseOpponentNID','fCaseOpponentPhone',
  'fCaseOpponentAddr','fCaseOpponentJob','fCaseOpponentEmployer',
  'fCaseStatus','fCaseDate','fCaseNextSession','fCaseFees',
  'fCaseMarriageDate','fCaseMarriageDoc','fCaseNotaryOffice',
  'fCaseHasInventory','fCaseHasChildren',
  'fCaseDemands','fCaseDefenses','fCaseProcedures','fCaseDecisions',
  'fCaseJudgmentDate','fCaseEnforcement','fCaseEnforcementDetails',
  'fCaseNotes'
];

var CASES_MAP = {
  fCaseNum:              'رقم_القضية',
  fCaseCircuit:          'رقم_الدائرة',
  fCaseRoom:             'رقم_القاعة',
  fCaseDocketNum:        'رقم_الدعوى',
  fCaseType:             'نوع_الدعوى',
  fCaseCourt:            'المحكمة',
  fCaseTitle:            'عنوان_القضية',
  fCaseClientType:       'نوع_الموكل',
  fCaseClient:           'اسم_الموكل',
  fCaseClientNID:        'رقم_قومي_الموكل',
  fCaseClientPhone:      'هاتف_الموكل',
  fCaseClientAddr:       'عنوان_الموكل',
  fCaseClientJob:        'عمل_الموكل',
  fCaseClientEmployer:   'جهة_عمل_الموكل',
  fCaseOpponent:         'اسم_الخصم',
  fCaseOpponentNID:      'رقم_قومي_الخصم',
  fCaseOpponentPhone:    'هاتف_الخصم',
  fCaseOpponentAddr:     'عنوان_الخصم',
  fCaseOpponentJob:      'عمل_الخصم',
  fCaseOpponentEmployer: 'جهة_عمل_الخصم',
  fCaseStatus:           'الحالة',
  fCaseDate:             'تاريخ_القيد',
  fCaseNextSession:      'تاريخ_الجلسة_القادمة',
  fCaseFees:             'أتعاب_المحاماة',
  fCaseMarriageDate:     'تاريخ_عقد_الزواج',
  fCaseMarriageDoc:      'رقم_وثيقة_الزواج',
  fCaseNotaryOffice:     'مكتب_التوثيق',
  fCaseHasInventory:     'وجود_قائمة_منقولات',
  fCaseHasChildren:      'وجود_أطفال',
  fCaseDemands:          'الطلبات_القانونية',
  fCaseDefenses:         'الدفوع_القانونية',
  fCaseProcedures:       'إجراءات_الدعوى',
  fCaseDecisions:        'قرارات_المحكمة',
  fCaseJudgmentDate:     'تاريخ_الحكم',
  fCaseEnforcement:      'رقم_التنفيذ',
  fCaseEnforcementDetails: 'إجراءات_التنفيذ',
  fCaseNotes:            'الملاحظات'
};

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.13
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/, and already proven in js/modules/
// clients.js (Sub-Phase 9.11): `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_cases_
// repository_integration.js loads this file), otherwise the browser
// global `window.CasesRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/CasesRepository.js ahead
// of this file — see docs/Cases_Repository_Integration_Report.md
// "Deployment note" for the exact tags needed; adding them to
// index.html is explicitly out of scope for this phase's "Modify ONLY
// cases.js" mandate, exactly as documented for Clients in Sub-Phase
// 9.11).

var CasesRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/CasesRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var CasesRepository = CasesRepositoryNS && CasesRepositoryNS.CasesRepository;

if (typeof CasesRepository !== 'function') {
  throw new Error(
    'cases.js requires js/repositories/CasesRepository.js to be ' +
    'loaded first (CasesRepository class not found).'
  );
}

// PHASE 12 — SUB-PHASE 12.4 — Cases Undo Pilot Integration.
// js/core/UndoManager.js (SUB-PHASE 12.2, unmodified by this phase) is
// required here exactly the way CasesRepository.js/DatabaseService.js/
// LocalStorageAdapter.js are already required above: same in-browser
// `<script>`-tag-populates-`window.UndoManager` assumption, same
// Node `require()` fallback for the test harness. See
// docs/Cases_Undo_Pilot_Report.md §2 for the full wiring rationale —
// Cases is the ONLY entity Repository in the project wired to an
// UndoManager instance as of this phase (Repository_Undo_Hook_Report.md
// §4.6 confirms every one of the 9 entity Repositories' `_undoManager`
// was still `null` prior to this phase).
var UndoManagerNS = (typeof module !== 'undefined' && module.exports)
  ? require('../core/UndoManager.js')
  : (typeof window !== 'undefined' ? window : this);

var UndoManager = UndoManagerNS && UndoManagerNS.UndoManager;

// SCOPE NOTE — audited and deliberate (docs/Cases_Undo_Pilot_Report.md
// §2.1 "Known Limitation"): unlike CasesRepository.js/DatabaseService.js/
// LocalStorageAdapter.js/Repository.js (already wired into index.html's
// <script> tag list since earlier phases), js/core/UndoManager.js has
// NOT been added to index.html by this phase — "PRODUCTION FILES
// ALLOWED: Only js/modules/cases.js" for THIS sub-phase excludes
// index.html. In Node (this harness, and any future Node consumer) the
// require() above always succeeds. In an actual, unmodified index.html
// browser page load, `window.UndoManager` is therefore undefined here —
// this is intentionally NOT a fatal error. Every pre-existing Cases
// capability (create/update/delete/restore/render/etc.) must keep
// working exactly as it did before this phase regardless, so the
// missing dependency degrades ONLY Undo/Redo (canUndo()/canRedo() will
// simply report false, identical to today's other 8 entity
// Repositories that also have no UndoManager wired — Phase12_3_
// Verification_Report.md §4.6) rather than throwing and breaking the
// entire Cases module load. This mirrors js/core/Repository.js's own
// "a misbehaving/absent UndoManager degrades undo/redo only, never the
// primary path" discipline. Wiring the actual <script> tag into
// index.html is an explicit, documented, deferred follow-up — not a
// silent gap (see final report, "Known Limitations").
if (typeof UndoManager !== 'function') {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      'cases.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it — see ' +
      'docs/Cases_Undo_Pilot_Report.md §2.1). Cases continues to work ' +
      'exactly as before this phase; undoLastCaseAction()/' +
      'redoLastCaseAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoManager = null;
}

// PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
// js/core/UndoReconciler.js (new this phase) extracts the reconciliation
// logic this file previously implemented locally (_resolveUndoEntryId /
// _withUndoManagerSuspended / _applyCasesUndoInstruction, SUB-PHASE
// 12.4) into an entity-agnostic shared utility, per the Phase 12.5
// pre-audit's finding (PHASE_12_5_PRE_AUDIT_Undo_Generalization.md §4)
// that none of that logic actually depended on anything Cases-specific
// beyond `casesRepository`/`CASES_ID_FIELD`. Loaded the same dual
// Node/browser way as every other core/ file. Degrades gracefully (see
// below) exactly like UndoManager above — a missing UndoReconciler
// disables Undo/Redo only, never the primary Cases path.
var UndoReconcilerNS = (typeof module !== 'undefined' && module.exports)
  ? require('../core/UndoReconciler.js')
  : (typeof window !== 'undefined' ? window : this);

var UndoReconciler = UndoReconcilerNS && UndoReconcilerNS.UndoReconciler
  ? UndoReconcilerNS.UndoReconciler
  : UndoReconcilerNS;

if (!UndoReconciler || typeof UndoReconciler.applyUndoInstruction !== 'function') {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      'cases.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). Cases continues to work ' +
      'exactly as before this phase; undoLastCaseAction()/' +
      'redoLastCaseAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * Identifier field name — must match CasesRepository's own
 * CASES_ID_FIELD constant exactly (js/repositories/CasesRepository.js,
 * §1). Duplicated here rather than imported, same "depends only on its
 * own declared dependency" discipline every Repository-integrated module
 * already uses for its own local constants. Unlike every previously
 * migrated module, this is a NATURAL key (user-entered case number),
 * not an auto-generated id — see file header "NATURAL-KEY ID" note.
 */
var CASES_ID_FIELD = 'رقم_القضية';

/**
 * The single CasesRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'cases'
 * localStorage key `data.cases`/`saveLocal()` always used.
 */
var casesRepository = new CasesRepository();

/**
 * casesUndoManager — PHASE 12.4 pilot: the single UndoManager instance
 * wired to `casesRepository` via the public `setUndoManager()` façade
 * added in SUB-PHASE 12.3 (js/core/Repository.js, NOT modified by this
 * phase). Wiring an instance is the only way any Cases mutation
 * (`create`/`update`/`delete`/`restore`) ever gets recorded — every one
 * of Repository.js's `recordCreate`/`recordUpdate`/`recordDelete`/
 * `recordRestore` hook call sites has existed since 12.3, but is a
 * guaranteed no-op while `_undoManager` is `null`
 * (Phase12_3_Verification_Report.md §4.6). Pilot scope (this phase's
 * mandate: "ONLY Cases is allowed to use Undo") is enforced simply by
 * this being the ONLY module in the project that constructs an
 * UndoManager and calls setUndoManager() at all — see
 * docs/Cases_Undo_Pilot_Report.md §2.
 *
 * `null` when `UndoManager` (above) was not resolvable — i.e. an
 * unmodified index.html browser load that hasn't yet added the
 * `<script src="js/core/UndoManager.js">` tag (see the "SCOPE NOTE"
 * above). `undoLastCaseAction()`/`redoLastCaseAction()` both already
 * guard on `casesRepository.canUndo()`/`.canRedo()` first, which
 * report `false` with no manager wired — so this degrades to a clean
 * "nothing to undo/redo" rather than any crash.
 */
var casesUndoManager = (typeof UndoManager === 'function') ? new UndoManager(casesRepository) : null;
if (casesUndoManager) {
  casesRepository.setUndoManager(casesUndoManager);
}

/**
 * Resolves once CasesRepository.open() has loaded its initial in-memory
 * copy from storage (Repository Contract §11: Create -> Open -> Ready).
 * Every write path awaits this before touching the Repository;
 * renderCases()/editCase()/viewCase()/quickPrintCase()/quickCaseQR()
 * stay synchronous and simply no-op (or read a stale-but-harmless empty
 * mirror) in the vanishingly small window before this resolves — same
 * guarantee clients.js's clientsRepositoryReadyPromise provides (see
 * that file's "READ / WRITE SPLIT" header note).
 */
var casesRepositoryReadyPromise = (function () {
  var _p = casesRepository.open().then(function () {
    syncCasesMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderCases()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('CasesRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // casesRepository.open() can never hang ensureCasesRepositoryReady()
  // forever. See js/core/RepositoryReadyTimeout.js. Purely additive:
  // if that helper isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('cases', _p) : _p;
})();

/**
 * ensureCasesRepositoryReady() — awaited by every write path
 * (saveCase, deleteCase). open() itself is idempotent
 * (Repository.prototype.open() returns immediately if already
 * 'ready'/'busy'), so calling this more than once is always safe and
 * cheap.
 * @returns {Promise<void>}
 */
function ensureCasesRepositoryReady() {
  if (casesRepository.isReady()) return Promise.resolve();
  return casesRepositoryReadyPromise;
}

/**
 * syncCasesMirror — refreshes the legacy global `data.cases` array from
 * the Repository's current state (soft-deleted records excluded, same
 * as the Repository's own getAll() default). Called after open() and
 * after every create/update/delete this module performs, so
 * dashboard.js / clients.js keep seeing accurate data without being
 * touched themselves.
 */
function syncCasesMirror() {
  data.cases = casesRepository.getAll();
}

/**
 * resolveCaseIndex(list, record) — the index half of the "index ->
 * record -> id" translation layer (see file header). Finds `record`'s
 * position inside `list` by identifier equality (`رقم_القضية`),
 * replacing the old `data.cases.indexOf(c)` reference-equality lookup
 * that no longer works now that Repository reads return cloned objects
 * (audit R-01/§16.3).
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveCaseIndex(list, record) {
  var id = record ? record[CASES_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][CASES_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة القضايا
// ================================================================

function renderCases() {
  // Defensive only — see casesRepositoryReadyPromise's doc comment.
  // In normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!casesRepository.isReady()) return;

  var s  = val('searchCases').toLowerCase();
  var st = val('filterCaseStatus');
  var ty = val('filterCaseType');

  syncCasesMirror();

  var queryModel = {};
  if (s) queryModel.search = s;
  var filterObj = {};
  if (st) filterObj['الحالة'] = st;
  if (ty) filterObj['نوع_الدعوى'] = ty;
  if (Object.keys(filterObj).length) queryModel.filter = filterObj;

  // NOTE (audit §4): CasesRepository.search() applies no sort unless
  // queryModel.sort is explicitly passed (which it never is here), so
  // the returned order matches plain insertion/array order — identical
  // to the old `data.cases.filter(...)`'s behavior. Verified directly in
  // js/tests/verify_cases_repository_integration.js.
  var rows = casesRepository.search(queryModel).items;

  var tb = document.getElementById('casesTableBody');
  var em = document.getElementById('casesEmpty');
  var ml = document.getElementById('casesMobileList');
  var cc = document.getElementById('casesCount');

  if (cc) cc.textContent = rows.length > 0 ? rows.length + ' قضية' : 'لا نتائج';

  if (!rows.length) {
    tb.innerHTML = '';
    ml.innerHTML = '';
    // PHASE 16.6 — Keyed DOM Recycling (Pilot) — SAFETY: the two lines
    // above wipe both containers' real children directly (not through
    // DomRecycler), so any key->node references DomKeyIndex is holding
    // for them would now point at detached/dead nodes. Reset both so
    // the next non-empty render starts clean instead of reusing dead
    // references. Additive only — window.DomKeyIndex may be undefined
    // if js/core/dom/ isn't loaded, hence the guard.
    if (window.DomKeyIndex) { DomKeyIndex.reset(tb); DomKeyIndex.reset(ml); }
    em.style.display = '';
    // HOTFIX (workflow correction): a case requires an existing client
    // (see #clientSelectorList in the case form) — guide the user to add
    // a client first when none exist yet.
    var caseStepClient = document.getElementById('casesEmptyStepClient');
    var caseStepCase = document.getElementById('casesEmptyStepCase');
    if (caseStepClient && caseStepCase) {
      if (!data.clients.length) { caseStepClient.style.display = ''; caseStepCase.style.display = 'none'; }
      else { caseStepClient.style.display = 'none'; caseStepCase.style.display = ''; }
    }
    return;
  }
  em.style.display = 'none';

  // ----------------------------------------------------------------
  // PHASE 16.6 — Keyed DOM Recycling (Pilot)
  // ----------------------------------------------------------------
  // desktopRowInner()/mobileCardInner() below are the EXACT SAME markup
  // strings renderCases() has always built for each row/card — moved
  // out of the inline .map() callbacks into named functions so the SAME
  // template logic can be called both by DomRecycler (new path) and by
  // the untouched legacy full-rebuild block (fallback path) with zero
  // duplication of the actual HTML. Only the outer wrapper tags
  // (<tr>...</tr> / <div class="m-card">...</div>) moved: DomRecycler's
  // DomNodeFactory now owns creating that wrapper element; these
  // functions own everything inside it, unchanged.

  function desktopRowInner(c) {
    var ri = resolveCaseIndex(data.cases, c);
    return '<td><strong style="color:var(--gold)">' + escapeHtml(c['رقم_القضية'] || '—') + '</strong></td>' +
      '<td>' + escapeHtml(c['رقم_الدائرة'] || '—') + '</td>' +
      '<td>' + escapeHtml(c['رقم_القاعة'] || '—') + '</td>' +
      '<td>' + escapeHtml(c['عنوان_القضية'] || '—') + '</td>' +
      '<td><small>' + escapeHtml(c['نوع_الدعوى'] || '—') + '</small></td>' +
      '<td>' + escapeHtml(c['اسم_الموكل'] || '—') + '</td>' +
      '<td>' + escapeHtml(c['اسم_الخصم'] || '—') + '</td>' +
      '<td><small>' + escapeHtml(c['المحكمة'] || '—') + '</small></td>' +
      '<td>' + statusBadge(c['الحالة']) + '</td>' +
      '<td>' + (c['تاريخ_الجلسة_القادمة']
        ? urgencyBadge(c['تاريخ_الجلسة_القادمة']) + '<br><small>' + escapeHtml(formatDate(c['تاريخ_الجلسة_القادمة'])) + '</small>'
        : '—') + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editCase(' + ri + ')" title="تعديل">&#9998;</button> ' +
        '<button class="btn btn-success btn-sm btn-icon" onclick="viewCase(' + ri + ')" title="عرض وطباعة القضية">&#128065;</button> ' +
        '<button class="btn btn-info btn-sm btn-icon" onclick="quickPrintCase(' + ri + ')" title="طباعة سريعة">&#128424;</button> ' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="quickCaseQR(' + ri + ')" title="QR بوابة الموكل">&#128275;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteCase(' + ri + ')" title="حذف">&#128465;</button>' +
      '</td>';
  }

  function mobileCardInner(c) {
    var ri = resolveCaseIndex(data.cases, c);
    return '<div class="m-card-header">' +
        '<div class="m-card-title">' + escapeHtml(c['عنوان_القضية'] || '—') + '</div>' +
        '<div class="m-card-num">' + escapeHtml(c['رقم_القضية'] || '—') + '</div>' +
      '</div>' +
      statusBadge(c['الحالة']) + ' <small style="color:var(--muted)">' + escapeHtml(c['نوع_الدعوى'] || '') + '</small>' +
      '<div class="m-card-meta" style="margin-top:7px;">' +
        '<span>&#128100; ' + escapeHtml(c['اسم_الموكل'] || '—') + '</span>' +
        (c['اسم_الخصم'] ? '<span>&#9876; ' + escapeHtml(c['اسم_الخصم']) + '</span>' : '') +
        (c['المحكمة']   ? '<span>&#127963; ' + escapeHtml(c['المحكمة']) + '</span>' : '') +
        (c['رقم_الدائرة'] ? '<span>&#127959; د. ' + escapeHtml(c['رقم_الدائرة']) + '</span>' : '') +
        (c['رقم_القاعة']  ? '<span>&#128682; ق. ' + escapeHtml(c['رقم_القاعة']) + '</span>' : '') +
        (c['تاريخ_الجلسة_القادمة'] ? '<span>&#128197; ' + escapeHtml(formatDate(c['تاريخ_الجلسة_القادمة'])) + '</span>' : '') +
      '</div>' +
      '<div class="m-card-actions" style="flex-wrap:wrap;gap:6px;">' +
        '<button class="btn btn-ghost btn-sm" onclick="editCase(' + ri + ')" style="flex:1;min-width:80px;">&#9998; تعديل</button>' +
        '<button class="btn btn-success btn-sm btn-icon" onclick="viewCase(' + ri + ')" title="عرض">&#128065;</button>' +
        '<button class="btn btn-info btn-sm btn-icon" onclick="quickPrintCase(' + ri + ')" title="طباعة">&#128424;</button>' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="quickCaseQR(' + ri + ')" title="QR الموكل">&#128275;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteCase(' + ri + ')">&#128465;</button>' +
      '</div>';
  }

  function caseRowKey(c) { return c['رقم_القضية']; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      DomRecycler.reconcile(tb, rows, { key: caseRowKey, tag: 'tr', render: desktopRowInner });
      DomRecycler.reconcile(ml, rows, { key: caseRowKey, tag: 'div', className: 'm-card', render: mobileCardInner });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.6 SAFETY: any recycler failure falls straight back to
      // the legacy full-rebuild path below, and drops whatever partial
      // key-index state the failed attempt may have left behind so the
      // NEXT render (recycled or not) never inherits it.
      recycled = false;
      if (window.DomKeyIndex) { DomKeyIndex.reset(tb); DomKeyIndex.reset(ml); }
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.5 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path (brief,
    // "Safety" section). Uses the SAME desktopRowInner()/mobileCardInner()
    // template functions defined above, just with the wrapper tags
    // restored around them.
    tb.innerHTML = rows.map(function(c) {
      return '<tr>' + desktopRowInner(c) + '</tr>';
    }).join('');

    ml.innerHTML = rows.map(function(c) {
      return '<div class="m-card">' + mobileCardInner(c) + '</div>';
    }).join('');
  }
}

// ================================================================
// CRUD — حفظ / تعديل / حذف
// ================================================================

/**
 * saveCase — حفظ قضية جديدة أو تحديث موجودة.
 * The original function is defined here; the override at the bottom
 * of this file wraps it to also persist embedded children JSON.
 *
 * PHASE 9.13: now creates/updates through CasesRepository instead of
 * pushing/assigning directly into data.cases. Two behavior notes:
 *   1. The three-field validation (رقم_القضية/عنوان_القضية/اسم_الموكل)
 *      still runs FIRST, directly against the DOM, before any Repository
 *      call — byte-identical to the pre-migration guard clause.
 *   2. NEW (audit §5/§17.1): رقم_القضية is Cases' natural key.
 *      `data.cases.push(obj)` never used to fail; `casesRepository.
 *      create()` now rejects a duplicate رقم_القضية with a
 *      RepositoryErrorTypes.CONFLICT error. That specific case is
 *      surfaced as its own Arabic toast (distinct from the generic
 *      failure toast) rather than failing silently.
 */
async function saveCase() {
  var num    = document.getElementById('fCaseNum').value.trim();
  var title  = document.getElementById('fCaseTitle').value.trim();
  var client = document.getElementById('fCaseClient').value.trim();

  if (!num || !title || !client) {
    toast('يرجى ملء الحقول الإلزامية', 'error');
    return;
  }

  await ensureCasesRepositoryReady();

  var obj = collectForm('cases');
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();
  obj['آخر_تحديث']     = new Date().toISOString();

  var idx = editIdx.cases;
  var result;

  if (idx >= 0) {
    var existingId = data.cases[idx] ? data.cases[idx][CASES_ID_FIELD] : null;
    result = await casesRepository.update(existingId, obj);
  } else {
    result = await casesRepository.create(obj);
  }

  if (!result || !result.success) {
    if (result && result.error && result.error.type === 'ConflictError') {
      toast('رقم القضية "' + escapeHtml(num) + '" مستخدم بالفعل، يرجى استخدام رقم آخر', 'error');
    } else {
      toast('حدث خطأ أثناء حفظ بيانات القضية', 'error');
    }
    return;
  }

  syncCasesMirror();

  if (idx >= 0) {
    toast('تم تحديث القضية', 'success');
  } else {
    toast('تمت إضافة القضية', 'success');
  }

  saveLocal();

  // Use ApiService instead of direct syncToSheets call
  ApiService.syncRow('القضايا', result.record, idx);

  closeModal('modalCase');
  renderCases();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('cases'); ApplicationShell.markDirty('dashboard'); }
}

/**
 * editCase — فتح نموذج تعديل قضية موجودة.
 * Unchanged, 100% synchronous (audit §16.1 binding constraint —
 * js/modules/clients.js wraps this function again and depends on its
 * DOM effects being visible the instant it returns).
 */
function editCase(i) {
  editIdx.cases = i;
  fillForm('cases', data.cases[i]);
  document.getElementById('modalCaseTitle').textContent = 'تعديل القضية';
  document.getElementById('modalCase').classList.add('open');
}

/**
 * deleteCase — حذف قضية.
 * PHASE 9.13: now deletes through CasesRepository (soft delete — see
 * file header "SOFT DELETE" note) instead of data.cases.splice(i,1).
 * No downstream wrap dependency in clients.js (audit §16.1), so this
 * function may safely become async with no ripple effect.
 */
async function deleteCase(i) {
  if (!confirm('حذف هذه القضية؟')) return;

  await ensureCasesRepositoryReady();

  var record = data.cases[i];
  if (!record) return;

  var id = record[CASES_ID_FIELD];

  // Preserves the ORIGINAL call order (ApiService.deleteData() before the
  // local removal) — see audit §14. ApiService.deleteData() is async and
  // internally catches its own errors (js/api/api.js), so this ordering
  // has no functional effect either before or after migration.
  //
  // KNOWN ARCHITECTURAL LIMITATION (audit §14, documented not fixed):
  // this still passes the plain frontend index `i`, exactly as before
  // migration. See file header note.
  ApiService.deleteData('القضايا', i);

  var result = await casesRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء حذف القضية', 'error');
    return;
  }

  syncCasesMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderCases();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('cases'); ApplicationShell.markDirty('dashboard'); }
}

/**
 * restoreCase(id) — استرجاع قضية محذوفة (Restore).
 * PHASE 10 — SUB-PHASE 10.3 — Cases Restore Pilot.
 * Restores a soft-deleted case through `casesRepository.restore(id)` —
 * the Core capability added in SUB-PHASE 10.2 (js/core/Repository.js,
 * unmodified by this phase; see
 * docs/Repository_Restore_Implementation_Report.md). Symmetric with
 * `deleteCase()` immediately above: same ready-guard, same
 * `syncCasesMirror()` -> `saveLocal()` -> `renderCases()` ->
 * `updateBadges()` refresh sequence, same `WriteResult`
 * success/failure handling and toast pattern — restore is simply
 * delete() reversed, exactly as `Restore_System_Design.md` §3
 * documents `Repository.prototype.restore()` itself to be.
 *
 * ID, NOT INDEX (deliberate, documented divergence from every other
 * action function in this file — audit finding, see
 * docs/Cases_Restore_Integration_Report.md §2 for the full reasoning):
 * `editCase(i)` / `viewCase(i)` / `quickPrintCase(i)` / `quickCaseQR(i)`
 * / `deleteCase(i)` all take a plain `data.cases` array index because
 * the record they act on is always currently VISIBLE in `data.cases`.
 * A soft-deleted case is, by definition, the opposite: `syncCasesMirror()`
 * sources `data.cases` from `casesRepository.getAll()`, which excludes
 * deleted records by default (file header "SOFT DELETE" note) — so a
 * deleted record has no `data.cases[i]` position to translate an index
 * from. `restoreCase()` therefore takes the Repository id (`رقم_القضية`)
 * directly, matching the id-based interface `Restore_System_Design.md`
 * §12-b already specifies for this exact function.
 *
 * NO UI WIRING (Pilot scope, per this phase's instructions): no Trash
 * screen / "restore" button exists anywhere in `index.html` yet
 * (`Restore_System_Design.md` §13 documents Trash as a future, not-yet-
 * built concept) — `index.html` is explicitly out of this phase's
 * scope. `restoreCase(id)` is reachable today from a console call or a
 * test harness, exactly as SUB-PHASE 10.2's own report anticipated
 * ("No UI/Module wiring — no Module calls it yet... SUB-PHASE 10.3+ is
 * the next authorized step").
 *
 * KNOWN LIMITATION / EXPLICIT DESIGN DECISION (documented, not silently
 * resolved — `Restore_System_Architecture.md` §15/§16, T-02): unlike
 * `deleteCase()`, this does NOT call any `ApiService` method.
 * `deleteCase()` calls `ApiService.deleteData()` before the Repository
 * write; the theoretical Sheets-side "undo" would be `ApiService.
 * syncRow()` (an update — the sheet row was never physically removed,
 * only soft-deleted locally). Whether a future `restoreCase()` should
 * call `syncRow()` is an explicitly deferred Module-level decision per
 * the SUB-PHASE 10.1 design docs, out of this minimal Pilot's scope.
 * Left uncalled here, so existing Google Sheets synchronization
 * behavior is completely untouched by this phase.
 *
 * @param {string} id - the CasesRepository id (رقم_القضية) of the
 *   soft-deleted case to restore.
 */
async function restoreCase(id) {
  await ensureCasesRepositoryReady();

  var result = await casesRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء استرجاع القضية', 'error');
    return;
  }

  syncCasesMirror();
  saveLocal();
  toast('تم استرجاع القضية', 'success');
  renderCases();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('cases'); ApplicationShell.markDirty('dashboard'); }
}

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.4 — Cases Undo
// Pilot Integration)
// ================================================================
//
// ARCHITECTURAL NOTE (see docs/Cases_Undo_Pilot_Report.md §3 for the
// full audit trail this summarizes):
//
// `casesRepository.undo()`/`.redo()` (Repository.prototype, SUB-PHASE
// 12.3) forward directly to the wired UndoManager's own `undo()`/
// `redo()`, which return a plain SNAPSHOT INSTRUCTION
// (`{action, before, after, metadata}`) describing what conceptually
// needs to happen — they do NOT themselves mutate `casesRepository`'s
// records (js/core/Repository.js's own doc comment: "Repository itself
// never applies the returned snapshot instructions to its own records
// — that reconciliation is explicitly out of scope for this
// sub-phase"). Without something applying that instruction,
// `undoLastCaseAction()` would toast success and change nothing — a
// fake Undo. Reconciling the instruction into an actual data change is
// exactly this pilot's job, done here in cases.js (the only file this
// phase may modify) using ONLY casesRepository's own already-existing
// public façade (create/update/delete/restore/getUndoManager/
// setUndoManager) — never reaching into `casesUndoManager` or
// js/core/UndoManager.js internals directly.
//
// REVERSAL MAPPING (single-record entries only — bulk/import/clear/
// transaction entries never occur here, since this module never calls
// those Repository methods):
//   'create'  undone -> delete(id)   (soft-delete the created record)
//   'delete'  undone -> restore(id)  (bring the deleted record back)
//   'restore' undone -> delete(id)   (put it back in the trash)
//   'update'  undone -> update(id, before, {allowDeleted:true})
// redo() replays the SAME action forward instead of reversing it:
//   'create'  redone -> restore(id)  (id already exists, soft-deleted
//                                      by the undo above — a plain
//                                      create() would reject it as a
//                                      CONFLICT, so restore() is the
//                                      correct forward replay)
//   'delete'  redone -> delete(id)
//   'restore' redone -> restore(id)
//   'update'  redone -> update(id, after, {allowDeleted:true})
//
// REDO-STACK PROTECTION: applying the reversal above calls a real
// Repository mutation method, which — same as any other call to
// create()/update()/delete()/restore() — unconditionally calls its own
// `_recordUndo()` hook if an UndoManager is wired. Left unguarded, that
// would push a brand-new history entry for the RECONCILIATION step
// itself, and recording anything new unconditionally clears the redo
// stack (js/core/UndoManager.js: "Recording a new entry... always
// clears the redo stack") — silently destroying the very entry
// `undo()` just made available for `redo()`. `_withUndoManagerSuspended()`
// below closes this gap by briefly unwiring `casesUndoManager` (via the
// public `setUndoManager()` façade — never touching the manager
// instance itself) for the duration of the single reconciliation call,
// then re-wiring it immediately after, success or failure.

/**
 * @private PHASE 12.5: thin delegation to the shared
 * `UndoReconciler.applyUndoInstruction()` (js/core/UndoReconciler.js),
 * binding it to `casesRepository`/`CASES_ID_FIELD`. Behavior is
 * byte-identical to SUB-PHASE 12.4's own local implementation (the
 * REVERSAL MAPPING documented above this section was extracted
 * verbatim into UndoReconciler.js — see that file's own header) —
 * this function now exists only to preserve this file's previous
 * internal call shape (`_applyCasesUndoInstruction(instruction,
 * direction)`) for `undoLastCaseAction()`/`redoLastCaseAction()` below.
 * @param {?{action:string, before:?Object, after:?Object, metadata:Object}} instruction
 * @param {'undo'|'redo'} direction
 * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
 */
async function _applyCasesUndoInstruction(instruction, direction) {
  if (!UndoReconciler) {
    return { success: false, record: null, error: { message: 'UndoReconciler is not available (js/core/UndoReconciler.js not loaded)' } };
  }
  return UndoReconciler.applyUndoInstruction(casesRepository, CASES_ID_FIELD, instruction, direction);
}

/**
 * undoLastCaseAction() — PHASE 12.4 Pilot entry point.
 * Reverses the most recent Cases mutation (create/update/delete/
 * restore), following the exact refresh sequence this phase mandates:
 * Repository.undo() -> syncCasesMirror() -> saveLocal() ->
 * renderCases() -> updateBadges() -> toast() -> return. Never touches
 * `casesUndoManager` directly — `casesRepository.canUndo()`/`.undo()`
 * are the only entry points used (Repository remains the façade).
 * Gracefully handles: empty history, a Repository/persist failure while
 * applying the reversal, and any unexpected exception — rendering is
 * never left in a broken state.
 * @returns {Promise<void>}
 */
async function undoLastCaseAction() {
  await ensureCasesRepositoryReady();

  try {
    if (!casesRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = casesRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var result = await _applyCasesUndoInstruction(instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncCasesMirror();
    saveLocal();
    renderCases();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('cases'); ApplicationShell.markDirty('dashboard'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastCaseAction() — PHASE 12.4 Pilot entry point.
 * Re-applies the most recently undone Cases mutation. Same refresh
 * sequence, same façade-only access, same error-handling guarantees as
 * `undoLastCaseAction()` above — see its doc comment for the full
 * rationale.
 * @returns {Promise<void>}
 */
async function redoLastCaseAction() {
  await ensureCasesRepositoryReady();

  try {
    if (!casesRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = casesRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var result = await _applyCasesUndoInstruction(instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncCasesMirror();
    saveLocal();
    renderCases();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('cases'); ApplicationShell.markDirty('dashboard'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

// ================================================================
// CASE STATISTICS — إحصائيات القضايا
// (Consumed by renderDashboard in index.html via data.cases)
// ================================================================

/**
 * getCaseStats — returns a plain object with case counts.
 * Can be used by dashboard or any future stats widget.
 */
function getCaseStats() {
  var total  = data.cases.length;
  var active = data.cases.filter(function(c) {
    return ['نشطة', 'active'].includes(c['الحالة']);
  }).length;
  var closed = data.cases.filter(function(c) {
    return ['منتهية', 'closed'].includes(c['الحالة']);
  }).length;
  var pending = data.cases.filter(function(c) {
    return ['معلقة', 'pending'].includes(c['الحالة']);
  }).length;
  return { total: total, active: active, closed: closed, pending: pending };
}

// ================================================================
// SEARCH & FILTER — البحث والتصفية
// (Implemented inline in renderCases above; these are the
//  event-handler entry points wired from index.html toolbar.)
// ================================================================

/** searchCases — called by oninput on the search field. */
function searchCases() {
  renderCases();
}

/** filterCases — called by onchange on the status/type filters. */
function filterCases() {
  renderCases();
}

// ================================================================
// CASE DETAIL VIEW — عرض تفاصيل القضية
// ================================================================

/**
 * viewCase — opens the full printable case report in modalView.
 */
function viewCase(i) {
  var c = data.cases[i];
  if (!c) return;

  var caseNum = c['رقم_القضية'] || '';

  var sessions = data.sessions.filter(function(s) {
    return s['رقم_القضية'] === caseNum || s['عنوان_القضية'] === (c['عنوان_القضية'] || '');
  }).sort(function(a, b) {
    return (parseLocalDate(a['التاريخ']) || 0) - (parseLocalDate(b['التاريخ']) || 0);
  });

  var docs = data.documents.filter(function(d) {
    return d['رقم_القضية'] === caseNum;
  });

  var children = [];
  try { children = JSON.parse(c['أطفال_القضية'] || '[]'); } catch(e) {}

  // FIX: The new client selector only writes the client name into the case
  // record; it does not autofill the detail fields (NID, phone, address, job,
  // employer).  Back-fill any missing client fields from data.clients so the
  // report always shows the full client record.  We work on a shallow copy so
  // the stored case object is never mutated.
  var clientName = (c['اسم_الموكل'] || '').trim();
  var matchedClientIdx = -1; // إصلاح: زر "QR الموكل" داخل عرض القضية —
                              // نحتاج فهرس الموكل المطابق لتمريره لاحقًا
                              // إلى window._currentViewClientIdx (نفس
                              // المتغيّر الذي تعتمد عليه showClientPortal()،
                              // وكان محسوبًا هنا أصلاً في _ci لكنه لم يُخزَّن).
  if (clientName && data.clients) {
    var firstName = clientName.split(/\s*[,،]\s*/)[0].trim();
    var clientRecord = null;
    for (var _ci = 0; _ci < data.clients.length; _ci++) {
      if ((data.clients[_ci]['الاسم'] || '').trim() === firstName) {
        clientRecord = data.clients[_ci];
        matchedClientIdx = _ci;
        break;
      }
    }
    if (clientRecord) {
      c = Object.assign({}, c);
      if (!c['رقم_قومي_الموكل']) c['رقم_قومي_الموكل'] = clientRecord['الرقم_القومي'] || '';
      if (!c['هاتف_الموكل'])     c['هاتف_الموكل']     = clientRecord['الهاتف']       || '';
      if (!c['عنوان_الموكل'])    c['عنوان_الموكل']    = clientRecord['العنوان']      || '';
      if (!c['عمل_الموكل'])      c['عمل_الموكل']      = clientRecord['الوظيفة']      || '';
      if (!c['جهة_عمل_الموكل']) c['جهة_عمل_الموكل'] = clientRecord['جهة_العمل']    || '';
    }
  }

  var html = buildCaseReport(c, sessions, docs, children);

  document.getElementById('viewModalTitle').innerHTML =
    '&#128065; عرض القضية: ' + escapeHtml(caseNum) + ' — ' + escapeHtml(c['عنوان_القضية'] || '');
  document.getElementById('viewModalBody').innerHTML = html;
  document.getElementById('modalView').classList.add('open');

  // Store for portal button in view modal header
  window._currentViewCase    = c;
  window._currentViewSessions = sessions;
  // إصلاح: بدون هذا السطر يبقى window._currentViewClientIdx بقيمته
  // القديمة (أو undefined) عند فتح قضية مباشرة، فيظهر زر "QR الموكل"
  // رسالة "لم يتم تحديد موكل" رغم ظهور بيانات الموكل كاملة في التقرير.
  window._currentViewClientIdx = matchedClientIdx;
}

/**
 * buildCaseReport — builds the full HTML report string for a case.
 * Used by viewCase() and quickPrintCase().
 */
function buildCaseReport(c, sessions, docs, children) {
  var today = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  // Local status badge (print-safe, doesn't depend on outer statusBadge)
  var sb = function(s) {
    var m = {
      نشطة: 'active-v', active: 'active-v',
      منتهية: 'closed-v', closed: 'closed-v',
      معلقة: 'pending-v', قادمة: 'active-v', مُرجأة: 'pending-v'
    };
    return '<span class="badge-v badge-' + (m[s] || 'pending-v') + '">' + escapeHtml(s) + '</span>';
  };

  var f = function(v, empty) {
    return (v && String(v).trim())
      ? escapeHtml(String(v).trim())
      : '<span class="empty">' + escapeHtml(empty || '—') + '</span>';
  };

  var html = '<div class="view-body" id="viewPrintContent">';

  // Header
  html += '<div class="view-header">' +
    '<div>' +
      '<div class="view-title">&#9878; ملف القضية</div>' +
      '<div class="view-subtitle">' + f(c['عنوان_القضية']) + ' &nbsp;|&nbsp; رقم قيد الدعوى بالمحكمة: ' + f(c['رقم_القضية']) + '</div>' +
    '</div>' +
    '<div class="view-office">' +
      '<strong>مكتب المحامي</strong><br>' + sb(c['الحالة'] || 'نشطة') + '<br><small>' + today + '</small>' +
    '</div>' +
  '</div>';

  // البيانات الأساسية
  html += '<div class="view-section"><div class="view-section-title">&#128203; البيانات الأساسية</div><div class="view-grid">';
  html += vf('نوع الدعوى', c['نوع_الدعوى']) +
          vf('المحكمة', c['المحكمة']) +
          vf('رقم الدائرة', c['رقم_الدائرة']) +
          vf('رقم القاعة', c['رقم_القاعة']) +
          vf('رقم الدعوى', c['رقم_الدعوى']) +
          vf('تاريخ القيد', formatDate(c['تاريخ_القيد'])) +
          vf('الجلسة القادمة', formatDate(c['تاريخ_الجلسة_القادمة'])) +
          vf('أتعاب المحاماة', c['أتعاب_المحاماة'] ? c['أتعاب_المحاماة'] + ' ج.م' : '');
  html += '</div></div>';

  // الموكل
  html += '<div class="view-section"><div class="view-section-title">&#128100; بيانات الموكل (' + f(c['نوع_الموكل']) + ')</div><div class="view-grid">';
  html += vf('الاسم', c['اسم_الموكل']) +
          vf('الرقم القومي', c['رقم_قومي_الموكل']) +
          vf('الهاتف', c['هاتف_الموكل']) +
          vf('العنوان', c['عنوان_الموكل']) +
          vf('الوظيفة', c['عمل_الموكل']) +
          vf('جهة العمل', c['جهة_عمل_الموكل']);
  html += '</div></div>';

  // الخصم
  if (c['اسم_الخصم']) {
    html += '<div class="view-section"><div class="view-section-title">&#128100; بيانات الخصم</div><div class="view-grid">';
    html += vf('الاسم', c['اسم_الخصم']) +
            vf('الرقم القومي', c['رقم_قومي_الخصم']) +
            vf('الهاتف', c['هاتف_الخصم']) +
            vf('العنوان', c['عنوان_الخصم']) +
            vf('الوظيفة', c['عمل_الخصم']) +
            vf('جهة العمل', c['جهة_عمل_الخصم']);
    html += '</div></div>';
  }

  // بيانات الزواج (أحوال شخصية)
  if (c['تاريخ_عقد_الزواج'] || c['رقم_وثيقة_الزواج']) {
    html += '<div class="view-section"><div class="view-section-title">&#128141; بيانات الزواج</div><div class="view-grid">';
    html += vf('تاريخ عقد الزواج', formatDate(c['تاريخ_عقد_الزواج'])) +
            vf('رقم الوثيقة', c['رقم_وثيقة_الزواج']) +
            vf('مكتب التوثيق', c['مكتب_التوثيق']) +
            vf('قائمة المنقولات', c['وجود_قائمة_منقولات']);
    html += '</div></div>';
  }

  // الأطفال
  if (children.length > 0) {
    html += '<div class="view-section"><div class="view-section-title">&#128118; الأطفال</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
      '<tr style="background:#f5f0e8;">' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">الاسم</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">السن</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">الحضانة</th>' +
      '</tr>';
    children.forEach(function(ch) {
      html += '<tr>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(ch.name) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + (ch.age ? escapeHtml(ch.age) + ' سنة' : '—') + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(ch.custody) + '</td>' +
      '</tr>';
    });
    html += '</table></div>';
  }

  // الطلبات والدفوع
  if (c['الطلبات_القانونية'] || c['الدفوع_القانونية']) {
    html += '<div class="view-section"><div class="view-section-title">&#128220; الطلبات والدفوع</div>';
    if (c['الطلبات_القانونية'])
      html += '<div class="view-field-full"><div class="view-label">الطلبات القانونية</div><div class="view-value">' + escapeHtml(c['الطلبات_القانونية']) + '</div></div>';
    if (c['الدفوع_القانونية'])
      html += '<div class="view-field-full"><div class="view-label">الدفوع القانونية</div><div class="view-value">' + escapeHtml(c['الدفوع_القانونية']) + '</div></div>';
    if (c['إجراءات_الدعوى'])
      html += '<div class="view-field-full"><div class="view-label">إجراءات الدعوى</div><div class="view-value">' + escapeHtml(c['إجراءات_الدعوى']) + '</div></div>';
    html += '</div>';
  }

  // سجل الجلسات
  html += '<div class="view-section"><div class="view-section-title">&#128197; سجل الجلسات (' + sessions.length + ' جلسة)</div>';
  if (!sessions.length) {
    html += '<div style="padding:14px;color:#888;font-size:12px;">لا توجد جلسات مسجلة لهذه القضية</div>';
  } else {
    sessions.forEach(function(s, idx) {
      var d = parseLocalDate(s['التاريخ']);
      var dayStr = d
        ? d.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        : '—';
      var statusCls = s['الحالة'] === 'منتهية' ? 'closed-v'
                    : s['الحالة'] === 'قادمة'   ? 'active-v'
                    : 'pending-v';
      html += '<div class="session-row">' +
        '<div class="session-num">' + (idx + 1) + '</div>' +
        '<div class="session-detail">' +
          '<div class="session-detail-title">&#128197; ' + dayStr +
            ' &nbsp; <span style="font-size:11px;font-weight:400;">الساعة ' + formatTime(s['الوقت']) + '</span>' +
          '</div>' +
          '<div class="session-detail-meta">' +
            '<span>&#127963; ' + escapeHtml(s['المحكمة'] || '—') + '</span>' +
            (s['القاضي'] ? '<span>&#128100; القاضي: ' + escapeHtml(s['القاضي']) + '</span>' : '') +
            '<span class="badge-v badge-' + statusCls + '">' + escapeHtml(s['الحالة'] || '—') + '</span>' +
          '</div>' +
          (s['ما_تم_في_الجلسة'] ? '<div style="font-size:12px;color:#444;margin-top:4px;">&#128221; ' + escapeHtml(s['ما_تم_في_الجلسة']) + '</div>' : '') +
          (s['القرار']          ? '<div class="session-decision">&#9878; القرار: ' + escapeHtml(s['القرار']) + '</div>' : '') +
          (s['التأجيل_إلى']     ? '<div class="session-next">&#128197; سبب التأجيل / التأجيل إلى: ' + escapeHtml(formatDate(s['التأجيل_إلى'])) + (s['الملاحظات'] ? ' — ' + escapeHtml(s['الملاحظات']) : '') + '</div>' : '') +
        '</div>' +
      '</div>';
    });
  }
  html += '</div>';

  // الأحكام والتنفيذ
  if (c['قرارات_المحكمة'] || c['تاريخ_الحكم'] || c['رقم_التنفيذ']) {
    html += '<div class="view-section"><div class="view-section-title">&#128296; الأحكام والتنفيذ</div><div class="view-grid">';
    if (c['قرارات_المحكمة'])
      html += '<div class="view-field-full"><div class="view-label">قرارات المحكمة</div><div class="view-value">' + escapeHtml(c['قرارات_المحكمة']) + '</div></div>';
    html += vf('تاريخ الحكم', formatDate(c['تاريخ_الحكم'])) + vf('رقم التنفيذ', c['رقم_التنفيذ']);
    if (c['إجراءات_التنفيذ'])
      html += '<div class="view-field-full"><div class="view-label">إجراءات التنفيذ ونتائجه</div><div class="view-value">' + escapeHtml(c['إجراءات_التنفيذ']) + '</div></div>';
    html += '</div></div>';
  }

  // المستندات
  if (docs.length > 0) {
    html += '<div class="view-section"><div class="view-section-title">&#128206; المستندات المودعة</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
      '<tr style="background:#f5f0e8;">' +
        '<th style="padding:7px 10px;border:1px solid #e8e0d0;text-align:right;">المستند</th>' +
        '<th style="padding:7px 10px;border:1px solid #e8e0d0;text-align:right;">النوع</th>' +
        '<th style="padding:7px 10px;border:1px solid #e8e0d0;text-align:right;">تاريخ الإيداع</th>' +
        '<th style="padding:7px 10px;border:1px solid #e8e0d0;text-align:right;">الرابط</th>' +
      '</tr>';
    docs.forEach(function(d) {
      html += '<tr>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;font-weight:700;">' + f(d['اسم_المستند']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(d['نوع_المستند']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(formatDate(d['تاريخ_الإيداع'])) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' +
          (d['رابط_Drive'] ? '<a href="' + escapeHtml(d['رابط_Drive']) + '" style="color:#2980b9;">&#128279; عرض</a>' : '—') +
        '</td>' +
      '</tr>';
    });
    html += '</table></div>';
  }

  // ملاحظات المحامي
  if (c['الملاحظات'])
    html += '<div class="view-section"><div class="view-section-title">&#128221; ملاحظات المحامي</div>' +
            '<div class="view-field-full"><div class="view-value">' + escapeHtml(c['الملاحظات']) + '</div></div></div>';

  html += '<div class="view-footer">' +
    '<span>نظام دعم المحامي — المدى الهندسية</span>' +
    '<span>تاريخ الطباعة: ' + today + '</span>' +
  '</div>';

  html += '</div>';
  return html;
}

/**
 * vf — helper: renders a single view-field div (label + value).
 * Only used by buildCaseReport; defined here to keep it scoped.
 */
function vf(label, val) {
  var v = (val && String(val).trim())
    ? escapeHtml(String(val).trim())
    : '<span class="empty">—</span>';
  return '<div class="view-field"><div class="view-label">' + escapeHtml(label) + '</div><div class="view-value">' + v + '</div></div>';
}

// ================================================================
// QUICK PRINT — طباعة سريعة من قائمة القضايا
// ================================================================

/**
 * quickPrintCase — opens a standalone print window for a case
 * without opening the view modal first.
 */
function quickPrintCase(i) {
  var c = data.cases[i];
  if (!c) return;

  var caseNum  = c['رقم_القضية'] || '';
  var sessions = data.sessions.filter(function(s) {
    return s['رقم_القضية'] === caseNum || s['عنوان_القضية'] === (c['عنوان_القضية'] || '');
  }).sort(function(a, b) {
    return (parseLocalDate(a['التاريخ']) || 0) - (parseLocalDate(b['التاريخ']) || 0);
  });
  var docs = data.documents.filter(function(d) { return d['رقم_القضية'] === caseNum; });
  var children = [];
  try { children = JSON.parse(c['أطفال_القضية'] || '[]'); } catch(e) {}

  var body = buildCaseReport(c, sessions, docs, children);

  var printContent =
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0;}' +
    'body{font-family:Cairo,Arial,sans-serif;background:#fff;color:#111;direction:rtl;}' +
    '@page{size:A4;margin:15mm;}' +
    '@media print{body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}' +
    '.view-section-title{background:#0D1B2A!important;color:#C9A84C!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
    '.session-num{background:#f5f0e8!important;color:#C9A84C!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
    '.badge-active-v{background:#d5f5e3!important;color:#1e8449!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
    '.badge-closed-v{background:#eaecee!important;color:#717d7e!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
    '.badge-pending-v{background:#fdebd0!important;color:#a04000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
    '}' +
    '.view-body{padding:20px;background:#fff;color:#111;font-family:Cairo,Arial,sans-serif;direction:rtl;}' +
    '.view-header{border-bottom:3px solid #C9A84C;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;}' +
    '.view-office{font-size:11px;color:#888;text-align:left;}' +
    '.view-title{font-size:20px;font-weight:900;color:#0D1B2A;}' +
    '.view-subtitle{font-size:13px;color:#555;margin-top:3px;}' +
    '.view-section{margin-bottom:18px;border:1px solid #e8e0d0;border-radius:8px;overflow:hidden;}' +
    '.view-section-title{background:#0D1B2A;color:#C9A84C;font-size:12px;font-weight:700;padding:8px 14px;letter-spacing:1px;}' +
    '.view-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;}' +
    '.view-field{padding:9px 14px;border-bottom:1px solid #f0ece4;}' +
    '.view-field:nth-child(odd){border-left:1px solid #f0ece4;}' +
    '.view-field-full{padding:9px 14px;border-bottom:1px solid #f0ece4;grid-column:1/-1;}' +
    '.view-label{font-size:10px;font-weight:700;color:#888;margin-bottom:3px;}' +
    '.view-value{font-size:13px;color:#111;font-weight:600;}' +
    '.view-value.empty{color:#bbb;font-weight:400;}' +
    '.session-row{display:grid;grid-template-columns:80px 1fr;gap:0;border-bottom:1px solid #f0ece4;}' +
    '.session-row:last-child{border-bottom:none;}' +
    '.session-num{background:#f5f0e8;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:#C9A84C;border-left:1px solid #e8e0d0;}' +
    '.session-detail{padding:10px 14px;}' +
    '.session-detail-title{font-size:13px;font-weight:700;color:#0D1B2A;margin-bottom:4px;}' +
    '.session-detail-meta{font-size:11px;color:#888;margin-bottom:4px;display:flex;gap:10px;flex-wrap:wrap;}' +
    '.session-decision{font-size:12px;color:#C9A84C;font-weight:700;margin-top:4px;}' +
    '.session-next{font-size:11px;color:#2980B9;margin-top:2px;}' +
    '.badge-v{display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;}' +
    '.badge-active-v{background:#d5f5e3;color:#1e8449;}' +
    '.badge-closed-v{background:#eaecee;color:#717d7e;}' +
    '.badge-pending-v{background:#fdebd0;color:#a04000;}' +
    '.badge-urgent-v{background:#fadbd8;color:#922b21;}' +
    '.view-footer{margin-top:18px;padding-top:12px;border-top:2px solid #C9A84C;display:flex;justify-content:space-between;font-size:10px;color:#999;}' +
    'table{width:100%;border-collapse:collapse;font-size:12px;}' +
    'th,td{padding:7px 10px;border:1px solid #e8e0d0;text-align:right;}' +
    'th{background:#f5f0e8;color:#8B6914;font-weight:700;}' +
    '</style></head><body>' +
    body +
    '</body></html>';

  var win = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
  if (!win) { toast('فعّل النوافذ المنبثقة للطباعة', 'error'); return; }
  win.document.open();
  win.document.write(printContent);
  win.document.close();
  win.focus();
  // إصلاح (تعليق الطباعة إلى ما لا نهاية): كان الكود القديم يستخدم
  // window.onload لتشغيل الطباعة، وهذا ينتظر تحميل كل موارد الصفحة
  // بما فيها خط Cairo الخارجي من Google Fonts — لو الاتصال بطيء أو
  // تعطّل تحميل الخط، لا يُطلق onload أبدًا وتظل النافذة "تحمّل" للأبد.
  // الحل: نفس أسلوب printView() (clients.js) الموثوق — انتظار نصف
  // ثانية فقط ثم الطباعة مباشرة، بغض النظر عن اكتمال تحميل الخط.
  setTimeout(function() { win.print(); }, 600);
}

// ================================================================
// QUICK QR FROM CASES LIST — QR الموكل من قائمة القضايا
// ================================================================

/**
 * quickCaseQR — finds the client linked to a case and calls genClientQR.
 */
function quickCaseQR(i) {
  var c = data.cases[i];
  if (!c) { toast('القضية غير موجودة', 'error'); return; }

  var clientName = c['اسم_الموكل'] || '';
  if (!clientName) { toast('لا يوجد اسم موكل لهذه القضية', 'info'); return; }

  var ci = -1;
  for (var x = 0; x < data.clients.length; x++) {
    if ((data.clients[x]['الاسم'] || '').trim() === clientName.trim()) { ci = x; break; }
  }

  if (ci < 0) {
    toast('الموكل "' + escapeHtml(clientName) + '" غير مسجل في قسم الموكلين — أضفه أولاً لتفعيل QR', 'info');
    return;
  }

  genClientQR(ci);
}

// ================================================================
// CHILDREN SECTION inside Case Modal
// ================================================================

/**
 * toggleChildrenSection — shows/hides the children rows section
 * based on the "وجود أطفال" select value.
 */
function toggleChildrenSection() {
  var v = document.getElementById('fCaseHasChildren').value;
  document.getElementById('childrenSectionDiv').style.display = (v === 'نعم') ? '' : 'none';
}

/**
 * addChildRow — appends a child entry row inside the case modal.
 * @param {Object} [childData] - Optional prefill: { name, age, custody }
 */
function addChildRow(childData) {
  childData = childData || {};
  var d   = document.getElementById('childrenRows');
  var row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr) 30px;gap:7px;margin-bottom:7px;align-items:end;';
  row.innerHTML =
    '<div><label style="font-size:10px;color:var(--muted);">الاسم</label>' +
      '<input type="text" value="' + escapeHtml(childData.name || '') + '" placeholder="اسم الطفل" onchange="updateChildrenData()"></div>' +
    '<div><label style="font-size:10px;color:var(--muted);">السن</label>' +
      '<input type="number" value="' + escapeHtml(childData.age || '') + '" placeholder="السن" min="0" max="25" onchange="updateChildrenData()"></div>' +
    '<div><label style="font-size:10px;color:var(--muted);">الحضانة</label>' +
      '<select onchange="updateChildrenData()">' +
        '<option value="">—</option>' +
        '<option' + (childData.custody === 'مع الأم' ? ' selected' : '') + '>مع الأم</option>' +
        '<option' + (childData.custody === 'مع الأب' ? ' selected' : '') + '>مع الأب</option>' +
        '<option' + (childData.custody === 'مشتركة'  ? ' selected' : '') + '>مشتركة</option>' +
      '</select></div>' +
    '<button type="button" class="btn btn-danger btn-icon btn-sm" onclick="this.parentNode.remove();updateChildrenData();">&#10005;</button>';
  d.appendChild(row);
  updateChildrenData();
}

/**
 * updateChildrenData — serialises current child rows into the
 * hidden fCaseChildrenData field as JSON.
 */
function updateChildrenData() {
  var rows = document.getElementById('childrenRows').children;
  var arr  = [];
  for (var i = 0; i < rows.length; i++) {
    var inputs = rows[i].querySelectorAll('input,select');
    arr.push({ name: inputs[0].value, age: inputs[1].value, custody: inputs[2].value });
  }
  document.getElementById('fCaseChildrenData').value = JSON.stringify(arr);
}

/**
 * loadChildrenRows — deserialises saved children JSON and rebuilds rows.
 * @param {string} jsonStr
 */
function loadChildrenRows(jsonStr) {
  document.getElementById('childrenRows').innerHTML = '';
  try {
    var arr = JSON.parse(jsonStr || '[]');
    arr.forEach(function(c) { addChildRow(c); });
  } catch(e) {}
}

// ================================================================
// OVERRIDE saveCase to persist embedded children JSON
// ================================================================
// The base saveCase() above calls collectForm('cases') which (via
// the collectForm override below) will attach أطفال_القضية.
// We wrap saveCase so children data is harvested before collectForm runs.
//
// PHASE 9.13 note: the base saveCase() is now async (Repository.create()/
// update() are Promise-returning). `return`ing _origSaveCase()'s promise
// here costs nothing and fixes a real bug: without it, `await saveCase()`
// from anywhere within this file (or this file's own Node test harness)
// would resolve before the create/update actually finished, since a
// wrapper with no `return` produces `undefined`, and `await undefined`
// resolves on the very next microtask regardless of what the wrapped
// call is still doing. This has NO effect on the existing
// onclick="saveCase()" HTML handler (still fire-and-forget, exactly as
// before) or on js/modules/clients.js's own further wrap of this same
// function (out of scope for this phase, also still fire-and-forget,
// unchanged) — both already ignore any return value, same as when
// saveCase() was fully synchronous.
var _origSaveCase = saveCase;
saveCase = function() {
  updateChildrenData();
  var childrenJson = document.getElementById('fCaseChildrenData');
  window._pendingChildren = childrenJson ? childrenJson.value : '[]';
  return _origSaveCase();
};

// ================================================================
// OVERRIDE collectForm — inject children into cases object
// ================================================================
var _origCollect = collectForm;
collectForm = function(type) {
  var obj = _origCollect(type);
  if (type === 'cases' && window._pendingChildren) {
    obj['أطفال_القضية'] = window._pendingChildren;
    window._pendingChildren = null;
  }
  return obj;
};

// ================================================================
// OVERRIDE fillForm — restore children rows when editing a case
// ================================================================
var _origFill = fillForm;
fillForm = function(type, obj) {
  _origFill(type, obj);
  if (type === 'cases') {
    var hasChildren = document.getElementById('fCaseHasChildren');
    var childrenData = obj['أطفال_القضية'] || '[]';
    if (hasChildren && hasChildren.value === 'نعم') {
      document.getElementById('childrenSectionDiv').style.display = '';
      loadChildrenRows(childrenData);
    }
  }
};

// ================================================================
// OVERRIDE resetForm — repopulate case dropdowns in other modules
// after reset clears them.
// ================================================================
var _origResetForm = resetForm;
resetForm = function(type) {
  _origResetForm(type);
  var dropdownMap = {
    sessions:  'fSessionCaseNum',
    documents: 'fDocCaseNum',
    fees:      'fFeeCaseNum',
    children:  'fChildCaseNum'
  };
  if (dropdownMap[type]) {
    populateCaseDropdown(dropdownMap[type]);
  }
};

// ================================================================
// populateCaseDropdown — تعبئة قائمة القضايا في النماذج الأخرى
// (sessions, documents, fees, children)
// ================================================================

/**
 * populateCaseDropdown — fills a <select> with all cases.
 * @param {string} selectId    - ID of the target <select>
 * @param {string} [selectedVal] - Optional value to pre-select
 */
function populateCaseDropdown(selectId, selectedVal) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  var current = selectedVal || sel.value;
  sel.innerHTML = '<option value="">-- اختر القضية --</option>';
  data.cases.forEach(function(c) {
    var num   = c['رقم_القضية'] || '';
    var title = c['عنوان_القضية'] || '';
    var opt   = document.createElement('option');
    opt.value       = num;
    opt.textContent = num + (title ? ' — ' + title : '');
    if (num === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ================================================================
// autofillSessionFromCase — تعبئة تلقائية لنموذج الجلسة
// Shared helper kept here because it reads data.cases.
// ================================================================

/**
 * autofillSessionFromCase — pre-fills court/type/title in the
 * session modal when a case is selected.
 * @param {string}  caseNum
 * @param {boolean} [skipCourt] - If true, don't overwrite court field
 */
function autofillSessionFromCase(caseNum, skipCourt) {
  if (!caseNum) return;
  var c = data.cases.find(function(x) { return x['رقم_القضية'] === caseNum; });
  if (!c) return;

  var titleEl = document.getElementById('fSessionCaseTitle');
  var typeEl  = document.getElementById('fSessionCaseType');
  var courtEl = document.getElementById('fSessionCourt');
  var circuitEl = document.getElementById('fSessionCircuit');
  var roomEl    = document.getElementById('fSessionRoom');

  if (titleEl && !titleEl.value)            titleEl.value = c['عنوان_القضية'] || '';
  else if (titleEl && !skipCourt)           titleEl.value = c['عنوان_القضية'] || '';

  if (typeEl && !typeEl.value)              typeEl.value  = c['نوع_الدعوى'] || '';
  else if (typeEl && !skipCourt)            typeEl.value  = c['نوع_الدعوى'] || '';

  if (courtEl && !courtEl.value && !skipCourt) courtEl.value = c['المحكمة'] || '';

  if (circuitEl && !circuitEl.value && !skipCourt) circuitEl.value = c['رقم_الدائرة'] || '';
  if (roomEl && !roomEl.value && !skipCourt)       roomEl.value    = c['رقم_القاعة'] || '';
}

// ================================================================
// autofillFeeFromCase — تعبئة اسم الموكل من القضية لنموذج الأتعاب
// ================================================================

/**
 * autofillFeeFromCase — pre-fills the client name in the fee modal.
 * @param {string} caseNum
 */
function autofillFeeFromCase(caseNum) {
  if (!caseNum) return;
  var c = data.cases.find(function(x) { return x['رقم_القضية'] === caseNum; });
  if (!c) return;
  var clientEl = document.getElementById('fFeeClient');
  if (clientEl) clientEl.value = c['اسم_الموكل'] || '';
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// every function above remains a plain global function exactly as
// before). Mirrors js/modules/clients.js's export block (Sub-Phase
// 9.11), extended for Cases' own additional functions the integration
// test harness (js/tests/verify_cases_repository_integration.js) and
// regression suite need to reach directly.
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CASES_FIELDS: CASES_FIELDS,
    CASES_MAP: CASES_MAP,
    CASES_ID_FIELD: CASES_ID_FIELD,
    casesRepository: casesRepository,
    ensureCasesRepositoryReady: ensureCasesRepositoryReady,
    syncCasesMirror: syncCasesMirror,
    resolveCaseIndex: resolveCaseIndex,
    renderCases: renderCases,
    searchCases: searchCases,
    filterCases: filterCases,
    saveCase: saveCase,
    editCase: editCase,
    deleteCase: deleteCase,
    restoreCase: restoreCase,
    casesUndoManager: casesUndoManager,
    undoLastCaseAction: undoLastCaseAction,
    redoLastCaseAction: redoLastCaseAction,
    getCaseStats: getCaseStats,
    viewCase: viewCase,
    buildCaseReport: buildCaseReport,
    quickPrintCase: quickPrintCase,
    quickCaseQR: quickCaseQR,
    toggleChildrenSection: toggleChildrenSection,
    addChildRow: addChildRow,
    updateChildrenData: updateChildrenData,
    loadChildrenRows: loadChildrenRows,
    populateCaseDropdown: populateCaseDropdown,
    autofillSessionFromCase: autofillSessionFromCase,
    autofillFeeFromCase: autofillFeeFromCase,
    resetForm: resetForm
  };
}
