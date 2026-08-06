/**
 * ================================================================
 * js/core/dom/DomPatch.js — نظام الحسام للمحاماة
 * PHASE 16.6 — Keyed DOM Recycling (Pilot)
 * PHASE 16.9 — Attribute Reconciliation (adds attrs() only)
 * ================================================================
 * One small, isolated decision a keyed diff needs for every recycled
 * row/card: does this node's content actually need rewriting? Written
 * so it is a zero-DOM-write no-op when nothing changed — that is the
 * entire performance point of recycling versus the legacy
 * table.innerHTML = rows.map(...).join('') rebuild.
 *
 * Depends on DomNodeFactory.setContent() (js/core/dom/DomNodeFactory.js)
 * as its single write path — DomPatch itself never touches .innerHTML
 * directly.
 *
 * PHASE 16.9 adds attrs(entry, attrs): the same "compare first, write
 * only if needed, cache last value" contract as content(), applied to
 * the fixed scalar outer-node property set (className, id, title,
 * hidden, disabled — see DomNodeFactory.setAttrs()). Per-key shallow
 * comparison only; no nested/deep comparison, no dataset, no style.
 * A key present in a previous call but absent from the new `attrs`
 * object is treated as explicitly cleared back to its DOM default
 * (empty string for className/id/title, false for hidden/disabled),
 * not left stale. content() and position() are unmodified.
 * ================================================================
 */
(function (global) {
  'use strict';

  // The only scalar outer-node properties Phase 16.9 recognizes.
  // Intentionally NOT extensible here without a deliberate design
  // decision — see the Phase 16.9-A Architecture Validation Report.
  var SCALAR_ATTR_DEFAULTS = { className: '', id: '', title: '', hidden: false, disabled: false };
  var SCALAR_ATTR_KEYS = ['className', 'id', 'title', 'hidden', 'disabled'];

  var DomPatch = {
    /**
     * content(entry, html) -> boolean changed
     * entry: {node, html} — a DomKeyIndex map entry. Compares `html`
     * against the last string this exact node was set to; writes AND
     * updates the cached string only when they differ.
     * @param {{node: HTMLElement, html: (string|null)}} entry
     * @param {string} html
     * @returns {boolean}
     */
    content: function (entry, html) {
      if (entry.html === html) return false;
      global.DomNodeFactory.setContent(entry.node, html);
      entry.html = html;
      return true;
    },

    /**
     * attrs(entry, attrs) -> boolean changed
     * entry: {node, html, attrs} — a DomKeyIndex map entry. Compares
     * each recognized scalar key in `attrs` against the last value
     * cached for that key on this exact entry; writes ONLY the keys
     * that actually differ (via a single DomNodeFactory.setAttrs()
     * call carrying just those keys), then caches the full resolved
     * set for next time.
     *
     * A recognized key missing from `attrs` but present in the cache
     * is written back to its scalar default (cleared), not skipped —
     * so a caller that stops supplying e.g. `title` on a later render
     * doesn't leave a stale title behind.
     *
     * Keys never mentioned by the caller (neither now nor previously)
     * are never touched at all, so a caller using only `className`
     * never pays any cost for id/title/hidden/disabled.
     *
     * @param {{node: HTMLElement, html: (string|null), attrs: (object|null)}} entry
     * @param {{className:string=, id:string=, title:string=, hidden:boolean=, disabled:boolean=}} attrs
     * @returns {boolean}
     */
    attrs: function (entry, attrs) {
      if (!attrs) return false;

      var prev = entry.attrs || {};
      var next = {};
      var toWrite = {};
      var changed = false;

      for (var i = 0; i < SCALAR_ATTR_KEYS.length; i++) {
        var key = SCALAR_ATTR_KEYS[i];
        var hasNew = Object.prototype.hasOwnProperty.call(attrs, key);
        var hasOld = Object.prototype.hasOwnProperty.call(prev, key);

        if (!hasNew && !hasOld) continue; // never mentioned; leave untouched entirely

        var newVal = hasNew ? attrs[key] : SCALAR_ATTR_DEFAULTS[key]; // removed -> cleared
        var oldVal = hasOld ? prev[key] : undefined; // first time this key is seen

        if (newVal !== oldVal) {
          toWrite[key] = newVal;
          changed = true;
        }
        next[key] = newVal;
      }

      if (changed) global.DomNodeFactory.setAttrs(entry.node, toWrite);
      entry.attrs = next;
      return changed;
    },

    /**
     * position(node, container, anchor) -> boolean moved
     * Ensures `node` sits immediately before `anchor` (or at the end,
     * if `anchor` is null) inside `container`. Guarded so an
     * already-correct slot costs one comparison instead of one DOM
     * write; insertBefore() itself is safe to call even when `node`
     * is being attached for the first time.
     * @param {HTMLElement} node
     * @param {Element} container
     * @param {Node|null} anchor
     * @returns {boolean}
     */
    position: function (node, container, anchor) {
      if (node === anchor) return false;
      container.insertBefore(node, anchor || null);
      return true;
    }
  };

  global.DomPatch = DomPatch;
})(typeof window !== 'undefined' ? window : this);
