/**
 * ================================================================
 * js/modules/process-server-works.js — وحدة أعمال المحضرين | نظام الحسام
 * ================================================================
 * PHASE 38 — Process Server Works Module (أعمال المحضرين)
 *
 * Built the same way js/modules/opponents.js was (see that file's own
 * header for the full rationale of every pattern reused here):
 *   - Reads/writes go through js/repositories/ProcessServerWorksRepository.js
 *     (own 'processServerWorks' localStorage/IndexedDB entity — never
 *     touches 'clients'/'cases'/'opponents'/'documents').
 *   - `data.processServerWorks` is kept as a synced, read-only mirror of
 *     `processServerWorksRepository.getAll()`, exactly like `data.opponents`.
 *   - INDEX -> RECORD -> ID translation layer identical to Opponents'
 *     (`resolvePswIndex`), because index.html's row templates use plain
 *     onclick="editProcessServerWork(N)" indexes.
 *   - Soft delete via ProcessServerWorksRepository (`softDelete: true`).
 *
 * SECOND RESPONSIBILITY — CLIENT + CASE SELECTORS (single-select each)
 *   Reuses the exact same 'client-selector-*' CSS classes/markup pattern
 *   already used by js/modules/clients.js (case's client picker) and
 *   js/modules/opponents.js (case's opponent picker) — just single-select
 *   instead of multi-select, since one Process Server Work belongs to
 *   exactly one client. The case dropdown (#fPswCaseNum, a plain <select>,
 *   reusing populateCaseDropdown()'s markup style from js/modules/cases.js)
 *   is re-populated to show ONLY that client's own cases, matched by
 *   'اسم_الموكل' text — the exact same client<->case name-matching
 *   convention js/modules/clients.js already relies on (القضايا has no
 *   formal client-id column; see that file's own comments).
 *
 * THIRD RESPONSIBILITY — CLIENT PORTAL VISIBILITY (tri-state)
 *   'ظهور_في_بوابة_الموكل' is surfaced as a plain <select> in the modal
 *   (#fPswPortalVisibility) with three options — مخفي / بيانات_فقط /
 *   بيانات_ومستندات — read by Config/05_Portal.gs when building each
 *   client's portal page. Defaults to 'مخفي' for every new/legacy record
 *   (safe-by-default, same philosophy as 'ظاهر_للموكل' on Documents/Tasks).
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data, editIdx, ApiService, saveLocal(), toast(), closeModal(),
 *     val(), uid(), collectForm(), fillForm(), resetForm(),
 *     confirmDialog(), escapeHtml(), CLIENT_NAME_SEPARATOR,
 *     _splitClientNames() — same shared globals/helpers every sibling
 *     module uses (CLIENT_NAME_SEPARATOR/_splitClientNames come from
 *     js/modules/clients.js, loaded before this file).
 *   - ProcessServerWorksRepository : js/repositories/ProcessServerWorksRepository.js
 *   - ProcessServerFields          : js/modules/process-server-fields.js
 *
 * Sheet name (GAS): 'أعمال_المحضرين'
 *
 * Does NOT touch:
 *   - Clients, Cases, Opponents, Sessions, Documents, Tasks, Fees,
 *     Calendar, Library, Templates, Settings, Children
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     IndexedDBAdapter.js, any sibling *Repository.js
 * ================================================================
 */

// escapeHtml fallback — defensive only, mirrors opponents.js.
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
var ProcessServerWorksRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/ProcessServerWorksRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var ProcessServerWorksRepository = ProcessServerWorksRepositoryNS && ProcessServerWorksRepositoryNS.ProcessServerWorksRepository;

if (typeof ProcessServerWorksRepository !== 'function') {
  throw new Error(
    'process-server-works.js requires js/repositories/ProcessServerWorksRepository.js ' +
    'to be loaded first (ProcessServerWorksRepository class not found).'
  );
}

var PSW_ID_FIELD = 'رقم_العمل';
var PSW_PORTAL_VISIBILITY_DEFAULT = (ProcessServerWorksRepositoryNS && ProcessServerWorksRepositoryNS.PSW_PORTAL_VISIBILITY_DEFAULT) || 'مخفي';

/** The single ProcessServerWorksRepository instance this module talks to. */
var processServerWorksRepository = new ProcessServerWorksRepository();

var processServerWorksRepositoryReadyPromise = (function () {
  var _p = processServerWorksRepository.open().then(function () {
    syncProcessServerWorksMirror();
  }).catch(function (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('ProcessServerWorksRepository failed to open:', err);
    }
  });
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('processServerWorks', _p) : _p;
})();

function ensureProcessServerWorksRepositoryReady() {
  if (processServerWorksRepository.isReady()) return Promise.resolve();
  return processServerWorksRepositoryReadyPromise;
}

function syncProcessServerWorksMirror() {
  if (typeof data !== 'undefined') data.processServerWorks = processServerWorksRepository.getAll();
}

function resolvePswIndex(list, record) {
  var id = record ? record[PSW_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][PSW_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة أعمال المحضرين (+ تبويبات الكل/مستلم/غير مستلم)
// ================================================================
var _pswStatusFilter = 'all';

function filterPswStatus(status) {
  _pswStatusFilter = status || 'all';
  document.querySelectorAll('.ps-tab').forEach(function (btn) {
    btn.classList.toggle('ps-tab-active', btn.getAttribute('data-ps-status') === _pswStatusFilter);
  });
  renderProcessServerWorks();
}

function renderProcessServerWorks() {
  if (!processServerWorksRepository.isReady()) return;

  var s = (document.getElementById('searchPsw') && typeof val === 'function') ? val('searchPsw').toLowerCase() : '';

  syncProcessServerWorksMirror();
  var allWorks = data.processServerWorks || [];

  var queryModel = {};
  if (s) queryModel.search = s;
  if (_pswStatusFilter === 'received') queryModel.filter = { 'الحالة': 'مستلم' };
  else if (_pswStatusFilter === 'notReceived') queryModel.filter = { 'الحالة': 'غير مستلم' };

  var rows = processServerWorksRepository.search(queryModel).items;
  rows = processServerWorksRepository.sort(rows);

  var tb = document.getElementById('pswTableBody');
  var em = document.getElementById('pswEmpty');
  var ml = document.getElementById('pswMobileList');
  var countBadge = document.getElementById('pswCount');
  if (countBadge) countBadge.textContent = allWorks.length;

  var receivedCountEl = document.getElementById('pswReceivedCount');
  var notReceivedCountEl = document.getElementById('pswNotReceivedCount');
  if (receivedCountEl) receivedCountEl.textContent = allWorks.filter(function (w) { return w['الحالة'] === 'مستلم'; }).length;
  if (notReceivedCountEl) notReceivedCountEl.textContent = allWorks.filter(function (w) { return w['الحالة'] !== 'مستلم'; }).length;

  if (!rows.length) {
    if (tb) tb.innerHTML = '';
    if (ml) ml.innerHTML = '';
    if (em) {
      em.style.display = '';
      var emTitle = em.querySelector('h3');
      if (emTitle) {
        emTitle.textContent = _pswStatusFilter === 'received' ? 'لا يوجد محاضر مستلمة'
          : (_pswStatusFilter === 'notReceived' ? 'لا يوجد محاضر غير مستلمة' : 'لا يوجد أعمال محضرين مضافة حتى الآن');
      }
    }
    return;
  }
  if (em) em.style.display = 'none';

  function statusBadgeHtml(w) {
    var received = w['الحالة'] === 'مستلم';
    return '<span class="badge ' + (received ? 'badge-active' : 'badge-pending') + '">' + (received ? '&#10003; مستلم' : '&#128337; غير مستلم') + '</span>';
  }

  function desktopPswRowInner(w) {
    var ri = resolvePswIndex(allWorks, w);
    return '<td><strong>' + escapeHtml(w['طبيعة_الاعلان'] || '—') + '</strong></td>' +
      '<td>' + escapeHtml(w['اسم_الموكل'] || '—') + '</td>' +
      '<td>' + escapeHtml(w['رقم_القضية'] || '—') + '</td>' +
      '<td>' + escapeHtml(w['المحكمة'] || '—') + '</td>' +
      '<td>' + escapeHtml(w['تاريخ_الجلسة'] || '—') + '</td>' +
      '<td>' + statusBadgeHtml(w) + '</td>' +
      '<td>' +
        '<button class="btn btn-info btn-sm btn-icon" onclick="viewProcessServerWork(' + ri + ')" title="عرض">&#128065;</button> ' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editProcessServerWork(' + ri + ')" title="تعديل">&#9998;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteProcessServerWork(' + ri + ')" title="حذف">&#128465;</button>' +
      '</td>';
  }

  function mobilePswCardInner(w) {
    var ri = resolvePswIndex(allWorks, w);
    return '<div class="m-card-header">' +
        '<div class="m-card-title">&#128220; ' + escapeHtml(w['طبيعة_الاعلان'] || 'عمل محضرين') + '</div>' +
        '<div class="m-card-num">' + statusBadgeHtml(w) + '</div>' +
      '</div>' +
      '<div class="m-card-meta">' +
        (w['اسم_الموكل'] ? '<span>&#128100; ' + escapeHtml(w['اسم_الموكل']) + '</span>' : '') +
        (w['رقم_القضية'] ? '<span>&#128193; ' + escapeHtml(w['رقم_القضية']) + '</span>' : '') +
        (w['المحكمة'] ? '<span>&#127963; ' + escapeHtml(w['المحكمة']) + '</span>' : '') +
        (w['تاريخ_الجلسة'] ? '<span>&#128197; ' + escapeHtml(w['تاريخ_الجلسة']) + '</span>' : '') +
      '</div>' +
      '<div class="m-card-actions">' +
        '<button class="btn btn-info btn-sm" onclick="viewProcessServerWork(' + ri + ')" style="flex:1;">&#128065; عرض</button>' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editProcessServerWork(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteProcessServerWork(' + ri + ')">&#128465;</button>' +
      '</div>';
  }

  if (tb) tb.innerHTML = rows.map(function (w) { return '<tr>' + desktopPswRowInner(w) + '</tr>'; }).join('');
  if (ml) ml.innerHTML = rows.map(function (w) { return '<div class="m-card">' + mobilePswCardInner(w) + '</div>'; }).join('');
}

function searchProcessServerWorks() { renderProcessServerWorks(); }

function _pswDocuments(w) {
  if (!w) return [];
  try {
    var arr = JSON.parse(w['المستندات'] || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// ================================================================
// CRUD — إنشاء / تحديث / حذف / عرض أعمال المحضرين
// ================================================================
async function saveProcessServerWork() {
  var clientId = document.getElementById('fPswClientId') ? document.getElementById('fPswClientId').value.trim() : '';
  if (!clientId) {
    toast('يرجى اختيار الموكل أولاً', 'error');
    return;
  }

  await ensureProcessServerWorksRepositoryReady();

  var obj = collectForm('processServerWorks');

  if (window.ProcessServerFields && typeof ProcessServerFields.collect === 'function') {
    var extended = ProcessServerFields.collect();
    Object.keys(extended).forEach(function (k) { obj[k] = extended[k]; });
  }

  if (!obj['الحالة']) obj['الحالة'] = 'غير مستلم';
  if (!obj['ظهور_في_بوابة_الموكل']) obj['ظهور_في_بوابة_الموكل'] = PSW_PORTAL_VISIBILITY_DEFAULT;

  obj[PSW_ID_FIELD] = obj[PSW_ID_FIELD] || uid();
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();
  obj['آخر_تحديث'] = new Date().toISOString();

  var idx = editIdx.processServerWorks;
  var result;

  if (idx >= 0) {
    var existingId = data.processServerWorks[idx] ? data.processServerWorks[idx][PSW_ID_FIELD] : null;
    result = await processServerWorksRepository.update(existingId, obj);
  } else {
    result = await processServerWorksRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء حفظ عمل المحضرين', 'error');
    return;
  }

  syncProcessServerWorksMirror();

  toast(idx >= 0 ? 'تم تحديث عمل المحضرين' : 'تمت إضافة عمل المحضرين بنجاح', 'success');

  saveLocal();
  ApiService.syncRow('أعمال_المحضرين', result.record, idx);

  closeModal('modalProcessServerWork');
  renderProcessServerWorks();
  if (typeof updateBadges === 'function') updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('processServerWorks'); }
}

function editProcessServerWork(i) {
  editIdx.processServerWorks = i;
  var record = data.processServerWorks[i];
  fillForm('processServerWorks', record);
  syncPswClientSelectorFromRecord(record);
  syncPswCaseSelectorFromRecord(record);
  if (window.ProcessServerFields && typeof ProcessServerFields.fill === 'function') {
    ProcessServerFields.fill(record);
  }
  document.getElementById('modalProcessServerWorkTitle').textContent = 'تعديل عمل المحضرين';
  document.getElementById('modalProcessServerWork').classList.add('open');
}

async function deleteProcessServerWork(i) {
  if (!(await confirmDialog('حذف عمل المحضرين هذا من السجل؟'))) return;

  await ensureProcessServerWorksRepositoryReady();

  var record = data.processServerWorks[i];
  if (!record) return;

  var id = record[PSW_ID_FIELD];

  // FIX C1 (DATABASE_FORENSIC_REPORT.md §P6-C1): pass `id` alongside the
  // fallback index `i` so the backend matches by رقم_العمل first — this
  // is the module behind the "بيانات أعمال المحضرين لا تُحذف بشكل صحيح"
  // symptom reported for this task (see DATABASE_SYNC_FINAL_REPORT.md §A).
  ApiService.deleteData('أعمال_المحضرين', i, id);

  var result = await processServerWorksRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء حذف عمل المحضرين', 'error');
    return;
  }

  syncProcessServerWorksMirror();
  saveLocal();
  toast('تم حذف عمل المحضرين', 'info');
  renderProcessServerWorks();
  if (typeof updateBadges === 'function') updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('processServerWorks'); }
}

async function restoreProcessServerWork(id) {
  await ensureProcessServerWorksRepositoryReady();
  var result = await processServerWorksRepository.restore(id);
  if (!result || !result.success) {
    toast('حدث خطأ أثناء استرجاع عمل المحضرين', 'error');
    return;
  }
  // FIX C4 (DATABASE_FORENSIC_REPORT.md §C4): sync the restore to
  // Sheets — same pattern as restoreCase(). This module is the one
  // behind the "بيانات أعمال المحضرين" symptom reported for this task.
  ApiService.syncRow('أعمال_المحضرين', result.record, 0);
  syncProcessServerWorksMirror();
  saveLocal();
  toast('تم استرجاع عمل المحضرين', 'success');
  renderProcessServerWorks();
  if (typeof updateBadges === 'function') updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('processServerWorks'); }
}

/**
 * viewProcessServerWork — عرض ملف عمل المحضرين الكامل، بنفس نظام العرض
 * المستخدم بالفعل لملف الموكل (viewClient) وملف القضية (viewCase) وملف
 * الخصم (viewOpponent): نفس الـ Overlay المشترك #modalView
 * (viewModalTitle/viewModalBody)، ونفس أقسام view-section/view-grid
 * المرئية والقابلة للطباعة، بدلاً من الـ Overlay المؤقت البسيط الذي كان
 * يُستخدم سابقًا لهذه الشاشة فقط. لا حاجة لتعديل index.html من أجلها —
 * #modalView معرَّف هناك بالفعل ومشترك بين كل الوحدات.
 * @param {number} i
 */
function viewProcessServerWork(i) {
  var w = data.processServerWorks[i];
  if (!w) return;

  // نفس تقنية viewClient/viewCase/viewOpponent بالضبط: تصفير أعلام
  // العرض الأخرى حتى يعرف printView() (js/modules/clients.js) أي نوع
  // ملف مفتوح حاليًا، وإخفاء زر "QR الموكل" لأن هذا ليس ملف موكل.
  window._currentViewCase     = null;
  window._currentViewClient   = null;
  window._currentViewOpponent = null;
  window._currentViewPsw      = w;
  window._currentViewPswIdx   = i;

  var portalBtn = document.getElementById('viewPortalBtn');
  if (portalBtn) portalBtn.style.display = 'none';

  document.getElementById('viewModalTitle').innerHTML =
    '&#128220; ملف عمل المحضرين — ' + escapeHtml(w['طبيعة_الاعلان'] || '');
  document.getElementById('viewModalBody').innerHTML = buildPswReport(w);
  document.getElementById('modalView').classList.add('open');
}

// ================================================================
// REPORT BUILDER — بناء تقرير عمل المحضرين
// ================================================================

/**
 * buildPswReport — يبني نفس هيكل تقرير الموكل/الخصم (buildClientReport
 * في js/modules/clients.js، buildOpponentReport في js/modules/opponents.js)
 * لكن لبيانات عمل المحضرين: نفس ترويسة المكتب، ونفس فئات
 * view-section/view-grid — تحافظ على نفس الحقول التي كانت تُعرض في
 * الـ Overlay البسيط القديم (الموكل/القضية/رقم المحضرين/المحكمة/قلم
 * المحضرين/التواريخ/الحالة/الملاحظات/المستندات/ظهور بوابة الموكل)، دون
 * حذف أي منها.
 * @param {Object} w  Process Server Work record
 * @returns {string}
 */
function buildPswReport(w) {
  var today = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  function f(v) {
    return (v && String(v).trim()) ? escapeHtml(String(v).trim()) : '—';
  }

  function vf(label, value) {
    var v = (value && String(value).trim())
      ? String(value).trim()
      : '<span class="empty">—</span>';
    return '<div class="view-field"><div class="view-label">' + label +
           '</div><div class="view-value">' + v + '</div></div>';
  }

  var statusReceived = w['الحالة'] === 'مستلم';
  var visibilityLabels = { 'مخفي': 'مخفي عن بوابة الموكل', 'بيانات_فقط': 'بيانات العمل فقط ظاهرة بالبوابة', 'بيانات_ومستندات': 'بيانات العمل والمستندات ظاهرة بالبوابة' };

  var html = '';

  // ---- Report header ----
  var _officeReport = (window.OfficeProfileService && OfficeProfileService.getDisplayProfile())
    || { officeName: 'مكتب الحسام للمحاماة', lawyerName: 'المستشار حسام محمد إبراهيم' };
  html += '<div class="case-report" style="padding:20px;font-family:Cairo,Arial,sans-serif;direction:rtl;">';
  html += '<div class="report-header" style="text-align:center;border-bottom:2px solid #c9a84c;padding-bottom:14px;margin-bottom:18px;">' +
    '<div style="font-size:20px;font-weight:900;color:#1a2744;">' + f(_officeReport.officeName) + '</div>' +
    '<div style="font-size:13px;color:#555;margin-top:4px;">' + f(_officeReport.lawyerName) + '</div>' +
    '<div style="font-size:15px;font-weight:700;color:#c9a84c;margin-top:10px;">&#128220; ملف عمل المحضرين</div>' +
  '</div>';

  // ---- بيانات العمل ----
  html += '<div class="view-section"><div class="view-section-title">&#128203; بيانات العمل</div>' +
    '<div class="view-grid">' +
    vf('طبيعة الإعلان',    f(w['طبيعة_الاعلان'])) +
    vf('الحالة',            statusReceived ? '<span style="color:#1e8449;font-weight:700;">&#10003; مستلم</span>' : '<span style="color:#a04000;font-weight:700;">&#128337; غير مستلم</span>') +
    vf('الموكل',            f(w['اسم_الموكل'])) +
    vf('رقم القضية',       f(w['رقم_القضية'])) +
    (w['عنوان_القضية'] ? vf('عنوان القضية', f(w['عنوان_القضية'])) : '') +
    vf('رقم المحضرين',      f(w['رقم_المحضرين'])) +
    vf('المحكمة',           f(w['المحكمة'])) +
    vf('قلم المحضرين',      f(w['قلم_المحضرين'])) +
    vf('تاريخ التسليم',    f(w['تاريخ_التسليم'])) +
    vf('تاريخ الاستلام',   f(w['تاريخ_الاستلام'])) +
    vf('تاريخ الجلسة',     f(w['تاريخ_الجلسة'])) +
    vf('الظهور ببوابة الموكل', f(visibilityLabels[w['ظهور_في_بوابة_الموكل']] || visibilityLabels[PSW_PORTAL_VISIBILITY_DEFAULT])) +
    '</div></div>';

  // ---- الملاحظات ----
  if (w['الملاحظات'] && w['الملاحظات'].trim()) {
    html += '<div class="view-section"><div class="view-section-title">&#128221; ملاحظات</div>' +
      '<div class="view-field-full"><div class="view-value">' + escapeHtml(w['الملاحظات']) + '</div></div>' +
      '</div>';
  }

  // ---- المستندات ----
  var docs = _pswDocuments(w);
  html += '<div class="view-section"><div class="view-section-title">&#128193; المستندات (' + docs.length + ')</div>';
  if (docs.length) {
    html += '<div class="view-field-full"><div class="view-value">' +
      docs.map(function (d) {
        return d.fileUrl
          ? '<a href="' + escapeHtml(d.fileUrl) + '" target="_blank">&#128206; ' + f(d.name || 'مستند') + '</a>'
          : '&#128206; ' + f(d.name || 'مستند');
      }).join('<br>') +
      '</div></div>';
  } else {
    html += '<div style="padding:12px;color:#888;font-size:12px;">لا توجد مستندات مرفقة</div>';
  }
  html += '</div>';

  // ---- Footer ----
  html += '<div class="view-footer" style="display:flex;justify-content:space-between;border-top:1px solid #e8e0d0;padding-top:10px;margin-top:18px;font-size:11px;color:#999;">' +
    '<span>نظام الحسام للمحاماة</span>' +
    '<span>تاريخ الطباعة: ' + today + '</span>' +
  '</div>';

  html += '</div>'; // .case-report
  return html;
}

// ================================================================
// PRINT — طباعة ملف عمل المحضرين (يوسّع printView() المشتركة إضافةً)
// ================================================================
// نفس تقنية اللف (wrap) المستخدمة في js/modules/opponents.js: printView()
// الأصلية (معرَّفة في js/modules/clients.js) تبقى دون أي تعديل مباشر؛
// هذا اللف يضيف فقط حالة "ملف عمل محضرين مفتوح حاليًا" قبل تفويض أي حالة
// أخرى (موكل/قضية/خصم) لأقرب لفّة سابقة كما هي.
if (typeof printView === 'function') {
  var _origPrintViewForPsw = printView;
  printView = function () {
    if (window._currentViewPsw) {
      var body = document.getElementById('viewModalBody');
      if (!body || !body.innerHTML.trim()) {
        toast('لا يوجد محتوى لطباعته', 'info');
        return;
      }
      var printContent = (typeof _buildClientPrintDocument === 'function')
        ? _buildClientPrintDocument(body.innerHTML)
        : body.innerHTML;
      var w = window.open('', '_blank', 'width=900,height=1100,scrollbars=yes');
      if (!w) { toast('افتح النوافذ المنبثقة للطباعة', 'info'); return; }
      w.document.open();
      w.document.write(printContent);
      w.document.close();
      w.focus();
      setTimeout(function () { w.print(); }, 600);
      return;
    }
    return _origPrintViewForPsw.apply(this, arguments);
  };
}

// ================================================================
// OVERRIDE viewClient/viewCase/viewOpponent — clear stale
// _currentViewPsw flag
// ================================================================
// Same non-invasive wrap technique used throughout this file and by
// js/modules/opponents.js's own wraps of viewClient/viewCase: opening a
// client/case/opponent file after a process-server-work file (same
// session, no reload) must not leave window._currentViewPsw set, or
// printView() above would keep printing the psw template instead of
// whichever file is actually open. Additive only — clients.js/cases.js/
// opponents.js themselves are never edited.
if (typeof viewClient === 'function') {
  var _origViewClientForPsw = viewClient;
  viewClient = function (i) {
    var r = _origViewClientForPsw.apply(this, arguments);
    window._currentViewPsw = null;
    window._currentViewPswIdx = null;
    return r;
  };
}

if (typeof viewCase === 'function') {
  var _origViewCaseForPsw = viewCase;
  viewCase = function (i) {
    var r = _origViewCaseForPsw.apply(this, arguments);
    window._currentViewPsw = null;
    window._currentViewPswIdx = null;
    return r;
  };
}

if (typeof viewOpponent === 'function') {
  var _origViewOpponentForPsw = viewOpponent;
  viewOpponent = function (i) {
    var r = _origViewOpponentForPsw.apply(this, arguments);
    window._currentViewPsw = null;
    window._currentViewPswIdx = null;
    return r;
  };
}

// ================================================================
// CLIENT SELECTOR (single-select) — اختيار موكل واحد لعمل المحضرين
// ================================================================
var _pswSelectedClientId = '';

function togglePswClientSelector(evt) {
  if (evt) evt.stopPropagation();
  var panel = document.getElementById('pswClientSelectorPanel');
  if (!panel) return;
  var willOpen = !panel.classList.contains('open');
  document.querySelectorAll('.client-selector-panel').forEach(function (p) { p.classList.remove('open'); });
  if (willOpen) {
    panel.classList.add('open');
    renderPswClientSelectorList();
    var search = document.getElementById('pswClientSelectorSearch');
    if (search) { search.value = ''; search.focus(); }
  }
}

function renderPswClientSelectorList() {
  var list = document.getElementById('pswClientSelectorList');
  if (!list) return;
  var q = (document.getElementById('pswClientSelectorSearch') ? document.getElementById('pswClientSelectorSearch').value : '').trim().toLowerCase();
  var all = (data.clients || []).slice().sort(function (a, b) {
    return String(a['الاسم'] || '').localeCompare(String(b['الاسم'] || ''), 'ar');
  });
  var filtered = q ? all.filter(function (c) { return String(c['الاسم'] || '').toLowerCase().indexOf(q) !== -1; }) : all;

  if (!filtered.length) {
    list.innerHTML = '<div class="client-selector-empty">لا يوجد موكلين مطابقين — يمكنك إضافة موكل جديد من صفحة الموكلين.</div>';
  } else {
    list.innerHTML = filtered.map(function (c) {
      var id = c['رقم_الموكل'];
      var checked = _pswSelectedClientId === id;
      return '<div class="client-selector-item' + (checked ? ' selected' : '') + '" onclick="selectPswClient(\'' + id + '\')">' +
        '<span>' + escapeHtml(c['الاسم'] || '—') + (c['الهاتف'] ? ' <small>(' + escapeHtml(c['الهاتف']) + ')</small>' : '') + '</span>' +
      '</div>';
    }).join('');
  }
}

function selectPswClient(id) {
  _pswSelectedClientId = id;
  var client = (data.clients || []).filter(function (c) { return c['رقم_الموكل'] === id; })[0];

  var idEl = document.getElementById('fPswClientId');
  var nameEl = document.getElementById('fPswClientNameHidden');
  if (idEl) idEl.value = id;
  if (nameEl) nameEl.value = client ? (client['الاسم'] || '') : '';

  renderPswClientSelectorChips();
  populatePswCaseDropdown(client ? client['الاسم'] : '');

  var panel = document.getElementById('pswClientSelectorPanel');
  if (panel) panel.classList.remove('open');
}

function removePswClient() {
  _pswSelectedClientId = '';
  var idEl = document.getElementById('fPswClientId');
  var nameEl = document.getElementById('fPswClientNameHidden');
  if (idEl) idEl.value = '';
  if (nameEl) nameEl.value = '';
  renderPswClientSelectorChips();
  populatePswCaseDropdown('');
}

function renderPswClientSelectorChips() {
  var chips = document.getElementById('pswClientSelectorChips');
  if (!chips) return;
  if (!_pswSelectedClientId) {
    chips.innerHTML = '<span class="client-selector-placeholder">اضغط لاختيار الموكل...</span>';
    return;
  }
  var client = (data.clients || []).filter(function (c) { return c['رقم_الموكل'] === _pswSelectedClientId; })[0];
  var label = client ? client['الاسم'] : _pswSelectedClientId;
  chips.innerHTML = '<span class="client-chip">' + escapeHtml(label) +
    '<button type="button" class="client-chip-remove" onclick="event.stopPropagation();removePswClient()" title="إزالة">&times;</button></span>';
}

function syncPswClientSelectorFromRecord(record) {
  _pswSelectedClientId = record ? (record['رقم_الموكل'] || '') : '';
  var idEl = document.getElementById('fPswClientId');
  var nameEl = document.getElementById('fPswClientNameHidden');
  if (idEl) idEl.value = _pswSelectedClientId;
  if (nameEl) nameEl.value = record ? (record['اسم_الموكل'] || '') : '';
  renderPswClientSelectorChips();
}

function resetPswClientSelector() {
  _pswSelectedClientId = '';
  renderPswClientSelectorChips();
  populatePswCaseDropdown('');
}

// Close the picker panel on outside click (mirrors the client/opponent
// selectors' own document-level listener; every listener only ever
// touches its own DOM ids, so all three coexist harmlessly).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function () {
    var panel = document.getElementById('pswClientSelectorPanel');
    if (panel) panel.classList.remove('open');
  });
}

// ================================================================
// CASE SELECTOR (scoped to the chosen client) — اختيار قضية من قضايا
// الموكل المختار فقط. Cases have no formal client-id column (see
// js/modules/clients.js's own comments), so — exactly like that file
// already does for the case's own client picker — matching is done by
// 'اسم_الموكل' text, split on CLIENT_NAME_SEPARATOR to tolerate cases
// that list more than one client name.
// ================================================================
function populatePswCaseDropdown(clientName) {
  var sel = document.getElementById('fPswCaseNum');
  if (!sel) return;
  var current = sel.value;
  sel.innerHTML = '<option value="">-- بدون ربط بقضية محددة --</option>';

  if (!clientName) {
    sel.disabled = true;
    return;
  }
  sel.disabled = false;

  var name = clientName.trim();
  var matchingCases = (data.cases || []).filter(function (c) {
    var names = (typeof _splitClientNames === 'function') ? _splitClientNames(c['اسم_الموكل'] || '') : [(c['اسم_الموكل'] || '').trim()];
    return names.indexOf(name) !== -1;
  });

  matchingCases.forEach(function (c) {
    var num = c['رقم_القضية'] || '';
    var title = c['عنوان_القضية'] || '';
    var opt = document.createElement('option');
    opt.value = num;
    opt.textContent = num + (title ? ' — ' + title : '');
    opt.setAttribute('data-case-title', title);
    if (num === current) opt.selected = true;
    sel.appendChild(opt);
  });

  if (!matchingCases.length) {
    var noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '-- لا توجد قضايا مسجلة لهذا الموكل --';
    noneOpt.disabled = true;
    sel.appendChild(noneOpt);
  }
}

/** onPswCaseChange — autofills the hidden عنوان_القضية field. */
function onPswCaseChange() {
  var sel = document.getElementById('fPswCaseNum');
  var titleEl = document.getElementById('fPswCaseTitle');
  if (!sel || !titleEl) return;
  var opt = sel.options[sel.selectedIndex];
  titleEl.value = opt ? (opt.getAttribute('data-case-title') || '') : '';
}

function syncPswCaseSelectorFromRecord(record) {
  var sel = document.getElementById('fPswCaseNum');
  if (sel) sel.value = record ? (record['رقم_القضية'] || '') : '';
  onPswCaseChange();
}

// ================================================================
// Exports (Node/test harness only — browser globals are the plain
// function declarations above, same convention as opponents.js)
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processServerWorksRepository: processServerWorksRepository,
    renderProcessServerWorks: renderProcessServerWorks,
    saveProcessServerWork: saveProcessServerWork,
    editProcessServerWork: editProcessServerWork,
    deleteProcessServerWork: deleteProcessServerWork,
    restoreProcessServerWork: restoreProcessServerWork,
    viewProcessServerWork: viewProcessServerWork,
    buildPswReport: buildPswReport,
    filterPswStatus: filterPswStatus,
    selectPswClient: selectPswClient,
    removePswClient: removePswClient,
    populatePswCaseDropdown: populatePswCaseDropdown,
    _createEmbeddedPswIfFilled: _createEmbeddedPswIfFilled
  };
}

// ================================================================
// OVERRIDE saveCase — create an embedded عمل محضرين (Process Server
// Work) when the case-modal's "محضرين" tab was filled in (optional —
// decision §4). Same wrap pattern as sessions.js/tasks.js this
// session — non-fatal on failure, doesn't block the case save.
// ================================================================
if (typeof saveCase === 'function') {
  var _origSaveCaseForEmbeddedPsw = saveCase;
  saveCase = function () {
    var result = _origSaveCaseForEmbeddedPsw.apply(this, arguments);
    if (result && typeof result.then === 'function') {
      return result.then(function (saveOutcome) {
        return _createEmbeddedPswIfFilled().then(function () { return saveOutcome; });
      });
    }
    return result;
  };
}

/**
 * _createEmbeddedPswIfFilled — reads the "محضرين" tab's fields. Unlike
 * sessions.js (gated on التاريخ) and tasks.js (gated on العنوان),
 * PSW_REQUIRED_FIELDS is actually رقم_الموكل — a field this tab
 * doesn't even expose (it's derived automatically from the case's
 * first selected client, same §4 convention as عمل اداري). The intent
 * signal here is therefore طبيعة_الاعلان OR رقم_المحضرين — either one
 * being filled means the user meant to add a work item.
 * @returns {Promise<void>}
 */
function _createEmbeddedPswIfFilled() {
  var natureEl = document.getElementById('fCasePswNature');
  var numberEl = document.getElementById('fCasePswNumber');
  var nature = natureEl ? natureEl.value.trim() : '';
  var number = numberEl ? numberEl.value.trim() : '';
  if (!nature && !number) return Promise.resolve(); // tab left empty — nothing to do

  var caseNumEl = document.getElementById('fCaseNum');
  var caseNum = caseNumEl ? caseNumEl.value.trim() : '';
  if (!caseNum) return Promise.resolve(); // defensive — saveCase() already requires this

  var clientId = '';
  var clientsHidden = document.getElementById('fCaseClients');
  if (clientsHidden && clientsHidden.value) {
    try {
      var ids = JSON.parse(clientsHidden.value);
      if (Array.isArray(ids) && ids.length) clientId = ids[0]; // "أول موكل فى القضية"
    } catch (e) { /* malformed/absent — proceed without a client link, non-fatal */ }
  }
  if (!clientId) return Promise.resolve(); // PSW_REQUIRED_FIELDS = ['رقم_الموكل'] — no client selected on the case yet means we genuinely cannot create a valid record; silently skip rather than fail loudly for an optional tab

  var clientName = '';
  if (typeof data !== 'undefined' && data.clients) {
    var idField = (typeof CLIENTS_ID_FIELD !== 'undefined') ? CLIENTS_ID_FIELD : 'رقم_الموكل';
    var match = data.clients.filter(function (c) { return c[idField] === clientId; })[0];
    if (match) clientName = match['الاسم'] || '';
  }

  var courtEl = document.getElementById('fCasePswCourt');
  var officeEl = document.getElementById('fCasePswOffice');
  var deliveryEl = document.getElementById('fCasePswDeliveryDate');
  var receiptEl = document.getElementById('fCasePswReceiptDate');
  var sessionDateEl = document.getElementById('fCasePswSessionDate');
  var notesEl = document.getElementById('fCasePswNotes');

  return ensureProcessServerWorksRepositoryReady().then(function () {
    return processServerWorksRepository.create({
      'رقم_الموكل': clientId,
      'اسم_الموكل': clientName,
      'رقم_القضية': caseNum,
      'طبيعة_الاعلان': nature,
      'رقم_المحضرين': number,
      'المحكمة': courtEl ? courtEl.value.trim() : '',
      'قلم_المحضرين': officeEl ? officeEl.value.trim() : '',
      'تاريخ_التسليم': deliveryEl ? deliveryEl.value.trim() : '',
      'تاريخ_الاستلام': receiptEl ? receiptEl.value.trim() : '',
      'تاريخ_الجلسة': sessionDateEl ? sessionDateEl.value.trim() : '',
      'الملاحظات': notesEl ? notesEl.value.trim() : ''
    });
  }).then(function (result) {
    if (result && result.success) {
      syncProcessServerWorksMirror();
      [natureEl, numberEl, courtEl, officeEl, deliveryEl, receiptEl, sessionDateEl, notesEl].forEach(function (el) { if (el) el.value = ''; });
      if (typeof updateBadges === 'function') updateBadges();
    } else if (typeof console !== 'undefined' && console.error) {
      console.error('Embedded PSW creation failed:', result && result.error);
    }
  }).catch(function (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('Embedded PSW creation failed:', err);
    }
  });
}
