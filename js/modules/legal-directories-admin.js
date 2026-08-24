/**
 * ================================================================
 * legal-directories-admin.js — js/modules/legal-directories-admin.js
 * نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Admin Panel (Stage 3, PART A)
 *
 * WHAT THIS IS
 *   Pure, DOM-free draft-editing logic for the static Directory/Node
 *   dataset: add/edit/toggle-enabled/remove/reorder Directories and
 *   Nodes, validate the result (js/utils/DirectoryValidation.js),
 *   and serialize it back to the exact JSON shape shipped in Stage 1
 *   (js/data/directories/legal-directories.json). No DOM, no
 *   fetch/network, no IndexedDB/Repository — this file only mutates
 *   an in-memory "draft" clone and never touches the loaded/live
 *   dataset in js/modules/legal-directories.js directly.
 *
 * SCOPE DECISION — GitHub-backed publishing (flagged, not built here)
 *   The original roadmap groups "Admin Panel" and "GitHub-backed
 *   publishing workflow" together. This phase intentionally builds
 *   ONLY the editing/validation/export side. Committing the edited
 *   dataset back to the repository (GitHub API + Actions) is NOT
 *   implemented, because doing it safely requires a decision only
 *   you can make: a GitHub Personal Access Token must never be
 *   embedded in client-side code shipped to every user's browser
 *   (this app has no server component to hold a secret) — see
 *   js/utils/DirectoryAdminExport.js is not what stores anything;
 *   this file only produces exportDraftJSON() text, which today the
 *   UI offers as a file download. Publishing that file is a manual
 *   "download -> commit" step until you choose one of:
 *     (a) a small trusted backend/serverless endpoint that holds the
 *         token and accepts the edited JSON, or
 *     (b) a manual PR/commit step by a human with repo access, or
 *     (c) GitHub's device-flow OAuth (still needs *something*
 *         server-side to keep the resulting token off client code).
 *   This mirrors Stage-1 rule §23's "stop and inform" convention —
 *   recorded here rather than guessed.
 *
 * PERMISSIONS
 *   Gating (who may see/use admin controls) lives in the UI layer
 *   (js/modules/legal-directories.js), reusing the EXISTING RBAC
 *   system as-is (window.HossamSession + window.HossamPermissionService,
 *   permission key "CanManageRawData" from js/core/rbac/Permissions.js
 *   settings group) — no changes made to any RBAC file.
 *
 * IDENTITY ON CREATE (Stage-1 §12)
 *   New ids are never derived from array position. genId() below.
 * ================================================================
 */
(function (global) {
  'use strict';

  var DirectoryValidationNS = (typeof module !== 'undefined' && module.exports)
    ? require('./../utils/DirectoryValidation.js')
    : global.DirectoryValidation;
  var DirectoryModelNS = (typeof module !== 'undefined' && module.exports)
    ? require('./../utils/DirectoryModel.js')
    : global.DirectoryModel;

  var NODE_TYPES = DirectoryModelNS.NODE_TYPES;

  var _draft = null;      // { directories: Directory[] } | null
  var _original = null;   // untouched snapshot, for resetDraft()/isDirty()

  // ================================================================
  // 1. ID generation (stable, not position-derived — Stage-1 §12)
  // ================================================================

  function genId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function collectAllIds(dataset) {
    var ids = new Set();
    (dataset.directories || []).forEach(function (d) {
      ids.add(d.id);
      DirectoryModelNS.walkNodes(d, function (n) { ids.add(n.id); });
    });
    return ids;
  }

  function uniqueId(prefix, dataset) {
    var existing = collectAllIds(dataset);
    var id = genId(prefix);
    while (existing.has(id)) id = genId(prefix);
    return id;
  }

  // ================================================================
  // 2. Draft lifecycle
  // ================================================================

  function startDraft(dataset) {
    _original = dataset;
    _draft = JSON.parse(JSON.stringify(dataset || { directories: [] }));
    return _draft;
  }

  function getDraft() { return _draft; }

  function isDirty() {
    if (!_draft || !_original) return false;
    return JSON.stringify(_draft) !== JSON.stringify(_original);
  }

  function resetDraft() {
    if (_original) _draft = JSON.parse(JSON.stringify(_original));
    return _draft;
  }

  function discardDraft() {
    _draft = null;
    _original = null;
  }

  // ================================================================
  // 3. Lookup helpers (search the draft tree)
  // ================================================================

  function findDirectory(id) {
    return (_draft.directories || []).find(function (d) { return d.id === id; }) || null;
  }

  /**
   * Finds a node anywhere in the draft and returns
   * { node, siblings, directory } — `siblings` is the actual array
   * reference the node lives in (directory.items, or some folder's
   * children), so callers can splice/reorder in place.
   */
  function findNode(nodeId) {
    var found = null;
    (_draft.directories || []).forEach(function (directory) {
      if (found) return;
      (function search(list, parentList) {
        if (found) return;
        list.forEach(function (n) {
          if (found) return;
          if (n.id === nodeId) { found = { node: n, siblings: list, directory: directory }; return; }
          if (n.type === NODE_TYPES.FOLDER && Array.isArray(n.children)) search(n.children, list);
        });
      })(directory.items || [], null);
    });
    return found;
  }

  // ================================================================
  // 4. Directory operations
  // ================================================================

  var ALLOWED_DIRECTORY_FIELDS = ['title', 'description', 'icon', 'enabled'];
  var ALLOWED_NODE_FIELDS = ['title', 'description', 'icon', 'enabled', 'url', 'target'];

  function pickAllowed(fields, allowedKeys) {
    var out = {};
    (fields ? Object.keys(fields) : []).forEach(function (k) {
      if (allowedKeys.indexOf(k) !== -1) out[k] = fields[k];
    });
    return out;
  }

  function maxOrder(list) {
    var max = -1;
    (list || []).forEach(function (item) {
      if (typeof item.order === 'number' && isFinite(item.order) && item.order > max) max = item.order;
    });
    return max;
  }

  function addDirectory(fields) {
    var id = uniqueId('dir', _draft);
    var directory = Object.assign({
      id: id,
      title: '',
      items: [],
      enabled: true,
      order: maxOrder(_draft.directories) + 1
    }, pickAllowed(fields, ALLOWED_DIRECTORY_FIELDS));
    directory.items = [];
    _draft.directories.push(directory);
    return id;
  }

  function updateDirectory(id, fields) {
    var directory = findDirectory(id);
    if (!directory) throw new Error('directory not found: ' + id);
    Object.assign(directory, pickAllowed(fields, ALLOWED_DIRECTORY_FIELDS));
    return directory;
  }

  function toggleDirectoryEnabled(id) {
    var directory = findDirectory(id);
    if (!directory) throw new Error('directory not found: ' + id);
    directory.enabled = directory.enabled === false; // flip, default true -> false first toggle
    return directory.enabled;
  }

  function removeDirectory(id) {
    var before = _draft.directories.length;
    _draft.directories = _draft.directories.filter(function (d) { return d.id !== id; });
    return _draft.directories.length < before;
  }

  function moveDirectoryOrder(id, direction) {
    var sorted = DirectoryModelNS.sortByOrder(_draft.directories);
    var idx = sorted.findIndex(function (d) { return d.id === id; });
    if (idx === -1) return false;
    var swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return false;
    var a = sorted[idx], b = sorted[swapIdx];
    var tmp = (typeof a.order === 'number') ? a.order : idx;
    a.order = (typeof b.order === 'number') ? b.order : swapIdx;
    b.order = tmp;
    return true;
  }

  // ================================================================
  // 5. Node operations
  // ================================================================

  /**
   * @param {string} directoryId
   * @param {string|null} parentNodeId  null = top-level item of the directory
   * @param {Object} fields  { title, type, url?, description?, icon? }
   */
  function addNode(directoryId, parentNodeId, fields) {
    var directory = findDirectory(directoryId);
    if (!directory) throw new Error('directory not found: ' + directoryId);

    var type = (fields && fields.type === NODE_TYPES.LINK) ? NODE_TYPES.LINK : NODE_TYPES.FOLDER;
    var id = uniqueId('node', _draft);
    var node = Object.assign({
      id: id,
      title: '',
      type: type,
      enabled: true
    }, pickAllowed(fields, ALLOWED_NODE_FIELDS));
    node.type = type; // type is not editable via pickAllowed on purpose
    if (type === NODE_TYPES.FOLDER) {
      node.children = [];
      delete node.url;
      delete node.target;
    }

    var targetList;
    if (parentNodeId) {
      var parentResult = findNode(parentNodeId);
      if (!parentResult || parentResult.node.type !== NODE_TYPES.FOLDER) {
        throw new Error('parent folder not found or not a folder: ' + parentNodeId);
      }
      if (!Array.isArray(parentResult.node.children)) parentResult.node.children = [];
      targetList = parentResult.node.children;
    } else {
      targetList = directory.items;
    }
    node.order = maxOrder(targetList) + 1;
    targetList.push(node);
    return id;
  }

  function updateNode(nodeId, fields) {
    var result = findNode(nodeId);
    if (!result) throw new Error('node not found: ' + nodeId);
    Object.assign(result.node, pickAllowed(fields, ALLOWED_NODE_FIELDS));
    return result.node;
  }

  function toggleNodeEnabled(nodeId) {
    var result = findNode(nodeId);
    if (!result) throw new Error('node not found: ' + nodeId);
    result.node.enabled = result.node.enabled === false;
    return result.node.enabled;
  }

  function removeNode(nodeId) {
    var result = findNode(nodeId);
    if (!result) return false;
    var idx = result.siblings.indexOf(result.node);
    if (idx === -1) return false;
    result.siblings.splice(idx, 1);
    return true;
  }

  function moveNodeOrder(nodeId, direction) {
    var result = findNode(nodeId);
    if (!result) return false;
    var sorted = DirectoryModelNS.sortByOrder(result.siblings);
    var idx = sorted.findIndex(function (n) { return n.id === nodeId; });
    if (idx === -1) return false;
    var swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return false;
    var a = sorted[idx], b = sorted[swapIdx];
    var tmp = (typeof a.order === 'number') ? a.order : idx;
    a.order = (typeof b.order === 'number') ? b.order : swapIdx;
    b.order = tmp;
    return true;
  }

  // ================================================================
  // 6. Validation + export
  // ================================================================

  function validateDraft() {
    return DirectoryValidationNS.validateDataset(_draft);
  }

  function exportDraftJSON() {
    return JSON.stringify(_draft, null, 2);
  }

  // ================================================================
  // 7. Exports
  // ================================================================

  var api = {
    startDraft: startDraft,
    getDraft: getDraft,
    isDirty: isDirty,
    resetDraft: resetDraft,
    discardDraft: discardDraft,
    addDirectory: addDirectory,
    updateDirectory: updateDirectory,
    toggleDirectoryEnabled: toggleDirectoryEnabled,
    removeDirectory: removeDirectory,
    moveDirectoryOrder: moveDirectoryOrder,
    addNode: addNode,
    updateNode: updateNode,
    toggleNodeEnabled: toggleNodeEnabled,
    removeNode: removeNode,
    moveNodeOrder: moveNodeOrder,
    validateDraft: validateDraft,
    exportDraftJSON: exportDraftJSON,
    findDirectory: findDirectory,
    findNode: findNode
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    global.LegalDirectoriesAdmin = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
