/**
 * js/modules/ledger.js
 * PHASE 9 — LEDGER (كشف الحساب) — UI layer only.
 *
 * Pure rendering over js/modules/financial-reports.js's getCaseLedger()/
 * getClientLedger()/getOfficeLedger() — themselves pure projections over
 * the existing Fees/Expenses sources (see that file's own PHASE 9
 * header). This file creates NO new storage, NO new Repository, and
 * copies NO transaction anywhere — it only turns the already-computed
 * ledger array into an HTML table inside #modalLedger.
 *
 * New file (not an existing module's natural fit) per PHASE 8 prompt
 * §24's own suggestion ("وربما: js/modules/ledger.js إذا لم يوجد ملف
 * مناسب").
 */
'use strict';

/**
 * openLedger(type, id, title) — opens #modalLedger and renders the
 * requested ledger.
 * @param {'case'|'client'|'office'} type
 * @param {string} [id] - رقم_القضية (type==='case') or رقم_الموكل (type==='client'); ignored for 'office'
 * @param {string} [title] - modal title; a sensible default is used when omitted
 */
function openLedger(type, id, title) {
  var entries = [];
  if (type === 'case') {
    entries = (typeof getCaseLedger === 'function') ? getCaseLedger(id) : [];
  } else if (type === 'client') {
    entries = (typeof getClientLedger === 'function') ? getClientLedger(id) : [];
  } else {
    entries = (typeof getOfficeLedger === 'function') ? getOfficeLedger() : [];
  }

  var titleEl = document.getElementById('ledgerModalTitle');
  if (titleEl) {
    titleEl.textContent = title || (
      type === 'case' ? ('كشف حساب القضية ' + (id || '')) :
      type === 'client' ? 'كشف حساب الموكل' :
      'كشف حساب المكتب'
    );
  }

  var bodyEl = document.getElementById('ledgerModalBody');
  if (bodyEl) bodyEl.innerHTML = renderLedgerTable(entries, type);

  var modal = document.getElementById('modalLedger');
  if (modal && modal.classList) modal.classList.add('open');
}

/**
 * renderLedgerTable(entries, type) — builds the ledger table HTML.
 * Each row is clickable ("فتح الحركة") back to its own SOURCE record
 * (openLedgerEntrySource) — never a second copy, just a jump to the
 * real Fees/Expenses record that already exists.
 * @param {Array} entries - from getCaseLedger()/getClientLedger()/getOfficeLedger()
 * @param {string} [type]
 * @returns {string}
 */
function renderLedgerTable(entries, type) {
  if (!entries || !entries.length) {
    return '<div class="empty-state empty-container"><div class="icon">&#128179;</div><h3>لا توجد حركات مالية بعد</h3></div>';
  }

  var showCaseCol = type !== 'case';
  var html = '<div class="hsm-table-scroll"><table style="width:100%;min-width:640px;font-size:12px;border-collapse:collapse;">' +
    '<tr style="background:#f5f0e6;">' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">التاريخ</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">النوع</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">البيان</th>' +
      (showCaseCol ? '<th style="padding:7px 10px;border:1px solid #e8e0d0;">القضية</th>' : '') +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">دخل</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">مصروف</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">الرصيد</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;"></th></tr>';

  entries.forEach(function (entry) {
    html += '<tr>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(formatDate(entry.date)) + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(entry.type) + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(entry.description) + (entry.clientName ? ' — ' + escapeHtml(entry.clientName) : '') + '</td>' +
      (showCaseCol ? '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(entry.caseNum || '—') + '</td>' : '') +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:#1ab46c;font-weight:700;">' + (entry.income ? '+' + entry.income.toLocaleString('ar-EG') : '—') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:#c0392b;font-weight:700;">' + (entry.expense ? '-' + entry.expense.toLocaleString('ar-EG') : '—') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;font-weight:900;">' + entry.balance.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' +
        '<button class="btn btn-ghost btn-sm" onclick="openLedgerEntrySource(\'' + escapeHtml(entry.sourceType) + '\',\'' + escapeHtml(entry.sourceId) + '\')">&#128065;</button>' +
      '</td></tr>';
  });

  html += '</table></div>';
  return html;
}

/**
 * openLedgerEntrySource(sourceType, sourceId) — jumps to the real
 * source record a ledger row points at (never a copy — see file
 * header). For now: closes the Ledger modal and navigates to the Fees
 * page (Fees entries) so the user can locate the payment there;
 * Expenses entries similarly surface the Expenses page. A deep-link
 * directly to one row is a natural follow-up once the Fees/Expenses
 * pages expose a stable per-row anchor.
 * @param {'fee'|'expense'} sourceType
 * @param {string} sourceId
 */
function openLedgerEntrySource(sourceType, sourceId) {
  closeModal('modalLedger');
  if (sourceType === 'fee' && typeof navigate === 'function') {
    navigate('fees');
  } else if (sourceType === 'expense' && typeof navigate === 'function') {
    navigate('expenses');
  }
}

// ================================================================
// Node/test export
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openLedger: openLedger,
    renderLedgerTable: renderLedgerTable,
    openLedgerEntrySource: openLedgerEntrySource
  };
}

if (typeof window !== 'undefined') {
  window.openLedger = openLedger;
  window.renderLedgerTable = renderLedgerTable;
  window.openLedgerEntrySource = openLedgerEntrySource;
}
