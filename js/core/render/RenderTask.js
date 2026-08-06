/* ============================================================================
 * PHASE 16.2 — RENDER QUEUE FOUNDATION (ZERO REGRESSION)
 * File: js/core/render/RenderTask.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A factory for plain "render task" records: `{ id, key, callback,
 *   meta, createdAt }`. A task is a generic wrapper around ANY callback —
 *   it has no idea whether `key` means "cases", "dashboard", or anything
 *   else. That is deliberate: the Render Queue layer must stay entity-
 *   agnostic (see the "REQUIREMENTS" section of the Phase 16.2 brief).
 *
 * WHY IT EXISTS (Phase 16.2)
 *   RenderRegistry, RenderDispatcher, and RenderQueue all need a shared,
 *   consistent shape for "one unit of render work". Rather than each of
 *   them building object literals ad hoc, this file is the single place
 *   that shape is defined, so it can change in one spot later if needed.
 *
 * HOW THIS WILL BE USED IN PHASE 16.3+
 *   Future phases may add fields to the task shape (e.g. priority, a
 *   dirty/needs-render flag sourced from ShellState) without touching
 *   every call site — only this factory needs updating.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.RenderTaskFactory.
 *   - create() only builds and returns a plain object; it never touches
 *     the DOM, storage, or invokes the callback itself.
 *   - Nothing outside js/core/render/* references this file in this phase.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var nextId = 1;

  var RenderTaskFactory = {
    /**
     * @param {string} key      Generic identifier for what this task
     *                          renders (e.g. a page id). Opaque to this
     *                          layer — never inspected or branched on.
     * @param {Function} callback  The render work to run. Never rewritten,
     *                          only invoked as-is by RenderDispatcher.
     * @param {*} [meta]        Optional, opaque extra data the caller wants
     *                          carried alongside the task. Not used by the
     *                          queue itself in this phase.
     */
    create: function (key, callback, meta) {
      return {
        id: nextId++,
        key: key,
        callback: callback,
        meta: meta === undefined ? null : meta,
        createdAt: (global.performance && global.performance.now) ? global.performance.now() : Date.now()
      };
    }
  };

  global.RenderTaskFactory = RenderTaskFactory;
})(window);
