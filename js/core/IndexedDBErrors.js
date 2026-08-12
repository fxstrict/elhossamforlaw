/**
 * ================================================================
 * IndexedDBErrors.js — IndexedDB Error Taxonomy | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3A — IndexedDB Foundation — Database Engine Core
 *
 * WHAT THIS FILE IS
 *   A dedicated, engine-level error layer for the future IndexedDB
 *   engine/adapter. Every error type below is a real Error subclass
 *   (matching the existing StorageAdapter.js / LocalStorageAdapter.js
 *   discipline: `instanceof`-safe, real stack trace, structured
 *   `type`/`cause` fields), never a bare string or plain object.
 *
 * WHAT THIS FILE IS NOT
 *   - It does not open, close, read, or write any database. It defines
 *     error shapes only.
 *   - It does not modify Repository.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, DatabaseService.js, or any Repository.
 *   - It is not wired into index.html and not yet consumed by any other
 *     new file's runtime behavior beyond `fromDOMException()` classifying
 *     native IndexedDB errors for a future engine/adapter to use.
 *
 * Covers exactly the failure classes named in the Phase 13.3A spec:
 *   QuotaExceeded, Blocked, VersionConflict, Abort, Unknown, Timeout,
 *   BrowserUnsupported.
 * ================================================================
 */

(function (root) {
  'use strict';

  // ================================================================
  // 1. Base error — shared shape every IndexedDB error type inherits.
  // ================================================================

  /**
   * @class IndexedDBError
   * Base class for every error this file defines. Never thrown directly
   * by application code — always one of the concrete subclasses below.
   * @param {string} name - concrete subclass name (e.g. 'QuotaExceededError').
   * @param {string} type - short machine-readable type tag (e.g. 'QuotaExceeded').
   * @param {string} message
   * @param {{cause?: *, dbName?: string, storeName?: string, recoverable?: boolean}} [extra]
   */
  function IndexedDBError(name, type, message, extra) {
    extra = extra || {};
    this.message = message;
    this.name = name;
    this.type = type;
    this.cause = extra.cause != null ? extra.cause : null;
    this.dbName = extra.dbName != null ? extra.dbName : null;
    this.storeName = extra.storeName != null ? extra.storeName : null;
    this.recoverable = extra.recoverable === true;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, IndexedDBError);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
  IndexedDBError.prototype = Object.create(Error.prototype);
  IndexedDBError.prototype.constructor = IndexedDBError;
  IndexedDBError.prototype.name = 'IndexedDBError';

  /** @private builds a concrete subclass constructor sharing the base shape. */
  function defineErrorType(className, typeTag, defaultRecoverable) {
    function Ctor(message, extra) {
      extra = extra || {};
      if (extra.recoverable === undefined) {
        extra = Object.assign({}, extra, { recoverable: defaultRecoverable });
      }
      IndexedDBError.call(this, className, typeTag, message, extra);
    }
    Ctor.prototype = Object.create(IndexedDBError.prototype);
    Ctor.prototype.constructor = Ctor;
    Ctor.prototype.name = className;
    return Ctor;
  }

  // ================================================================
  // 2. Concrete error types
  // ================================================================

  /** Storage quota was exceeded during a write/upgrade. Not recoverable
   *  by retrying the same operation without freeing space. */
  var QuotaExceededError = defineErrorType('QuotaExceededError', 'QuotaExceeded', false);

  /** A version-change/delete request is blocked by another open
   *  connection (e.g. another tab) that has not closed. Recoverable —
   *  the caller may retry once the blocking connection closes. */
  var BlockedError = defineErrorType('BlockedError', 'Blocked', true);

  /** The requested version conflicts with the database's actual current
   *  version (stale schema expectation, concurrent upgrade elsewhere). */
  var VersionConflictError = defineErrorType('VersionConflictError', 'VersionConflict', false);

  /** A transaction was aborted (explicitly, or by the engine due to a
   *  constraint failure within it). Recoverable — caller may retry the
   *  whole transaction. */
  var AbortError = defineErrorType('AbortError', 'Abort', true);

  /** Catch-all for a native IndexedDB error that does not map to any of
   *  the other named categories. */
  var UnknownError = defineErrorType('UnknownError', 'Unknown', false);

  /** An operation did not complete within its allotted time (used by the
   *  engine's own open()/transaction watchdogs, not a native IndexedDB
   *  concept). Recoverable — caller may retry. */
  var TimeoutError = defineErrorType('TimeoutError', 'Timeout', true);

  /** The current environment has no usable `indexedDB` global at all
   *  (unsupported browser, privacy mode with IndexedDB disabled, or a
   *  non-browser runtime with no IndexedDB shim installed). */
  var BrowserUnsupportedError = defineErrorType('BrowserUnsupportedError', 'BrowserUnsupported', false);

  // ================================================================
  // 3. Classification — map a native DOMException / DOMError (or any
  //    error-like object a real IndexedDB request/transaction surfaces
  //    via its `.error`) to one of the concrete types above.
  // ================================================================

  /**
   * fromDOMException(nativeError, context) -> IndexedDBError
   * Never throws. Always returns a concrete IndexedDBError subclass
   * instance, falling back to UnknownError for anything unrecognized.
   * @param {*} nativeError - the native `event.target.error` /
   *   `DOMException` (or any object exposing a `.name` string) that
   *   caused the failure. May be null/undefined.
   * @param {{dbName?: string, storeName?: string, op?: string}} [context]
   */
  function fromDOMException(nativeError, context) {
    context = context || {};
    var nativeName = (nativeError && nativeError.name) ? nativeError.name : '';
    var nativeMessage = (nativeError && nativeError.message) ? nativeError.message : '';
    var opLabel = context.op ? (context.op + ': ') : '';
    var extra = {
      cause: nativeError || null,
      dbName: context.dbName || null,
      storeName: context.storeName || null
    };

    switch (nativeName) {
      case 'QuotaExceededError':
        return new QuotaExceededError(opLabel + 'storage quota exceeded' +
          (nativeMessage ? ' (' + nativeMessage + ')' : ''), extra);
      case 'AbortError':
        return new AbortError(opLabel + 'operation aborted' +
          (nativeMessage ? ' (' + nativeMessage + ')' : ''), extra);
      case 'VersionError':
        return new VersionConflictError(opLabel + 'version conflict' +
          (nativeMessage ? ' (' + nativeMessage + ')' : ''), extra);
      case 'InvalidStateError':
      case 'TransactionInactiveError':
      case 'ConstraintError':
      case 'DataError':
      case 'NotFoundError':
      case 'InvalidAccessError':
      case 'ReadOnlyError':
      case 'DataCloneError':
        // Real, named IndexedDB failure classes that don't map to one of
        // this file's narrower named categories — surfaced as Unknown
        // with the native name preserved in the message, rather than
        // silently misclassified into an unrelated bucket.
        return new UnknownError(opLabel + nativeName +
          (nativeMessage ? ' (' + nativeMessage + ')' : ''), extra);
      default:
        return new UnknownError(opLabel + (nativeName || 'unrecognized IndexedDB error') +
          (nativeMessage ? ' (' + nativeMessage + ')' : ''), extra);
    }
  }

  /**
   * isBrowserSupported(globalObj) -> boolean
   * Cheap capability check: does `globalObj` expose a usable `indexedDB`?
   * @param {*} globalObj - typically `window`/`self`/`globalThis`.
   */
  function isBrowserSupported(globalObj) {
    return !!(globalObj && globalObj.indexedDB &&
      typeof globalObj.indexedDB.open === 'function');
  }

  // ================================================================
  // 4. Exports
  // ================================================================

  var api = {
    IndexedDBError: IndexedDBError,
    QuotaExceededError: QuotaExceededError,
    BlockedError: BlockedError,
    VersionConflictError: VersionConflictError,
    AbortError: AbortError,
    UnknownError: UnknownError,
    TimeoutError: TimeoutError,
    BrowserUnsupportedError: BrowserUnsupportedError,
    fromDOMException: fromDOMException,
    isBrowserSupported: isBrowserSupported
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IndexedDBErrors = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
