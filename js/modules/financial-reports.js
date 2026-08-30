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
   * ================================================================
   * PHASE 4 — FEE AGREEMENT / COLLECTED / REMAINING (ARCHITECTURE
   * DECISION OPTION D, approved PHASE 3)
   * ================================================================
   * ADDITIVE ONLY — every function below still returns its original
   * totalFees/totalExpenses/net fields completely unchanged (see
   * verify_financial_reports.js, which keeps passing unmodified). This
   * section adds three new fields (agreedTotal, collected, remaining)
   * to each of getClientNet/getCaseNet/getOfficeNet's return value.
   *
   * SOURCE OF "الأتعاب المتفق عليها" (agreedTotal)
   *   CaseClientsRepository.أتعاب_العلاقة (js/repositories/
   *   CaseClientsRepository.js) — the field that sits next to the
   *   مدّعي/مدّعى عليه role picker during case registration (PHASE 1
   *   DISCOVERY). Read here via the data.caseClients mirror, which
   *   js/modules/clients.js already maintains via syncCaseClientsMirror()
   *   (js/modules/clients.js:1507) — same "read the mirror, don't own a
   *   second Repository instance" pattern this file already uses for
   *   data.fees. Soft-deleted rows (deletedAt != null) are excluded
   *   automatically because CaseClientsRepository.getAll() already
   *   excludes them before ever reaching the mirror — no extra filtering
   *   needed here.
   *
   * SOURCE OF "المحصَّل" (collected)
   *   Unchanged: the exact same data.fees sum totalFees already computes.
   *   "collected" is simply totalFees under its correct accounting name
   *   (PHASE 3 §13/§15 — Fees records ARE payments, not obligations).
   *
   * DUPLICATE-COUNTING GUARD
   *   A Fees row tagged with رقم_علاقة is matched to a relationship by
   *   id ONLY when رقم_علاقة is present (never in addition to the
   *   existing رقم_القضية/اسم_الموكل match used for totalFees/collected
   *   — those two numbers share the exact same underlying `fees` array
   *   and reducer, so a payment is summed once into collected
   *   regardless of whether it carries رقم_علاقة, exactly like today).
   *   رقم_علاقة is used ONLY to select which CaseClients rows'
   *   أتعاب_العلاقة feed agreedTotal — it never re-sums a fee.
   * ================================================================
   */

  /** getCaseClientsRows — reads the data.caseClients mirror (maintained by clients.js). */
  function _caseClientsRows() {
    var d = _dataRef() || {};
    return d.caseClients || [];
  }

  /**
   * getClientNet — إجمالي أتعاب الموكل - مصروفات الموكل = صافي عائد الموكل
   * @param {string} clientId — رقم_الموكل
   * @returns {{totalFees:number, totalExpenses:number, net:number, agreedTotal:number, collected:number, remaining:number}}
   */
  function getClientNet(clientId) {
    var d = _dataRef() || {};
    if (!clientId) return { totalFees: 0, totalExpenses: 0, net: 0, agreedTotal: 0, collected: 0, remaining: 0 };

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

    var relationships = _caseClientsRows().filter(function (r) { return r['رقم_الموكل'] === clientId; });
    var agreedTotal = relationships.reduce(function (acc, r) { return acc + _num(r['أتعاب_العلاقة']); }, 0);
    var collected = totalFees;
    var remaining = agreedTotal - collected;

    return { totalFees: totalFees, totalExpenses: totalExpenses, net: totalFees - totalExpenses, agreedTotal: agreedTotal, collected: collected, remaining: remaining };
  }

  /**
   * getCaseNet — إجمالي أتعاب القضية - مصروفات القضية = صافي عائد القضية
   * @param {string} caseNum — رقم_القضية
   * @returns {{totalFees:number, totalExpenses:number, net:number, agreedTotal:number, collected:number, remaining:number}}
   */
  function getCaseNet(caseNum) {
    var d = _dataRef() || {};
    if (!caseNum) return { totalFees: 0, totalExpenses: 0, net: 0, agreedTotal: 0, collected: 0, remaining: 0 };

    var fees = (d.fees || []).filter(function (f) { return f['رقم_القضية'] === caseNum; });
    var totalFees = fees.reduce(function (acc, f) { return acc + _num(f['المبلغ']); }, 0);

    var expenses = (d.expenses || []).filter(function (e) { return e['رقم_القضية'] === caseNum; });
    var totalExpenses = expenses.reduce(function (acc, e) { return acc + _num(e['المبلغ']); }, 0);

    var relationships = _caseClientsRows().filter(function (r) { return r['رقم_القضية'] === caseNum; });
    var agreedTotal = relationships.reduce(function (acc, r) { return acc + _num(r['أتعاب_العلاقة']); }, 0);
    var collected = totalFees;
    var remaining = agreedTotal - collected;

    return { totalFees: totalFees, totalExpenses: totalExpenses, net: totalFees - totalExpenses, agreedTotal: agreedTotal, collected: collected, remaining: remaining };
  }

  /**
   * getOfficeNet — إجمالي إيرادات المكتب (كل الأتعاب) - كل المصروفات
   * (كل المستويات) = صافي أرباح المكتب. See file header for why this is
   * the complete P&L rather than office-scope expenses only.
   * @returns {{totalFees:number, totalExpenses:number, net:number, agreedTotal:number, collected:number, remaining:number}}
   */
  function getOfficeNet() {
    var d = _dataRef() || {};
    var totalFees = (d.fees || []).reduce(function (acc, f) { return acc + _num(f['المبلغ']); }, 0);
    var totalExpenses = (d.expenses || []).reduce(function (acc, e) { return acc + _num(e['المبلغ']); }, 0);
    var agreedTotal = _caseClientsRows().reduce(function (acc, r) { return acc + _num(r['أتعاب_العلاقة']); }, 0);
    var collected = totalFees;
    var remaining = agreedTotal - collected;
    return { totalFees: totalFees, totalExpenses: totalExpenses, net: totalFees - totalExpenses, agreedTotal: agreedTotal, collected: collected, remaining: remaining };
  }

  /**
   * ================================================================
   * PHASE 4 (continued) — ADVANCED REPORTS (PHASE 3 §17, items 10-19)
   * ================================================================
   * All additive, read-only, over the exact same three sources
   * (data.fees / data.expenses / data.caseClients) — no new Repository,
   * no new storage, per PHASE 3's own instruction not to invent a data
   * source that doesn't exist yet.
   * ================================================================
   */

  /** _inRange(dateStr, from, to) — inclusive date-string comparison, tolerant of missing bounds. */
  function _inRange(dateStr, from, to) {
    if (!dateStr) return false;
    var d = String(dateStr).slice(0, 10); // tolerate full ISO timestamps, compare by date part
    if (from && d < String(from).slice(0, 10)) return false;
    if (to && d > String(to).slice(0, 10)) return false;
    return true;
  }

  /**
   * getCollectionsInRange(from, to) — إجمالي التحصيلات (Fees) خلال فترة،
   * بحسب تاريخ_الاستلام. from/to اختياريان (إغفال أحدهما = بلا حد من هذه الجهة).
   * @param {string} [from] - YYYY-MM-DD
   * @param {string} [to] - YYYY-MM-DD
   * @returns {number}
   */
  function getCollectionsInRange(from, to) {
    var d = _dataRef() || {};
    return (d.fees || [])
      .filter(function (f) { return _inRange(f['تاريخ_الاستلام'], from, to); })
      .reduce(function (acc, f) { return acc + _num(f['المبلغ']); }, 0);
  }

  /**
   * getExpensesInRange(from, to) — إجمالي المصروفات (كل المستويات) خلال فترة،
   * بحسب التاريخ.
   * @param {string} [from] - YYYY-MM-DD
   * @param {string} [to] - YYYY-MM-DD
   * @returns {number}
   */
  function getExpensesInRange(from, to) {
    var d = _dataRef() || {};
    return (d.expenses || [])
      .filter(function (e) { return _inRange(e['التاريخ'], from, to); })
      .reduce(function (acc, e) { return acc + _num(e['المبلغ']); }, 0);
  }

  /** _todayIso() / _monthStartIso() / _yearStartIso() — real system clock, no faking. */
  function _todayIso() { return new Date().toISOString().slice(0, 10); }
  function _monthStartIso() { var d = new Date(); return d.toISOString().slice(0, 7) + '-01'; }
  function _yearStartIso() { return new Date().getFullYear() + '-01-01'; }

  function getTodayCollections() { return getCollectionsInRange(_todayIso(), _todayIso()); }
  function getMonthCollections() { return getCollectionsInRange(_monthStartIso(), _todayIso()); }
  function getYearCollections() { return getCollectionsInRange(_yearStartIso(), _todayIso()); }
  function getTodayExpenses() { return getExpensesInRange(_todayIso(), _todayIso()); }
  function getMonthExpenses() { return getExpensesInRange(_monthStartIso(), _todayIso()); }
  function getYearExpenses() { return getExpensesInRange(_yearStartIso(), _todayIso()); }

  /**
   * getTopRevenueCases(limit) — أكثر القضايا تحقيقًا للإيراد (بالمحصَّل فعليًا،
   * وليس المتفق عليه — الإيراد الفعلي هو ما دخل الخزينة).
   * @param {number} [limit=5]
   * @returns {Array<{caseNum:string, collected:number}>}
   */
  function getTopRevenueCases(limit) {
    var d = _dataRef() || {};
    var byCase = {};
    (d.fees || []).forEach(function (f) {
      var c = f['رقم_القضية'];
      if (!c) return;
      byCase[c] = (byCase[c] || 0) + _num(f['المبلغ']);
    });
    return Object.keys(byCase)
      .map(function (c) { return { caseNum: c, collected: byCase[c] }; })
      .sort(function (a, b) { return b.collected - a.collected; })
      .slice(0, limit || 5);
  }

  /**
   * getTopRevenueClients(limit) — أكثر الموكلين تحقيقًا للإيراد. مطابقة
   * ID-based فقط (رقم_الموكل) — سجلات قديمة بلا رقم_الموكل لا يمكن
   * تجميعها بموكل محدد بأمان دون الاسم، فتُستبعد من هذا الترتيب تحديدًا
   * (بخلاف getClientNet التي تملك سياق clientId واحد فتلجأ لمطابقة الاسم).
   * @param {number} [limit=5]
   * @returns {Array<{clientId:string, collected:number}>}
   */
  function getTopRevenueClients(limit) {
    var d = _dataRef() || {};
    var byClient = {};
    (d.fees || []).forEach(function (f) {
      var cl = f['رقم_الموكل'];
      if (!cl) return;
      byClient[cl] = (byClient[cl] || 0) + _num(f['المبلغ']);
    });
    return Object.keys(byClient)
      .map(function (cl) { return { clientId: cl, collected: byClient[cl] }; })
      .sort(function (a, b) { return b.collected - a.collected; })
      .slice(0, limit || 5);
  }

  /**
   * getCasesWithOutstandingBalance() — القضايا التي لها أتعاب متبقية
   * (المتفق عليه > المحصَّل لهذه القضية تحديدًا). قضية سُدِّدت بالكامل أو
   * دُفع فيها أكثر من المتفق عليه لا تظهر هنا.
   * @returns {Array<{caseNum:string, agreedTotal:number, collected:number, remaining:number}>}
   *   مرتبة تنازليًا حسب المتبقي.
   */
  function getCasesWithOutstandingBalance() {
    var caseNums = {};
    _caseClientsRows().forEach(function (r) { if (r['رقم_القضية']) caseNums[r['رقم_القضية']] = true; });
    var list = Object.keys(caseNums).map(function (caseNum) {
      var net = getCaseNet(caseNum);
      return { caseNum: caseNum, agreedTotal: net.agreedTotal, collected: net.collected, remaining: net.remaining };
    }).filter(function (r) { return r.remaining > 0; });
    return list.sort(function (a, b) { return b.remaining - a.remaining; });
  }

  /**
   * getTotalOutstanding() — إجمالي المبالغ المستحقة غير المحصلة.
   * تحديدًا: مجموع "المتبقي" الموجب لكل قضية على حدة (وليس صافي المتفق
   * عليه - المحصَّل على مستوى المكتب ككل) — حتى لا تُخفي دفعة زائدة في
   * قضية أ استحقاقًا حقيقيًا في قضية ب. راجع getOfficeNet().remaining
   * للصافي الإجمالي (رقم مختلف تمامًا، وله معنى محاسبي مختلف).
   * @returns {number}
   */
  function getTotalOutstanding() {
    return getCasesWithOutstandingBalance().reduce(function (acc, r) { return acc + r.remaining; }, 0);
  }

  /**
   * getOfficeExpenseBreakdown() — PHASE 11 (Office Financial Dashboard).
   * Separates ExpensesRepository's single 'النطاق' column into the
   * three distinct totals PHASE 7 §11/§13 found getOfficeNet() lumping
   * together. Additive — getOfficeNet().totalExpenses is untouched.
   * @returns {{officeExpenses:number, caseExpenses:number, clientExpenses:number, total:number}}
   */
  function getOfficeExpenseBreakdown() {
    var d = _dataRef() || {};
    var officeExpenses = 0, caseExpenses = 0, clientExpenses = 0;
    (d.expenses || []).forEach(function (e) {
      var amount = _num(e['المبلغ']);
      if (e['النطاق'] === 'مكتب') officeExpenses += amount;
      else if (e['النطاق'] === 'قضية') caseExpenses += amount;
      else if (e['النطاق'] === 'موكل') clientExpenses += amount;
    });
    return {
      officeExpenses: officeExpenses,
      caseExpenses: caseExpenses,
      clientExpenses: clientExpenses,
      total: officeExpenses + caseExpenses + clientExpenses
    };
  }

  /**
   * ================================================================
   * PHASE 12.1/12.2 — SINGLE-PASS RANKING AGGREGATION
   * ================================================================
   * getCaseFinancialRanking()/getClientFinancialRanking() group Fees +
   * Expenses + CaseClients by case/client in ONE forEach pass each
   * (three total passes regardless of how many cases/clients exist),
   * rather than calling getCaseNet(caseNum)/getClientNet(clientId)
   * once per case/client — which would be O(n×m) exactly as the PHASE
   * 12 prompt warns against ("لا تستخدم getCaseNet() داخل loop لكل
   * قضية"). getCaseNet()/getClientNet() themselves are UNCHANGED and
   * remain the right tool for a SINGLE case/client view (PHASE 3's own
   * design) — these two functions exist only for ranking many rows
   * at once.
   * ================================================================
   */

  /** getCaseFinancialRanking() — one row per case: {caseNum, agreed, collected, remaining, expenses, netCash}. netCash = collected - expenses (NEVER agreed - expenses). */
  function getCaseFinancialRanking() {
    var d = _dataRef() || {};
    var byCase = {};
    function bucket(caseNum) {
      if (!byCase[caseNum]) byCase[caseNum] = { caseNum: caseNum, agreed: 0, collected: 0, expenses: 0 };
      return byCase[caseNum];
    }
    (d.caseClients || []).forEach(function (r) {
      if (!r['رقم_القضية']) return;
      bucket(r['رقم_القضية']).agreed += _num(r['أتعاب_العلاقة']);
    });
    (d.fees || []).forEach(function (f) {
      if (!f['رقم_القضية']) return;
      bucket(f['رقم_القضية']).collected += _num(f['المبلغ']);
    });
    (d.expenses || []).forEach(function (e) {
      if (e['النطاق'] !== 'قضية' || !e['رقم_القضية']) return;
      bucket(e['رقم_القضية']).expenses += _num(e['المبلغ']);
    });
    return Object.keys(byCase).map(function (caseNum) {
      var row = byCase[caseNum];
      row.remaining = row.agreed - row.collected;
      row.netCash = row.collected - row.expenses;
      return row;
    });
  }

  /** getClientFinancialRanking() — one row per client: {clientId, agreed, collected, remaining, expenses, netCash}. collected is id-matched only (رقم_الموكل) — same scoping rule getTopRevenueClients() already uses; a client with only legacy name-matched fees will show collected=0 here (same limitation getTopRevenueClients() already documents). */
  function getClientFinancialRanking() {
    var d = _dataRef() || {};
    var byClient = {};
    function bucket(clientId) {
      if (!byClient[clientId]) byClient[clientId] = { clientId: clientId, agreed: 0, collected: 0, expenses: 0 };
      return byClient[clientId];
    }
    (d.caseClients || []).forEach(function (r) {
      if (!r['رقم_الموكل']) return;
      bucket(r['رقم_الموكل']).agreed += _num(r['أتعاب_العلاقة']);
    });
    (d.fees || []).forEach(function (f) {
      if (!f['رقم_الموكل']) return;
      bucket(f['رقم_الموكل']).collected += _num(f['المبلغ']);
    });
    (d.expenses || []).forEach(function (e) {
      if (e['النطاق'] !== 'موكل' || !e['رقم_الموكل']) return;
      bucket(e['رقم_الموكل']).expenses += _num(e['المبلغ']);
    });
    return Object.keys(byClient).map(function (clientId) {
      var row = byClient[clientId];
      row.remaining = row.agreed - row.collected;
      row.netCash = row.collected - row.expenses;
      return row;
    });
  }

  /**
   * getRelationshipRemaining(relationshipId) — PHASE 8 (Security +
   * Payment Workflow). Precise PER-RELATIONSHIP figure (not per-case or
   * per-client aggregate — see file header rationale in this section):
   * collected is the sum of ONLY رقم_علاقة-tagged Fees for this exact
   * relationship id — never the legacy رقم_القضية/اسم_الموكل fallback,
   * because a case can have more than one relationship (e.g. plaintiff
   * AND defendant both represented), and an untagged historical payment
   * cannot be safely attributed to one specific relationship among
   * several by name/case matching alone.
   * @param {string} relationshipId
   * @returns {{agreedTotal:number, collected:number, remaining:number}}
   */
  function getRelationshipRemaining(relationshipId) {
    if (!relationshipId) return { agreedTotal: 0, collected: 0, remaining: 0 };
    var d = _dataRef() || {};
    var rel = _caseClientsRows().filter(function (r) { return r.id === relationshipId; })[0];
    if (!rel) return { agreedTotal: 0, collected: 0, remaining: 0 };
    var agreedTotal = _num(rel['أتعاب_العلاقة']);
    var collected = (d.fees || [])
      .filter(function (f) { return f['رقم_علاقة'] === relationshipId; })
      .reduce(function (acc, f) { return acc + _num(f['المبلغ']); }, 0);
    return { agreedTotal: agreedTotal, collected: collected, remaining: agreedTotal - collected };
  }

  /**
   * ================================================================
   * PHASE 9 — LEDGER (كشف الحساب): Projection/View over Fees +
   * Expenses. Per audit prompt §18/§9: "Ledger = View/Projection...
   * ولا يتم إنشاء نسخة ثانية من نفس الحركة لمجرد العرض" — every entry
   * below is computed fresh on each call directly from data.fees /
   * data.expenses; nothing is ever written back to any store. Each
   * entry carries sourceType + sourceId pointing at its real origin
   * record, so the UI can navigate back to it — never a copy.
   * ================================================================
   */

  /** _ledgerEntriesFrom(fees, expenses) — merges + sorts chronologically, computing a running balance. Shared by all three getXLedger() functions below. */
  function _buildLedger(feeRows, expenseRows) {
    var entries = [];
    feeRows.forEach(function (f) {
      entries.push({
        date: f['تاريخ_الاستلام'] || '',
        type: 'دفعة أتعاب',
        description: f['نوع_الأتعاب'] || 'دفعة أتعاب',
        caseNum: f['رقم_القضية'] || '',
        clientId: f['رقم_الموكل'] || '',
        clientName: f['اسم_الموكل'] || '',
        income: _num(f['المبلغ']),
        expense: 0,
        sourceType: 'fee',
        sourceId: f['رقم_العملية']
      });
    });
    expenseRows.forEach(function (e) {
      entries.push({
        date: e['التاريخ'] || '',
        type: 'مصروف (' + (e['النطاق'] || '') + ')',
        description: e['التصنيف'] || 'مصروف',
        caseNum: e['رقم_القضية'] || '',
        clientId: e['رقم_الموكل'] || '',
        clientName: '',
        income: 0,
        expense: _num(e['المبلغ']),
        sourceType: 'expense',
        sourceId: e.id
      });
    });

    // Chronological order; entries sharing the same date keep their
    // relative insertion order (Array.prototype.sort is stable in every
    // engine this project targets) rather than being scrambled.
    entries.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });

    var running = 0;
    entries.forEach(function (entry) {
      running += entry.income - entry.expense;
      entry.balance = running;
    });
    return entries;
  }

  /**
   * getCaseLedger(caseNum) — كشف حساب القضية.
   * @param {string} caseNum
   * @returns {Array<{date, type, description, caseNum, clientId, clientName, income, expense, balance, sourceType, sourceId}>}
   */
  function getCaseLedger(caseNum) {
    if (!caseNum) return [];
    var d = _dataRef() || {};
    var feeRows = (d.fees || []).filter(function (f) { return f['رقم_القضية'] === caseNum; });
    var expenseRows = (d.expenses || []).filter(function (e) { return e['رقم_القضية'] === caseNum; });
    return _buildLedger(feeRows, expenseRows);
  }

  /**
   * getClientLedger(clientId) — كشف حساب الموكل (كل قضاياه مجتمعة، كل
   * حركة تحمل رقم القضية التي تخصها).
   * @param {string} clientId
   * @returns {Array}
   */
  function getClientLedger(clientId) {
    if (!clientId) return [];
    var d = _dataRef() || {};
    var client = (d.clients || []).filter(function (c) {
      return c[(typeof CLIENTS_ID_FIELD !== 'undefined') ? CLIENTS_ID_FIELD : 'رقم_الموكل'] === clientId;
    })[0];
    var clientName = client ? (client['الاسم'] || '').trim() : '';

    var feeRows = (d.fees || []).filter(function (f) {
      return f['رقم_الموكل'] === clientId || (clientName && (f['اسم_الموكل'] || '').trim() === clientName);
    });
    var expenseRows = (d.expenses || []).filter(function (e) { return e['رقم_الموكل'] === clientId; });
    return _buildLedger(feeRows, expenseRows);
  }

  /**
   * getOfficeLedger() — كشف حساب المكتب (كل الحركات، بلا تصفية).
   * @returns {Array}
   */
  function getOfficeLedger() {
    var d = _dataRef() || {};
    return _buildLedger(d.fees || [], d.expenses || []);
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
    getOfficeNet: getOfficeNet,
    getRelationshipRemaining: getRelationshipRemaining,
    getCaseLedger: getCaseLedger,
    getClientLedger: getClientLedger,
    getOfficeLedger: getOfficeLedger,
    getCollectionsInRange: getCollectionsInRange,
    getExpensesInRange: getExpensesInRange,
    getTodayCollections: getTodayCollections,
    getMonthCollections: getMonthCollections,
    getYearCollections: getYearCollections,
    getTodayExpenses: getTodayExpenses,
    getMonthExpenses: getMonthExpenses,
    getYearExpenses: getYearExpenses,
    getTopRevenueCases: getTopRevenueCases,
    getTopRevenueClients: getTopRevenueClients,
    getCasesWithOutstandingBalance: getCasesWithOutstandingBalance,
    getTotalOutstanding: getTotalOutstanding,
    getOfficeExpenseBreakdown: getOfficeExpenseBreakdown,
    getCaseFinancialRanking: getCaseFinancialRanking,
    getClientFinancialRanking: getClientFinancialRanking
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
    root.getRelationshipRemaining = getRelationshipRemaining;
    root.getCaseLedger = getCaseLedger;
    root.getClientLedger = getClientLedger;
    root.getOfficeLedger = getOfficeLedger;
    root.getCollectionsInRange = getCollectionsInRange;
    root.getExpensesInRange = getExpensesInRange;
    root.getTodayCollections = getTodayCollections;
    root.getMonthCollections = getMonthCollections;
    root.getYearCollections = getYearCollections;
    root.getTodayExpenses = getTodayExpenses;
    root.getMonthExpenses = getMonthExpenses;
    root.getYearExpenses = getYearExpenses;
    root.getTopRevenueCases = getTopRevenueCases;
    root.getTopRevenueClients = getTopRevenueClients;
    root.getCasesWithOutstandingBalance = getCasesWithOutstandingBalance;
    root.getTotalOutstanding = getTotalOutstanding;
    root.getOfficeExpenseBreakdown = getOfficeExpenseBreakdown;
    root.getCaseFinancialRanking = getCaseFinancialRanking;
    root.getClientFinancialRanking = getClientFinancialRanking;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
