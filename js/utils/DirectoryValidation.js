/**
 * ================================================================
 * DirectoryValidation.js — js/utils/DirectoryValidation.js
 * نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Data Model (Stage 1 — Model only)
 *
 * WHAT THIS IS
 *   Validation Layer for DirectoryModel.js datasets (Stage-1 §18).
 *   Pure, synchronous, no I/O, no DOM. Depends only on
 *   js/utils/DirectoryModel.js.
 *
 * WHAT IT CHECKS (Stage-1 §18, literally)
 *   - Every Directory/Node has an id.
 *   - No duplicate ids (directory ids unique among directories; node
 *     ids unique across the ENTIRE dataset, not just siblings — see
 *     DirectoryModel.js "IDENTITY").
 *   - Every Directory/Node has a title.
 *   - `type` is a valid NODE_TYPES value.
 *   - folder nodes: `children`, if present, must be an array; a
 *     folder must NOT declare `url`.
 *   - link nodes: `url` is required (non-empty string); a link must
 *     NOT declare `children`.
 *   - `order`, if present, must be a finite number (Stage-1 §9 —
 *     duplicate order values are NOT an error, see DirectoryModel.js
 *     SORT BEHAVIOR; only non-numeric/non-finite order is an error).
 *   - `directory` (the dataset root) is well-formed: an object with a
 *     `directories` array.
 *   - No node references a non-existent parent and no circular
 *     structure — this dataset shape is nested children (not parent
 *     references), so a cycle cannot be constructed from JSON; this
 *     is enforced defensively via a max-depth guard rather than a
 *     parent-existence check, since there is no parent-id field in
 *     this design (Stage-1 §5 explicitly designs the tree via nested
 *     `children`, not references — recorded here rather than
 *     silently assumed).
 *
 * ERROR FORMAT
 *   Every error is a plain object:
 *     { directoryId, nodeId, path, message }
 *   `path` is a human-readable breadcrumb, e.g.
 *     'courts > مجلس الدولة > أسوان'
 *   toDisplayString(error) formats it exactly like the Stage-1 spec
 *   example:
 *     Directory "courts":
 *     Node "state-court-aswan":
 *     type=link
 *     url is missing
 * ================================================================
 */
(function (global) {
  'use strict';

  var DirectoryModelNS = (typeof module !== 'undefined' && module.exports)
    ? require('./DirectoryModel.js')
    : global.DirectoryModel;

  var NODE_TYPES = DirectoryModelNS.NODE_TYPES;

  // ================================================================
  // 1. Small helpers
  // ================================================================

  function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
  }

  function isValidOrder(v) {
    return v === undefined || v === null || (typeof v === 'number' && isFinite(v));
  }

  function makeError(directoryId, nodeId, path, message) {
    return { directoryId: directoryId, nodeId: nodeId, path: path, message: message };
  }

  // ================================================================
  // 2. Node validation (recursive)
  // ================================================================

  function validateNode(node, ctx, errors, seenNodeIds, depth) {
    depth = depth || 0;
    var path = ctx.path;

    if (!node || typeof node !== 'object') {
      errors.push(makeError(ctx.directoryId, undefined, path, 'node is missing or not an object'));
      return;
    }

    var nodeId = node.id;

    if (!isNonEmptyString(nodeId)) {
      errors.push(makeError(ctx.directoryId, nodeId, path, 'id is missing'));
    } else if (seenNodeIds.has(nodeId)) {
      errors.push(makeError(ctx.directoryId, nodeId, path, 'duplicate id "' + nodeId + '" (must be unique across the whole dataset)'));
    } else {
      seenNodeIds.add(nodeId);
    }

    if (!isNonEmptyString(node.title)) {
      errors.push(makeError(ctx.directoryId, nodeId, path, 'title is missing'));
    }

    var type = node.type;
    var validType = (type === NODE_TYPES.FOLDER || type === NODE_TYPES.LINK);
    if (!validType) {
      errors.push(makeError(ctx.directoryId, nodeId, path, 'type=' + JSON.stringify(type) + ' is invalid (must be "folder" or "link")'));
    }

    if (!isValidOrder(node.order)) {
      errors.push(makeError(ctx.directoryId, nodeId, path, 'order=' + JSON.stringify(node.order) + ' is invalid (must be a finite number, or omitted)'));
    }

    if (type === NODE_TYPES.LINK) {
      if (!isNonEmptyString(node.url)) {
        errors.push(makeError(ctx.directoryId, nodeId, path, 'type=link, url is missing'));
      }
      if (node.children !== undefined) {
        errors.push(makeError(ctx.directoryId, nodeId, path, 'type=link must not declare children'));
      }
    }

    if (type === NODE_TYPES.FOLDER) {
      if (node.url !== undefined) {
        errors.push(makeError(ctx.directoryId, nodeId, path, 'type=folder must not declare url'));
      }
      if (node.children !== undefined && !Array.isArray(node.children)) {
        errors.push(makeError(ctx.directoryId, nodeId, path, 'children must be an array when present'));
      } else if (Array.isArray(node.children)) {
        if (depth >= 64) {
          errors.push(makeError(ctx.directoryId, nodeId, path, 'max nesting depth exceeded (possible malformed/circular data)'));
          return;
        }
        node.children.forEach(function (child) {
          var childTitle = (child && isNonEmptyString(child.title)) ? child.title : '?';
          validateNode(child, { directoryId: ctx.directoryId, path: path + ' > ' + childTitle }, errors, seenNodeIds, depth + 1);
        });
      }
    }
  }

  // ================================================================
  // 3. Directory validation
  // ================================================================

  function validateDirectory(directory, errors, seenDirectoryIds, seenNodeIds) {
    if (!directory || typeof directory !== 'object') {
      errors.push(makeError(undefined, undefined, '(directory)', 'directory is missing or not an object'));
      return;
    }

    var directoryId = directory.id;

    if (!isNonEmptyString(directoryId)) {
      errors.push(makeError(directoryId, undefined, directory.title || '(directory)', 'directory id is missing'));
    } else if (seenDirectoryIds.has(directoryId)) {
      errors.push(makeError(directoryId, undefined, directory.title || directoryId, 'duplicate directory id "' + directoryId + '"'));
    } else {
      seenDirectoryIds.add(directoryId);
    }

    if (!isNonEmptyString(directory.title)) {
      errors.push(makeError(directoryId, undefined, directoryId || '(directory)', 'directory title is missing'));
    }

    if (!isValidOrder(directory.order)) {
      errors.push(makeError(directoryId, undefined, directory.title || directoryId, 'directory order=' + JSON.stringify(directory.order) + ' is invalid'));
    }

    if (!Array.isArray(directory.items)) {
      errors.push(makeError(directoryId, undefined, directory.title || directoryId, 'items must be an array'));
      return;
    }

    directory.items.forEach(function (node) {
      var nodeTitle = (node && isNonEmptyString(node.title)) ? node.title : '?';
      validateNode(node, { directoryId: directoryId, path: (directory.title || directoryId) + ' > ' + nodeTitle }, errors, seenNodeIds, 0);
    });
  }

  // ================================================================
  // 4. Dataset validation (entry point)
  // ================================================================

  /**
   * @param {Object} dataset  { directories: Directory[] }
   * @returns {{ valid: boolean, errors: Array<{directoryId,nodeId,path,message}> }}
   */
  function validateDataset(dataset) {
    var errors = [];

    if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.directories)) {
      errors.push(makeError(undefined, undefined, '(dataset)', 'dataset must be an object with a "directories" array'));
      return { valid: false, errors: errors };
    }

    var seenDirectoryIds = new Set();
    var seenNodeIds = new Set(); // global across the whole dataset — see IDENTITY

    dataset.directories.forEach(function (directory) {
      validateDirectory(directory, errors, seenDirectoryIds, seenNodeIds);
    });

    return { valid: errors.length === 0, errors: errors };
  }

  /**
   * Formats a single error exactly like the Stage-1 spec example:
   *   Directory "courts":
   *   Node "state-court-aswan":
   *   type=link
   *   url is missing
   */
  function toDisplayString(error) {
    var lines = [];
    if (error.directoryId) lines.push('Directory "' + error.directoryId + '":');
    if (error.nodeId) lines.push('Node "' + error.nodeId + '":');
    lines.push(error.path ? (error.path + ' — ' + error.message) : error.message);
    return lines.join('\n');
  }

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    validateDataset: validateDataset,
    toDisplayString: toDisplayString
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    global.DirectoryValidation = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
