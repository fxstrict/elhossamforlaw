/**
 * ================================================================
 * DirectoryPublisher.js — js/utils/DirectoryPublisher.js
 * نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Architecture hardening (Stage 4)
 *
 * WHAT THIS IS
 *   The single "export/publish artifact" seam between the Admin
 *   Panel (js/modules/legal-directories-admin.js) and however the
 *   resulting file eventually leaves the browser. Today that's a
 *   manual download (see legal-directories.js's admin bar) that you
 *   commit to GitHub by hand — see legal-directories-admin.js's
 *   header for why GitHub API/OAuth/PAT/Actions are NOT built here
 *   (explicit decision, not an oversight).
 *
 *       Static JSON -> DirectoryModel -> Validation -> DirectoryRenderer -> UI
 *       Admin Panel -> Draft -> Validation -> DirectoryPublisher -> [delivery]
 *
 *   `[delivery]` is intentionally NOT this file's concern. This file
 *   only turns a draft dataset into `{ filename, content, dataset }`
 *   — a plain, serializable artifact. Swapping the manual-download
 *   delivery for a future "publish to GitHub" delivery only touches
 *   the UI layer's button handler; it never touches this file, the
 *   Model, the Validation layer, or the Renderer.
 *
 * WHAT IT GUARANTEES ABOUT THE OUTPUT (Stage-4 §4)
 *   - Valid JSON, deterministic key order (a fixed, documented order
 *     per object type — see CANONICAL ORDER below), independent of
 *     admin edit history (add-then-edit vs edit-only produce the
 *     same key order).
 *   - `items`/`children` are re-sorted by `order` at canonicalization
 *     time, so the exported file's on-disk order always matches
 *     display order — easier to review in a GitHub diff.
 *   - Only schema fields are emitted (no admin-UI-only/transient
 *     properties, no session data, no secrets, nothing IndexedDB- or
 *     Google-Sheets-related — there never was any such coupling in
 *     this feature to begin with, so there is nothing to strip; this
 *     is enforced structurally by only ever reading the whitelisted
 *     keys below, not by a separate "sanitize" pass).
 *   - Never mutates the dataset object passed in.
 *
 * VERSIONING (Stage-4 §5, revised in Final Audit §2 — BUG FIX)
 *   Dataset-level `version` (positive integer) and `updatedAt` (ISO
 *   date string) are stamped ONLY here, i.e. only when an export/
 *   publish actually happens — never by the read-only load path
 *   (js/modules/legal-directories.js never calls this file).
 *
 *   FIX: the original Stage-4 implementation bumped `version` and
 *   re-stamped `updatedAt` to "now" on EVERY export call, even a
 *   no-op re-export of an unchanged draft — meaning clicking
 *   "download" twice in a row with no edits produced two different
 *   files, which would show as a spurious change in a GitHub diff.
 *   That is not acceptable (an exported artifact must be a pure
 *   function of actual content, not of when/how many times someone
 *   clicked export). Fixed via `options.bump`:
 *     - bump !== false (default): a REAL content change happened —
 *       version = baseVersion (explicit, or dataset.version, or 0) + 1;
 *       updatedAt = options.now || new Date().toISOString().
 *     - bump === false: NO content actually changed — version and
 *       updatedAt are carried over unchanged from the dataset being
 *       exported (falling back to baseVersion/now only if the dataset
 *       has neither yet, e.g. exporting a hand-authored file that
 *       never had a version stamped before).
 *   The caller (js/modules/legal-directories-admin.js's exportArtifact())
 *   decides which case applies using its own isDirty() check — this
 *   file stays a pure function of its explicit inputs and does not
 *   track any draft/session state itself.
 *   Per-Directory `version`/`updatedAt` (documented as optional,
 *   future-admin-panel-use fields in DirectoryModel.js) are left
 *   exactly as-is if a Directory happens to have them — this file
 *   does not invent per-directory values.
 *
 * CANONICAL ORDER
 *   Dataset:   $schemaVersion, version, updatedAt, directories
 *   Directory: id, slug, title, description, icon, defaultIcon,
 *              enabled, order, items, metadata, version, updatedAt
 *   Node:      id, slug, title, type, order, icon, description,
 *              enabled, children (folder) | url, target (link), metadata
 *   (JSON.stringify drops any key whose value is `undefined`, so
 *   listing every possible key here and letting absent ones be
 *   `undefined` is sufficient to get a clean, order-correct result.)
 * ================================================================
 */
(function (global) {
  'use strict';

  var DirectoryModelNS = (typeof module !== 'undefined' && module.exports)
    ? require('./DirectoryModel.js')
    : global.DirectoryModel;
  var DirectoryValidationNS = (typeof module !== 'undefined' && module.exports)
    ? require('./DirectoryValidation.js')
    : global.DirectoryValidation;

  var NODE_TYPES = DirectoryModelNS.NODE_TYPES;

  // ================================================================
  // 1. Canonicalization (pure, no mutation of the input)
  // ================================================================

  function canonicalIcon(icon) {
    return icon ? DirectoryModelNS.normalizeIcon(icon) : undefined;
  }

  function canonicalNode(node) {
    var out = {
      id: node.id,
      slug: node.slug,
      title: node.title,
      type: node.type,
      order: node.order,
      icon: canonicalIcon(node.icon),
      description: node.description,
      enabled: node.enabled !== false
    };
    if (node.type === NODE_TYPES.FOLDER) {
      var children = DirectoryModelNS.sortByOrder(node.children || []);
      out.children = children.map(canonicalNode);
    } else if (node.type === NODE_TYPES.LINK) {
      out.url = node.url;
      out.target = node.target;
    }
    out.metadata = node.metadata;
    return out;
  }

  function canonicalDirectory(directory) {
    var items = DirectoryModelNS.sortByOrder(directory.items || []);
    return {
      id: directory.id,
      slug: directory.slug,
      title: directory.title,
      description: directory.description,
      icon: canonicalIcon(directory.icon),
      defaultIcon: canonicalIcon(directory.defaultIcon),
      enabled: directory.enabled !== false,
      order: directory.order,
      items: items.map(canonicalNode),
      metadata: directory.metadata,
      version: directory.version,
      updatedAt: directory.updatedAt
    };
  }

  /**
   * @param {Object} dataset
   * @param {{version:number, updatedAt:string}} stamp
   * @returns {Object} a brand-new, canonicalized dataset object.
   */
  function canonicalizeDataset(dataset, stamp) {
    var directories = DirectoryModelNS.sortByOrder(dataset.directories || []);
    return {
      $schemaVersion: (typeof dataset.$schemaVersion === 'number') ? dataset.$schemaVersion : 1,
      version: stamp.version,
      updatedAt: stamp.updatedAt,
      directories: directories.map(canonicalDirectory)
    };
  }

  // ================================================================
  // 2. Export artifact (the seam)
  // ================================================================

  /**
   * @param {Object} dataset  the draft to export (never mutated)
   * @param {{baseVersion?:number, now?:string, filename?:string, skipValidation?:boolean}} [options]
   * @returns {{filename:string, content:string, dataset:Object}}
   * @throws if the dataset fails DirectoryValidation (unless options.skipValidation)
   */
  function createExportArtifact(dataset, options) {
    options = options || {};

    if (!options.skipValidation) {
      var result = DirectoryValidationNS.validateDataset(dataset);
      if (!result.valid) {
        throw new Error('cannot export: dataset failed validation (' + result.errors.length + ' error(s))');
      }
    }

    var baseVersion = (typeof options.baseVersion === 'number')
      ? options.baseVersion
      : (typeof dataset.version === 'number' ? dataset.version : 0);

    var stamp;
    if (options.bump === false) {
      // No real content change — carry the existing stamp over
      // unchanged (fixes: re-exporting an unmodified draft must not
      // produce a different file every time it's clicked).
      stamp = {
        version: (typeof dataset.version === 'number') ? dataset.version : (baseVersion || 1),
        updatedAt: dataset.updatedAt || options.now || new Date().toISOString()
      };
    } else {
      stamp = {
        version: baseVersion + 1,
        updatedAt: options.now || new Date().toISOString()
      };
    }

    var canonical = canonicalizeDataset(dataset, stamp);
    var content = JSON.stringify(canonical, null, 2) + '\n';

    return {
      filename: options.filename || 'legal-directories.json',
      content: content,
      dataset: canonical
    };
  }

  // ================================================================
  // 3. Exports
  // ================================================================

  var api = {
    canonicalizeDataset: canonicalizeDataset,
    canonicalDirectory: canonicalDirectory,
    canonicalNode: canonicalNode,
    createExportArtifact: createExportArtifact
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    global.DirectoryPublisher = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
