/**
 * ================================================================
 * HistoryPanel.js — History Panel Aggregation Core | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 12.6 — History Panel (Undo / Redo History)
 * PHASE 12.6B — added `before`/`after` passthrough on each flattened
 *   entry (read-only; both fields already existed inside every
 *   UndoManager entry returned by exportHistory() — this phase just
 *   stops discarding one of the two). Used by historypanel-ui.js's new
 *   "عرض التفاصيل" expandable detail view. No other logic changed.
 *
 * WHAT THIS FILE IS
 *   A read-only, entity-agnostic aggregator that turns the 9 separate,
 *   independent per-entity UndoManager instances (one per module, wired
 *   since SUB-PHASE 12.4/12.5 — casesUndoManager, clientsUndoManager,
 *   childrenUndoManager, sessionsUndoManager, tasksUndoManager,
 *   feesUndoManager, documentsUndoManager, libraryUndoManager,
 *   templatesUndoManager) into ONE merged, human-readable feed for a UI
 *   panel, and provides a "jump to this point" helper that re-uses each
 *   module's own undoLast<Entity>Action()/redoLast<Entity>Action()
 *   wrapper (never Repository/UndoManager internals) to actually apply
 *   the reversal.
 *
 * WHAT THIS FILE IS NOT / WHAT IT NEVER TOUCHES
 *   - It NEVER modifies js/core/UndoManager.js, js/core/UndoReconciler.js,
 *     js/core/Repository.js, or any js/repositories/*.js file.
 *   - It NEVER reaches into a private (`_`-prefixed) field of any
 *     Repository or UndoManager instance. It only calls the same public
 *     façade already documented and used by the 9 modules themselves:
 *     `repository.getUndoManager()` -> `.exportHistory()` (read-only),
 *     and `repository.canUndo()/canRedo()` for guard checks.
 *   - It NEVER calls repository.undo()/redo() itself to mutate data —
 *     that would only return a snapshot instruction (see
 *     UndoReconciler.js header) without touching data.*, the persisted
 *     record, mirrors, renders, or badges. Applying a reversal is
 *     delegated entirely to each module's existing, already-verified
 *     undoLast<Entity>Action()/redoLast<Entity>Action() wrapper, so the
 *     full existing refresh sequence (Repository mutation -> mirror
 *     sync -> saveLocal -> render -> badges -> toast) runs exactly as
 *     it already does for the 9 existing per-page Undo/Redo buttons.
 *     This file adds a new way to TRIGGER that sequence; it does not
 *     reimplement it.
 *
 * WHY EACH ENTITY KEEPS ITS OWN INDEPENDENT HISTORY (NOT A REWRITE)
 *   Each of the 9 modules wires its own `new UndoManager(<repo>)`
 *   instance (Phase 12.5 brief §11 — kept deliberately separate so one
 *   entity's undo/redo history is never entangled with another's).
 *   This panel does not change that. It reads all 9 histories and
 *   displays them on one merged timeline (sorted by real timestamp),
 *   but "jump to here" for an entry belonging to entity X only ever
 *   calls entity X's own undo/redo wrapper, the number of times needed
 *   to reach that point in X's own stack. Two entries from different
 *   entities can be adjacent in the merged feed purely because their
 *   timestamps are close — undoing one never affects the other's stack.
 *   Every entity's history is capped independently at its own
 *   maxHistorySize (50, per UndoManager.js's default — see
 *   `historyLimits()` below for the live per-entity figures instead of
 *   a fabricated single global number).
 * ================================================================
 */

(function (root) {
  'use strict';

  // --------------------------------------------------------------
  // Entity registry — one row per entity module. Every property here
  // matches a global name each module already exposes today (verified
  // by reading js/modules/*.js — see docs/Phase12_6_History_Panel_Report.md
  // §2 "Registry Verification Table"). Nothing here is guessed.
  // --------------------------------------------------------------
  var REGISTRY = [
    { key: 'cases',     label: 'قضية',   plural: 'قضايا',   icon: '📁', repoVar: 'casesRepository',     idField: 'رقم_القضية',  undoFn: 'undoLastCaseAction',     redoFn: 'redoLastCaseAction',     labelFields: ['عنوان_القضية', 'اسم_الموكل'] },
    { key: 'clients',   label: 'موكل',   plural: 'موكلين',  icon: '👤', repoVar: 'clientsRepository',   idField: 'رقم_الموكل',  undoFn: 'undoLastClientAction',   redoFn: 'redoLastClientAction',   labelFields: ['الاسم'] },
    { key: 'children',  label: 'طفل',    plural: 'أطفال',   icon: '👶', repoVar: 'childrenRepository',  idField: 'رقم_الطفل',   undoFn: 'undoLastChildAction',    redoFn: 'redoLastChildAction',    labelFields: ['الاسم', 'اسم'] },
    { key: 'sessions',  label: 'جلسة',   plural: 'جلسات',   icon: '📅', repoVar: 'sessionsRepository',  idField: 'رقم_الجلسة',  undoFn: 'undoLastSessionAction',  redoFn: 'redoLastSessionAction',  labelFields: ['عنوان_القضية'] },
    { key: 'tasks',     label: 'مهمة',   plural: 'مهام',    icon: '✅', repoVar: 'tasksRepository',     idField: 'رقم_المهمة',  undoFn: 'undoLastTaskAction',     redoFn: 'redoLastTaskAction',     labelFields: ['العنوان'] },
    { key: 'fees',      label: 'أتعاب',  plural: 'أتعاب',   icon: '💰', repoVar: 'feesRepository',      idField: 'رقم_العملية', undoFn: 'undoLastFeeAction',      redoFn: 'redoLastFeeAction',      labelFields: ['اسم_الموكل'] },
    { key: 'documents', label: 'مستند',  plural: 'مستندات', icon: '📎', repoVar: 'documentsRepository', idField: 'رقم_المستند', undoFn: 'undoLastDocumentAction', redoFn: 'redoLastDocumentAction', labelFields: ['اسم_المستند'] },
    { key: 'library',   label: 'كتاب',   plural: 'كتب',     icon: '📚', repoVar: 'libraryRepository',   idField: 'id',           undoFn: 'undoLastLibBookAction',  redoFn: 'redoLastLibBookAction',  labelFields: ['العنوان'] },
    { key: 'templates', label: 'صيغة',   plural: 'صيغ',     icon: '📄', repoVar: 'templatesRepository', idField: 'id',           undoFn: 'undoLastTemplateAction', redoFn: 'redoLastTemplateAction', labelFields: ['العنوان'] }
  ];

  var TYPE_LABEL = { create: 'CREATE', update: 'UPDATE', delete: 'DELETE', restore: 'RESTORE' };
  var TYPE_VERB_UNDO = { create: 'تم التراجع عن إنشاء', update: 'تم التراجع عن تعديل', delete: 'تم التراجع عن حذف', restore: 'تم التراجع عن استعادة' };
  var TYPE_VERB_DO   = { create: 'تم إنشاء', update: 'تم تعديل', delete: 'تم حذف', restore: 'تمت استعادة' };

  // Two entries from the same entity + same type within this many ms of
  // each other are considered part of one bulk operation for DISPLAY
  // purposes only (grouping never changes what undo/redo actually do —
  // see groupFeed() below, each underlying entry is still distinct).
  var BULK_WINDOW_MS = 4000;
  var BULK_MIN_COUNT = 3;

  function getRepo(entity) {
    var repo = root[entity.repoVar];
    return (repo && typeof repo.getUndoManager === 'function') ? repo : null;
  }

  function labelFor(entity, record) {
    if (!record) return null;
    for (var i = 0; i < entity.labelFields.length; i++) {
      var v = record[entity.labelFields[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    var idVal = record[entity.idField];
    return idVal !== undefined && idVal !== null ? String(idVal) : null;
  }

  /**
   * @returns {Array<{entity, idx, type, timestamp, record, id}>} every
   *   live entity's raw history entries, tagged and flattened, oldest
   *   first (idx = position within that entity's own stack — needed
   *   later to compute how many undo() calls reach a given entry).
   */
  function rawEntries(kind) {
    // kind: 'history' | 'redo'
    var out = [];
    REGISTRY.forEach(function (entity) {
      var repo = getRepo(entity);
      if (!repo) return;
      var mgr = repo.getUndoManager();
      if (!mgr || typeof mgr.exportHistory !== 'function') return;
      var snap = mgr.exportHistory();
      var list = (kind === 'redo') ? snap.redo : snap.history;
      (list || []).forEach(function (entry, idx) {
        var record = (entry.type === 'delete') ? entry.before : entry.after;
        out.push({
          entity: entity,
          idx: idx,
          stackLength: list.length,
          type: entry.type,
          timestamp: entry.timestamp,
          record: record,
          // PHASE 12.6B: both already existed on `entry` (see UndoManager.js
          // buildEntry()) — surfaced here read-only for the UI's expandable
          // "Before / After" detail view. Nothing about jumpTo()/getFeed()'s
          // existing contract changes.
          before: entry.before,
          after: entry.after,
          label: labelFor(entity, record) || labelFor(entity, entry.before)
        });
      });
    });
    return out;
  }

  /** Groups consecutive same-entity/same-type entries within
   *  BULK_WINDOW_MS into one display group when there are >= BULK_MIN_COUNT
   *  of them. Input must already be sorted oldest-first. */
  function groupBulk(sortedAsc) {
    var groups = [];
    var i = 0;
    while (i < sortedAsc.length) {
      var start = i;
      var j = i + 1;
      while (
        j < sortedAsc.length &&
        sortedAsc[j].entity.key === sortedAsc[start].entity.key &&
        sortedAsc[j].type === sortedAsc[start].type &&
        (new Date(sortedAsc[j].timestamp) - new Date(sortedAsc[j - 1].timestamp)) <= BULK_WINDOW_MS
      ) {
        j++;
      }
      var span = sortedAsc.slice(start, j);
      if (span.length >= BULK_MIN_COUNT) {
        groups.push({ bulk: true, entity: span[0].entity, type: span[0].type, members: span, anchor: span[span.length - 1] });
      } else {
        span.forEach(function (e) { groups.push({ bulk: false, entity: e.entity, type: e.type, members: [e], anchor: e }); });
      }
      i = j;
    }
    return groups;
  }

  /**
   * @returns {{undo: Array<Group>, redo: Array<Group>, counts: Object, limits: Array}}
   *   `undo`/`redo` are newest-first (display order). Each Group's
   *   `anchor` entry carries `{entity, idx, stackLength, type, timestamp,
   *   record, label}` and is what jumpTo() needs.
   */
  function getFeed() {
    var histAsc = rawEntries('history').sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    var redoAsc = rawEntries('redo').sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    var undoGroups = groupBulk(histAsc).reverse();
    var redoGroups = groupBulk(redoAsc).reverse();

    var counts = { undo: histAsc.length, redo: redoAsc.length };
    var limits = REGISTRY.map(function (entity) {
      var repo = getRepo(entity);
      var mgr = repo && repo.getUndoManager();
      var snap = mgr ? mgr.exportHistory() : null;
      return {
        key: entity.key, label: entity.label,
        used: snap ? snap.history.length : 0,
        max: snap ? snap.maxHistorySize : null,
        wired: !!mgr
      };
    });

    return { undo: undoGroups, redo: redoGroups, counts: counts, limits: limits };
  }

  /**
   * Applies enough undo()/redo() calls (through the target entity's own
   * existing wrapper function — see file header) to reach the state
   * right after `group.anchor`, keeping that action itself but reverting
   * everything of that SAME entity that happened after it.
   * Only ever touches `group.entity`'s own stack — never any other
   * entity's history, even if other entities' entries sit between it and
   * "now" on the merged timeline.
   * @param {Group} group - one entry from getFeed().undo or .redo
   * @param {'undo'|'redo'} direction
   */
  async function jumpTo(group, direction) {
    var entity = group.entity;
    var fnName = direction === 'undo' ? entity.undoFn : entity.redoFn;
    var fn = root[fnName];
    if (typeof fn !== 'function') {
      return { success: false, error: 'وظيفة ' + fnName + ' غير متاحة' };
    }

    var anchorIdx = group.anchor.idx;
    var anchorStackLen = group.anchor.stackLength;
    var callsNeeded = direction === 'undo'
      ? (anchorStackLen - 1 - anchorIdx)   // undo everything AFTER the anchor
      : (anchorStackLen - anchorIdx);      // redo up to AND including the anchor

    if (callsNeeded <= 0) callsNeeded = direction === 'redo' ? 1 : 0;
    // A single "undo this bulk group" click (group.bulk===true, direction
    // 'undo', anchor === newest member) already yields callsNeeded 0 when
    // the group is at the very top of the stack — in that case the group
    // itself is the thing to undo, so fall back to one call per member.
    if (callsNeeded === 0 && direction === 'undo') {
      callsNeeded = group.members.length;
    }

    var done = 0;
    for (var i = 0; i < callsNeeded; i++) {
      try {
        await fn();
        done++;
      } catch (e) {
        return { success: done > 0, error: (e && e.message) || String(e), done: done, requested: callsNeeded };
      }
    }
    return { success: true, done: done, requested: callsNeeded };
  }

  function typeLabel(type) { return TYPE_LABEL[type] || String(type).toUpperCase(); }
  function verbFor(type, wasUndoRedo) {
    // wasUndoRedo: true when displaying inside the redo list (i.e. this
    // entry was itself undone and is now awaiting redo) — purely a
    // display nuance, not used for any logic decision.
    return (wasUndoRedo ? TYPE_VERB_UNDO : TYPE_VERB_DO)[type] || type;
  }

  var api = {
    REGISTRY: REGISTRY,
    getFeed: getFeed,
    jumpTo: jumpTo,
    typeLabel: typeLabel,
    verbFor: verbFor,
    BULK_MIN_COUNT: BULK_MIN_COUNT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HistoryPanel = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
