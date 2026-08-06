/**
 * ================================================================
 * js/modules/client-messages.js — وحدة رسائل وملاحظات الموكل
 * نظام الحسام للمحاماة
 * ================================================================
 * INTEGRATION PHASE — Client Portal Messages Wiring.
 *
 * WHAT THIS FILE IS
 *   Connects the already-live 'رسائل_الموكل' sheet (Config/00_Config.gs
 *   SHEET_DEFS) and the already-live Config/05_Portal.gs read path to
 *   the rest of the app: a lawyer can now add/edit/delete a client
 *   message or note from inside the client's own view (viewClient()),
 *   choose whether it also targets one specific case of that client,
 *   and toggle whether it is visible on the client portal
 *   ('ظاهر_للموكل') — exactly mirroring the same show/hide toggle now
 *   also added to Tasks and Documents (see js/repositories/
 *   TasksRepository.js / DocumentsRepository.js LEGACY_FIELDS additions
 *   and the matching FIELDS.tasks/FIELDS.documents + modal <select>
 *   additions in index.html, same phase).
 *
 *   Follows the exact structural pattern already established by
 *   js/modules/documents.js / js/modules/tasks.js: Repository instance
 *   -> open() -> readyPromise -> mirror (`data.clientMessages`) ->
 *   render/save/edit/delete, using js/repositories/
 *   ClientMessagesRepository.js (new, this phase) the same way those
 *   two use their own Repository files.
 *
 * WHAT THIS FILE IS NOT
 *   - Does not modify js/modules/clients.js beyond the single
 *     `renderClientMessagesSection(c)` call site already added to
 *     `buildClientReport()` (same phase, additive one-liner).
 *   - Does not modify js/repositories/*.js, js/core/*.js, Config/*.gs.
 *   - Does not touch cases.js/dashboard.js/any other module.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data, editIdx        : shared app state (data.clientMessages,
 *                             editIdx.clientMessages — both added to
 *                             index.html this phase)
 *   - ApiService            : js/api/api.js (generic sheet sync)
 *   - saveLocal(), toast(), confirmDialog(), closeModal(), val(),
 *     uid(), collectForm(), fillForm(), resetForm(), formatDate()
 *   - ClientMessagesRepository : js/repositories/ClientMessagesRepository.js
 *
 * GAS Sheet name: 'رسائل_الموكل'
 * ================================================================
 */

'use strict';

// ================================================================
// 1. Repository instantiation (same dual Node/browser pattern as
//    every other module — see js/modules/tasks.js §"Repository
//    instantiation" for the reference this mirrors).
// ================================================================

var ClientMessagesRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/ClientMessagesRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var ClientMessagesRepository = ClientMessagesRepositoryNS && ClientMessagesRepositoryNS.ClientMessagesRepository;

if (typeof ClientMessagesRepository !== 'function') {
  throw new Error(
    'client-messages.js requires js/repositories/ClientMessagesRepository.js ' +
    'to be loaded first (ClientMessagesRepository class not found).'
  );
}

var CLIENT_MESSAGES_ID_FIELD = 'id';

/**
 * The single ClientMessagesRepository instance this module talks to.
 * Default construction wires it to the real DatabaseService +
 * IndexedDBAdapter pair, backed by the 'clientMessages' object store
 * (js/core/IndexedDBSchema.js SCHEMA_VERSIONS version 2, this phase).
 */
var clientMessagesRepository = new ClientMessagesRepository();

/**
 * Resolves once ClientMessagesRepository.open() has loaded its initial
 * in-memory copy from storage (Repository Contract §11). Every write
 * path awaits this first; render functions stay synchronous.
 */
var clientMessagesRepositoryReadyPromise = (function () {
  var _p = clientMessagesRepository.open().then(function () {
    syncClientMessagesMirror();
  }).catch(function (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('ClientMessagesRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // clientMessagesRepository.open() can never hang
  // ensureClientMessagesRepositoryReady() forever. See
  // js/core/RepositoryReadyTimeout.js. Purely additive: if that helper
  // isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('clientMessages', _p) : _p;
})();

/**
 * ensureClientMessagesRepositoryReady() — awaited by every write path.
 * @returns {Promise<void>}
 */
function ensureClientMessagesRepositoryReady() {
  if (clientMessagesRepository.isReady()) return Promise.resolve();
  return clientMessagesRepositoryReadyPromise;
}

/**
 * syncClientMessagesMirror — refreshes the legacy global
 * `data.clientMessages` array from the Repository's current state,
 * exactly the same convention `syncTasksMirror()`/`syncDocumentsMirror()`
 * already follow.
 */
function syncClientMessagesMirror() {
  data.clientMessages = clientMessagesRepository.getAll();
}

/**
 * resolveClientMessageIndex(list, record) — same "index -> record -> id"
 * translation-layer helper every other Repository-backed module defines
 * (see resolveTaskIndex() in tasks.js / resolveDocIndex() in
 * documents.js): finds `record`'s CURRENT position inside `list` by
 * identifier equality, since Repository reads return cloned objects
 * (reference-equality lookups no longer work).
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveClientMessageIndex(list, record) {
  var id = record ? record[CLIENT_MESSAGES_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][CLIENT_MESSAGES_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// 2. Case-dropdown helper, scoped to ONE client
// ================================================================

/**
 * populateClientCaseDropdown(selectId, clientName, selectedVal) —
 * same idea as cases.js's populateCaseDropdown(), but filtered down to
 * only the cases belonging to one client (a message optionally targets
 * one specific case of THIS client, never an unrelated one). Reads
 * data.cases directly (read-only), exactly like populateCaseDropdown()
 * does — no new dependency, no change to cases.js.
 * @param {string} selectId
 * @param {string} clientName - matched against اسم_الموكل (cases.js's
 *   own linkage field for a client, same field fees.js/fFeeClient use).
 * @param {string} [selectedVal]
 */
function populateClientCaseDropdown(selectId, clientName, selectedVal) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  var current = selectedVal || sel.value;
  sel.innerHTML = '<option value="">-- كل قضايا الموكل --</option>';
  (data.cases || []).forEach(function (cs) {
    if ((cs['اسم_الموكل'] || '') !== clientName) return;
    var num = cs['رقم_القضية'] || '';
    var title = cs['عنوان_القضية'] || '';
    var opt = document.createElement('option');
    opt.value = num;
    opt.textContent = num + (title ? ' — ' + title : '');
    if (num === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ================================================================
// 3. Add / Edit modal
// ================================================================

/**
 * Tracks which message (by id, not index — same reasoning as every
 * other Repository-backed module's "ID, NOT INDEX" notes) the add/edit
 * modal is currently editing. null => adding a new message.
 */
var _clientMsgEditingId = null;

/**
 * openAddClientMessage(clientId, clientName) — opens the modal to add a
 * new message/note for one client.
 * @param {string} clientId   - رقم_الموكل of the client this message
 *                              belongs to (mandatory, stamped into the
 *                              hidden #fMsgClientId field).
 * @param {string} clientName - اسم_الموكل, used only to scope the
 *                              optional case dropdown to this client's
 *                              own cases.
 */
function openAddClientMessage(clientId, clientName) {
  _clientMsgEditingId = null;
  resetForm('clientMessages');
  document.getElementById('fMsgClientId').value = clientId || '';
  populateClientCaseDropdown('fMsgCaseNum', clientName || '');
  document.getElementById('modalClientMsgTitle').textContent = 'إضافة رسالة/ملاحظة';
  document.getElementById('modalClientMsg').classList.add('open');
}

/**
 * editClientMessage(id, clientName) — opens the modal pre-filled with an
 * existing message. Purely synchronous: reads the already-synced
 * data.clientMessages mirror, same as editTask()/editDocument().
 * @param {string} id
 * @param {string} clientName
 */
function editClientMessage(id, clientName) {
  var m = (data.clientMessages || []).filter(function (r) { return r[CLIENT_MESSAGES_ID_FIELD] === id; })[0];
  if (!m) return;
  _clientMsgEditingId = id;
  fillForm('clientMessages', m);
  populateClientCaseDropdown('fMsgCaseNum', clientName || '', m['رقم_القضية'] || '');
  document.getElementById('modalClientMsgTitle').textContent = 'تعديل رسالة/ملاحظة';
  document.getElementById('modalClientMsg').classList.add('open');
}

/**
 * saveClientMessage — create/update via ClientMessagesRepository,
 * mirrors saveTask()/saveDocument()'s create-vs-update + ApiService.syncRow
 * pattern exactly.
 */
async function saveClientMessage() {
  var clientId = (document.getElementById('fMsgClientId').value || '').trim();
  var text = (document.getElementById('fMsgText').value || '').trim();

  if (!clientId) {
    toast('لا يوجد موكل محدد لهذه الرسالة', 'error');
    return;
  }
  if (!text) {
    toast('يرجى إدخال نص الرسالة', 'error');
    return;
  }

  await ensureClientMessagesRepositoryReady();

  var obj = collectForm('clientMessages');
  obj['التاريخ'] = obj['التاريخ'] || new Date().toISOString().slice(0, 10);
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var result;
  if (_clientMsgEditingId) {
    result = await clientMessagesRepository.update(_clientMsgEditingId, obj);
  } else {
    result = await clientMessagesRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncClientMessagesMirror();
  saveLocal();
  toast(_clientMsgEditingId ? 'تم التحديث' : 'تمت الإضافة', 'success');
  // ApiService.syncRow's rowIndex param: >=0 means "update the sheet row
  // at this 0-based frontend index", <0 means "append a new row" — same
  // contract every other module (tasks.js/documents.js) already relies
  // on. resolveClientMessageIndex() below finds the just-saved record's
  // CURRENT position in the freshly-synced mirror (never a stale/guessed
  // index), exactly mirroring resolveTaskIndex()/resolveDocIndex().
  var syncIdx = _clientMsgEditingId ? resolveClientMessageIndex(data.clientMessages, result.record) : -1;
  ApiService.syncRow('رسائل_الموكل', result.record, syncIdx);
  closeModal('modalClientMsg');
  refreshClientMessagesPanel(clientId);
  if (window.ApplicationShell) { ApplicationShell.markDirty('clientMessages'); }
}

/**
 * deleteClientMessage — confirms, soft-deletes via
 * ClientMessagesRepository (softDelete: true, same as every other
 * entity Repository), then refreshes the panel in place.
 * @param {string} id
 * @param {string} clientId - needed to know which panel to re-render.
 */
async function deleteClientMessage(id, clientId) {
  if (!(await confirmDialog('هل تريد حذف هذه الرسالة/الملاحظة؟'))) return;

  await ensureClientMessagesRepositoryReady();

  var result = await clientMessagesRepository.delete(id);
  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncClientMessagesMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  refreshClientMessagesPanel(clientId);
  if (window.ApplicationShell) { ApplicationShell.markDirty('clientMessages'); }
}

// ================================================================
// 4. Render — embedded inside the client view (buildClientReport())
// ================================================================

/**
 * renderClientMessagesSection(client) -> HTML string. Called from
 * js/modules/clients.js's buildClientReport() (single additive call
 * site, same phase). Interactive controls (add/edit/delete buttons)
 * carry the `no-print` class so printClientFile()'s printed output
 * stays a clean report, matching the convention already used elsewhere
 * for print-only vs. screen-only content in this project.
 * @param {Object} client - one data.clients[] record.
 * @returns {string}
 */
function renderClientMessagesSection(client) {
  var clientId = client['رقم_الموكل'] || '';
  var clientName = client['الاسم'] || '';

  function f(v) {
    return (v == null ? '' : String(v))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var msgs = (data.clientMessages || []).filter(function (m) {
    return String(m['رقم_الموكل'] || '') === String(clientId);
  }).sort(function (a, b) {
    return String(b['التاريخ'] || '').localeCompare(String(a['التاريخ'] || ''));
  });

  var html = '<div id="clientMsgSection" data-client-id="' + f(clientId) + '" ' +
    'style="margin-top:18px;padding-top:14px;border-top:1px solid #e8e0d0;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
    '<h4 style="margin:0;color:#8a6d1f;">رسائل وملاحظات الموكل' +
    (msgs.length ? ' (' + msgs.length + ')' : '') + '</h4>' +
    '<button type="button" class="btn btn-sm btn-primary no-print" ' +
    'onclick="openAddClientMessage(\'' + f(clientId) + '\',\'' + f(clientName) + '\')">' +
    '&#10133; إضافة رسالة</button>' +
  '</div>';

  if (!msgs.length) {
    html += '<div style="color:#999;font-size:12px;">لا توجد رسائل أو ملاحظات مسجلة لهذا الموكل بعد.</div>';
  } else {
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<tr style="background:#faf6ec;">' +
        '<th style="padding:6px 8px;border:1px solid #e8e0d0;">التاريخ</th>' +
        '<th style="padding:6px 8px;border:1px solid #e8e0d0;">النوع</th>' +
        '<th style="padding:6px 8px;border:1px solid #e8e0d0;">القضية</th>' +
        '<th style="padding:6px 8px;border:1px solid #e8e0d0;">النص</th>' +
        '<th style="padding:6px 8px;border:1px solid #e8e0d0;">ظاهر للموكل؟</th>' +
        '<th style="padding:6px 8px;border:1px solid #e8e0d0;" class="no-print">إجراءات</th>' +
      '</tr>';
    msgs.forEach(function (m) {
      var id = m[CLIENT_MESSAGES_ID_FIELD];
      var visible = (m['ظاهر_للموكل'] === 'نعم');
      html += '<tr>' +
        '<td style="padding:6px 8px;border:1px solid #e8e0d0;">' + f(m['التاريخ'] ? formatDate(m['التاريخ']) : '') + '</td>' +
        '<td style="padding:6px 8px;border:1px solid #e8e0d0;">' + f(m['نوع_الرسالة']) + '</td>' +
        '<td style="padding:6px 8px;border:1px solid #e8e0d0;">' + f(m['رقم_القضية'] || '—') + '</td>' +
        '<td style="padding:6px 8px;border:1px solid #e8e0d0;">' + f(m['نص_الرسالة']) + '</td>' +
        '<td style="padding:6px 8px;border:1px solid #e8e0d0;color:' + (visible ? '#1ab46c' : '#c0392b') + ';font-weight:700;">' +
          (visible ? 'نعم' : 'لا') +
        '</td>' +
        '<td style="padding:6px 8px;border:1px solid #e8e0d0;" class="no-print">' +
          '<button type="button" class="btn btn-ghost btn-sm no-print" onclick="editClientMessage(\'' + f(id) + '\',\'' + f(clientName) + '\')">&#9998; تعديل</button> ' +
          '<button type="button" class="btn btn-danger btn-sm no-print" onclick="deleteClientMessage(\'' + f(id) + '\',\'' + f(clientId) + '\')">&#128465; حذف</button>' +
        '</td>' +
      '</tr>';
    });
    html += '</table>';
  }

  html += '</div>';
  return html;
}

/**
 * refreshClientMessagesPanel(clientId) — re-renders just the
 * #clientMsgSection block in place after a save/delete, without
 * rebuilding the whole client view (avoids disturbing the surrounding
 * report/print content or scroll position).
 * @param {string} clientId
 */
function refreshClientMessagesPanel(clientId) {
  var container = document.getElementById('clientMsgSection');
  if (!container) return;
  var client = (data.clients || []).filter(function (cl) {
    return String(cl['رقم_الموكل'] || '') === String(clientId);
  })[0];
  if (!client) return;
  container.outerHTML = renderClientMessagesSection(client);
}

// ================================================================
// 5. Exports (Node/test harness access — same convention as every
//    other module file)
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clientMessagesRepository: clientMessagesRepository,
    syncClientMessagesMirror: syncClientMessagesMirror,
    resolveClientMessageIndex: resolveClientMessageIndex,
    populateClientCaseDropdown: populateClientCaseDropdown,
    openAddClientMessage: openAddClientMessage,
    editClientMessage: editClientMessage,
    saveClientMessage: saveClientMessage,
    deleteClientMessage: deleteClientMessage,
    renderClientMessagesSection: renderClientMessagesSection,
    refreshClientMessagesPanel: refreshClientMessagesPanel
  };
}
