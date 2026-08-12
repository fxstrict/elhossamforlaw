/**
 * ================================================================
 * js/modules/clients.js — وحدة الموكلين | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Clients-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.11 below: a new
 * `restoreClient(id)` function (see its own doc comment, next to
 * `deleteClient()`) that calls the `clientsRepository.restore(id)` Core
 * capability added in SUB-PHASE 10.2 (js/core/Repository.js, itself NOT
 * modified by this phase), following the exact pattern piloted on Cases
 * in SUB-PHASE 10.3. No existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.11 — Repository Integration
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * ClientsRepository.js instead of the legacy global `data.clients` array
 * directly. Nothing else in the project was changed to make this happen:
 * ClientsRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This mirrors the pattern
 * already proven in js/modules/documents.js (Sub-Phase 9.3) and seven
 * other sibling modules (children, sessions, tasks, fees, library,
 * templates) — see docs/Clients_Repository_Integration_Audit.md for the
 * full pre-migration analysis this phase executes.
 *
 * WHY `data.clients` STILL EXISTS BELOW
 *   js/modules/cases.js (linear scans of `data.clients` in the report
 *   backfill and in quickCaseQR()) and js/modules/dashboard.js
 *   (`data.clients.length`, twice) both read the global `data.clients`
 *   array directly, and this phase's mandate is "Modify ONLY clients.js"
 *   — neither of those modules may be touched. So `data.clients` is kept
 *   alive as a read-only MIRROR of `ClientsRepository.getAll()`,
 *   refreshed after every Repository read/write this file performs.
 *   Every other module keeps working unmodified and unaware that Clients
 *   moved to the Repository.
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderClients`) call the Repository's SYNCHRONOUS methods
 *     only (`search()`, `getAll()`) — no unnecessary async.
 *   - Writes (`saveClient`, `deleteClient`, `revokeAndRegenQR`) are the
 *     ONLY functions in this file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *     Clients has THREE write call sites (one more than Documents'
 *     two), because revokeAndRegenQR() is a second, independent write
 *     path into client records that bypasses saveClient() entirely.
 *   - `editClient`/`viewClient`/`printClientFile`/`genClientQR`/
 *     `showClientPortal` stay 100% synchronous and unchanged: they only
 *     read the already-synced `data.clients` mirror, exactly like before.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editClient(N)"` / `onclick="deleteClient(N)"` /
 *   `onclick="viewClient(N)"` / `onclick="genClientQR(N)"` attributes
 *   (index.html's row templates were not changed, per this phase's rule
 *   "Do NOT modify HTML"). Because ClientsRepository.search()/getAll()
 *   return CLONED records (not the same object references `data.clients`
 *   used to hold), the old `data.clients.indexOf(c)` reference-equality
 *   trick no longer works. `resolveClientIndex()` below is the smallest
 *   possible replacement: it looks a record up in the current mirror by
 *   its identifier field (`رقم_الموكل`) instead of by reference.
 *   `editClient(i)`/`viewClient(i)`/`printClientFile(i)`/`genClientQR(i)`
 *   then resolve that same index back to a record, and only
 *   `saveClient`/`deleteClient`/`revokeAndRegenQR` go one step further
 *   and resolve the record to its `رقم_الموكل` id before calling
 *   `ClientsRepository.update()/create()/delete()` (which take an id or
 *   a full record, not an index).
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   ClientsRepository is configured with `softDelete: true` (unchanged,
 *   not this phase's decision to make). `delete(id)` therefore keeps the
 *   record in storage with a `deletedAt` stamp instead of physically
 *   removing it, unlike the original `data.clients.splice(i,1)`.
 *   `getAll()`/`search()` both exclude soft-deleted records by default,
 *   so nothing deleted ever reappears anywhere `data.clients` is read
 *   (this file, cases.js, dashboard.js) — the UI-observable behavior is
 *   therefore identical to a hard delete. See
 *   docs/Clients_Repository_Integration_Report.md §5/§6 for the full
 *   analysis of what this means for the raw localStorage payload and for
 *   ApiService's row-index assumption (R-06, documented not fixed).
 *
 * KNOWN ARCHITECTURAL LIMITATION — NOT FIXED THIS PHASE (audit R-06)
 *   `ApiService.deleteData()`/`updateData()`/`syncRow()` all send a
 *   0-based `rowIndex` (+1 for the GAS header row) on the assumption
 *   that the frontend array position equals the backend sheet row. This
 *   assumption was already fragile before this migration (any out-of-
 *   band sheet edit breaks it) but was at least internally consistent
 *   because `data.clients` was hard-delete/append-only and index-stable
 *   within a session. Now that soft-delete semantics are introduced via
 *   ClientsRepository, `data.clients` (sourced from `getAll()`) omits
 *   soft-deleted rows while the Repository's own underlying storage
 *   array still contains them (with a `deletedAt` stamp) at their
 *   original position. This phase does NOT change what value is passed
 *   to ApiService for Clients — per the audit's explicit recommendation
 *   (§9 Step 5), the drift is accepted as an already-latent,
 *   pre-existing architectural gap and documented here and in the
 *   integration report, not silently patched.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data          : shared app data object  { clients, cases, sessions, fees, … }
 *   - editIdx       : shared edit-index map   { clients: -1 }
 *   - ApiService    : api.js layer  (replaces direct syncToSheets / syncDeleteToSheets)
 *   - saveLocal()   : localStorage persistence helper
 *   - toast()       : UI notification helper
 *   - updateBadges(): badge counter updater
 *   - closeModal()  : modal close helper
 *   - formatDate()  : date formatter  (from ui-utils.js)
 *   - val()         : getElementById + .value helper  (from ui-utils.js)
 *   - uid()         : unique-ID generator  (from ui-utils.js)
 *   - collectForm() : generic form-to-object helper  (from ui-utils.js)
 *   - fillForm()    : generic object-to-form helper  (from ui-utils.js)
 *   - resetForm()   : generic form-reset helper  (from ui-utils.js)
 *   - ClientsRepository : js/repositories/ClientsRepository.js (new this
 *                         phase — loaded the same dual Node/browser way
 *                         every Repository file already loads its own
 *                         dependencies)
 *
 * Sheet name (GAS):  'الموكلين'
 *
 * Does NOT touch:
 *   - Cases, Sessions, Documents, Tasks, Fees, Calendar, Library,
 *     Templates, Settings, Children
 *   - CSS / HTML structure
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/ClientsRepository.js
 * ================================================================
 */

/**
 * ================================================================
 * PHASE 13.18 — SECURITY PART 3/4 — INDEPENDENT VERIFICATION
 * ================================================================
 * An independent re-audit of every HTML/attribute/document.write sink
 * in this file (not a re-read of the prior phase's report) was
 * performed line-by-line: `innerHTML` assignments in `renderClients()`,
 * `buildClientReport()`, `displayPortalModal()`, `renderClientSelectorList()`,
 * `renderClientSelectorChips()`; the `document.write()` calls in
 * `printClientFile()`, `printClientsReport()`, `printView()`; every
 * `onclick=`/`onchange=` inline-handler string; and the `<img src>`
 * built in `displayPortalModal()`.
 *
 * FINDING 1 (CONFIRMED — informational, no fix needed): every one of
 * the sinks above already passes user-/Repository-originated values
 * through `escapeHtml()` (HTML/attribute contexts), `sanitizeClientUrl()`
 * (URL-scheme contexts), `_attrSafeJSString()` (inline-handler JS-string
 * contexts), or plain `textContent` assignment. No unescaped
 * interpolation of client, case, or fee data into HTML was found in
 * this file.
 *
 * FINDING 2 (CONFIRMED — low severity, FIXED this phase): `_attrSafeJSString()`
 * relied solely on `JSON.stringify()` plus `&`/`"` escaping. `JSON.stringify()`
 * does not escape U+2028/U+2029, which pre-ES2019 JS engines can treat
 * as string-terminating characters inside a string literal. Hardened
 * by escaping both to their `\uXXXX` form (see `_attrSafeJSString()`
 * below) — additive only, no change to any other character's handling
 * or to any call site's observable output for ordinary input.
 *
 * SCOPE: This phase modifies ONLY `js/modules/clients.js`, and only
 * the two lines described in Finding 2 plus this note. No other
 * function, no HTML, no other file was touched.
 * ================================================================
 */

'use strict';

// ================================================================
// SECURITY — PHASE 13.18 (SECURITY PART 3/4)
// ================================================================
// Local, dependency-free HTML/URL escaping helpers. No other file in
// the project defines a shared escapeHtml() this module can reuse
// (js/modules/cases.js — SECURITY PART 2 — defines its own local
// copy the same way, not exported), so — per this phase's explicit
// instruction ("If the file has no escaping helper, create ONE local
// helper. Do NOT import libraries.") — a local copy is declared here.
//
// Every value that reaches HTML, an HTML attribute, or a template
// literal inside this file and originates from the Repository/
// Google Sheet/user input (client records, case records, fee
// records) MUST be passed through escapeHtml() first. Values placed
// into `.textContent` do NOT need escaping (the DOM already treats
// them as plain text) and are intentionally left as-is.

/**
 * escapeHtml — escapes the five HTML-significant characters so a
 * value can be safely interpolated into an HTML string (text node or
 * attribute value). Mirrors the escaping used by cases.js's own local
 * helper (SECURITY PART 2) so both modules produce identical output
 * for identical input.
 * @param {*} value
 * @returns {string}
 */
/**
 * _cfParseArr — safely parses a JSON-array field written by
 * js/modules/client-fields.js (أرقام_الهواتف/العناوين/التوكيلات/
 * المستندات/المديرين). Returns [] for empty/legacy/malformed values so
 * every caller below stays crash-proof on client records saved before
 * this phase.
 * @param {*} raw
 * @returns {Array}
 */
function _cfParseArr(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * sanitizeClientUrl — blocks script-executing URL schemes
 * (javascript:, vbscript:, data:) before a value is placed into a
 * URL-consuming sink (an `href`/`src` attribute, `window.open()`,
 * `location`). Everything else (http(s), protocol-relative `//…`,
 * relative paths, and any other scheme such as the QR image
 * provider's own https URL) passes through unchanged — this is a
 * blocklist for known-dangerous schemes, not a rewrite of the URL.
 * @param {*} url
 * @returns {string}
 */
function sanitizeClientUrl(url) {
  var s = (url === null || url === undefined) ? '' : String(url).trim();
  if (/^\s*(javascript|vbscript|data)\s*:/i.test(s)) return '';
  return s;
}

// ================================================================
// اتصال فون / محادثة واتساب — أزرار الاتصال المباشر بالموكل من الصف
// ================================================================
// كلا الزرين يعتمدان على نفس رقم هاتف الموكل المخزَّن (c['الهاتف']) —
// بيانات خارجية بحتة (روابط tel:/wa.me) لا تُنشئ ولا تُعدّل أي شيء في
// حاوية التخزين (data.clients)، فقط تفتح تطبيق الهاتف/واتساب بنفس رقم
// الموكل المعروض في الصف. يُستدعيان بنفس نمط باقي أزرار الصف (بتمرير
// الفهرس i ثم قراءة data.clients[i] داخليًا)، فلا حاجة لأي إفلات
// (escaping) خاص بالرقم داخل onclick.

/**
 * normalizeEgyptPhoneForWhatsapp — يحوّل رقم هاتف مصري محلي (يبدأ
 * غالبًا بصفر، مثل 01012345678) لصيغة دولية بدون '+' ولا أصفار بادئة
 * كما يتطلبها رابط wa.me (مثال: 201012345678). يترك أي رقم يبدأ بكود
 * الدولة 20 بالفعل كما هو، ويتجاهل أي رمز غير رقمي (مسافات/شرطات).
 * @param {string} phone
 * @returns {string} سلسلة أرقام فقط جاهزة لـ wa.me، أو '' لو الرقم فارغ
 */
function normalizeEgyptPhoneForWhatsapp(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.charAt(0) === '0') digits = digits.substring(1);
  if (digits.indexOf('20') !== 0) digits = '20' + digits;
  return digits;
}

/**
 * callClient — يفتح تطبيق الاتصال بالهاتف المسجَّل للموكل رقمه i.
 * @param {number} i  0-based index في data.clients
 */
function callClient(i) {
  var c = data.clients[i];
  var phone = c ? String(c['الهاتف'] || '').trim() : '';
  if (!phone) { toast('لا يوجد رقم هاتف مسجل لهذا الموكل', 'error'); return; }
  window.location.href = 'tel:' + phone;
}

/**
 * whatsappClient — يفتح محادثة واتساب مع الموكل رقمه i في تبويب جديد.
 * @param {number} i  0-based index في data.clients
 */
function whatsappClient(i) {
  var c = data.clients[i];
  var phone = c ? String(c['الهاتف'] || '').trim() : '';
  if (!phone) { toast('لا يوجد رقم هاتف مسجل لهذا الموكل', 'error'); return; }
  var waNumber = normalizeEgyptPhoneForWhatsapp(phone);
  if (!waNumber) { toast('رقم الهاتف غير صالح لفتح واتساب', 'error'); return; }
  window.open(sanitizeClientUrl('https://wa.me/' + waNumber), '_blank', 'noopener');
}

// ================================================================
// FIELDS & MAP — clients slice only
// ================================================================

var CLIENTS_FIELDS = [
  'fClientName', 'fClientType', 'fClientNID', 'fClientPower', 'fClientPhone',
  'fClientEmail', 'fClientAddress', 'fClientJob', 'fClientEmployer',
  'fClientMarital', 'fClientNotes'
];

var CLIENTS_MAP = {
  fClientName:     'الاسم',
  fClientType:     'النوع',
  fClientNID:      'الرقم_القومي',
  fClientPower:    'رقم_التوكيل',
  fClientPhone:    'الهاتف',
  fClientEmail:    'البريد',
  fClientAddress:  'العنوان',
  fClientJob:      'الوظيفة',
  fClientEmployer: 'جهة_العمل',
  fClientMarital:  'الحالة_الاجتماعية',
  fClientNotes:    'ملاحظات'
};

/**
 * Identifier field name — must match ClientsRepository's own
 * CLIENTS_ID_FIELD constant exactly (js/repositories/ClientsRepository.js,
 * §1). Duplicated here rather than imported, same "depends only on its
 * own declared dependency" discipline every Repository-integrated module
 * already uses for its own local constants — this file's one declared
 * new dependency is ClientsRepository itself, not its internals.
 */
var CLIENTS_ID_FIELD = 'رقم_الموكل';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.11
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/, and already proven in js/modules/
// documents.js (Sub-Phase 9.3): `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_clients_
// repository_integration.js loads this file), otherwise the browser
// global `window.ClientsRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/ClientsRepository.js ahead
// of this file — see docs/Clients_Repository_Integration_Report.md §6
// "Deployment note" for the exact tags needed; adding them to
// index.html is explicitly out of scope for this phase's "Modify ONLY
// clients.js" mandate, exactly as documented for Documents in Sub-Phase
// 9.3).

var ClientsRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/ClientsRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var ClientsRepository = ClientsRepositoryNS && ClientsRepositoryNS.ClientsRepository;

if (typeof ClientsRepository !== 'function') {
  throw new Error(
    'clients.js requires js/repositories/ClientsRepository.js to be ' +
    'loaded first (ClientsRepository class not found).'
  );
}

/**
 * The single ClientsRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'clients'
 * localStorage key `data.clients`/`saveLocal()` always used.
 */
var clientsRepository = new ClientsRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way clientsRepository is required above,
 * mirroring the exact pattern SUB-PHASE 12.4 established for
 * `casesRepository`/`casesUndoManager` in js/modules/cases.js, and
 * generalized to every entity module by this phase's pre-audit
 * (PHASE_12_5_PRE_AUDIT_Undo_Generalization.md §4/§6). Neither file is
 * modified by this phase. Degrades gracefully exactly like Cases: a
 * missing dependency disables Undo/Redo for this module only — every
 * pre-existing CRUD/render/sync/toast behavior in this file is
 * completely unaffected either way.
 */
var UndoManagerNS = (typeof module !== 'undefined' && module.exports)
  ? require('../core/UndoManager.js')
  : (typeof window !== 'undefined' ? window : this);

var UndoManager = UndoManagerNS && UndoManagerNS.UndoManager;

if (typeof UndoManager !== 'function') {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      'clients.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastClientAction()/' +
      'redoLastClientAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoManager = null;
}

var UndoReconcilerNS = (typeof module !== 'undefined' && module.exports)
  ? require('../core/UndoReconciler.js')
  : (typeof window !== 'undefined' ? window : this);

var UndoReconciler = UndoReconcilerNS && UndoReconcilerNS.UndoReconciler
  ? UndoReconcilerNS.UndoReconciler
  : UndoReconcilerNS;

if (!UndoReconciler || typeof UndoReconciler.applyUndoInstruction !== 'function') {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      'clients.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastClientAction()/' +
      'redoLastClientAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * ClientsUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `clientsRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Clients stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var clientsUndoManager = (typeof UndoManager === 'function') ? new UndoManager(clientsRepository) : null;
if (clientsUndoManager) {
  clientsRepository.setUndoManager(clientsUndoManager);
}

/**
 * Resolves once ClientsRepository.open() has loaded its initial
 * in-memory copy from storage (Repository Contract §11: Create -> Open
 * -> Ready). Every write path awaits this before touching the
 * Repository; renderClients()/editClient()/viewClient()/genClientQR()
 * stay synchronous and simply no-op (or read a stale-but-harmless empty
 * mirror) in the vanishingly small window before this resolves — same
 * guarantee documents.js's documentsRepositoryReadyPromise provides (see
 * that file's "READ / WRITE SPLIT" header note).
 */
var clientsRepositoryReadyPromise = (function () {
  var _p = clientsRepository.open().then(function () {
    syncClientsMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderClients()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('ClientsRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // clientsRepository.open() can never hang ensureClientsRepositoryReady()
  // forever. See js/core/RepositoryReadyTimeout.js. Purely additive:
  // if that helper isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('clients', _p) : _p;
})();

/**
 * ensureClientsRepositoryReady() — awaited by every write path
 * (saveClient, deleteClient, revokeAndRegenQR). open() itself is
 * idempotent (Repository.prototype.open() returns immediately if
 * already 'ready'/'busy'), so calling this more than once is always
 * safe and cheap.
 * @returns {Promise<void>}
 */
function ensureClientsRepositoryReady() {
  if (clientsRepository.isReady()) return Promise.resolve();
  return clientsRepositoryReadyPromise;
}

/**
 * syncClientsMirror — refreshes the legacy global `data.clients` array
 * from the Repository's current state (soft-deleted records excluded,
 * same as the Repository's own getAll() default). Called after open()
 * and after every create/update/delete this module performs, so
 * cases.js / dashboard.js keep seeing accurate data without being
 * touched themselves.
 */
function syncClientsMirror() {
  data.clients = clientsRepository.getAll();
}

/**
 * resolveClientIndex(list, record) — the index half of the "index ->
 * record -> id" translation layer (see file header). Finds `record`'s
 * position inside `list` by identifier equality (`رقم_الموكل`),
 * replacing the old `data.clients.indexOf(c)` reference-equality lookup
 * that no longer works now that Repository reads return cloned objects
 * (audit R-01).
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveClientIndex(list, record) {
  var id = record ? record[CLIENTS_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][CLIENTS_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة الموكلين
// ================================================================

/**
 * renderClients — renders the clients table (desktop) and mobile
 * card list, respecting the search filter.
 */
function renderClients() {
  // Defensive only — see clientsRepositoryReadyPromise's doc comment.
  // In normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!clientsRepository.isReady()) return;

  var s = val('searchClients').toLowerCase();

  syncClientsMirror();
  var allClients = data.clients;

  var queryModel = {};
  if (s) queryModel.search = s;
  var rows = clientsRepository.search(queryModel).items;

  var tb  = document.getElementById('clientsTableBody');
  var em  = document.getElementById('clientsEmpty');
  var ml  = document.getElementById('clientsMobileList');

  if (!rows.length) {
    if (tb) tb.innerHTML = '';
    if (ml) ml.innerHTML = '';
    // PHASE 16.7 — Keyed DOM Recycling (Clients) — SAFETY: the two lines
    // above wipe both containers' real children directly (not through
    // DomRecycler), so any key->node references DomKeyIndex is holding
    // for them would now point at detached/dead nodes. Reset both so
    // the next non-empty render starts clean instead of reusing dead
    // references. Additive only — window.DomKeyIndex may be undefined
    // if js/core/dom/ isn't loaded, hence the guard. Same pattern as
    // renderCases() (js/modules/cases.js).
    if (window.DomKeyIndex) { if (tb) DomKeyIndex.reset(tb); if (ml) DomKeyIndex.reset(ml); }
    if (em) em.style.display = '';
    return;
  }
  if (em) em.style.display = 'none';

  // ----------------------------------------------------------------
  // PHASE 16.7 — Keyed DOM Recycling (Clients)
  // ----------------------------------------------------------------
  // desktopClientRowInner()/mobileClientCardInner() below are the EXACT
  // SAME markup strings renderClients() has always built for each
  // row/card — moved out of the inline .map() callbacks into named
  // functions so the SAME template logic can be called both by
  // DomRecycler (new path) and by the untouched legacy full-rebuild
  // block (fallback path) with zero duplication of the actual HTML.
  // Only the outer wrapper tags (<tr>...</tr> / <div class="m-card">...
  // </div>) moved: DomRecycler's DomNodeFactory now owns creating that
  // wrapper element; these functions own everything inside it,
  // unchanged. Mirrors renderCases() (js/modules/cases.js) exactly.

  function desktopClientRowInner(c) {
    var ri = resolveClientIndex(allClients, c);
    return '<td><strong>' + escapeHtml(c['الاسم']         || '—') + '</strong></td>' +
      '<td>'         + escapeHtml(c['النوع']          || '—') + '</td>' +
      '<td>'         + escapeHtml(c['الهاتف']         || '—') + '</td>' +
      '<td style="direction:ltr;text-align:right;">' + escapeHtml(c['الرقم_القومي'] || '—') + '</td>' +
      '<td>'         + escapeHtml(c['العنوان']        || '—') + '</td>' +
      '<td>'         + escapeHtml(c['الوظيفة']        || '—') + '</td>' +
      '<td>' +
        '<button class="btn btn-call btn-sm btn-icon" onclick="callClient(' + ri + ')" title="اتصال هاتفي">&#128222;</button> ' +
        '<button class="btn btn-whatsapp btn-sm btn-icon" onclick="whatsappClient(' + ri + ')" title="محادثة واتساب">&#128172;</button> ' +
        '<button class="btn btn-info btn-sm btn-icon" onclick="viewClient(' + ri + ')" title="عرض الملف">&#128065;</button> ' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editClient(' + ri + ')" title="تعديل">&#9998;</button> ' +
        '<button class="btn btn-success btn-sm btn-icon" onclick="genClientQR(' + ri + ')" title="QR الموكل">&#128275;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteClient(' + ri + ')" title="حذف">&#128465;</button>' +
      '</td>';
  }

  function mobileClientCardInner(c) {
    var ri = resolveClientIndex(allClients, c);
    return '<div class="m-card-header">' +
        '<div class="m-card-title">&#128100; ' + escapeHtml(c['الاسم'] || '—') + '</div>' +
        '<div class="m-card-num">' + escapeHtml(c['النوع'] || '—') + '</div>' +
      '</div>' +
      '<div class="m-card-meta">' +
        (c['الهاتف']   ? '<span>&#128222; ' + escapeHtml(c['الهاتف'])   + '</span>' : '') +
        (c['العنوان']  ? '<span>&#127968; ' + escapeHtml(c['العنوان'])  + '</span>' : '') +
        (c['الوظيفة']  ? '<span>&#128188; ' + escapeHtml(c['الوظيفة'])  + '</span>' : '') +
      '</div>' +
      '<div class="m-card-actions">' +
        '<button class="btn btn-call btn-sm btn-icon" onclick="callClient(' + ri + ')" title="اتصال هاتفي">&#128222;</button>' +
        '<button class="btn btn-whatsapp btn-sm btn-icon" onclick="whatsappClient(' + ri + ')" title="محادثة واتساب">&#128172;</button>' +
        '<button class="btn btn-info btn-sm" onclick="viewClient(' + ri + ')" style="flex:1;">&#128065; عرض</button>' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editClient(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-success btn-sm btn-icon" onclick="genClientQR(' + ri + ')">&#128275;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteClient(' + ri + ')">&#128465;</button>' +
      '</div>';
  }

  function clientRowKey(client) { return client['رقم_الموكل']; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      if (tb) DomRecycler.reconcile(tb, rows, { key: clientRowKey, tag: 'tr', render: desktopClientRowInner });
      if (ml) DomRecycler.reconcile(ml, rows, { key: clientRowKey, tag: 'div', className: 'm-card', render: mobileClientCardInner });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.7 SAFETY: any recycler failure falls straight back to
      // the legacy full-rebuild path below, and drops whatever partial
      // key-index state the failed attempt may have left behind so the
      // NEXT render (recycled or not) never inherits it. Same pattern
      // as renderCases() (js/modules/cases.js).
      recycled = false;
      if (window.DomKeyIndex) { if (tb) DomKeyIndex.reset(tb); if (ml) DomKeyIndex.reset(ml); }
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.6.1 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // desktopClientRowInner()/mobileClientCardInner() template functions
    // defined above, just with the wrapper tags restored around them.

    // ---- Desktop table ----
    if (tb) {
      tb.innerHTML = rows.map(function(c) {
        return '<tr>' + desktopClientRowInner(c) + '</tr>';
      }).join('');
    }

    // ---- Mobile cards ----
    if (ml) {
      ml.innerHTML = rows.map(function(c) {
        return '<div class="m-card">' + mobileClientCardInner(c) + '</div>';
      }).join('');
    }
  }
}

// ================================================================
// SEARCH — بحث في الموكلين (triggered by oninput on searchClients)
// ================================================================

/**
 * searchClients — alias kept for any direct callers; delegates to renderClients.
 */
function searchClients() {
  renderClients();
}

// ================================================================
// CRUD — إنشاء / تحديث / حذف الموكلين
// ================================================================

/**
 * saveClient — creates or updates a client record.
 * Called by the modal "حفظ الموكل" button.
 */
async function saveClient() {
  var name = document.getElementById('fClientName') ? document.getElementById('fClientName').value.trim() : '';
  if (!name) {
    toast('يرجى إدخال اسم الموكل', 'error');
    return;
  }

  await ensureClientsRepositoryReady();

  var obj = collectForm('clients');

  // === بيانات الموكل الموسّعة (هواتف/عناوين/توكيلات/مستندات/مديرين) ===
  // إضافة صرفة فوق collectForm العام أعلاه (الذي يتعامل فقط مع حقول
  // القيمة الواحدة) — تُدمَج هنا بنفس نمط portal_token القائم أسفل هذا
  // الكود مباشرة. js/modules/client-fields.js وحده مسؤول عن قراءة/بناء
  // الصفوف المتكررة داخل نافذة الموكل؛ هذا السطر إضافي فقط ولا يمسّ أي
  // حقل مسطّح كان موجودًا قبل هذا التعديل.
  if (window.ClientFields && typeof ClientFields.collect === 'function') {
    var extended = ClientFields.collect();
    Object.keys(extended).forEach(function (k) { obj[k] = extended[k]; });
  }

  // === إنشاء حساب بوابة الموكل (اسم مستخدم/كلمة مرور) عند الطلب ===
  // لا يُعاد توليدهما إن كانا موجودين مسبقًا (نفس فلسفة الحفاظ على
  // portal_token أدناه) — فقط يُنشآن أول مرة يُفعَّل فيها المفتاح.
  var wantsAccount = document.getElementById('fClientCreateAccount')
    ? document.getElementById('fClientCreateAccount').value === 'نعم'
    : false;
  var existingForAccount = (editIdx.clients >= 0 && data.clients[editIdx.clients]) ? data.clients[editIdx.clients] : null;
  if (wantsAccount) {
    obj['حساب_مفعل'] = 'نعم';
    obj['اسم_المستخدم'] = (existingForAccount && existingForAccount['اسم_المستخدم'])
      ? existingForAccount['اسم_المستخدم']
      : ('client_' + (typeof uid === 'function' ? uid() : Date.now().toString(36)));
    obj['كلمة_المرور'] = (existingForAccount && existingForAccount['كلمة_المرور'])
      ? existingForAccount['كلمة_المرور']
      : Math.random().toString(36).slice(2, 10);
  } else {
    obj['حساب_مفعل'] = 'لا';
    obj['اسم_المستخدم'] = (existingForAccount && existingForAccount['اسم_المستخدم']) || '';
    obj['كلمة_المرور'] = (existingForAccount && existingForAccount['كلمة_المرور']) || '';
  }

  // Preserve auto-generated fields on update; create them on add.
  // NOTE (audit R-02): ClientsRepository._resolveId() performs this exact
  // same `|| uid()`-equivalent fallback internally when رقم_الموكل is
  // absent, making this local stamp technically redundant on create — it
  // is kept anyway, for defense-in-depth and byte-identical behavior with
  // the pre-migration function, exactly as documents.js kept its
  // تاريخ_الإنشاء stamp under the same reasoning. See
  // docs/Clients_Repository_Integration_Report.md §3 for this decision.
  obj['رقم_الموكل']    = obj['رقم_الموكل']    || uid();
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  // === إصلاح رمز بوابة الموكل (portal_token) ===
  // السبب الجذري للمشكلة (ظهرت في زر "QR الموكل" برسالة "لا يوجد رمز
  // بوابة لهذا الموكل" بلا أي طريقة لحلها): هذه الدالة لم تكن تولّد
  // `portal_token` إطلاقاً — لا عند إنشاء موكل جديد ولا عند تعديله —
  // فكان يبقى فارغاً للأبد. المسار الوحيد لتوليده كان `revokeAndRegenQR()`،
  // لكنها لا تُستدعى إلا من داخل نافذة البوابة نفسها، والنافذة (`genClientQR`)
  // ترفض الفتح أصلاً بدون توكن موجود مسبقاً — حلقة مُغلقة (Chicken-and-Egg)
  // تمنع أي موكل من الحصول على QR نهائياً.
  // الحل: توليد التوكن هنا تلقائياً بنفس نمط رقم_الموكل/تاريخ_الإنشاء
  // أعلاه، لكن بدون عيبهما (إعادة التوليد في كل حفظ): إن كان للموكل توكن
  // بالفعل يُحافَظ عليه كما هو (حتى لا تُبطَل روابط/QR سبق مشاركتها معه)،
  // وإن لم يكن له توكن (موكل جديد، أو موكل قديم حُفظ قبل هذا الإصلاح) يُولَّد
  // له توكن جديد فورًا — وهذا يُصلح تلقائيًا (self-heal) أي موكل قديم بمجرد
  // فتح "تعديل" له وحفظه ولو بدون تغيير أي بيانات.
  var existingClientForToken = (editIdx.clients >= 0 && data.clients[editIdx.clients])
    ? data.clients[editIdx.clients]
    : null;
  obj['portal_token'] = (existingClientForToken && existingClientForToken['portal_token'])
    ? existingClientForToken['portal_token']
    : (uid() + '-' + uid());

  var idx = editIdx.clients;
  var result;

  if (idx >= 0) {
    var existingId = data.clients[idx] ? data.clients[idx][CLIENTS_ID_FIELD] : null;
    result = await clientsRepository.update(existingId, obj);
  } else {
    result = await clientsRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء حفظ بيانات الموكل', 'error');
    return;
  }

  syncClientsMirror();

  if (idx >= 0) {
    toast('تم تحديث بيانات الموكل', 'success');
  } else {
    toast('تمت إضافة الموكل بنجاح', 'success');
  }
  if (wantsAccount && !(existingForAccount && existingForAccount['اسم_المستخدم'])) {
    toast('تم إنشاء حساب بوابة الموكل — المستخدم: ' + obj['اسم_المستخدم'], 'success');
  }

  saveLocal();
  ApiService.syncRow('الموكلين', result.record, idx);

  closeModal('modalClient');
  renderClients();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('clients'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('cases'); }
}

/**
 * editClient — opens the client modal pre-filled for editing.
 * @param {number} i  0-based index in data.clients
 */
function editClient(i) {
  editIdx.clients = i;
  fillForm('clients', data.clients[i]);
  // === بيانات الموكل الموسّعة — إعادة بناء الصفوف المتكررة وتفعيل
  // قسم النوع الصحيح (شخص طبيعي/اعتباري) وعرض بيانات حساب البوابة ===
  if (window.ClientFields && typeof ClientFields.fill === 'function') {
    ClientFields.fill(data.clients[i]);
  }
  if (typeof switchClientFormTab === 'function') switchClientFormTab('basic');
  document.getElementById('modalClientTitle').textContent = 'تعديل بيانات الموكل';
  document.getElementById('modalClient').classList.add('open');
}

/**
 * deleteClient — confirms and deletes a client record.
 * @param {number} i  0-based index in data.clients
 */
async function deleteClient(i) {
  if (!(await confirmDialog('حذف هذا الموكل من السجل؟'))) return;

  await ensureClientsRepositoryReady();

  var record = data.clients[i];
  if (!record) return;

  var id = record[CLIENTS_ID_FIELD];

  // Preserves the ORIGINAL call order (ApiService.deleteData() before the
  // local removal) — see audit §8 item 4. ApiService.deleteData() is
  // async and internally catches its own errors (js/api/api.js), so this
  // ordering has no functional effect either before or after migration.
  //
  // KNOWN ARCHITECTURAL LIMITATION (audit R-06, documented not fixed):
  // this still passes the plain frontend index `i`, exactly as before
  // migration. Once ClientsRepository's soft-delete semantics apply,
  // `rowIndex` sent here can drift from the true GAS sheet row after the
  // first deleted client — a pre-existing, already-latent architectural
  // gap this phase intentionally does not fix. See
  // docs/Clients_Repository_Integration_Report.md §6.
  ApiService.deleteData('الموكلين', i);

  var result = await clientsRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء حذف الموكل', 'error');
    return;
  }

  syncClientsMirror();
  saveLocal();
  toast('تم حذف الموكل', 'info');
  renderClients();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('clients'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('cases'); }
}

/**
 * restoreClient(id) — استرجاع موكل محذوف (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Cases_Restore_Integration_Report.md and
 * docs/Restore_Rollout_Report.md for the full rationale, repeated only
 * briefly here).
 *
 * Restores a soft-deleted client through `clientsRepository.restore(id)`
 * (inherited, unmodified, from `Repository.prototype.restore()`, SUB-
 * PHASE 10.2). Symmetric with `deleteClient()` immediately above: same
 * ready-guard, same `syncClientsMirror()` -> `saveLocal()` ->
 * `renderClients()` -> `updateBadges()` refresh sequence, same
 * `WriteResult` success/failure handling and toast pattern.
 *
 * ID, NOT INDEX (same documented divergence as `restoreCase()`): a
 * soft-deleted client is absent from `data.clients` (`syncClientsMirror()`
 * sources it from `clientsRepository.getAll()`, which excludes deleted
 * records by default), so there is no `data.clients[i]` position to
 * translate an index from.
 *
 * NO UI WIRING (Rollout scope, matching the Pilot): no Trash screen /
 * "restore" button exists anywhere in `index.html` — out of this
 * phase's scope, unchanged.
 *
 * KNOWN LIMITATION / EXPLICIT DESIGN DECISION (documented, not silently
 * resolved — same decision as `restoreCase()`): unlike `deleteClient()`,
 * this does NOT call `ApiService.deleteData()`/`syncRow()`. Google
 * Sheets synchronization behavior is therefore completely untouched by
 * this phase.
 *
 * @param {string} id - the ClientsRepository id (رقم_الموكل) of the
 *   soft-deleted client to restore.
 */
async function restoreClient(id) {
  await ensureClientsRepositoryReady();

  var result = await clientsRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء استرجاع الموكل', 'error');
    return;
  }

  syncClientsMirror();
  saveLocal();
  toast('تم استرجاع الموكل', 'success');
  renderClients();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('clients'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('cases'); }
}

// ================================================================
// VIEW — عرض ملف الموكل الكامل
// ================================================================

/**
 * viewClient — builds and displays the full client file in the
 * shared modalView overlay (same overlay used by viewCase).
 * @param {number} i  0-based index in data.clients
 */
function viewClient(i) {
  var c = data.clients[i];
  if (!c) return;

  // Store reference so printView() and showClientPortal() can use it
  window._currentViewCase   = null;    // not a case view
  window._currentViewClient = c;
  window._currentViewClientIdx = i;

  document.getElementById('viewModalTitle').textContent =
    '&#128100; ملف الموكل — ' + (c['الاسم'] || '');

  // Show/hide the portal button
  var portalBtn = document.getElementById('viewPortalBtn');
  if (portalBtn) portalBtn.style.display = '';

  document.getElementById('viewModalBody').innerHTML = buildClientReport(c);
  document.getElementById('modalView').classList.add('open');
}

// ================================================================
// OVERRIDE viewCase — clear stale _currentViewClient flag
// ================================================================
// viewClient() (above) nulls out window._currentViewCase whenever a
// client file is opened, so printView() can tell the two view types
// apart. viewCase() (cases.js) has no symmetric reset: it sets
// window._currentViewCase but never clears window._currentViewClient.
// Without this wrap, opening a client file and then a case file (in
// the same session, no reload) would leave _currentViewClient set,
// and printView() would wrongly try to print the client template for
// a case. This wrap is additive only — it adds the missing reset
// after the original viewCase() runs unchanged.
if (typeof viewCase === 'function') {
  var _origViewCaseForPrintView = viewCase;
  viewCase = function(i) {
    _origViewCaseForPrintView(i);
    window._currentViewClient = null;
    window._currentViewClientIdx = null;
  };
}


// ================================================================
// REPORT BUILDER — بناء تقرير الموكل
// ================================================================

/**
 * buildClientReport — returns the inner HTML for the client file view.
 * @param {Object} c  Client record
 * @returns {string}
 */
function buildClientReport(c) {
  var today = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  // Helper: safe value — HTML-escaped (every caller below interpolates
  // the result directly into an HTML string).
  function f(v) {
    return (v && String(v).trim()) ? escapeHtml(String(v).trim()) : '—';
  }

  // Helper: view field row — `value` is expected to already be
  // HTML-escaped (all call sites below pass it through f() first);
  // `label` is always a hardcoded string literal from this file, never
  // user/Repository data, so it is not re-escaped.
  function vf(label, value) {
    var v = (value && String(value).trim())
      ? String(value).trim()
      : '<span class="empty">—</span>';
    return '<div class="view-field"><div class="view-label">' + label +
           '</div><div class="view-value">' + v + '</div></div>';
  }

  // Linked cases
  var clientName = (c['الاسم'] || '').trim();
  var linkedCases = (data.cases || []).filter(function(cs) {
    var caseClients = (cs['اسم_الموكل'] || '');
    return caseClients.indexOf(clientName) >= 0;
  });

  // Linked fees
  var linkedFees = (data.fees || []).filter(function(f) {
    return (f['اسم_الموكل'] || '').indexOf(clientName) >= 0;
  });
  var totalFees = linkedFees.reduce(function(acc, f) {
    return acc + (parseFloat(f['المبلغ']) || 0);
  }, 0);

  var html = '';

  // ---- Report header ----
  // OFFICE PROFILE: uses the office's own saved data when available
  // (js/office/OfficeProfileService.js), falling back to the exact same
  // hardcoded text as before when no profile has been entered yet
  // (Zero Regression for any install that hasn't touched Settings ->
  // "بيانات المكتب" / the first-run screen).
  var _officeReport = (window.OfficeProfileService && OfficeProfileService.getDisplayProfile())
    || { officeName: 'مكتب الحسام للمحاماة', lawyerName: 'المستشار حسام محمد إبراهيم' };
  html += '<div class="case-report" style="padding:20px;font-family:Cairo,Arial,sans-serif;direction:rtl;">';
  html += '<div class="report-header" style="text-align:center;border-bottom:2px solid #c9a84c;padding-bottom:14px;margin-bottom:18px;">' +
    '<div style="font-size:20px;font-weight:900;color:#1a2744;">' + f(_officeReport.officeName) + '</div>' +
    '<div style="font-size:13px;color:#555;margin-top:4px;">' + f(_officeReport.lawyerName) + '</div>' +
    '<div style="font-size:15px;font-weight:700;color:#c9a84c;margin-top:10px;">&#128100; ملف الموكل</div>' +
  '</div>';

  // ---- Client details ----
  html += '<div class="view-section"><div class="view-section-title">&#128100; البيانات الشخصية</div>' +
    '<div class="view-grid">' +
    vf('الاسم الكامل',       f(c['الاسم'])) +
    vf('نوع الموكل',         f(c['النوع'])) +
    vf('الرقم القومي',       f(c['الرقم_القومي'])) +
    vf('رقم التوكيل',        f(c['رقم_التوكيل'])) +
    vf('رقم الهاتف',         f(c['الهاتف'])) +
    vf('البريد الإلكتروني',  f(c['البريد'])) +
    vf('العنوان',             f(c['العنوان'])) +
    vf('الوظيفة',             f(c['الوظيفة'])) +
    vf('جهة العمل',           f(c['جهة_العمل'])) +
    vf('الحالة الاجتماعية',  f(c['الحالة_الاجتماعية'])) +
    (c['الجنسية']        ? vf('الجنسية', f(c['الجنسية'])) : '') +
    (c['رقم_جواز_السفر'] ? vf('رقم جواز السفر', f(c['رقم_جواز_السفر'])) : '') +
    (c['تاريخ_الميلاد']  ? vf('تاريخ الميلاد', f(c['تاريخ_الميلاد'])) : '') +
    (c['الجنس']          ? vf('الجنس', f(c['الجنس'])) : '') +
    '</div></div>';

  // ---- بيانات الشركة (شخص اعتباري فقط) ----
  if ((c['النوع'] || '').trim() === 'شخص اعتباري') {
    html += '<div class="view-section"><div class="view-section-title">&#127970; بيانات الشركة</div>' +
      '<div class="view-grid">' +
      vf('نوع الشركة', f(c['نوع_الشركة'])) +
      vf('نشاط الشركة', f(c['نشاط_الشركة'])) +
      vf('القانون التابع له', f(c['القانون_التابع_له'])) +
      vf('رقم السجل', f(c['رقم_السجل'])) +
      vf('تاريخ بداية السجل', f(c['تاريخ_بداية_السجل'])) +
      vf('تاريخ نهاية السجل', f(c['تاريخ_نهاية_السجل'])) +
      vf('الرقم الموحد', f(c['الرقم_الموحد'])) +
      vf('الرقم الضريبي', f(c['الرقم_الضريبي'])) +
      '</div></div>';

    var _mgrs = _cfParseArr(c['المديرين']);
    if (_mgrs.length) {
      html += '<div class="view-section"><div class="view-section-title">&#128101; المديرين</div>' +
        '<div class="view-field-full"><div class="view-value">' +
        _mgrs.map(function(m) { return escapeHtml(m.name || ''); }).filter(Boolean).join('، ') +
        '</div></div></div>';
    }
  }

  // ---- أرقام هواتف متعددة ----
  var _phones = _cfParseArr(c['أرقام_الهواتف']);
  if (_phones.length > 1) {
    html += '<div class="view-section"><div class="view-section-title">&#128222; أرقام الهواتف</div>' +
      '<div class="view-field-full"><div class="view-value">' +
      _phones.map(function(p) { return escapeHtml((p.type || '') + ': ' + (p.number || '')); }).join('<br>') +
      '</div></div></div>';
  }

  // ---- عناوين متعددة ----
  var _addrs = _cfParseArr(c['العناوين']);
  if (_addrs.length > 1) {
    html += '<div class="view-section"><div class="view-section-title">&#128205; العناوين</div>' +
      '<div class="view-field-full"><div class="view-value">' +
      _addrs.map(function(a) { return escapeHtml((a.type || '') + ': ' + (a.detail || '')); }).join('<br>') +
      '</div></div></div>';
  }

  // ---- التوكيلات ----
  var _powers = _cfParseArr(c['التوكيلات']);
  if (_powers.length) {
    html += '<div class="view-section"><div class="view-section-title">&#128196; التوكيلات (' + _powers.length + ')</div>';
    html += '<div class="hsm-table-scroll"><table style="width:100%;min-width:520px;font-size:12px;border-collapse:collapse;">' +
      '<tr style="background:#f5f0e8;">' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">النوع</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">رقم/حرف/سنة</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">مكتب التوثيق</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">الصفة</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">الملف</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">ظاهر للموكل</th>' +
      '</tr>';
    _powers.forEach(function(p) {
      var _pVisible = p.visible === 'نعم';
      html += '<tr>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(p.type) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f([p.number, p.letter, p.year].filter(Boolean).join('/')) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(p.notaryOffice) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(p.capacity) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + (p.fileUrl ? '<a href="' + escapeHtml(p.fileUrl) + '" target="_blank">فتح</a>' : '<span class="empty">لم يُرفع بعد</span>') + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + (_pVisible ? '<span style="color:#1e8449;font-weight:700;">&#10003; نعم</span>' : '<span style="color:#888;">لا</span>') + '</td>' +
      '</tr>';
    });
    html += '</table></div></div>';
  }

  // ---- مستندات الموكل ----
  var _docs = _cfParseArr(c['المستندات']);
  if (_docs.length) {
    html += '<div class="view-section"><div class="view-section-title">&#128193; مستندات الموكل (' + _docs.length + ')</div>' +
      '<div class="view-field-full"><div class="view-value">' +
      _docs.map(function(d) {
        var _dVisible = d.visible === 'نعم';
        var _label = d.fileUrl
          ? '<a href="' + escapeHtml(d.fileUrl) + '" target="_blank">' + f(d.name) + '</a>'
          : f(d.name);
        return _label + ' <span style="font-size:11px;' + (_dVisible ? 'color:#1e8449;' : 'color:#888;') + '">(' + (_dVisible ? '&#10003; ظاهر للموكل' : 'مخفي عن الموكل') + ')</span>';
      }).join('<br>') +
      '</div></div></div>';
  }

  // ---- Notes ----
  if (c['ملاحظات'] && c['ملاحظات'].trim()) {
    html += '<div class="view-section"><div class="view-section-title">&#128221; ملاحظات</div>' +
      '<div class="view-field-full"><div class="view-value">' + escapeHtml(c['ملاحظات']) + '</div></div>' +
      '</div>';
  }

  // ---- Linked cases ----
  html += '<div class="view-section"><div class="view-section-title">&#9878; القضايا المرتبطة (' + linkedCases.length + ' قضية)</div>';
  if (!linkedCases.length) {
    html += '<div style="padding:12px;color:#888;font-size:12px;">لا توجد قضايا مسجلة لهذا الموكل</div>';
  } else {
    html += '<div class="hsm-table-scroll"><table style="width:100%;min-width:560px;font-size:12px;border-collapse:collapse;">' +
      '<tr style="background:#f5f0e8;">' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">رقم القضية</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">العنوان</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">النوع</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">الحالة</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">الجلسة القادمة</th>' +
      '</tr>';
    linkedCases.forEach(function(cs) {
      html += '<tr>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;font-weight:700;color:#c9a84c;">' + f(cs['رقم_القضية']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(cs['عنوان_القضية']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(cs['نوع_الدعوى']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(cs['الحالة']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' +
          (cs['تاريخ_الجلسة_القادمة']
            ? new Date(cs['تاريخ_الجلسة_القادمة']).toLocaleDateString('ar-EG')
            : '—') +
        '</td>' +
      '</tr>';
    });
    html += '</table></div>';
  }
  html += '</div>';

  // ---- Fees summary ----
  html += '<div class="view-section"><div class="view-section-title">&#128176; الأتعاب المسجلة (' + linkedFees.length + ' عملية)</div>';
  if (!linkedFees.length) {
    html += '<div style="padding:12px;color:#888;font-size:12px;">لا توجد أتعاب مسجلة لهذا الموكل</div>';
  } else {
    html += '<div class="hsm-table-scroll"><table style="width:100%;min-width:560px;font-size:12px;border-collapse:collapse;">' +
      '<tr style="background:#f5f0e8;">' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">رقم القضية</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">النوع</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">المبلغ</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">التاريخ</th>' +
        '<th style="padding:7px 10px;text-align:right;border:1px solid #e8e0d0;">طريقة الدفع</th>' +
      '</tr>';
    linkedFees.forEach(function(fee) {
      html += '<tr>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:#c9a84c;">' + f(fee['رقم_القضية']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(fee['نوع_الأتعاب']) + '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;font-weight:700;color:#1ab46c;">' +
          (fee['المبلغ'] ? Number(fee['المبلغ']).toLocaleString('ar-EG') + ' ج.م' : '—') +
        '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' +
          (fee['تاريخ_الاستلام'] ? new Date(fee['تاريخ_الاستلام']).toLocaleDateString('ar-EG') : '—') +
        '</td>' +
        '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + f(fee['طريقة_الدفع']) + '</td>' +
      '</tr>';
    });
    html += '<tr style="background:#f0f8f4;">' +
      '<td colspan="2" style="padding:8px 10px;border:1px solid #e8e0d0;font-weight:700;">الإجمالي</td>' +
      '<td style="padding:8px 10px;border:1px solid #e8e0d0;font-weight:900;color:#1ab46c;">' +
        totalFees.toLocaleString('ar-EG') + ' ج.م' +
      '</td>' +
      '<td colspan="2" style="border:1px solid #e8e0d0;"></td>' +
    '</tr>';
    html += '</table></div>';
  }
  html += '</div>';

  // ---- Client Messages/Notes (client portal) ----
  // INTEGRATION PHASE — Client Portal Messages Wiring: renderClientMessagesSection()
  // is defined in js/modules/client-messages.js (loaded after this file), and is
  // called here at RUNTIME only (buildClientReport() itself is unchanged in every
  // other respect). Guarded so this file still works standalone if that module is
  // ever absent for any reason.
  if (typeof renderClientMessagesSection === 'function') {
    html += renderClientMessagesSection(c);
  }

  // ---- Footer ----
  html += '<div class="view-footer" style="display:flex;justify-content:space-between;border-top:1px solid #e8e0d0;padding-top:10px;margin-top:18px;font-size:11px;color:#999;">' +
    '<span>نظام الحسام للمحاماة</span>' +
    '<span>تاريخ الطباعة: ' + today + '</span>' +
  '</div>';

  html += '</div>'; // .case-report
  return html;
}

// ================================================================
// PRINT — طباعة ملف الموكل
// ================================================================

/**
 * printClientFile — opens a standalone print window for a client.
 * Can be called directly from the clients list.
 * @param {number} i  0-based index in data.clients
 */
function printClientFile(i) {
  var c = data.clients[i];
  if (!c) return;

  var body = buildClientReport(c);

  var printContent =
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0;}' +
    'html{-webkit-text-size-adjust:100%;}' +
    'body{font-family:Cairo,Arial,sans-serif;background:#fff;color:#111;direction:rtl;max-width:100%;overflow-x:hidden;}' +
    '@page{size:A4;margin:15mm;}' +
    '.case-report{padding:10px;}' +
    '.report-header{text-align:center;border-bottom:2px solid #c9a84c;padding-bottom:12px;margin-bottom:16px;}' +
    '.view-section{margin-bottom:16px;border:1px solid #e8e0d0;border-radius:6px;overflow:hidden;}' +
    '.view-section-title{background:#f5f0e8;padding:8px 12px;font-weight:700;font-size:13px;border-bottom:1px solid #e8e0d0;}' +
    '.view-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0;}' +
    '.view-field{padding:7px 12px;border-bottom:1px solid #f0ece4;border-left:1px solid #f0ece4;min-width:0;}' +
    '.view-field-full{padding:7px 12px;border-bottom:1px solid #f0ece4;}' +
    '.view-label{font-size:10px;color:#888;margin-bottom:2px;}' +
    '.view-value{font-size:13px;font-weight:600;overflow-wrap:anywhere;word-break:break-word;}' +
    '.empty{color:#ccc;}' +
    '.hsm-table-scroll{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;}' +
    'table{width:100%;min-width:520px;border-collapse:collapse;font-size:12px;}' +
    'th,td{padding:6px 10px;border:1px solid #e8e0d0;text-align:right;}' +
    'th{background:#f5f0e8;font-weight:700;}' +
    '.view-footer{display:flex;justify-content:space-between;border-top:1px solid #e8e0d0;padding-top:8px;margin-top:14px;font-size:10px;color:#999;}' +
    /* Screen-only (mobile viewing before printing) — @page/@media print above
       is untouched, so the actual PDF/paper output is unaffected. */
    '@media screen and (max-width:640px){' +
      'body{padding:0 4px;}' +
      '.case-report{padding:10px 6px;}' +
      '.view-grid{grid-template-columns:1fr;}' +
      '.view-field{border-left:none;}' +
      'table{display:block;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;}' +
    '}' +
    '</style>' +
    '</head><body>' + body + '</body></html>';

  var w = window.open('', '_blank', 'width=850,height=1100');
  if (!w) { toast('افتح النوافذ المنبثقة للطباعة', 'info'); return; }
  w.document.write(printContent);
  w.document.close();
  w.focus();
  setTimeout(function() { w.print(); }, 600);
}

// ================================================================
// QR / PORTAL — رمز QR للموكل
// ================================================================

/**
 * genClientQR — generates the portal QR for a client.
 * Uses ApiService.getPortalUrl() and ApiService.getQrImageUrl().
 *
 * This is the ACTIVE implementation (third definition in original
 * index.html — the first two were dead code).
 *
 * @param {number} i  0-based index in data.clients
 */
function genClientQR(i) {
  var c = data.clients[i];
  if (!c) return;

  var token = c['portal_token'];
  if (!token) {
    // ملاحظة: بعد إصلاح saveClient() ليولّد portal_token تلقائيًا، هذه
    // الحالة لا تحدث إلا لموكل قديم حُفظ قبل الإصلاح ولم يُعدَّل بعد —
    // الحل بسيط: فتح "تعديل" ثم "حفظ" (بدون أي تغيير) يولّد له توكن فورًا.
    toast('لم يُنشأ رمز بوابة لهذا الموكل بعد — افتح "تعديل بيانات الموكل" ثم اضغط "حفظ" لإنشائه تلقائيًا', 'info');
    return;
  }

  var portalUrl = ApiService.getPortalUrl(token);
  displayPortalModal(c['الاسم'] || 'الموكل', portalUrl, token, i);
}

/**
 * showClientPortal — triggered from the view modal "QR الموكل" button.
 * Reads the current viewed client from window._currentViewClientIdx.
 */
function showClientPortal() {
  var idx = window._currentViewClientIdx;
  if (idx === undefined || idx === null || idx < 0) {
    toast('لم يتم تحديد موكل', 'info');
    return;
  }
  genClientQR(idx);
}

/**
 * displayPortalModal — renders the portal modal with QR code and action buttons.
 * @param {string} clientName   - Display name shown in modal header
 * @param {string} portalUrl    - Full portal URL
 * @param {string} token        - Portal token (for revoke/regenerate)
 * @param {number} clientIdx    - 0-based index (for revoke/regenerate save-back)
 */
function displayPortalModal(clientName, portalUrl, token, clientIdx) {
  // Sanitized once here so every consumer (linkDiv textContent, the QR
  // image src below, and openPortalDirect()'s window.open()/
  // copyPortalLink()'s clipboard write) receives the same safe value.
  portalUrl = sanitizeClientUrl(portalUrl);

  // Persist so action buttons (copy, open, revoke) can access them
  window._portalUrl      = portalUrl;
  window._portalToken    = token;
  window._portalClientIdx = clientIdx;

  // Label
  var label = document.getElementById('portalClientLabel');
  if (label) label.textContent = 'بوابة الموكل: ' + clientName;

  // Link text
  var linkDiv = document.getElementById('portalLinkDiv');
  if (linkDiv) linkDiv.textContent = portalUrl;

  // QR code image — responsive size
  var qrSize = Math.min(window.innerWidth - 60, 220);
  var qrUrl  = sanitizeClientUrl(ApiService.getQrImageUrl(portalUrl, qrSize, 'M'));
  var qrDiv  = document.getElementById('qrCodeDiv');
  if (qrDiv) {
    qrDiv.innerHTML =
      '<img src="' + escapeHtml(qrUrl) + '" alt="QR الموكل" ' +
      'style="border-radius:8px;border:4px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,0.25);" ' +
      'width="' + qrSize + '" height="' + qrSize + '">';
  }

  document.getElementById('modalPortal').classList.add('open');
}

/**
 * copyPortalLink — copies the portal URL to clipboard.
 */
function copyPortalLink() {
  var url = window._portalUrl || '';
  if (!url) { toast('لا يوجد رابط', 'info'); return; }
  navigator.clipboard.writeText(url).then(function() {
    toast('تم نسخ رابط البوابة', 'success');
  }).catch(function() {
    toast('تعذر النسخ — انسخ الرابط يدوياً', 'error');
  });
}

/**
 * openPortalDirect — opens the portal URL in a new tab.
 */
function openPortalDirect() {
  var url = window._portalUrl || '';
  if (!url) { toast('لا يوجد رابط', 'info'); return; }
  window.open(url, '_blank');
}

/**
 * revokeAndRegenQR — invalidates the current portal token and
 * generates a new one, then saves back to Sheets.
 */
async function revokeAndRegenQR() {
  var idx = window._portalClientIdx;
  if (idx === undefined || idx === null || !data.clients[idx]) {
    toast('تعذر إعادة إنشاء الرمز', 'error');
    return;
  }

  if (!(await confirmDialog('سيصبح رمز QR القديم بلا فائدة فوراً. هل تريد المتابعة؟','تأكيد إعادة التوليد'))) return;

  await ensureClientsRepositoryReady();

  var id = data.clients[idx][CLIENTS_ID_FIELD];
  var newToken = uid() + '-' + uid();

  // Partial-field patch (audit R-03) — Repository.prototype.update()
  // merges this onto the existing record, so the direct
  // data.clients[idx]['portal_token'] = newToken mutation is replaced
  // with an equivalent single-field update through the Repository,
  // rather than a full-record replace.
  var result = await clientsRepository.update(id, { portal_token: newToken });

  if (!result || !result.success) {
    toast('تعذر إعادة إنشاء الرمز', 'error');
    return;
  }

  syncClientsMirror();
  saveLocal();

  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('clients'); }

  ApiService.updateData('الموكلين', result.record, idx);
  toast('تم إنشاء رمز QR جديد — الرمز القديم لم يعد صالحاً', 'success');

  closeModal('modalPortal');

  // Re-open portal modal with new token
  var c = data.clients[idx];
  var portalUrl = ApiService.getPortalUrl(newToken);
  displayPortalModal(c['الاسم'] || 'الموكل', portalUrl, newToken, idx);
}

// ================================================================
// CLIENT SELECTOR — منتقي الموكلين في نموذج القضايا
// ================================================================
// This block powers the multi-client picker inside the Case modal
// (fCaseClient field). It lives here because it reads data.clients
// and its functions are conceptually part of the Clients module.
//
// NOTE: The picker wraps resetForm / editCase / saveCase via variable
// re-assignment (same pattern used by cases.js for children). The
// wraps are additive and do not break prior overrides.
// ================================================================

/** Separator used when joining multiple selected client names */
var CLIENT_NAME_SEPARATOR = '، ';

/** Array of currently selected client names in the case modal picker */
var _caseSelectedClients = [];

/**
 * _splitClientNames — splits a separator-delimited client string
 * into a clean array of names.
 * @param {string} str
 * @returns {string[]}
 */
function _splitClientNames(str) {
  return String(str || '')
    .split(/\s*[,،]\s*/)
    .map(function(s) { return s.trim(); })
    .filter(Boolean);
}

/**
 * _attrSafeJSString — wraps JSON.stringify and HTML-escapes the result
 * so it can be placed safely inside an HTML attribute (onchange/onclick).
 *
 * PHASE 13.18 — SECURITY PART 3/4 (independent verification) hardening:
 * `JSON.stringify()` does NOT escape U+2028 (LINE SEPARATOR) or U+2029
 * (PARAGRAPH SEPARATOR) — a long-documented JS gotcha. Modern engines
 * (ES2019+) tolerate these raw inside a string literal, but escaping
 * them here is a zero-risk, defense-in-depth hardening for any legacy
 * JS engine that still treats them as line terminators inside a string
 * literal, which — post HTML-attribute-decoding — could otherwise
 * truncate the intended `toggleCaseClient(...)`/`removeCaseClient(...)`
 * call early. No other escaping in this helper changes; every existing
 * call site (`renderClientSelectorList()`, `renderClientSelectorChips()`)
 * and its output for all previously-handled characters (&, ") is
 * byte-identical to before.
 * @param {string} s
 * @returns {string}
 */
function _attrSafeJSString(s) {
  return JSON.stringify(s)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * toggleClientSelector — opens or closes the picker dropdown panel.
 * @param {Event} [e]
 */
function toggleClientSelector(e) {
  if (e) e.stopPropagation();
  var panel = document.getElementById('clientSelectorPanel');
  if (!panel) return;
  if (panel.classList.contains('open')) {
    closeClientSelector();
  } else {
    panel.classList.add('open');
    renderClientSelectorList();
    var s = document.getElementById('clientSelectorSearch');
    if (s) { s.value = ''; s.focus(); }
  }
}

/**
 * closeClientSelector — closes the picker panel.
 */
function closeClientSelector() {
  var panel = document.getElementById('clientSelectorPanel');
  if (panel) panel.classList.remove('open');
}

// Close picker on outside click
document.addEventListener('click', function(e) {
  var panel = document.getElementById('clientSelectorPanel');
  var box   = document.getElementById('clientSelectorBox');
  if (!panel || !panel.classList.contains('open')) return;
  if (box   && box.contains(e.target))   return;
  if (panel && panel.contains(e.target)) return;
  closeClientSelector();
});

/**
 * renderClientSelectorList — rebuilds the checkbox list inside the picker.
 * Filtered by the search input.
 */
function renderClientSelectorList() {
  var list = document.getElementById('clientSelectorList');
  if (!list) return;

  var qEl     = document.getElementById('clientSelectorSearch');
  var q       = ((qEl && qEl.value) || '').trim().toLowerCase();
  var all     = (data.clients || []).filter(function(c) { return (c['الاسم'] || '').trim(); });
  var clients = q
    ? all.filter(function(c) { return (c['الاسم'] || '').toLowerCase().indexOf(q) >= 0; })
    : all;

  if (!clients.length) {
    list.innerHTML = '<div class="client-selector-empty">' +
      (all.length
        ? 'لا يوجد موكلين مطابقين للبحث'
        : 'لا يوجد موكلين مسجلين بعد — أضف موكلاً من صفحة «الموكلين» أولاً') +
      '</div>';
    return;
  }

  list.innerHTML = clients.map(function(c) {
    var name    = (c['الاسم'] || '').trim();
    var checked = _caseSelectedClients.indexOf(name) >= 0;
    var sub     = [c['النوع'], c['الهاتف']].filter(Boolean).join(' · ');
    return '<label class="client-selector-item">' +
      '<input type="checkbox" ' + (checked ? 'checked' : '') +
        ' onchange="toggleCaseClient(' + _attrSafeJSString(name) + ', this.checked)">' +
      '<span class="client-selector-item-text">' +
        '<span class="client-selector-item-name">' + escapeHtml(name) + '</span>' +
        (sub ? '<span class="client-selector-item-sub">' + escapeHtml(sub) + '</span>' : '') +
      '</span></label>';
  }).join('');
}

/**
 * toggleCaseClient — adds or removes a client name from the selection.
 * @param {string}  name
 * @param {boolean} checked
 */
function toggleCaseClient(name, checked) {
  var idx = _caseSelectedClients.indexOf(name);
  if (checked && idx < 0)  _caseSelectedClients.push(name);
  else if (!checked && idx >= 0) _caseSelectedClients.splice(idx, 1);
  _syncCaseClientField();
  renderClientSelectorChips();
}

/**
 * removeCaseClient — removes a client from the selection via chip ×.
 * @param {string} name
 */
function removeCaseClient(name) {
  var idx = _caseSelectedClients.indexOf(name);
  if (idx >= 0) _caseSelectedClients.splice(idx, 1);
  _syncCaseClientField();
  renderClientSelectorChips();
  renderClientSelectorList();
}

/**
 * _syncCaseClientField — writes the joined client names to the
 * hidden #fCaseClient input and triggers detail auto-fill.
 */
function _syncCaseClientField() {
  var el = document.getElementById('fCaseClient');
  if (el) el.value = _caseSelectedClients.join(CLIENT_NAME_SEPARATOR);
  _autofillCaseClientDetails();
}

/**
 * _autofillCaseClientDetails — when exactly one client is selected,
 * fills the detail fields (NID, phone, address, job, employer) from
 * the matching data.clients record.
 *
 * BUGFIX: toggleCaseClient previously only pushed the name, leaving
 * detail inputs blank unless typed manually.
 */
function _autofillCaseClientDetails() {
  if (_caseSelectedClients.length !== 1) return;
  var name  = _caseSelectedClients[0];
  var match = (data.clients || []).filter(function(c) {
    return (c['الاسم'] || '').trim() === name.trim();
  })[0];
  if (!match) return;

  var fieldMap = {
    fCaseClientNID:      'الرقم_القومي',
    fCaseClientPhone:    'الهاتف',
    fCaseClientAddr:     'العنوان',
    fCaseClientJob:      'الوظيفة',
    fCaseClientEmployer: 'جهة_العمل'
  };
  Object.keys(fieldMap).forEach(function(fieldId) {
    var el = document.getElementById(fieldId);
    if (el) el.value = match[fieldMap[fieldId]] || '';
  });

  // === بيانات الموكل الموسّعة — مزامنة نوع الموكل (شخص طبيعي/اعتباري)
  // في نموذج القضية مع النوع الفعلي المسجَّل بملف الموكل، بعد إصلاح
  // معرّف select#fClientType (كان id مكررًا مع نافذة القضية نفسها —
  // راجع تعليق التعديل في نافذة الموكل بـ index.html). ===
  var caseTypeEl = document.getElementById('fCaseClientType');
  if (caseTypeEl && caseTypeEl.options && match['النوع']) {
    var wantType = match['النوع'].trim();
    for (var oi = 0; oi < caseTypeEl.options.length; oi++) {
      if (caseTypeEl.options[oi].value.trim() === wantType || caseTypeEl.options[oi].text.trim() === wantType) {
        caseTypeEl.selectedIndex = oi;
        break;
      }
    }
  }
}

/**
 * renderClientSelectorChips — redraws the selected-client chip bar.
 */
function renderClientSelectorChips() {
  var box = document.getElementById('clientSelectorChips');
  if (!box) return;
  if (!_caseSelectedClients.length) {
    box.innerHTML = '<span class="client-selector-placeholder">اختر موكلاً واحداً أو أكثر من القائمة...</span>';
    return;
  }
  box.innerHTML = _caseSelectedClients.map(function(name) {
    return '<span class="client-chip">' + escapeHtml(name) +
      '<button type="button" class="client-chip-remove" ' +
        'onclick="event.stopPropagation();removeCaseClient(' + _attrSafeJSString(name) + ')" ' +
        'title="إزالة">&times;</button></span>';
  }).join('');
}

/**
 * syncCaseClientSelectorFromField — re-syncs the picker's visual
 * state from the hidden #fCaseClient field value.
 * Called when an existing case is loaded into the form for editing.
 */
function syncCaseClientSelectorFromField() {
  var el = document.getElementById('fCaseClient');
  _caseSelectedClients = _splitClientNames(el ? el.value : '');
  renderClientSelectorChips();
}

// ================================================================
// OVERRIDE resetForm — clear picker on case form reset
// ================================================================
// Wrap the existing resetForm (which may already have been wrapped
// by cases.js) so the picker is cleaned up when the modal resets.
var _origResetFormForClientSelector = resetForm;
resetForm = function(type) {
  _origResetFormForClientSelector(type);
  if (type === 'cases') {
    _caseSelectedClients = [];
    renderClientSelectorChips();
    closeClientSelector();
  }
};

// ================================================================
// OVERRIDE editCase — sync picker when a case is opened for editing
// ================================================================
if (typeof editCase === 'function') {
  var _origEditCaseForClientSelector = editCase;
  editCase = function(i) {
    _origEditCaseForClientSelector(i);
    syncCaseClientSelectorFromField();
    closeClientSelector();
  };
}

// ================================================================
// OVERRIDE saveCase — guarantee hidden field is synced before save
// ================================================================
if (typeof saveCase === 'function') {
  var _origSaveCaseForClientSelector = saveCase;
  saveCase = function() {
    if (typeof _syncCaseClientField === 'function') _syncCaseClientField();
    return _origSaveCaseForClientSelector();
  };
}

// ================================================================
// CLIENT REPORT — تقرير الموكلين
// ================================================================

/**
 * printClientsReport — prints a summary table of all clients.
 * Accessible via a dedicated button (if added to the clients toolbar).
 */
function printClientsReport() {
  if (!data.clients || !data.clients.length) {
    toast('لا يوجد موكلون لطباعتهم', 'info');
    return;
  }

  var today = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  var rows = data.clients.map(function(c, i) {
    return '<tr>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;text-align:center;">' + (i + 1) + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;font-weight:700;">' + escapeHtml(c['الاسم'] || '—') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(c['النوع'] || '—') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(c['الهاتف'] || '—') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(c['الوظيفة'] || '—') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(c['العنوان'] || '—') + '</td>' +
    '</tr>';
  }).join('');

  // OFFICE PROFILE: same fallback pattern as printClientView() above.
  var _officeListReport = (window.OfficeProfileService && OfficeProfileService.getDisplayProfile())
    || { officeName: 'مكتب الحسام للمحاماة' };

  var printContent =
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0;}' +
    'body{font-family:Cairo,Arial,sans-serif;background:#fff;color:#111;direction:rtl;padding:20px;max-width:100%;overflow-x:hidden;}' +
    '@page{size:A4 landscape;margin:12mm;}' +
    'h1{font-size:16px;text-align:center;color:#1a2744;border-bottom:2px solid #c9a84c;padding-bottom:8px;margin-bottom:14px;}' +
    'p{font-size:11px;color:#888;text-align:center;margin-bottom:12px;}' +
    '.hsm-table-scroll{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;}' +
    'table{width:100%;min-width:640px;border-collapse:collapse;font-size:12px;}' +
    'th{background:#f5f0e8;padding:8px 10px;border:1px solid #e8e0d0;text-align:right;font-weight:700;}' +
    '@media screen and (max-width:640px){' +
      'body{padding:12px 6px;}' +
    '}' +
    '</style></head><body>' +
    '<h1>' + escapeHtml(_officeListReport.officeName) + ' — سجل الموكلين</h1>' +
    '<p>تاريخ الطباعة: ' + today + ' | عدد الموكلين: ' + data.clients.length + '</p>' +
    '<div class="hsm-table-scroll"><table>' +
      '<thead><tr>' +
        '<th>#</th><th>الاسم</th><th>النوع</th><th>الهاتف</th><th>الوظيفة</th><th>العنوان</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +
    '</body></html>';

  var w = window.open('', '_blank', 'width=1000,height=700');
  if (!w) { toast('افتح النوافذ المنبثقة للطباعة', 'info'); return; }
  w.document.write(printContent);
  w.document.close();
  w.focus();
  setTimeout(function() { w.print(); }, 600);
}

// ================================================================
// SHARED VIEW-MODAL PRINT — طباعة من نافذة العرض المشتركة (modalView)
// ================================================================
// FIX (CLIENTS_AUDIT_REPORT.md §2 / §4 — missing printView()):
// The "طباعة" button inside the shared #modalView overlay (used by
// BOTH viewCase() and viewClient()) calls onclick="printView()" with
// no arguments. That function never existed in any loaded script,
// so clicking it threw "ReferenceError: printView is not defined"
// and never printed anything.
//
// viewCase() (cases.js) sets window._currentViewCase and renders
// buildCaseReport()'s output (wrapped in <div class="view-body"
// id="viewPrintContent">) into #viewModalBody.
// viewClient() (this file) sets window._currentViewCase = null and
// window._currentViewClient = <client>, rendering buildClientReport()'s
// output (wrapped in <div class="case-report">) into #viewModalBody.
//
// printView() reuses the SAME print CSS already shipped with
// quickPrintCase() (cases.js) and printClientFile() (this file) —
// no new design, no new layout, RTL/Arabic font stack unchanged —
// and simply prints whatever is currently sitting in #viewModalBody,
// which is exactly the markup those two builder functions produced.
// This avoids re-implementing report HTML a third time and keeps a
// single source of truth: the builder functions themselves.

/**
 * printView — prints whichever report (case or client) is currently
 * open in the shared #modalView overlay. Triggered by the "طباعة"
 * button in the view-modal header.
 */
function printView() {
  var body = document.getElementById('viewModalBody');
  if (!body || !body.innerHTML.trim()) {
    toast('لا يوجد محتوى لطباعته', 'info');
    return;
  }

  var isClientView = !!window._currentViewClient;
  var isCaseView   = !isClientView && !!window._currentViewCase;

  if (!isClientView && !isCaseView) {
    toast('لا يوجد ملف مفتوح للطباعة', 'info');
    return;
  }

  var printContent = isClientView
    ? _buildClientPrintDocument(body.innerHTML)
    : _buildCasePrintDocument(body.innerHTML);

  var w = window.open('', '_blank', 'width=900,height=1100,scrollbars=yes');
  if (!w) { toast('افتح النوافذ المنبثقة للطباعة', 'info'); return; }
  w.document.open();
  w.document.write(printContent);
  w.document.close();
  w.focus();
  setTimeout(function() { w.print(); }, 600);
}

/**
 * _buildClientPrintDocument — wraps client-report HTML with the
 * exact same print CSS used by printClientFile() (unchanged).
 * @param {string} bodyHtml
 * @returns {string}
 */
function _buildClientPrintDocument(bodyHtml) {
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0;}' +
    'body{font-family:Cairo,Arial,sans-serif;background:#fff;color:#111;direction:rtl;max-width:100%;overflow-x:hidden;}' +
    '@page{size:A4;margin:15mm;}' +
    '.case-report{padding:10px;}' +
    '.report-header{text-align:center;border-bottom:2px solid #c9a84c;padding-bottom:12px;margin-bottom:16px;}' +
    '.view-section{margin-bottom:16px;border:1px solid #e8e0d0;border-radius:6px;overflow:hidden;}' +
    '.view-section-title{background:#f5f0e8;padding:8px 12px;font-weight:700;font-size:13px;border-bottom:1px solid #e8e0d0;}' +
    '.view-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0;}' +
    '.view-field{padding:7px 12px;border-bottom:1px solid #f0ece4;border-left:1px solid #f0ece4;min-width:0;}' +
    '.view-field-full{padding:7px 12px;border-bottom:1px solid #f0ece4;}' +
    '.view-label{font-size:10px;color:#888;margin-bottom:2px;}' +
    '.view-value{font-size:13px;font-weight:600;overflow-wrap:anywhere;word-break:break-word;}' +
    '.empty{color:#ccc;}' +
    'table{width:100%;min-width:520px;border-collapse:collapse;font-size:12px;}' +
    'th,td{padding:6px 10px;border:1px solid #e8e0d0;text-align:right;}' +
    'th{background:#f5f0e8;font-weight:700;}' +
    '.view-footer{display:flex;justify-content:space-between;border-top:1px solid #e8e0d0;padding-top:8px;margin-top:14px;font-size:10px;color:#999;}' +
    '@media screen and (max-width:640px){' +
      'body{padding:0 4px;}' +
      '.case-report{padding:10px 6px;}' +
      '.view-grid{grid-template-columns:1fr;}' +
      '.view-field{border-left:none;}' +
      'table{display:block;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;}' +
    '}' +
    '</style>' +
    '</head><body>' + bodyHtml + '</body></html>';
}

/**
 * _buildCasePrintDocument — wraps case-report HTML with the exact
 * same print CSS used by quickPrintCase() in cases.js (unchanged).
 * @param {string} bodyHtml
 * @returns {string}
 */
function _buildCasePrintDocument(bodyHtml) {
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">' +
    '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0;}' +
    'body{font-family:Cairo,Arial,sans-serif;background:#fff;color:#111;direction:rtl;max-width:100%;overflow-x:hidden;}' +
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
    'table{width:100%;min-width:520px;border-collapse:collapse;font-size:12px;}' +
    'th,td{padding:7px 10px;border:1px solid #e8e0d0;text-align:right;}' +
    'th{background:#f5f0e8;color:#8B6914;font-weight:700;}' +
    '@media screen and (max-width:640px){' +
      '.view-body{padding:10px 6px;}' +
      '.view-header{flex-direction:column;gap:6px;}' +
      '.view-grid{grid-template-columns:1fr;}' +
      '.view-field{border-left:none;}' +
      '.session-row{grid-template-columns:48px 1fr;}' +
      'table{display:block;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;}' +
    '}' +
    '</style></head><body>' + bodyHtml + '</body></html>';
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// every function above remains a plain global function exactly as
// before). Mirrors js/modules/documents.js's export block (Sub-Phase
// 9.3), extended with the additional Clients-only functions the
// integration test harness (js/tests/verify_clients_repository_
// integration.js) and regression suite need to reach directly.
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `clientsRepository`/`CLIENTS_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render/updateBadges/toast`), matching every other
// entity module's `restoreClient()` refresh sequence exactly.
//
// `clientsRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/ClientsRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastClientAction() — PHASE 12.5. Reverses the most recent
 * Clients mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastClientAction() {
  await ensureClientsRepositoryReady();

  try {
    if (!clientsRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = clientsRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(clientsRepository, CLIENTS_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncClientsMirror();
    saveLocal();
    renderClients();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('clients'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('cases'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastClientAction() — PHASE 12.5. Re-applies the most recently
 * undone Clients mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastClientAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastClientAction() {
  await ensureClientsRepositoryReady();

  try {
    if (!clientsRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = clientsRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(clientsRepository, CLIENTS_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncClientsMirror();
    saveLocal();
    renderClients();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('clients'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('cases'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clientsUndoManager: clientsUndoManager,
    undoLastClientAction: undoLastClientAction,
    redoLastClientAction: redoLastClientAction,
    CLIENTS_FIELDS: CLIENTS_FIELDS,
    CLIENTS_MAP: CLIENTS_MAP,
    CLIENTS_ID_FIELD: CLIENTS_ID_FIELD,
    clientsRepository: clientsRepository,
    ensureClientsRepositoryReady: ensureClientsRepositoryReady,
    syncClientsMirror: syncClientsMirror,
    resolveClientIndex: resolveClientIndex,
    renderClients: renderClients,
    searchClients: searchClients,
    saveClient: saveClient,
    editClient: editClient,
    deleteClient: deleteClient,
    restoreClient: restoreClient,
    viewClient: viewClient,
    buildClientReport: buildClientReport,
    printClientFile: printClientFile,
    printView: printView,
    printClientsReport: printClientsReport,
    genClientQR: genClientQR,
    showClientPortal: showClientPortal,
    displayPortalModal: displayPortalModal,
    copyPortalLink: copyPortalLink,
    openPortalDirect: openPortalDirect,
    revokeAndRegenQR: revokeAndRegenQR,
    toggleClientSelector: toggleClientSelector,
    closeClientSelector: closeClientSelector,
    renderClientSelectorList: renderClientSelectorList,
    toggleCaseClient: toggleCaseClient,
    removeCaseClient: removeCaseClient,
    syncCaseClientSelectorFromField: syncCaseClientSelectorFromField,
    _splitClientNames: _splitClientNames,
    _autofillCaseClientDetails: _autofillCaseClientDetails
  };
}
