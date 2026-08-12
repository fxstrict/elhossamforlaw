/**
 * ================================================================
 * js/core/dom/DomKeyIndex.js — نظام الحسام للمحاماة
 * PHASE 16.6 — Keyed DOM Recycling (Pilot)
 * PHASE 16.9 — Attribute Reconciliation (entry shape note only; this
 * file's own get()/reset() logic is completely unchanged)
 * ================================================================
 * Maintains a persistent key -> live DOM node map, one per container
 * element, across repeated renderCases() calls. This is the "memory"
 * that lets DomRecycler tell "this row already exists, reuse it" apart
 * from "this row is new, create it" on every call.
 *
 * Scope (Phase 16.6 brief): renderCases() ONLY. Nothing here is wired
 * into any other page/module.
 *
 * Design constraints (Phase 16.6 brief):
 *   - No Proxy, no MutationObserver, no EventBus, no external library.
 *   - Container-scoped via a WeakMap keyed by the container DOM element
 *     itself, so:
 *       a) unrelated containers never share state, and
 *       b) if a container element is ever replaced (e.g. a future page
 *          navigation rebuilds #casesTableBody as a brand-new element),
 *          the old Map is simply unreachable and garbage-collected —
 *          the next render for the new container starts clean instead
 *          of reusing dead node references.
 *   - Plain ES5-compatible JavaScript, consistent with the rest of
 *     js/core/.
 * ================================================================
 */
(function (global) {
  'use strict';

  // container Element -> Map(key -> entry)
  // entry: {node: HTMLElement, html: string|null, attrs: object|null}
  //   - `attrs` was added in PHASE 16.9 (Attribute Reconciliation).
  //     DomRecycler.js is the only place that reads or writes it; this
  //     file remains a plain, entry-shape-agnostic key->object store,
  //     exactly as before. Callers who never set `options.attrs` (e.g.
  //     renderCases(), renderClients()) get entries whose `attrs` field
  //     simply stays null forever — no behavior change here.
  var registry = new WeakMap();

  var DomKeyIndex = {
    /**
     * get(container) -> Map(key -> {node, html, attrs})
     * Returns the persistent key map for this container, creating an
     * empty one on first use for that container.
     * @param {Element} container
     * @returns {Map}
     */
    get: function (container) {
      var map = registry.get(container);
      if (!map) {
        map = new Map();
        registry.set(container, map);
      }
      return map;
    },

    /**
     * reset(container) — drops all tracked keys for this container.
     * Used whenever the container's real children were changed WITHOUT
     * going through DomRecycler (e.g. renderCases()'s existing
     * `tb.innerHTML = ''` empty-state branch, or DomRecycler's own
     * Safety fallback to the legacy full-rebuild path) so a stale
     * key->node reference is never reused on the next render.
     * @param {Element} container
     */
    reset: function (container) {
      registry.delete(container);
    }
  };

  global.DomKeyIndex = DomKeyIndex;
})(typeof window !== 'undefined' ? window : this);
