/**
 * ================================================================
 * js/core/dom/DomNodeFactory.js — نظام الحسام للمحاماة
 * PHASE 16.6 — Keyed DOM Recycling (Pilot)
 * PHASE 16.9 — Attribute Reconciliation (adds setAttrs() only)
 * ================================================================
 * Single choke point for creating a new recycled row/card node and for
 * writing its content. Deliberately tiny — document.createElement() +
 * innerHTML, exactly what renderCases() already used, just narrowed
 * from "whole container" to "one row/card at a time".
 *
 * PHASE 16.9 adds setAttrs(node, attrs): the single write primitive
 * for outer-node SCALAR attributes (className, id, title, hidden,
 * disabled). Per the Phase 16.9-A Architecture Validation Report,
 * this is intentionally narrower than a generic attribute engine —
 * no dataset, no style, no ARIA, no arbitrary attributes. Those are
 * explicitly postponed, not supported. create() and setContent() are
 * unmodified by this addition.
 * ================================================================
 */
(function (global) {
  'use strict';

  var DomNodeFactory = {
    /**
     * create(tag, className) -> HTMLElement (new, empty)
     * @param {string} tag e.g. 'tr' | 'div'
     * @param {string} [className]
     */
    create: function (tag, className) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      return node;
    },

    /**
     * setContent(node, html) — writes innerHTML on a single node.
     * The ONLY place in the recycling layer that touches .innerHTML
     * on a per-row/card node, as opposed to the legacy code's
     * per-container .innerHTML rebuild (table.innerHTML = rows.map(...)).
     * @param {HTMLElement} node
     * @param {string} html
     */
    setContent: function (node, html) {
      node.innerHTML = html;
    },

    /**
     * setAttrs(node, attrs) — writes a fixed set of SCALAR outer-node
     * properties. PHASE 16.9 (revised/narrowed scope): only className,
     * id, title, hidden, disabled are recognized. Any other key present
     * on `attrs` (dataset, style, aria-*, arbitrary attributes) is
     * intentionally ignored — those are postponed, not silently
     * "supported" via a generic passthrough. This keeps every write
     * a plain property assignment (no nested objects, no
     * setAttribute() branching), consistent with this file's existing
     * "deliberately tiny" scope.
     * @param {HTMLElement} node
     * @param {{className:string=, id:string=, title:string=, hidden:boolean=, disabled:boolean=}} attrs
     */
    setAttrs: function (node, attrs) {
      if (!attrs) return;
      if (attrs.className !== undefined) node.className = attrs.className;
      if (attrs.id !== undefined) node.id = attrs.id;
      if (attrs.title !== undefined) node.title = attrs.title;
      if (attrs.hidden !== undefined) node.hidden = attrs.hidden;
      if (attrs.disabled !== undefined) node.disabled = attrs.disabled;
    }
  };

  global.DomNodeFactory = DomNodeFactory;
})(typeof window !== 'undefined' ? window : this);
