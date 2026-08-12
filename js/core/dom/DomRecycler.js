/**
 * ================================================================
 * js/core/dom/DomRecycler.js — نظام الحسام للمحاماة
 * PHASE 16.6 — Keyed DOM Recycling (Pilot)
 * PHASE 16.9 — Attribute Reconciliation (adds options.attrs ONLY)
 * ================================================================
 * reconcile(container, items, options) — the ONE public API
 * renderCases() calls. Everything else in js/core/dom/ (DomKeyIndex,
 * DomNodeFactory, DomPatch) is an implementation detail this function
 * composes; renderCases() never touches them directly (brief: "لا تجعل
 * renderCases يعرف تفاصيل التنفيذ. بل يستدعى API بسيطة فقط").
 *
 * This is NOT a Virtual DOM / React / Vue-style diff. It is a single,
 * intentionally simple keyed reconciliation pass:
 *   - one forward walk over `items`,
 *   - one "anchor" pointer tracking the next untouched existing child,
 *   - O(n) node moves in the common case (few/no reorders), NOT an
 *     LIS-optimal minimum-moves diff (documented limitation — a real
 *     future upgrade path, out of scope for this Pilot).
 *
 * options:
 *   key(item)     -> string|number — stable identity for the item
 *                     (Cases: رقم_القضية — see PHASE 16.6 Evidence §3-4)
 *   tag           -> outer element tag to create for NEW items
 *                     ('tr' | 'div')
 *   className     -> optional className for NEW items ('m-card' for
 *                     the mobile card list; omitted for <tr>)
 *   render(item)  -> INNER html string for this item — no outer
 *                     <tr>/<div> wrapper. The factory owns the wrapper
 *                     element; render() owns the content, using the
 *                     EXACT SAME string-building logic renderCases()
 *                     already had, just narrowed from "whole table" to
 *                     "one row/card".
 *   attrs(item)   -> OPTIONAL. PHASE 16.9. Returns a plain object of
 *                     scalar outer-node properties to reconcile for
 *                     this item — className, id, title, hidden,
 *                     disabled (see DomPatch.attrs() /
 *                     DomNodeFactory.setAttrs()). May return
 *                     undefined for any given item to skip attribute
 *                     reconciliation for just that item. If
 *                     options.attrs is omitted entirely (Cases,
 *                     Clients — every current caller), this whole
 *                     branch is never entered and nothing about
 *                     existing behavior changes.
 *
 * Returns stats {reused, created, removed, updated, moved} on success.
 * `updated` increments on EITHER a content change or an attrs change
 * (not a new separate counter) — existing callers who never use
 * options.attrs see this counter behave exactly as before.
 *
 * SAFETY (brief, mandatory): this function throws on any internal
 * failure (missing/duplicate key, etc.) by design — it never catches
 * its own errors, so a corrupted key index is never silently kept
 * around. Callers (renderCases()) MUST wrap reconcile() in try/catch
 * and fall back to the legacy full innerHTML rebuild on failure.
 * ================================================================
 */
(function (global) {
  'use strict';

  function reconcile(container, items, options) {
    if (!container) throw new Error('DomRecycler.reconcile: container is required');
    if (!options || typeof options.key !== 'function' || typeof options.render !== 'function') {
      throw new Error('DomRecycler.reconcile: options.key and options.render are required functions');
    }

    var keyFn = options.key;
    var renderFn = options.render;
    var tag = options.tag || 'div';
    var className = options.className || null;

    var map = global.DomKeyIndex.get(container);
    var stats = { reused: 0, created: 0, removed: 0, updated: 0, moved: 0 };
    var seenKeys = new Set();

    // Pointer to the next existing child that hasn't been "claimed" by
    // an item yet, walked forward as items are processed in order.
    var anchor = container.firstChild;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var key = keyFn(item);

      // PHASE 16.6 Evidence §5/§6: رقم_القضية is required + validated
      // by CasesRepository on every create()/update(), but legacy or
      // externally-imported data is a documented, low-probability
      // exception — guard defensively rather than assume every record
      // always has a usable key.
      if (key === undefined || key === null || key === '') {
        throw new Error('DomRecycler.reconcile: item at index ' + i + ' has no usable key');
      }
      if (seenKeys.has(key)) {
        throw new Error('DomRecycler.reconcile: duplicate key "' + key + '"');
      }
      seenKeys.add(key);

      var html = renderFn(item);
      var entry = map.get(key);
      var wasNew = !entry;

      if (wasNew) {
        var node = global.DomNodeFactory.create(tag, className);
        entry = { node: node, html: null, attrs: null };
        global.DomPatch.content(entry, html);
        map.set(key, entry);
        stats.created++;
      } else {
        stats.reused++;
        if (global.DomPatch.content(entry, html)) stats.updated++;
      }

      // PHASE 16.9: entirely optional, entirely gated. If a caller
      // never passes options.attrs (Cases, Clients), this branch is
      // never entered — no function call, no object allocation, no
      // read of entry.attrs. If options.attrs(item) returns nothing
      // for a particular item, that item's attrs are simply left as
      // they were (skip, not clear).
      if (options.attrs) {
        var itemAttrs = options.attrs(item);
        if (itemAttrs && global.DomPatch.attrs(entry, itemAttrs)) stats.updated++;
      }

      if (entry.node === anchor) {
        // Already in the right slot — advance the anchor, zero DOM writes.
        anchor = anchor.nextSibling;
      } else {
        global.DomPatch.position(entry.node, container, anchor);
        if (!wasNew) stats.moved++;
      }
    }

    // Remove stale nodes whose key is no longer present in this render.
    map.forEach(function (entry, key) {
      if (!seenKeys.has(key)) {
        if (entry.node.parentNode === container) container.removeChild(entry.node);
        map.delete(key);
        stats.removed++;
      }
    });

    return stats;
  }

  global.DomRecycler = { reconcile: reconcile };
})(typeof window !== 'undefined' ? window : this);
