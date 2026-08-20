/**
 * ================================================================
 * financial-reports.js — Client/Case/Office Net Calculations | نظام الحسام
 * ================================================================
 * CASES_RELATIONSHIP_FINANCIAL — قرار §3-G و §18 (القاعدة المحاسبية)
 *
 * "لا تحسب الأرباح من مجرد جمع أرقام عشوائية... أنشئ البنية التي تسمح
 * بذلك لاحقًا بشكل صحيح... بدون خلط المستويات."
 *
 * WHAT THIS FILE IS
 *   Pure, read-only reporting functions over the two existing
 *   Repositories (FeesRepository via data.fees, ExpensesRepository via
 *   this file's own data.expenses mirror) — NO new storage, NO new
 *   business logic mutating either entity. Three functions, matching
 *   §18's three levels exactly:
 *     - getClientNet(clientId)  = client's total fees - client's total expenses
 *     - getCaseNet(caseNum)     = case's total fees   - case's total expenses
 *     - getOfficeNet()          = ALL fees (office-wide) - ALL expenses (every scope)
 *   Office Net is the complete, standard P&L (all revenue minus all
 *   cost) — not "office-scope expenses only" — because §18's own
 *   revenue definition ("إجمالي إيرادات المكتب") is office-wide by
 *   its own wording, and subtracting only office-scope expenses would
 *   silently ignore every client/case expense while still counting
 *   100% of client/case fees as revenue — exactly the "خلط المستويات"
 *   (level-mixing) §18 explicitly forbids avoiding.
 *
 * WHAT THIS FILE IS NOT
 *   - Not a UI. No rendering, no DOM. Callers (dashboard.js, a future
 *     client/case report section) format the numbers however they need.
 *   - Not a new Repository. It reads data.fees (already maintained by
 *     js/modules/fees.js) and its own data.expenses mirror (maintained
 *     here, same pattern as every other *Repository wiring this phase
 *     — see js/modules/clients.js's caseClientsRepository for the
 *     identical structure) — it does not duplicate either store.
 *   - Does not touch FeesRepository.js or ExpensesRepository.js.
 *
 * MATCHING STRATEGY (both ID-based and legacy name-based, never one
 *   without the other — see decision §10's "لا تكسر التوافق"):
 *   Fees rows created before this phase only carry اسم_الموكل (a name
 *   string), not رقم_الموكل. getClientNet() therefore matches a Fees
 *   row to a client by EITHER رقم_الموكل === clientId (new, ID-based
 *   rows) OR اسم_الموكل === the resolved client's اسم (legacy rows) —
 *   whichever matches, counted once (a row is never double-counted
 *   even if — implausibly — both conditions were true for the same
 *   row, since the match is an OR on a single filter, not two passes).
 * ================================================================
 */

(function (root) {
  'use strict';

  var ExpensesRepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../repositories/ExpensesRepository.js')
    : (typeof window !== 'undefined' ? window : this);

  var ExpensesRepository = ExpensesRepositoryNS && ExpensesRepositoryNS.ExpensesRepository;

  if (typeof ExpensesRepository !== 'function') {
    throw new Error(
      'financial-reports.js requires js/repositories/ExpensesRepository.js ' +
      'to be loaded first (ExpensesRepository class not found).'
    );
  }

  /** The single ExpensesRepository instance this module talks to. */
  var expensesRepository = new ExpensesRepository();

  var expensesRepositoryReadyPromise = (function () {
    var _p = expensesRepository.open().then(function () {
      syncExpensesMirror();
    }).catch(function (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('ExpensesRepository failed to open:', err);
      }
    });
    return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('expenses', _p) : _p;
  })();

  function ensureExpensesRepositoryReady() {
    if (expensesRepository.isReady()) return Promise.resolve();
    return expensesRepositoryReadyPromise;
  }

  function _dataRef() {
    return (typeof data !== 'undefined') ? data : (root && root.data);
  }

  /** syncExpensesMirror — refreshes data.expenses from the Repository. */
  function syncExpensesMirror() {
    var d = _dataRef();
    if (d) d.expenses = expensesRepository.getAll();
  }

  function _num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  /**
   * getClientNet — إجمالي أتعاب الموكل - مصروفات الموكل = صافي عائد الموكل
   * @param {string} clientId — رقم_الموكل
   * @returns {{totalFees:number, totalExpenses:number, net:number}}
   */
  function getClientNet(clientId) {
    var d = _dataRef() || {};
    if (!clientId) return { totalFees: 0, totalExpenses: 0, net: 0 };

    var client = (d.clients || []).filter(function (c) {
      return c[(typeof CLIENTS_ID_FIELD !== 'undefined') ? CLIENTS_ID_FIELD : 'رقم_الموكل'] === clientId;
    })[0];
    var clientName = client ? (client['الاسم'] || '').trim() : '';

    var fees = (d.fees || []).filter(function (f) {
      return f['رقم_الموكل'] === clientId || (clientName && (f['اسم_الموكل'] || '').trim() === clientName);
    });
    var totalFees = fees.reduce(function (acc, f) { return acc + _num(f['المبلغ']); }, 0);

    var expenses = (d.expenses || []).filter(function (e) { return e['رقم_الموكل'] === clientId; });
    var totalExpenses = expenses.reduce(function (acc, e) { return acc + _num(e['المبلغ']); }, 0);

    return { totalFees: totalFees, totalExpenses: totalExpenses, net: totalFees - totalExpenses };
  }

  /**
   * getCaseNet — إجمالي أتعاب القضية - مصروفات القضية = صافي عائد القضية
   * @param {string} caseNum — رقم_القضية
   * @returns {{totalFees:number, totalExpenses:number, net:number}}
   */
  function getCaseNet(caseNum) {
    var d = _dataRef() || {};
    if (!caseNum) return { totalFees: 0, totalExpenses: 0, net: 0 };

    var fees = (d.fees || []).filter(function (f) { return f['رقم_القضية'] === caseNum; });
    var totalFees = fees.reduce(function (acc, f) { return acc + _num(f['المبلغ']); }, 0);

    var expenses = (d.expenses || []).filter(function (e) { return e['رقم_القضية'] === caseNum; });
    var totalExpenses = expenses.reduce(function (acc, e) { return acc + _num(e['المبلغ']); }, 0);

    return { totalFees: totalFees, totalExpenses: totalExpenses, net: totalFees - totalExpenses };
  }

  /**
   * getOfficeNet — إجمالي إيرادات المكتب (كل الأتعاب) - كل المصروفات
   * (كل المستويات) = صافي أرباح المكتب. See file header for why this is
   * the complete P&L rather than office-scope expenses only.
   * @returns {{totalFees:number, totalExpenses:number, net:number}}
   */
  function getOfficeNet() {
    var d = _dataRef() || {};
    var totalFees = (d.fees || []).reduce(function (acc, f) { return acc + _num(f['المبلغ']); }, 0);
    var totalExpenses = (d.expenses || []).reduce(function (acc, e) { return acc + _num(e['المبلغ']); }, 0);
    return { totalFees: totalFees, totalExpenses: totalExpenses, net: totalFees - totalExpenses };
  }

  // ================================================================
  // Exports
  // ================================================================

  var api = {
    expensesRepository: expensesRepository,
    ensureExpensesRepositoryReady: ensureExpensesRepositoryReady,
    syncExpensesMirror: syncExpensesMirror,
    getClientNet: getClientNet,
    getCaseNet: getCaseNet,
    getOfficeNet: getOfficeNet
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.expensesRepository = expensesRepository;
    root.ensureExpensesRepositoryReady = ensureExpensesRepositoryReady;
    root.syncExpensesMirror = syncExpensesMirror;
    root.getClientNet = getClientNet;
    root.getCaseNet = getCaseNet;
    root.getOfficeNet = getOfficeNet;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
