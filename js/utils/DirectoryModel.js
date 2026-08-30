/**
 * ================================================================
 * DirectoryModel.js — js/utils/DirectoryModel.js | نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Data Model (Stage 1 — Model only)
 *
 * WHAT THIS IS
 *   ONE generic tree data model — Directory -> Node -> Node -> ... —
 *   used to represent ANY future static reference directory the app
 *   ships with (courts, prosecutions, bar association branches,
 *   government sites, useful legal links, ...). There is no
 *   entity-specific model (no CourtModel/ProsecutionModel/etc.) —
 *   every directory is just a dataset that uses this one shape.
 *
 * WHAT THIS IS NOT
 *   - NOT a Repository. Does not extend js/core/Repository.js.
 *   - NOT wired to IndexedDB, StorageAdapter, DatabaseService, or
 *     Google Sheets/Apps Script in any way.
 *   - NOT tied to any user/office/case/client — this describes
 *     static, ship-with-the-app content, identical for every
 *     installation.
 *   - NOT a renderer. This file defines the Renderer Contract
 *     (function names/shapes a future UI renderer must implement)
 *     but contains no DOM code and renders nothing.
 *   - Does NOT modify index.html, CSS, or the service worker. It is
 *     not wired into any script tag yet — inert until a future UI
 *     phase requires it.
 *
 * DATA SOURCE
 *   Static JSON, e.g. js/data/directories/legal-directories.json.
 *   This file only defines the shape/behavior; it never fetches or
 *   requires a specific dataset file itself (kept generic/testable).
 *
 * SHAPE
 *   Directory {
 *     id            string   required, unique across all directories
 *     slug          string   optional, URL-friendly, NOT the identity
 *     title         string   required
 *     description   string   optional
 *     icon          Icon     optional (see ICON_TYPES)
 *     defaultIcon   Icon     optional, fallback when a Node has no icon
 *     enabled       boolean  optional, default true
 *     order         number   optional (see SORT BEHAVIOR)
 *     items         Node[]   required (may be empty array)
 *     metadata      object   optional, free-form but see METADATA RULES
 *     version       string   optional, future admin-panel use
 *     updatedAt     string   optional (ISO date), future admin-panel use
 *   }
 *
 *   Node {
 *     id            string   required, unique across the ENTIRE dataset
 *                            (not just among siblings) — see IDENTITY
 *     slug          string   optional, URL-friendly, NOT the identity
 *     title         string   required
 *     type          "folder" | "link"   required, see NODE_TYPES
 *     order         number   optional (see SORT BEHAVIOR)
 *     icon          Icon     optional (see ICON_TYPES)
 *     description   string   optional
 *     enabled       boolean  optional, default true
 *     children      Node[]   only meaningful when type === "folder"
 *     url           string   only meaningful when type === "link"
 *     target        string   optional, only meaningful when type === "link"
 *     qr            Icon     optional legacy alias — prefer icon.type "qr"
 *     metadata      object   optional, free-form but see METADATA RULES
 *   }
 *
 *   Icon (one of):
 *     { type: "default" }
 *     { type: "image", value: "<url or asset path>" }
 *     { type: "qr", value: "<url or asset path>" }
 *
 * IDENTITY (id vs slug)
 *   `id` is the permanent, stable, admin-invisible identity of a
 *   record. It must never be derived from array position (no
 *   `index-0`, `index-1`) so that re-ordering items in the admin
 *   panel later never changes identity. `slug` is a separate,
 *   optional, human/URL-friendly value used only for navigation —
 *   never used as a lookup key for identity/equality.
 *
 * SORT BEHAVIOR (documented per Stage-1 requirement §9)
 *   sortByOrder() is a STABLE sort:
 *     - Items with a finite numeric `order` sort ascending by that
 *       value.
 *     - Items with a missing/non-numeric `order` are treated as
 *       having order = +Infinity, i.e. they sort AFTER every item
 *       that does have a valid order, in their original relative
 *       (dataset) order.
 *     - Items that share the same `order` value keep their original
 *       relative (dataset) order (stable sort) — no error is thrown,
 *       this is a deliberate, documented tie-break, not a validation
 *       failure (DirectoryValidation.js does not reject duplicate
 *       order values for this reason).
 *
 * METADATA RULES
 *   `metadata` exists so future, currently-unknown display hints can
 *   be added without breaking this shape (e.g. a badge label). It is
 *   NOT a place to store: identity (id/slug), navigation (url/type/
 *   children), display core (title/icon/order/enabled), or anything
 *   user/office/case-specific. If a field is read by generic
 *   rendering logic, it belongs as a top-level field, not inside
 *   metadata.
 *
 * NO ENTITY-SPECIFIC BRANCHING
 *   Nothing in this file (or in the future renderer) may branch on
 *   a specific id/slug/title value (e.g. `if (id === "courts")`).
 *   All directory-specific behavior must be expressible through this
 *   generic shape alone.
 * ================================================================
 */
(function (global) {
  'use strict';

  // ================================================================
  // 1. Constants
  // ================================================================

  var NODE_TYPES = Object.freeze({
    FOLDER: 'folder',
    LINK: 'link'
  });

  var ICON_TYPES = Object.freeze({
    DEFAULT: 'default',
    IMAGE: 'image',
    QR: 'qr'
  });

  // ================================================================
  // 2. Small predicates (no entity-specific branching — generic only)
  // ================================================================

  function isFolder(node) {
    return !!node && node.type === NODE_TYPES.FOLDER;
  }

  function isLink(node) {
    return !!node && node.type === NODE_TYPES.LINK;
  }

  function isEnabled(entity) {
    // enabled defaults to true when absent (Stage-1 §10).
    return !entity || entity.enabled !== false;
  }

  function hasChildren(node) {
    return isFolder(node) && Array.isArray(node.children) && node.children.length > 0;
  }

  // ================================================================
  // 3. Sorting (see SORT BEHAVIOR above)
  // ================================================================

  function orderKey(entity) {
    var o = entity && entity.order;
    return (typeof o === 'number' && isFinite(o)) ? o : Infinity;
  }

  /**
   * Stable sort by `order`. Does not mutate the input array.
   * @param {Array<Object>} list  Directories or Nodes.
   * @returns {Array<Object>} a new, sorted array.
   */
  function sortByOrder(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (item, index) { return { item: item, index: index }; })
      .sort(function (a, b) {
        var diff = orderKey(a.item) - orderKey(b.item);
        if (diff !== 0) return diff;
        return a.index - b.index; // stable tie-break
      })
      .map(function (wrapped) { return wrapped.item; });
  }

  /** Sorted top-level items of a Directory (does not filter disabled). */
  function getSortedItems(directory) {
    return sortByOrder(directory && directory.items);
  }

  /** Sorted children of a folder Node (does not filter disabled). */
  function getSortedChildren(node) {
    return sortByOrder(node && node.children);
  }

  // ================================================================
  // 4. Normalization (pure — never mutates the input)
  // ================================================================

  function normalizeIcon(icon) {
    if (!icon || typeof icon !== 'object') {
      return { type: ICON_TYPES.DEFAULT };
    }
    if (icon.type === ICON_TYPES.IMAGE || icon.type === ICON_TYPES.QR) {
      return { type: icon.type, value: icon.value };
    }
    return { type: ICON_TYPES.DEFAULT };
  }

  /**
   * Returns a normalized shallow copy of a Node (does not mutate,
   * does not deep-clone children — callers that need a fully
   * normalized tree should use normalizeDirectory()/walkNodes()).
   */
  function normalizeNode(node) {
    if (!node || typeof node !== 'object') return null;
    var out = {
      id: node.id,
      slug: node.slug,
      title: node.title,
      type: node.type,
      order: (typeof node.order === 'number' && isFinite(node.order)) ? node.order : undefined,
      icon: normalizeIcon(node.icon || node.qr),
      description: node.description,
      enabled: node.enabled !== false
    };
    if (isFolder(out)) {
      out.children = Array.isArray(node.children) ? node.children : [];
    } else if (isLink(out)) {
      out.url = node.url;
      if (node.target) out.target = node.target;
    }
    if (node.metadata && typeof node.metadata === 'object') out.metadata = node.metadata;
    return out;
  }

  /**
   * Returns a normalized shallow copy of a Directory (items array is
   * copied but not deep-normalized — see walkNodes() for recursive
   * consumption).
   */
  function normalizeDirectory(directory) {
    if (!directory || typeof directory !== 'object') return null;
    return {
      id: directory.id,
      slug: directory.slug,
      title: directory.title,
      description: directory.description,
      icon: normalizeIcon(directory.icon),
      defaultIcon: directory.defaultIcon ? normalizeIcon(directory.defaultIcon) : undefined,
      order: (typeof directory.order === 'number' && isFinite(directory.order)) ? directory.order : undefined,
      enabled: directory.enabled !== false,
      items: Array.isArray(directory.items) ? directory.items : [],
      metadata: (directory.metadata && typeof directory.metadata === 'object') ? directory.metadata : undefined,
      version: directory.version,
      updatedAt: directory.updatedAt
    };
  }

  // ================================================================
  // 5. Traversal (generic — used by both Validation and Renderer)
  // ================================================================

  /**
   * Depth-first walk over every Node in a Directory (top-level items
   * plus every nested child), sorted by order at each level.
   * visitor(node, parentNode|null, depth) may return `false` to skip
   * descending into that node's children.
   * A defensive maxDepth guards against pathological/malformed data
   * (this tree is built from nested JSON so true cycles cannot occur,
   * but the guard keeps the walk safe if this model is ever fed a
   * hand-built object graph).
   */
  function walkNodes(directory, visitor, maxDepth) {
    maxDepth = (typeof maxDepth === 'number') ? maxDepth : 64;
    var items = getSortedItems(directory);
    (function visitLevel(nodes, parent, depth) {
      if (depth > maxDepth) return;
      nodes.forEach(function (node) {
        var descend = visitor(node, parent, depth);
        if (descend !== false && hasChildren(node)) {
          visitLevel(getSortedChildren(node), node, depth + 1);
        }
      });
    })(items, null, 0);
  }

  // ================================================================
  // 6. Renderer Contract (definition only — no DOM code, no UI here)
  // ================================================================

  /**
   * RENDERER CONTRACT
   * A future UI layer must implement a renderer with exactly this
   * shape. This model file only documents/exposes the contract name
   * and expected signatures; it performs no rendering itself.
   *
   *   renderDirectory(directory: Directory) -> Card[]
   *     Renders the Directory's sorted, enabled top-level items as
   *     Cards. Must not branch on directory.id/slug/title.
   *
   *   renderNode(node: Node) -> Card
   *     Renders a single Node as a Card. Must dispatch purely on
   *     node.type ("folder" -> navigates into node.children,
   *     "link" -> opens node.url in a new tab/window) — never on
   *     node.id/slug/title.
   *
   * DIRECTORY_RENDERER_CONTRACT below is a lightweight descriptor
   * (names + arity), not an implementation, so future code and tests
   * can assert against it without a UI existing yet.
   */
  var DIRECTORY_RENDERER_CONTRACT = Object.freeze({
    renderDirectory: { params: ['directory'], returns: 'Card[]' },
    renderNode: { params: ['node'], returns: 'Card' }
  });

  // ================================================================
  // 7. Exports
  // ================================================================

  var api = {
    NODE_TYPES: NODE_TYPES,
    ICON_TYPES: ICON_TYPES,
    DIRECTORY_RENDERER_CONTRACT: DIRECTORY_RENDERER_CONTRACT,
    isFolder: isFolder,
    isLink: isLink,
    isEnabled: isEnabled,
    hasChildren: hasChildren,
    sortByOrder: sortByOrder,
    getSortedItems: getSortedItems,
    getSortedChildren: getSortedChildren,
    normalizeIcon: normalizeIcon,
    normalizeNode: normalizeNode,
    normalizeDirectory: normalizeDirectory,
    walkNodes: walkNodes
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    global.DirectoryModel = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
