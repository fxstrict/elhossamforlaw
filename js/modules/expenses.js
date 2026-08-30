/**
 * ================================================================
 * expenses.js — Expenses CRUD (المصروفات) | نظام الحسام
 * ================================================================
 * CASES_RELATIONSHIP_FINANCIAL — قرار §3-G
 *
 * WHAT THIS FILE IS
 *   The UI/CRUD layer for المصروفات — render/save/edit/delete/restore
 *   — following js/modules/fees.js's structure exactly (same function
 *   names pattern, same Repository call shape, same ApiService.syncRow/
 *   deleteData calls, same saveLocal/updateBadges/toast sequence).
 *
 *   Does NOT create a second ExpensesRepository instance. The single
 *   instance (and its ready-promise/mirror-sync) is already owned by
 *   js/modules/financial-reports.js (built in Phase F/G, before this
 *   file existed) — this module reuses that exact instance via the
 *   globals it already exports (expensesRepository,
 *   ensureExpensesRepositoryReady, syncExpensesMirror), avoiding two
 *   independent Repository objects wrapping the same IndexedDB store
 *   (a real risk: stale mirrors, double-init races).
 *
 * SCOPE — intentional MVP boundary, not an oversight: no DomRecycler
 *   integration (fees.js's OPTIONAL performance layer — this module
 *   uses fees.js's own guaranteed-safe fallback path, plain innerHTML
 *   rebuild, which is itself a fully supported, tested pattern in this
 *   codebase, not a shortcut) and no undo/redo wiring. Both are
 *   reasonable, addable-later enhancements; neither is required by
 *   decision §3-G's actual text ("أنشئ نظام مصروفات متكامل").
 *
 * VALIDATION — mirrors ExpensesRepository.js's own scope-conditional
 *   rules client-side, matching fees.js's saveFee()'s pre-Repository
 *   validation style (fail fast with a clear toast before any
 *   Repository call, exactly like every other saveX() in this app).
 * ================================================================
 */

// ================================================================
// RENDER
// ================================================================

function renderExpenses() {
  if (typeof expensesRepository === 'undefined' || !expensesRepository.isReady()) return;

  var s = val('searchExpenses').toLowerCase();

  syncExpensesMirror();
  var allExpenses = data.expenses || [];

  var tb = document.getElementById('expensesTableBody');
  var em = document.getElementById('expensesEmpty');
  var ml = document.getElementById('expensesMobileList');
  if (!tb || !em || !ml) return;

  var total = allExpenses.reduce(function (acc, e) {
    return acc + (parseFloat(e['المبلغ']) || 0);
  }, 0);
  var totalEl = document.getElementById('expensesTotalNum');
  var countEl = document.getElementById('expensesCountNum');
  if (totalEl) totalEl.textContent = total.toLocaleString('ar-EG');
  if (countEl) countEl.textContent = allExpenses.length;

  var queryModel = {};
  if (s) queryModel.search = s;
  var rows = expensesRepository.search(queryModel).items;

  if (!rows.length) {
    tb.innerHTML = '';
    ml.innerHTML = '';
    em.style.display = '';
    return;
  }
  em.style.display = 'none';

  function scopeLabel(e) {
    var scope = e['النطاق'];
    if (scope === 'موكل') {
      var client = (data.clients || []).filter(function (c) { return c[(typeof CLIENTS_ID_FIELD !== 'undefined' ? CLIENTS_ID_FIELD : 'رقم_الموكل')] === e['رقم_الموكل']; })[0];
      return '&#128100; ' + (client ? escapeHtml(client['الاسم']) : (e['رقم_الموكل'] || '—'));
    }
    if (scope === 'قضية') return '&#9878; ' + escapeHtml(e['رقم_القضية'] || '—');
    if (scope === 'مكتب') return '&#127970; مكتب';
    return '—';
  }

  function expenseRowInner(e) {
    var ri = resolveExpenseIndex(allExpenses, e);
    return (
      '<td>' + (e['النطاق'] || '—') + '</td>' +
      '<td>' + scopeLabel(e) + '</td>' +
      '<td>' + escapeHtml(e['التصنيف'] || '—') + '</td>' +
      '<td><strong style="color:var(--danger)">' +
        (e['المبلغ'] ? Number(e['المبلغ']).toLocaleString('ar-EG') + ' ج.م' : '—') +
      '</strong></td>' +
      '<td>' + formatDate(e['التاريخ']) + '</td>' +
      '<td>' + escapeHtml(e['الحالة'] || '—') + '</td>' +
      '<td><small>' + escapeHtml(e['الملاحظات'] || '—') + '</small></td>' +
      '<td>' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editExpense(' + ri + ')">&#9998;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteExpense(' + ri + ')">&#128465;</button>' +
      '</td>'
    );
  }

  function expenseCardInner(e) {
    var ri = resolveExpenseIndex(allExpenses, e);
    return (
      '<div class="m-card-header">' +
        '<div class="m-card-title">&#128181; ' + escapeHtml(e['التصنيف'] || '—') + '</div>' +
        '<div class="m-card-num" style="color:var(--danger)">' +
          (e['المبلغ'] ? Number(e['المبلغ']).toLocaleString('ar-EG') + ' ج.م' : '—') +
        '</div>' +
      '</div>' +
      '<div class="m-card-meta">' +
        '<span>' + scopeLabel(e) + '</span>' +
        '<span>&#128197; ' + formatDate(e['التاريخ']) + '</span>' +
        '<span>' + escapeHtml(e['الحالة'] || '—') + '</span>' +
      '</div>' +
      '<div class="m-card-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="editExpense(' + ri + ')" style="flex:1;">&#9998; تعديل</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteExpense(' + ri + ')">&#128465;</button>' +
      '</div>'
    );
  }

  // Plain rebuild — same guaranteed-safe fallback path fees.js itself
  // uses when DomRecycler is unavailable (see file header — intentional
  // MVP scope, not a shortcut around an existing requirement).
  tb.innerHTML = rows.map(function (e) { return '<tr>' + expenseRowInner(e) + '</tr>'; }).join('');
  ml.innerHTML = rows.map(function (e) { return '<div class="m-card">' + expenseCardInner(e) + '</div>'; }).join('');
}

/**
 * resolveExpenseIndex — same purpose as resolveFeeIndex()/resolveCaseIndex():
 * maps a (possibly search/filter-reordered) record back to its real
 * index in the unfiltered data.expenses mirror, for onclick handlers.
 */
function resolveExpenseIndex(list, record) {
  var id = record['id'];
  for (var i = 0; i < list.length; i++) {
    if (list[i]['id'] === id) return i;
  }
  return -1;
}

// ================================================================
// CRUD
// ================================================================

/**
 * saveExpense — validates (scope-conditional, mirroring
 * ExpensesRepository.js's own _validate() rules), saves through
 * ExpensesRepository, syncs to GAS. Matches fees.js's saveFee() shape
 * exactly.
 */
async function saveExpense() {
  var scope = document.getElementById('fExpenseScope').value;
  var amount = document.getElementById('fExpenseAmount').value;
  var category = document.getElementById('fExpenseCategory').value.trim();
  var clientId = document.getElementById('fExpenseClientId').value;
  var caseNum = document.getElementById('fExpenseCaseNum').value;

  if (!scope || !amount || !category) {
    toast('يرجى ملء النطاق والمبلغ والتصنيف', 'error');
    return;
  }
  if (scope === 'موكل' && !clientId) {
    toast('يرجى اختيار الموكل', 'error');
    return;
  }
  if (scope === 'قضية' && !caseNum) {
    toast('يرجى اختيار القضية', 'error');
    return;
  }

  await ensureExpensesRepositoryReady();

  var obj = collectForm('expenses');
  // مكتب scope carries neither رقم_الموكل نor رقم_القضية — clear
  // whichever field isn't relevant so a stale value from a previous
  // scope selection in this same modal session never leaks through.
  if (scope !== 'موكل') obj['رقم_الموكل'] = '';
  if (scope !== 'قضية') obj['رقم_القضية'] = '';
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.expenses;
  var result;

  if (idx >= 0) {
    var existing = data.expenses[idx];
    var existingId = existing ? existing['id'] : null;
    result = await expensesRepository.update(existingId, obj);
  } else {
    result = await expensesRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncExpensesMirror();

  toast(idx >= 0 ? 'تم التحديث' : 'تم التسجيل', 'success');

  saveLocal();
  ApiService.syncRow('المصروفات', result.record, idx);
  closeModal('modalExpense');
  renderExpenses();
  updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('expenses'); }
}

/**
 * editExpense — opens the expense modal pre-filled with existing data.
 * Purely synchronous, matching editFee()'s exact shape.
 * @param {number} i - 0-based index in the data.expenses mirror.
 */
function editExpense(i) {
  editIdx.expenses = i;
  var record = data.expenses[i];
  populateCaseDropdown('fExpenseCaseNum', record['رقم_القضية']);
  if (typeof populateExpenseClientDropdown === 'function') populateExpenseClientDropdown(record['رقم_الموكل']);
  fillForm('expenses', record);
  toggleExpenseScopeFields(record['النطاق']);
  document.getElementById('modalExpenseTitle').textContent = 'تعديل المصروف';
  document.getElementById('modalExpense').classList.add('open');
}

/**
 * deleteExpense — confirms, removes via ExpensesRepository. Matches
 * deleteFee()'s exact shape, including the ApiService.deleteData() call.
 * @param {number} i - 0-based index in the data.expenses mirror.
 */
async function deleteExpense(i) {
  if (!(await confirmDialog('هل تريد حذف هذا المصروف؟'))) return;

  await ensureExpensesRepositoryReady();

  var record = data.expenses[i];
  if (!record) return;

  var id = record['id'];
  ApiService.deleteData('المصروفات', i, id);

  var result = await expensesRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncExpensesMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderExpenses();
  updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('expenses'); }
}

/**
 * restoreExpense(id) — استرجاع مصروف محذوف. Matches restoreFee()'s
 * exact shape (id, not index — same documented reason as restoreFee()).
 * @param {string} id
 */
async function restoreExpense(id) {
  await ensureExpensesRepositoryReady();

  var result = await expensesRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الاسترجاع', 'error');
    return;
  }

  ApiService.syncRow('المصروفات', result.record, 0);

  syncExpensesMirror();
  saveLocal();
  toast('تم الاسترجاع', 'success');
  renderExpenses();
  updateBadges();
  if (window.ApplicationShell) { ApplicationShell.markDirty('expenses'); }
}

/**
 * onExpenseCaseSelected(caseNum) — PHASE 13 (EXPENSE AUTO-FILL). Fixes
 * the confirmed gap: #fExpenseCaseNum had no onchange handler, so the
 * client dropdown always listed every client regardless of which case
 * was chosen. Reads ONLY the existing data.caseClients mirror (the
 * same source getRelationshipRemaining()/openPaymentModal() already
 * use) — no new Repository call, no write of any kind.
 * @param {string} caseNum
 */
function onExpenseCaseSelected(caseNum) {
  var linkedClientIds = (data.caseClients || [])
    .filter(function (r) { return r['رقم_القضية'] === caseNum; })
    .map(function (r) { return r['رقم_الموكل']; })
    .filter(function (id, i, arr) { return id && arr.indexOf(id) === i; }); // unique, drop empties

  var pool = linkedClientIds.length
    ? (data.clients || []).filter(function (c) { return linkedClientIds.indexOf(c[(typeof CLIENTS_ID_FIELD !== 'undefined') ? CLIENTS_ID_FIELD : 'رقم_الموكل']) !== -1; })
    : (data.clients || []); // no known relationship for this case (or no case selected) — fall back to the full list rather than an empty, unusable dropdown

  var sel = document.getElementById('fExpenseClientId');
  if (!sel) return;
  var idField = (typeof CLIENTS_ID_FIELD !== 'undefined') ? CLIENTS_ID_FIELD : 'رقم_الموكل';

  // Exactly one linked client -> auto-fill (PHASE 13 §3). More than one
  // -> leave the choice explicit, unselected (PHASE 13 §4 — never guess
  // which of several clients the expense belongs to).
  var autoSelectId = (linkedClientIds.length === 1) ? linkedClientIds[0] : '';

  var options = '<option value="">-- اختر الموكل --</option>';
  pool.forEach(function (c) {
    var id = c[idField];
    var selected = (autoSelectId && id === autoSelectId) ? ' selected' : '';
    options += '<option value="' + escapeHtml(id) + '"' + selected + '>' + escapeHtml(c['الاسم'] || '—') + '</option>';
  });
  sel.innerHTML = options;
  sel.value = autoSelectId;
}

/**
 * populateExpenseClientDropdown — fills #fExpenseClientId from
 * data.clients, mirroring populateCaseDropdown()'s exact shape/signature.
 * @param {string} [selectedVal]
 */
function populateExpenseClientDropdown(selectedVal) {
  var sel = document.getElementById('fExpenseClientId');
  if (!sel) return;
  var idField = (typeof CLIENTS_ID_FIELD !== 'undefined') ? CLIENTS_ID_FIELD : 'رقم_الموكل';
  var options = '<option value="">-- اختر الموكل --</option>';
  (data.clients || []).forEach(function (c) {
    var id = c[idField];
    var sel2 = (selectedVal && id === selectedVal) ? ' selected' : '';
    options += '<option value="' + escapeHtml(id) + '"' + sel2 + '>' + escapeHtml(c['الاسم'] || '—') + '</option>';
  });
  sel.innerHTML = options;
}

// ================================================================
// Node/test export
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderExpenses: renderExpenses,
    resolveExpenseIndex: resolveExpenseIndex,
    saveExpense: saveExpense,
    editExpense: editExpense,
    deleteExpense: deleteExpense,
    restoreExpense: restoreExpense,
    populateExpenseClientDropdown: populateExpenseClientDropdown,
    onExpenseCaseSelected: onExpenseCaseSelected
  };
}
