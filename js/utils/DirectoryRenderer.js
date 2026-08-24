/**
 * ================================================================
 * DirectoryRenderer.js — js/utils/DirectoryRenderer.js
 * نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Generic UI (Stage 2)
 *
 * WHAT THIS IS
 *   The concrete implementation of the Renderer Contract defined in
 *   js/utils/DirectoryModel.js (DIRECTORY_RENDERER_CONTRACT):
 *     renderDirectory(directory, handlers) -> HTMLElement[]  (Cards)
 *     renderNode(node, handlers)           -> HTMLElement    (Card)
 *   ONE renderer for every directory (courts, prosecutions, bar,
 *   ...) — dispatch is purely on `node.type` ("folder" | "link"),
 *   never on id/slug/title. No entity-specific branching anywhere in
 *   this file (Stage-1 §19/§6 requirement, carried into Stage 2).
 *
 * WHAT THIS IS NOT
 *   - Not page state: it does not know about breadcrumbs, navigation
 *     history, or which directory/folder is "currently open" — that
 *     is js/modules/legal-directories.js's job. This file only turns
 *     (directory|node) -> DOM.
 *   - Not a data source: it never fetches, validates, or mutates
 *     data — callers pass already-normalized Directory/Node objects.
 *
 * HANDLERS
 *   `handlers` is optional: { onFolderClick(node), onLinkClick(node) }.
 *   Card click dispatches to exactly one of these based on node.type
 *   — the only place node.type is inspected in this file.
 *
 * DEPENDENCIES
 *   js/utils/DirectoryModel.js (NODE_TYPES, ICON_TYPES, getSortedItems,
 *   getSortedChildren, isEnabled, hasChildren).
 * ================================================================
 */
(function (global) {
  'use strict';

  var DirectoryModelNS = (typeof module !== 'undefined' && module.exports)
    ? require('./DirectoryModel.js')
    : global.DirectoryModel;

  var NODE_TYPES = DirectoryModelNS.NODE_TYPES;
  var ICON_TYPES = DirectoryModelNS.ICON_TYPES;

  // ================================================================
  // 1. Icon rendering (generic — dispatches only on icon.type/node.type)
  // ================================================================

  var GENERIC_FOLDER_GLYPH = '\uD83D\uDCC1'; // 📁 — generic "folder", not court/prosecution-specific
  var GENERIC_LINK_GLYPH = '\uD83D\uDD17';    // 🔗 — generic "external link"

  function appendIcon(container, node) {
    var icon = node.icon || { type: ICON_TYPES.DEFAULT };
    var iconEl;
    if (icon.type === ICON_TYPES.IMAGE || icon.type === ICON_TYPES.QR) {
      if (icon.value) {
        iconEl = global.document.createElement('img');
        iconEl.src = icon.value;
        iconEl.alt = '';
        iconEl.loading = 'lazy';
        iconEl.style.width = '30px';
        iconEl.style.height = '30px';
        iconEl.style.objectFit = 'contain';
        iconEl.style.marginBottom = '8px';
        iconEl.style.display = 'block';
        container.appendChild(iconEl);
        return;
      }
      // Falls through to default glyph when a custom icon has no value
      // (Stage-1 §7: "لا تجعل وجود QR شرطًا لوجود Node").
    }
    iconEl = global.document.createElement('span');
    iconEl.className = 'legal-dir-card-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = node.type === NODE_TYPES.FOLDER ? GENERIC_FOLDER_GLYPH : GENERIC_LINK_GLYPH;
    container.appendChild(iconEl);
  }

  // ================================================================
  // 2. renderNode — dispatches purely on node.type
  // ================================================================

  /**
   * @param {Object} node
   * @param {{onFolderClick?:Function, onLinkClick?:Function}} [handlers]
   * @returns {HTMLElement}
   */
  function renderNode(node, handlers) {
    handlers = handlers || {};
    var doc = global.document;
    var card = doc.createElement('button');
    card.type = 'button';
    card.className = 'legal-dir-card';
    card.dataset.nodeId = node.id;
    card.dataset.nodeType = node.type;

    var badge = doc.createElement('span');
    badge.className = 'legal-dir-card-badge' + (node.type === NODE_TYPES.LINK ? ' is-link' : '');
    badge.textContent = node.type === NODE_TYPES.FOLDER ? 'مجلد' : 'رابط';
    card.appendChild(badge);

    appendIcon(card, node);

    var title = doc.createElement('span');
    title.className = 'legal-dir-card-title';
    title.textContent = node.title || '';
    card.appendChild(title);

    if (node.description) {
      var desc = doc.createElement('span');
      desc.className = 'legal-dir-card-desc';
      desc.textContent = node.description;
      card.appendChild(desc);
    }

    card.addEventListener('click', function () {
      if (node.type === NODE_TYPES.FOLDER) {
        if (typeof handlers.onFolderClick === 'function') handlers.onFolderClick(node);
      } else if (node.type === NODE_TYPES.LINK) {
        if (typeof handlers.onLinkClick === 'function') {
          handlers.onLinkClick(node);
        } else if (node.url) {
          global.open(node.url, node.target || '_blank', 'noopener,noreferrer');
        }
      }
    });

    return card;
  }

  // ================================================================
  // 3. renderDirectory / renderNodeChildren — sorted, enabled-only
  // ================================================================

  /**
   * Renders a Directory's top-level, enabled items as Cards.
   * @param {Object} directory
   * @param {{onFolderClick?:Function, onLinkClick?:Function}} [handlers]
   * @returns {HTMLElement[]}
   */
  function renderDirectory(directory, handlers) {
    var items = DirectoryModelNS.getSortedItems(directory)
      .filter(function (node) { return DirectoryModelNS.isEnabled(node); });
    return items.map(function (node) { return renderNode(node, handlers); });
  }

  /**
   * Renders a folder Node's sorted, enabled children as Cards — used
   * when the page module drills into a folder. Not part of the
   * minimal contract but follows the exact same rules, so it lives
   * here rather than being duplicated by every caller.
   * @param {Object} folderNode
   * @param {{onFolderClick?:Function, onLinkClick?:Function}} [handlers]
   * @returns {HTMLElement[]}
   */
  function renderNodeChildren(folderNode, handlers) {
    var children = DirectoryModelNS.getSortedChildren(folderNode)
      .filter(function (node) { return DirectoryModelNS.isEnabled(node); });
    return children.map(function (node) { return renderNode(node, handlers); });
  }

  // ================================================================
  // 4. Exports
  // ================================================================

  var api = {
    renderNode: renderNode,
    renderDirectory: renderDirectory,
    renderNodeChildren: renderNodeChildren
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    global.DirectoryRenderer = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
