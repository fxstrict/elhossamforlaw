/**
 * ================================================================
 * js/modules/opponents.js — وحدة الخصوم | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 37 — Opponents Module (new file, fully additive)
 *
 * Built the same way js/modules/clients.js was (see that file's own
 * header for the full rationale of every pattern reused here):
 *   - Reads/writes go through js/repositories/OpponentsRepository.js
 *     (own 'opponents' localStorage/IndexedDB entity — never touches
 *     'clients').
 *   - `data.opponents` is kept as a synced, read-only mirror of
 *     `opponentsRepository.getAll()`, exactly like `data.clients`, so
 *     any other module that ever needs to read it later can, without
 *     this module needing to know about it.
 *   - INDEX -> RECORD -> ID translation layer identical to Clients'
 *     (`resolveOpponentIndex`), because index.html's row templates use
 *     plain onclick="editOpponent(N)" indexes.
 *   - Soft delete via OpponentsRepository (`softDelete: true`).
 *
 * SECOND RESPONSIBILITY — CASE OPPONENT MULTI-SELECTOR
 *   This file ALSO wires the "اختيار خصم أو أكثر" picker inside the
 *   existing case modal (#modalCase), using the exact same
 *   wrap-the-existing-function technique js/modules/clients.js already
 *   uses for the client picker — copied verbatim in spirit, adapted to
 *   Opponents, and NEVER editing js/modules/cases.js itself. Because
 *   each wrap chains to the previous function reference, this module's
 *   wrapping of `editCase`/`saveCase`/`resetForm('cases')` composes
 *   safely regardless of load order — every wrapper always calls the
 *   reference it captured, not a hardcoded name.
 *
 * STORAGE OF THE SELECTION ON THE CASE RECORD
 *   A new column, 'رقم_الخصوم' (JSON array of opponent id strings), is
 *   written onto the case object being saved — purely additive next to
 *   the case's existing 'اسم_الخصم'/'رقم_قومي_الخصم'/etc. flat text
 *   fields (Config/00_Config.gs's SHEET_DEFS already lists
 *   'رقم_الخصوم' for 'القضايا' — see that file). Those legacy flat
 *   fields are NOT removed and keep working exactly as before: when
 *   the case has exactly one selected opponent, this module also
 *   autofills them from the opponent's own record, so print/report
 *   code that already reads those flat fields keeps working unmodified.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data, editIdx, ApiService, saveLocal(), toast(), closeModal(),
 *     val(), uid(), collectForm(), fillForm(), resetForm(),
 *     confirmDialog() — same shared globals every sibling module uses.
 *   - OpponentsRepository : js/repositories/OpponentsRepository.js
 *   - OpponentFields       : js/modules/opponent-fields.js
 *   - escapeHtml()         : already defined globally by clients.js
 *     (this file guards with a local fallback in case load order ever
 *     changes, but index.html loads clients.js first).
 *
 * Sheet name (GAS): 'الخصوم'
 *
 * Does NOT touch:
 *   - Clients, Cases, Sessions, Documents, Tasks, Fees, Calendar,
 *     Library, Templates, Settings, Children (only *wraps* three of
 *     cases.js's existing functions from the outside — never edits
 *     cases.js itself)
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     IndexedDBAdapter.js, js/repositories/ClientsRepository.js
 * ================================================================
 */

// escapeHtml fallback — only used if this file is ever loaded before
// clients.js defines the real one (defensive; not the normal load
// order index.html uses).
if (typeof escapeHtml !== 'function') {
  var escapeHtml = function (v) {
    if (v == null) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
}

// ================================================================
// Repository wiring
// ================================================================
var OpponentsRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/OpponentsRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var OpponentsRepository = OpponentsRepositoryNS && OpponentsRepositoryNS.OpponentsRepository;

if (typeof OpponentsRepository !== 'function') {
  throw new Error(
    'opponents.js requires js/repositories/OpponentsRepository.js to be ' +
    'loaded first (OpponentsRepository class not found).'
  );
}

var OPPONENTS_ID_FIELD = 'رقم_الخصم';

/** The single OpponentsRepository instance this module talks to. */
var opponentsRepository = new OpponentsRepository();

var opponentsRepositoryReadyPromise = (function () {
  var _p = opponentsRepository.open().then(function () {
    syncOpponentsMirror();
  }).catch(function (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('OpponentsRepository failed to open:', err);
    }
  });
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('opponents', _p) : _p;
})();

function ensureOpponentsRepositoryReady() {
  if (opponentsRepository.isReady()) return Promise.resolve();
  return opponentsRepositoryReadyPromise;
}

/**
 * syncOpponentsMirror — refreshes data.opponents from the Repository's
 * current state (soft-deleted records excluded).
 */
function syncOpponentsMirror() {
  if (typeof data !== 'undefined') data.opponents = opponentsRepository.getAll();
}

function resolveOpponentIndex(list, record) {
  var id = record ? record[OPPONENTS_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][OPPONENTS_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة الخصوم
// ================================================================
function renderOpponents() {
  if (!opponentsRepository.isReady()) return;

  var s = (document.getElementById('searchOpponents') && typeof val === 'function') ? val('searchOpponents').toLowerCase() : '';

  syncOpponentsMirror();
  var allOpponents = data.opponents || [];

  var queryModel = {};
  if (s) queryModel.search = s;
  var rows = opponentsRepository.search(queryModel).items;

  var tb = document.getElementById('opponentsTableBody');
  var em = document.getElementById('opponentsEmpty');
  var ml = document.getElementById('opponentsMobileList');
  var countBadge = document.getElementById('opponentsCount');
  if (countBadge) countBadge.textContent = allOpponents.length;

  if (!rows.length) {
    if (tb) tb.innerHTML = '';
    if (ml) ml.innerHTML = '';
    if (em) em.style.display = '';
    return;
  }
  if (em) em.style.display = 'none';

  function desktopOpponentRowInner(o) {
    var ri = resolveOpponentIndex(allOpponents, o);
    var phone = _opponentFirstPhone(o);
    return '<td><strong>' + escapeHtml(o['الاسم'] || '—') + '</strong></td>' +
      '<td>' + escapeHtml(o['النوع'] || '—') + '</td>' +
      '<td>' + escapeHtml(phone || '—') + '</td>' +
      '<td style="direction:ltr;text-align:right;">' + escapeHtml(o['الرقم_القومي'] || '—') + '</td>' +
      '<td>' + escapeHtml(o['الوظيفة'] || '—') + '</td>' +
      '<td>' +
        '<button class="btn btn-info btn-sm btn-icon" onclick="viewOpponent(' + ri + ')" title="عرض">&#128065;</button> ' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editOpponent(' + ri + ')" title="تعديل">&#9998;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteOpponent(' + ri + ')" title="حذف">&#128465;</button>' +
      '</td>';
  }

  function mobileOpponentCardInner(o) {
    var ri = resolveOpponentIndex(allOpponents, o);
    var phone = _opponentFirstPhone(o);
    return '<div class="m-card-header">' +
        '<div class="m-card-title">&#129333; ' + escapeHtml(o['الاسم'] || '—') + '</div>' +
        '<div class="m-card-num">' + escapeHtml(o['النوع'] || '—') + '</div>' +
      '</div>' +
      '<div class="m-card-meta">' +
        (phone ? '<span>&#128222; ' + escapeHtml(phone) + '</span>' : '') +
        (o['الوظيفة'] ? '<span>&#128188; ' + escapeHtml(o['الوظيفة']) + '</span>' : '') +
      '</div>' +
      '<div class="m-card-actions">' +
        '<button class="btn btn-info btn-sm" onclick="viewOpponent(' + ri + ')" style="flex:1;">&#128065; عرض</button>' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editOpponent(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteOpponent(' + ri + ')">&#128465;</button>' +
      '</div>';
  }

  if (tb) tb.innerHTML = rows.map(function (o) { return '<tr>' + desktopOpponentRowInner(o) + '</tr>'; }).join('');
  if (ml) ml.innerHTML = rows.map(function (o) { return '<div class="m-card">' + mobileOpponentCardInner(o) + '</div>'; }).join('');
}

function searchOpponents() { renderOpponents(); }

function _opponentPhones(o) {
  if (!o) return [];
  try {
    var arr = JSON.parse(o['أرقام_الهواتف'] || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function _opponentAddresses(o) {
  if (!o) return [];
  try {
    var arr = JSON.parse(o['العناوين'] || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function _opponentFirstPhone(o) {
  var p = _opponentPhones(o);
  return p.length ? p[0].number : '';
}

// ================================================================
// CRUD — إنشاء / تحديث / حذف / عرض الخصوم
// ================================================================
async function saveOpponent() {
  var name = document.getElementById('fOpponentName') ? document.getElementById('fOpponentName').value.trim() : '';
  if (!name) {
    toast('يرجى إدخال اسم الخصم', 'error');
    return;
  }

  await ensureOpponentsRepositoryReady();

  var obj = collectForm('opponents');

  if (window.OpponentFields && typeof OpponentFields.collect === 'function') {
    var extended = OpponentFields.collect();
    Object.keys(extended).forEach(function (k) { obj[k] = extended[k]; });
  }

  obj[OPPONENTS_ID_FIELD] = obj[OPPONENTS_ID_FIELD] || uid();
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.opponents;
  var result;

  if (idx >= 0) {
    var existingId = data.opponents[idx] ? data.opponents[idx][OPPONENTS_ID_FIELD] : null;
    result = await opponentsRepository.update(existingId, obj);
  } else {
    result = await opponentsRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء حفظ بيانات الخصم', 'error');
    return;
  }

  syncOpponentsMirror();

  toast(idx >= 0 ? 'تم تحديث بيانات الخصم' : 'تمت إضافة الخصم بنجاح', 'success');

  saveLocal();
  ApiService.syncRow('الخصوم', result.record, idx);

  closeModal('modalOpponent');
  renderOpponents();
  updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('opponents'); ApplicationShell.markDirty('cases'); }
  if (typeof renderOpponentSelectorList === 'function') renderOpponentSelectorList();
}

function editOpponent(i) {
  editIdx.opponents = i;
  fillForm('opponents', data.opponents[i]);
  if (window.OpponentFields && typeof OpponentFields.fill === 'function') {
    OpponentFields.fill(data.opponents[i]);
  }
  document.getElementById('modalOpponentTitle').textContent = 'تعديل بيانات الخصم';
  document.getElementById('modalOpponent').classList.add('open');
}

async function deleteOpponent(i) {
  if (!(await confirmDialog('حذف هذا الخصم من السجل؟'))) return;

  await ensureOpponentsRepositoryReady();

  var record = data.opponents[i];
  if (!record) return;

  var id = record[OPPONENTS_ID_FIELD];

  ApiService.deleteData('الخصوم', i);

  var result = await opponentsRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء حذف الخصم', 'error');
    return;
  }

  syncOpponentsMirror();
  saveLocal();
  toast('تم حذف الخصم', 'info');
  renderOpponents();
  updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('opponents'); ApplicationShell.markDirty('cases'); }
  if (typeof renderOpponentSelectorList === 'function') renderOpponentSelectorList();
}

async function restoreOpponent(id) {
  await ensureOpponentsRepositoryReady();
  var result = await opponentsRepository.restore(id);
  if (!result || !result.success) {
    toast('حدث خطأ أثناء استرجاع الخصم', 'error');
    return;
  }
  syncOpponentsMirror();
  saveLocal();
  toast('تم استرجاع الخصم', 'success');
  renderOpponents();
  updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('opponents'); ApplicationShell.markDirty('cases'); }
}

/**
 * viewOpponent — عرض بطاقة الخصم. تُنشئ Overlay مؤقتاً ديناميكياً
 * وتُزيله عند الإغلاق، فلا حاجة لتعديل index.html من أجلها.
 * @param {number} i
 */
function viewOpponent(i) {
  var o = data.opponents[i];
  if (!o) return;
  var phones = _opponentPhones(o).map(function (p) { return escapeHtml(p.type) + ': ' + escapeHtml(p.number); }).join('<br>') || '—';
  var addresses = _opponentAddresses(o).map(function (a) { return escapeHtml(a.type) + ': ' + escapeHtml(a.detail); }).join('<br>') || '—';

  var html =
    '<div class="modal-overlay open" id="opponentViewOverlay" onclick="if(event.target===this)this.remove();">' +
      '<div class="modal">' +
        '<div class="modal-header"><div class="modal-title">&#129333; ' + escapeHtml(o['الاسم'] || '—') + '</div><button class="modal-close" onclick="document.getElementById(\'opponentViewOverlay\').remove();">&#10005;</button></div>' +
        '<div class="modal-body">' +
          '<p><strong>النوع:</strong> ' + escapeHtml(o['النوع'] || '—') + '</p>' +
          '<p><strong>الرقم القومي:</strong> ' + escapeHtml(o['الرقم_القومي'] || '—') + '</p>' +
          '<p><strong>الجنسية:</strong> ' + escapeHtml(o['الجنسية'] || '—') + '</p>' +
          '<p><strong>رقم جواز السفر:</strong> ' + escapeHtml(o['رقم_جواز_السفر'] || '—') + '</p>' +
          '<p><strong>الوظيفة:</strong> ' + escapeHtml(o['الوظيفة'] || '—') + '</p>' +
          '<p><strong>جهة العمل:</strong> ' + escapeHtml(o['جهة_العمل'] || '—') + '</p>' +
          '<p><strong>الهواتف:</strong><br>' + phones + '</p>' +
          '<p><strong>العناوين:</strong><br>' + addresses + '</p>' +
        '</div>' +
        '<div class="modal-footer"><button class="btn btn-ghost" onclick="document.getElementById(\'opponentViewOverlay\').remove();">إغلاق</button></div>' +
      '</div>' +
    '</div>';

  var existing = document.getElementById('opponentViewOverlay');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);
}

// ================================================================
// CASE OPPONENT MULTI-SELECTOR — اختيار خصم أو أكثر عند إنشاء قضية
// ================================================================
// Same UI pattern as the existing client selector inside #modalCase
// (id="opponentSelectorBox"/"opponentSelectorPanel"/"opponentSelectorList"/
// "opponentSelectorChips", hidden field id="fCaseOpponents") — reuses
// the SAME CSS classes the client selector already uses
// (client-selector-*), so no CSS file needed changing.

var _caseSelectedOpponentIds = [];

function toggleOpponentSelector(evt) {
  if (evt) evt.stopPropagation();
  var panel = document.getElementById('opponentSelectorPanel');
  if (!panel) return;
  var willOpen = !panel.classList.contains('open');
  document.querySelectorAll('.client-selector-panel').forEach(function (p) { p.classList.remove('open'); });
  if (willOpen) {
    panel.classList.add('open');
    renderOpponentSelectorList();
    var search = document.getElementById('opponentSelectorSearch');
    if (search) { search.value = ''; search.focus(); }
  }
}

function renderOpponentSelectorList() {
  var list = document.getElementById('opponentSelectorList');
  if (!list) return;
  var q = (document.getElementById('opponentSelectorSearch') ? document.getElementById('opponentSelectorSearch').value : '').trim().toLowerCase();
  var all = (data.opponents || []).slice().sort(function (a, b) {
    return String(a['الاسم'] || '').localeCompare(String(b['الاسم'] || ''), 'ar');
  });
  var filtered = q ? all.filter(function (o) { return String(o['الاسم'] || '').toLowerCase().indexOf(q) !== -1; }) : all;

  if (!filtered.length) {
    list.innerHTML = '<div class="client-selector-empty">لا يوجد خصوم مطابقون — يمكنك إضافة خصم جديد من صفحة الخصوم.</div>';
  } else {
    list.innerHTML = filtered.map(function (o) {
      var id = o[OPPONENTS_ID_FIELD];
      var checked = _caseSelectedOpponentIds.indexOf(id) !== -1;
      return '<div class="client-selector-item' + (checked ? ' selected' : '') + '" onclick="toggleCaseOpponent(\'' + id + '\')">' +
        '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onclick="event.stopPropagation();toggleCaseOpponent(\'' + id + '\')">' +
        '<span>' + escapeHtml(o['الاسم'] || '—') + (o['النوع'] ? ' <small>(' + escapeHtml(o['النوع']) + ')</small>' : '') + '</span>' +
      '</div>';
    }).join('');
  }
  renderOpponentSelectorChips();
}

function toggleCaseOpponent(id) {
  var pos = _caseSelectedOpponentIds.indexOf(id);
  if (pos === -1) _caseSelectedOpponentIds.push(id);
  else _caseSelectedOpponentIds.splice(pos, 1);
  _syncCaseOpponentField();
  renderOpponentSelectorList();
}

function removeCaseOpponent(id) {
  var pos = _caseSelectedOpponentIds.indexOf(id);
  if (pos !== -1) _caseSelectedOpponentIds.splice(pos, 1);
  _syncCaseOpponentField();
  renderOpponentSelectorList();
}

function renderOpponentSelectorChips() {
  var chips = document.getElementById('opponentSelectorChips');
  if (!chips) return;
  if (!_caseSelectedOpponentIds.length) {
    chips.innerHTML = '<span class="client-selector-placeholder">اختر خصماً واحداً أو أكثر من القائمة...</span>';
    return;
  }
  chips.innerHTML = _caseSelectedOpponentIds.map(function (id) {
    var o = (data.opponents || []).filter(function (x) { return x[OPPONENTS_ID_FIELD] === id; })[0];
    var label = o ? o['الاسم'] : id;
    return '<span class="client-selector-chip">' + escapeHtml(label) +
      '<button type="button" onclick="event.stopPropagation();removeCaseOpponent(\'' + id + '\')">&times;</button></span>';
  }).join('');
}

/**
 * _syncCaseOpponentField — writes the current selection into the
 * hidden #fCaseOpponents field (JSON array of ids) and, when exactly
 * one opponent is selected, autofills the legacy flat fields
 * (fCaseOpponent/NID/Phone/Addr/Job/Employer) from that opponent's own
 * record. Purely additive: never clears those fields when 0 or 2+
 * opponents are selected, so any value the user typed manually is
 * never silently erased.
 */
function _syncCaseOpponentField() {
  var hidden = document.getElementById('fCaseOpponents');
  if (hidden) hidden.value = JSON.stringify(_caseSelectedOpponentIds);
  renderOpponentSelectorChips();

  if (_caseSelectedOpponentIds.length === 1) {
    var o = (data.opponents || []).filter(function (x) { return x[OPPONENTS_ID_FIELD] === _caseSelectedOpponentIds[0]; })[0];
    if (o) {
      var setIf = function (fieldId, value) {
        var el = document.getElementById(fieldId);
        if (el) el.value = value || '';
      };
      setIf('fCaseOpponent', o['الاسم']);
      setIf('fCaseOpponentNID', o['الرقم_القومي']);
      setIf('fCaseOpponentPhone', _opponentFirstPhone(o));
      var addr = _opponentAddresses(o)[0];
      setIf('fCaseOpponentAddr', addr ? addr.detail : '');
      setIf('fCaseOpponentJob', o['الوظيفة']);
      setIf('fCaseOpponentEmployer', o['جهة_العمل']);
    }
  }
}

/**
 * syncCaseOpponentSelectorFromField — rebuilds `_caseSelectedOpponentIds`
 * from a case record's own 'رقم_الخصوم' column (called by the
 * editCase() wrap below). Tolerates missing/malformed/legacy (pre-
 * Phase-37) case records gracefully — an absent or unparsable column
 * simply yields an empty selection, exactly like a brand new case.
 * @param {Object} caseRecord
 */
function syncCaseOpponentSelectorFromField(caseRecord) {
  _caseSelectedOpponentIds = [];
  var raw = caseRecord ? caseRecord['رقم_الخصوم'] : null;
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _caseSelectedOpponentIds = parsed;
    } catch (e) { /* legacy/malformed value — start empty, non-fatal */ }
  }
  var hidden = document.getElementById('fCaseOpponents');
  if (hidden) hidden.value = JSON.stringify(_caseSelectedOpponentIds);
  renderOpponentSelectorChips();
}

// Close the picker panel on outside click (mirrors the client
// selector's own document-level listener; both listeners coexist
// harmlessly since each only ever touches its own DOM ids).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function () {
    var panel = document.getElementById('opponentSelectorPanel');
    if (panel) panel.classList.remove('open');
  });
}

// ----------------------------------------------------------------
// Wrap resetForm/editCase/saveCase — SAME non-invasive technique
// js/modules/clients.js already uses for the client picker. Wrapping
// (not editing) js/modules/cases.js means this file adds opponent
// support without risking a single byte of that file's own, already
// heavily-audited logic.
// ----------------------------------------------------------------
if (typeof resetForm === 'function') {
  var _origResetFormForOpponents = resetForm;
  resetForm = function (type) {
    var r = _origResetFormForOpponents.apply(this, arguments);
    if (type === 'cases') {
      _caseSelectedOpponentIds = [];
      var hidden = document.getElementById('fCaseOpponents');
      if (hidden) hidden.value = '[]';
      renderOpponentSelectorChips();
    }
    return r;
  };
}

if (typeof editCase === 'function') {
  var _origEditCaseForOpponents = editCase;
  editCase = function (i) {
    var r = _origEditCaseForOpponents.apply(this, arguments);
    var record = (typeof data !== 'undefined' && data.cases) ? data.cases[i] : null;
    syncCaseOpponentSelectorFromField(record);
    return r;
  };
}

if (typeof saveCase === 'function') {
  var _origSaveCaseForOpponents = saveCase;
  saveCase = async function () {
    var hidden = document.getElementById('fCaseOpponents');
    if (hidden) hidden.value = JSON.stringify(_caseSelectedOpponentIds);
    return _origSaveCaseForOpponents.apply(this, arguments);
  };
}

// ================================================================
// Exports (Node/test harness only — browser globals are the plain
// function declarations above, same convention as clients.js)
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    opponentsRepository: opponentsRepository,
    renderOpponents: renderOpponents,
    saveOpponent: saveOpponent,
    editOpponent: editOpponent,
    deleteOpponent: deleteOpponent,
    restoreOpponent: restoreOpponent,
    viewOpponent: viewOpponent,
    toggleCaseOpponent: toggleCaseOpponent,
    removeCaseOpponent: removeCaseOpponent,
    syncCaseOpponentSelectorFromField: syncCaseOpponentSelectorFromField,
    renderOpponentSelectorList: renderOpponentSelectorList
  };
}
