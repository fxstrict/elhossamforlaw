/**
 * fake_indexeddb.js — minimal in-memory IDBFactory-shaped test double.
 * No browser and no third-party package required (network is
 * unavailable in this environment). Implements just enough of the real
 * IndexedDB surface for verify_indexeddb_engine.js to exercise
 * IndexedDBEngine.js / IndexedDBVersion.js / IndexedDBTransaction.js
 * against: open()/onupgradeneeded/onblocked/onsuccess/onerror,
 * createObjectStore/createIndex, transaction()/objectStore(), and
 * deleteDatabase(). Same self-contained-fake pattern the project's
 * existing verify_localstorage_adapter.js already uses for `localStorage`.
 *
 * Deliberately NOT a full IndexedDB re-implementation — no cursors, no
 * range queries, no real durability. Sufficient to validate this phase's
 * engine/version/transaction/error-layer LOGIC, not to be a substitute
 * for real browser testing.
 *
 * PHASE 13.3C — PART 3B extensions (additive only — every PHASE 13.3A
 * behavior above is unchanged):
 *   - `FakeIDBObjectStore.prototype.getAll()` / `.clear()` — needed
 *     because `IndexedDBAdapter.js` (PHASE 13.3B, written after this fake
 *     originally was) calls both, and neither existed here yet.
 *   - Per-store failure injection (`_failNextOp()` / the factory-level
 *     `injectStoreFailure()` helper) — lets a harness deterministically
 *     force one specific request (e.g. the 3rd `put()` of a 5-record
 *     write) to fail, to prove `MigrationService.js`'s atomic-write claim
 *     against something other than "it probably works".
 *   - Real transaction rollback on abort — the original fake mutated a
 *     store's backing `_data` directly and permanently inside `put()`,
 *     with no rollback if the transaction later aborted. Real IndexedDB
 *     guarantees an aborted `readwrite` transaction leaves NO partial
 *     writes; without fixing this gap, an injected mid-write failure
 *     would show a half-written store here even though a real browser
 *     would show the old, untouched data — the opposite of what an
 *     "atomic migration" verification needs to prove. Fixed by
 *     snapshotting every store a `readwrite` transaction touches at
 *     construction time, and restoring those snapshots in `abort()`.
 *   - A same-tick guard in `_makeRequest()` so that once a transaction has
 *     aborted, its OTHER already-in-flight requests (issued in the same
 *     microtask batch — e.g. `put() #4` and `#5` after `#3` fails) no
 *     longer execute their mutating body, so they can't silently re-apply
 *     data on top of the just-restored rollback snapshot.
 */

'use strict';

function microtask(fn) { Promise.resolve().then(fn); }

function makeDOMException(name, message) {
  var e = new Error(message || name);
  e.name = name;
  return e;
}

/** @private shallow-copies an object's own enumerable keys — used to
 *  snapshot/restore a store's backing `_data` around a readwrite
 *  transaction, without depending on `Object.assign`. */
function shallowCopyOwn(obj) {
  var copy = {};
  var keys = Object.keys(obj || {});
  for (var i = 0; i < keys.length; i++) { copy[keys[i]] = obj[keys[i]]; }
  return copy;
}

// ---- IDBIndex --------------------------------------------------------
function FakeIDBIndex(name, keyPath, options) {
  this.name = name;
  this.keyPath = keyPath;
  this.unique = !!(options && options.unique);
  this.multiEntry = !!(options && options.multiEntry);
}

// ---- IDBObjectStore ----------------------------------------------------
function FakeIDBObjectStore(name, keyPath, autoIncrement, db) {
  this.name = name;
  this.keyPath = keyPath;
  this.autoIncrement = !!autoIncrement;
  this._db = db;
  this._indexes = {}; // name -> FakeIDBIndex
  this._data = {};    // keyPath value -> record (shared with db-level backing store)
  this._pendingFailure = null; // PART 3B: one-shot forced-failure hook, see _failNextOp()
  var names = [];
  Object.defineProperty(this, 'indexNames', {
    get: function () {
      var arr = Object.keys(this._indexes);
      return { contains: function (n) { return arr.indexOf(n) !== -1; }, length: arr.length };
    }
  });
}
FakeIDBObjectStore.prototype.createIndex = function (name, keyPath, options) {
  var idx = new FakeIDBIndex(name, keyPath, options);
  this._indexes[name] = idx;
  return idx;
};

/** PART 3B: queues a forced failure for a future call of `opName`
 *  ('put'|'get'|'delete'|'count'|'getAll'|'clear') on THIS store.
 *  `skip` (default 0) lets a harness target a SPECIFIC call rather than
 *  only ever "the very next one" — e.g. `skip: 2` lets the first two
 *  matching calls succeed normally and fails the third, which is what
 *  proving atomicity on a multi-record write needs ("2 puts already
 *  applied, the 3rd fails — does the whole transaction roll back?").
 *  Consumed (cleared) the instant it actually fires, so it never affects
 *  more than the one targeted call. */
FakeIDBObjectStore.prototype._failNextOp = function (opName, errName, message, skip) {
  this._pendingFailure = {
    op: opName,
    errName: errName || 'UnknownError',
    message: message || ('Simulated "' + opName + '" failure (test-injected).'),
    skip: skip || 0
  };
};

FakeIDBObjectStore.prototype._makeRequest = function (opName, op) {
  var req = new FakeIDBRequest();
  var self = this;
  // PART 3B: capture the owning transaction (if any) at CALL time, not
  // inside the later microtask — a request belongs to whichever
  // transaction was active when it was created, matching real IndexedDB,
  // and this is also what lets us increment its pending-request count
  // synchronously (see the completion-timing comment on
  // `FakeIDBTransaction` above).
  var tx = self._activeTx;
  if (tx) { tx._pendingRequests += 1; }

  microtask(function () {
    // PART 3B: once this request's owning transaction has already
    // settled (committed OR aborted), it is not processed — mirrors real
    // IndexedDB delivering no further events for a finished transaction,
    // and specifically prevents an already-issued request (e.g. put() #4
    // queued before put() #3 aborted the transaction) from re-mutating
    // data on top of a just-restored rollback snapshot.
    if (tx && !tx._active) {
      tx._pendingRequests = Math.max(0, tx._pendingRequests - 1);
      return;
    }

    var runOp = op;
    if (self._pendingFailure && self._pendingFailure.op === opName) {
      if (self._pendingFailure.skip > 0) {
        self._pendingFailure.skip -= 1; // let this call through untouched, count it down
      } else {
        var forced = self._pendingFailure;
        self._pendingFailure = null;
        runOp = function () { throw makeDOMException(forced.errName, forced.message); };
      }
    }

    try {
      var result = runOp();
      req.result = result;
      if (req.onsuccess) { req.onsuccess({ target: req }); }
    } catch (err) {
      req.error = err;
      var handled = false;
      if (req.onerror) {
        var evt = { target: req, _defaultPrevented: false, preventDefault: function () { evt._defaultPrevented = true; } };
        req.onerror(evt);
        handled = !!evt._defaultPrevented;
      }
      if (!handled && tx) {
        tx.error = err;
        tx.abort();
      }
    }

    if (tx) {
      tx._pendingRequests = Math.max(0, tx._pendingRequests - 1);
      tx._maybeComplete();
    }
  });
  return req;
};
FakeIDBObjectStore.prototype.put = function (value) {
  var self = this;
  return this._makeRequest('put', function () {
    var key = value ? value[self.keyPath] : undefined;
    if (key === undefined || key === null) {
      // Mirrors real IndexedDB: storing a value into an object store with
      // an out-of-line keyPath that doesn't resolve on that value throws
      // a DataError DOMException.
      var err = new Error('Failed to execute \'put\' on \'IDBObjectStore\': evaluating the object store\'s key path did not yield a value.');
      err.name = 'DataError';
      throw err;
    }
    self._data[key] = value;
    return key;
  });
};
FakeIDBObjectStore.prototype.get = function (key) {
  var self = this;
  return this._makeRequest('get', function () { return self._data[key]; });
};
FakeIDBObjectStore.prototype.delete = function (key) {
  var self = this;
  return this._makeRequest('delete', function () { delete self._data[key]; return undefined; });
};
FakeIDBObjectStore.prototype.count = function () {
  var self = this;
  return this._makeRequest('count', function () { return Object.keys(self._data).length; });
};
/** PART 3B: needed by `IndexedDBAdapter.prototype.read()`, which calls
 *  `store.getAll()` — did not exist on this fake before (built for
 *  PHASE 13.3A's engine-only tests, predating PHASE 13.3B's adapter). */
FakeIDBObjectStore.prototype.getAll = function () {
  var self = this;
  return this._makeRequest('getAll', function () {
    return Object.keys(self._data).map(function (k) { return self._data[k]; });
  });
};
/** PART 3B: needed by `IndexedDBAdapter.prototype.write()`/`delete()`/
 *  `clear()`, all of which call `store.clear()` — same gap as `getAll()`
 *  above. */
FakeIDBObjectStore.prototype.clear = function () {
  var self = this;
  return this._makeRequest('clear', function () { self._data = {}; return undefined; });
};

// ---- IDBRequest ---------------------------------------------------------
function FakeIDBRequest() {
  this.result = undefined;
  this.error = null;
  this.onsuccess = null;
  this.onerror = null;
}

// ---- IDBTransaction -------------------------------------------------
function FakeIDBTransaction(db, storeNames, mode) {
  this._db = db;
  this._storeNames = storeNames;
  this.mode = mode;
  this.error = null;
  this.oncomplete = null;
  this.onerror = null;
  this.onabort = null;
  this._active = true;
  this._aborted = false;
  // PART 3B: number of requests issued on this transaction that have not
  // yet finished (incremented synchronously in `_makeRequest()` at the
  // moment a request is created, decremented once that request's
  // onsuccess/onerror handling completes). Replaces the old fixed
  // three-microtask-hop completion timer below.
  this._pendingRequests = 0;

  // PART 3B: snapshot every store this (readwrite) transaction touches,
  // BEFORE any request runs (constructor executes synchronously, and
  // every request body only runs later via a microtask — see
  // `_makeRequest()` — so this always captures true pre-transaction
  // state). `abort()` restores these snapshots, so a mid-write failure
  // leaves no partial writes, matching real IndexedDB's rollback
  // guarantee. `readonly` transactions never mutate anything, so they
  // need no snapshot.
  this._preSnapshots = null;
  if (mode === 'readwrite') {
    this._preSnapshots = {};
    for (var i = 0; i < storeNames.length; i++) {
      var storeHandle = db._getOrCreateStoreHandle(storeNames[i]);
      if (storeHandle) {
        this._preSnapshots[storeNames[i]] = shallowCopyOwn(storeHandle._data);
      }
    }
  }

  var self = this;
  // PART 3B (bug fix — found and fixed during MigrationService.js
  // integration testing, not just theorized): a transaction now completes
  // when its pending-request count returns to, and stays at, zero —
  // re-checked fresh every time a request finishes — instead of after a
  // FIXED number of microtask hops from construction.
  //
  // The old fixed-hop timer was a genuine race: a request chain that
  // itself needs more than a couple of microtask hops to issue its NEXT
  // request — e.g. `IndexedDBAdapter.write()`'s `store.clear()` whose
  // `.then()` continuation only THEN calls `store.put()` for every record
  // — could still be mid-flight when the fixed timer fired anyway,
  // marking the transaction complete while a request was genuinely still
  // pending. Combined with this same PART 3B change's "don't process
  // requests on a settled transaction" guard in `_makeRequest()` (itself
  // required so an aborted transaction's still-in-flight requests can't
  // re-mutate data on top of a just-restored rollback snapshot), that
  // stranded request would then never fire its onsuccess/onerror at all —
  // its caller's promise would never resolve or reject, hanging forever.
  // Reproduced directly: `IndexedDBAdapter.write()` with even a single
  // record hung indefinitely under the old timer once the settled-
  // transaction guard was added. `_maybeComplete()` below is re-armed
  // after every single request settles, so it correctly waits out request
  // chains of any depth instead of gambling on a fixed hop count.
  microtask(function () { self._maybeComplete(); });
}

/** PART 3B: see the completion-timing comment in the constructor above.
 *  Arms (or re-arms) a one-microtask-hop check: if no request is pending
 *  right now, wait one more microtask turn and confirm nothing got
 *  issued in the meantime before actually completing — that single hop
 *  is exactly enough for a promise-chained continuation (like write()'s
 *  clear().then(issue every put)) to have issued its next request, so it
 *  is correctly still counted as "pending" by the time this check runs. */
FakeIDBTransaction.prototype._maybeComplete = function () {
  var self = this;
  if (!self._active || self._pendingRequests > 0) { return; }
  microtask(function () {
    if (!self._active || self._pendingRequests > 0) { return; }
    self._active = false;
    if (self.oncomplete) { self.oncomplete({ target: self }); }
  });
};
FakeIDBTransaction.prototype.objectStore = function (name) {
  if (this._storeNames.indexOf(name) === -1) {
    throw makeDOMException('NotFoundError', 'Store "' + name + '" not in transaction scope.');
  }
  var handle = this._db._getOrCreateStoreHandle(name);
  handle._activeTx = this;
  return handle;
};
FakeIDBTransaction.prototype.abort = function () {
  if (!this._active) { return; }
  this._active = false;
  this._aborted = true;
  this.error = this.error || makeDOMException('AbortError', 'Transaction aborted.');

  // PART 3B: roll back every store this transaction snapshotted, so an
  // aborted readwrite transaction leaves no partial writes — see
  // constructor comment and file header for why this matters.
  if (this._preSnapshots) {
    var db = this._db;
    var snaps = this._preSnapshots;
    var names = Object.keys(snaps);
    for (var i = 0; i < names.length; i++) {
      var storeHandle = db._getOrCreateStoreHandle(names[i]);
      if (storeHandle) { storeHandle._data = snaps[names[i]]; }
    }
  }

  var self = this;
  microtask(function () {
    if (self.onabort) { self.onabort({ target: self }); }
  });
};

// ---- IDBDatabase ------------------------------------------------------
function FakeIDBDatabase(name, version, backing) {
  this.name = name;
  this.version = version;
  this._backing = backing; // shared per-dbName store registry (persists across close/reopen)
  this._closed = false;
  this.onversionchange = null;
  var names = Object.keys(backing.stores);
  Object.defineProperty(this, 'objectStoreNames', {
    get: function () {
      var arr = Object.keys(this._backing.stores);
      return { contains: function (n) { return arr.indexOf(n) !== -1; }, length: arr.length };
    }
  });
}
FakeIDBDatabase.prototype.createObjectStore = function (name, options) {
  options = options || {};
  var store = new FakeIDBObjectStore(name, options.keyPath, options.autoIncrement, this);
  this._backing.stores[name] = store;
  return store;
};
FakeIDBDatabase.prototype._getOrCreateStoreHandle = function (name) {
  return this._backing.stores[name];
};
FakeIDBDatabase.prototype.transaction = function (storeNames, mode) {
  if (this._closed) {
    throw makeDOMException('InvalidStateError', 'Database connection is closed.');
  }
  var names = Array.isArray(storeNames) ? storeNames : [storeNames];
  for (var i = 0; i < names.length; i++) {
    if (!this._backing.stores[names[i]]) {
      throw makeDOMException('NotFoundError', 'No objectStore named "' + names[i] + '".');
    }
  }
  return new FakeIDBTransaction(this, names, mode || 'readonly');
};
FakeIDBDatabase.prototype.close = function () {
  this._closed = true;
};

// ---- IDBOpenDBRequest -------------------------------------------------
function FakeOpenRequest() {
  FakeIDBRequest.call(this);
  this.transaction = null;
  this.onupgradeneeded = null;
  this.onblocked = null;
}
FakeOpenRequest.prototype = Object.create(FakeIDBRequest.prototype);

// ---- IDBFactory ---------------------------------------------------------
function FakeIndexedDB() {
  this._databases = {}; // name -> {version, stores: {name: FakeIDBObjectStore}}
  this._openConnections = {}; // name -> [FakeIDBDatabase,...] currently open (not closed)
  this._forceBlockOnOpen = {}; // name -> boolean, test hook
  this._forceBlockOnDelete = {}; // name -> boolean, test hook
}
FakeIndexedDB.prototype._trackOpenConnection = function (name, db) {
  this._openConnections[name] = this._openConnections[name] || [];
  this._openConnections[name].push(db);
};
FakeIndexedDB.prototype._untrackClosed = function (name) {
  var conns = this._openConnections[name] || [];
  this._openConnections[name] = conns.filter(function (c) { return !c._closed; });
};

FakeIndexedDB.prototype.open = function (name, version) {
  var self = this;
  var req = new FakeOpenRequest();
  microtask(function () {
    self._untrackClosed(name);

    if (self._forceBlockOnOpen[name]) {
      if (req.onblocked) { req.onblocked({ target: req }); }
      return;
    }

    var backing = self._databases[name];
    var oldVersion = backing ? backing.version : 0;
    var newVersion = version || (backing ? backing.version : 1);

    if (!backing) {
      backing = { version: newVersion, stores: {} };
      self._databases[name] = backing;
    }

    var needsUpgrade = newVersion > oldVersion;
    var db = new FakeIDBDatabase(name, newVersion, backing);

    function finishSuccess() {
      backing.version = newVersion;
      db.version = newVersion;
      self._trackOpenConnection(name, db);
      req.result = db;
      if (req.onsuccess) { req.onsuccess({ target: req }); }
    }

    if (needsUpgrade) {
      var upgradeTx = new FakeIDBTransaction(db, Object.keys(backing.stores), 'versionchange');
      req.transaction = upgradeTx;
      req.result = db;
      var upgradeErrorCaught = null;
      try {
        if (req.onupgradeneeded) {
          req.onupgradeneeded({
            target: req,
            oldVersion: oldVersion,
            newVersion: newVersion
          });
        }
      } catch (err) {
        upgradeErrorCaught = err;
      }
      microtask(function () {
        microtask(function () {
          if (upgradeTx._aborted || upgradeErrorCaught) {
            req.error = upgradeTx.error || upgradeErrorCaught || makeDOMException('AbortError', 'Upgrade aborted.');
            if (req.onerror) { req.onerror({ target: req }); }
            return;
          }
          finishSuccess();
        });
      });
    } else {
      finishSuccess();
    }
  });
  return req;
};

/** PART 3B: convenience wrapper around `FakeIDBObjectStore._failNextOp()`
 *  so a harness doesn't need to reach into `_databases`/`stores`
 *  internals directly. The database must already have been opened once
 *  (so the target store exists) before calling this. Throws synchronously
 *  if the named database/store isn't there yet — a harness bug, not a
 *  condition to silently ignore. */
FakeIndexedDB.prototype.injectStoreFailure = function (dbName, storeName, opName, errName, message, skip) {
  var backing = this._databases[dbName];
  if (!backing || !backing.stores[storeName]) {
    throw new Error(
      'injectStoreFailure: no store "' + storeName + '" in database "' + dbName +
      '" yet — open the database (and let its upgrade create the store) first.'
    );
  }
  backing.stores[storeName]._failNextOp(opName, errName, message, skip);
};

FakeIndexedDB.prototype.deleteDatabase = function (name) {
  var self = this;
  var req = new FakeIDBRequest();
  microtask(function () {
    self._untrackClosed(name);
    if (self._forceBlockOnDelete[name] || (self._openConnections[name] && self._openConnections[name].length > 0)) {
      if (req.onblocked) { req.onblocked({ target: req }); }
      return;
    }
    delete self._databases[name];
    req.result = undefined;
    if (req.onsuccess) { req.onsuccess({ target: req }); }
  });
  return req;
};

module.exports = { FakeIndexedDB: FakeIndexedDB };
