/**
 * verify_indexeddb_keypath_hotfix.js
 * PHASE 13.3A-HOTFIX — IndexedDB Schema Alignment (Critical Architecture Fix)
 *
 * WHAT THIS FILE IS
 *   The acceptance test for this hotfix. For every entity store, builds a
 *   record shaped exactly the way that entity's real Repository
 *   (js/repositories/*Repository.js) actually produces one — keyed by that
 *   Repository's real `idField` (`رقم_القضية`, `رقم_الموكل`, ... or `id` for
 *   the three entities that really use it) — opens the schema-defined
 *   database, and does `store.put(record)` against the live IndexedDBEngine.
 *   The single pass/fail bar for this hotfix, per its own spec: **no store
 *   may raise a DataError.**
 *
 *   Ground truth for each `idField` below is the literal `entityKey`/
 *   `idField:` configuration read directly out of each
 *   js/repositories/*Repository.js file this session — see
 *   docs/IndexedDB_KeyPath_Audit.md for the full per-file citation.
 *
 * Run: node js/tests/verify_indexeddb_keypath_hotfix.js
 */

const assert = require('assert');
const path = require('path');

const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const SchemaNS = require(path.join(__dirname, '..', 'core', 'IndexedDBSchema.js'));
const { IndexedDBEngine } = require(path.join(__dirname, '..', 'core', 'IndexedDBEngine.js'));
const { IndexedDBTransaction } = require(path.join(__dirname, '..', 'core', 'IndexedDBTransaction.js'));

let passed = 0;
let failed = 0;
const log = [];

async function check(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.stack ? e.stack : e));
  }
}

// One realistic record per entity, keyed by that Repository's real idField
// (never a synthetic "id"), covering every store IndexedDBSchema.js declares
// that a real Repository actually feeds.
const REAL_RECORDS = {
  cases: {
    'رقم_القضية': 'CASE-0001',
    code: 'C-0001',
    clientId: 'CL-0001',
    status: 'active',
    searchText: 'case 0001',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  clients: {
    'رقم_الموكل': 'CL-0001',
    code: 'CL-0001',
    name: 'Test Client',
    searchText: 'test client',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  sessions: {
    'رقم_الجلسة': 'SESS-0001',
    caseId: 'CASE-0001',
    clientId: 'CL-0001',
    sessionDate: '2026-07-16',
    status: 'scheduled',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  documents: {
    'رقم_المستند': 'DOC-0001',
    caseId: 'CASE-0001',
    clientId: 'CL-0001',
    name: 'Test Document',
    searchText: 'test document',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  tasks: {
    'رقم_المهمة': 'TASK-0001',
    caseId: 'CASE-0001',
    clientId: 'CL-0001',
    status: 'open',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  children: {
    'رقم_الطفل': 'CHILD-0001',
    caseId: 'CASE-0001',
    clientId: 'CL-0001',
    name: 'Test Child',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  fees: {
    'رقم_العملية': 'FEE-0001',
    caseId: 'CASE-0001',
    clientId: 'CL-0001',
    status: 'unpaid',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  library: {
    id: 'LIB-0001',
    name: 'Test Book',
    searchText: 'test book',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  templates: {
    id: 'TPL-0001',
    name: 'Test Template',
    code: 'TPL-0001',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  settings: {
    id: 'SETTINGS-0001',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  metadata: {
    id: 'META-0001'
  },
  clientMessages: {
    id: 'MSG-0001',
    clientId: 'CL-0001',
    caseId: 'CASE-0001',
    searchText: 'رسالة تجريبية',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  // PHASE 31 (RBAC): three new stores.
  users: {
    'اسم_المستخدم': 'testuser1',
    'الاسم': 'Test User',
    'الحالة': 'نشط',
    'الدور': 'lawyer',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  },
  auditLog: {
    id: 'LOG-0001',
    'المستخدم': 'testuser1',
    'الإجراء': 'CanCreateCases',
    'الوقت': '2026-07-16T00:00:00.000Z'
  },
  loginLog: {
    id: 'LOGIN-0001',
    'المستخدم': 'testuser1',
    'الوقت': '2026-07-16T00:00:00.000Z'
  }
};

(async function main() {

  await check('REAL_RECORDS covers every store IndexedDBSchema.js declares', () => {
    const storeNames = SchemaNS.getStoreNames();
    storeNames.forEach((name) => {
      assert.ok(Object.prototype.hasOwnProperty.call(REAL_RECORDS, name), 'missing fixture for store ' + name);
    });
    assert.strictEqual(Object.keys(REAL_RECORDS).length, storeNames.length);
  });

  await check('Every real record actually resolves a value at its store\'s declared keyPath', () => {
    // Sanity check on the fixtures themselves, independent of any engine:
    // each record must carry a value under its store's keyPath, exactly
    // the condition that was violated before this hotfix (every store's
    // keyPath was 'id', but 7 of the 9 real Repository records never had
    // an 'id' field at all).
    SchemaNS.STORE_DEFINITIONS.forEach((def) => {
      const record = REAL_RECORDS[def.name];
      assert.notStrictEqual(record[def.keyPath], undefined, def.name + ' record has no value at keyPath "' + def.keyPath + '"');
    });
  });

  await check('store.put(record) succeeds with no DataError for every entity (core hotfix acceptance test)', async () => {
    const fake = new FakeIndexedDB();
    const engine = new IndexedDBEngine({ indexedDBImpl: fake });
    const db = await engine.open();

    const storeNames = SchemaNS.getStoreNames();
    const tx = new IndexedDBTransaction(db, storeNames, 'readwrite');
    await tx.run((t) => {
      storeNames.forEach((name) => {
        // Throws synchronously (via fake_indexeddb's DataError enforcement)
        // if this store's keyPath doesn't resolve on the real record —
        // exactly the failure this hotfix exists to prevent.
        t.objectStore(name).put(REAL_RECORDS[name]);
      });
    });

    await engine.close();
  });

  await check('No synthetic "id" was added to any non-id-keyed entity\'s real record', () => {
    ['cases', 'clients', 'sessions', 'documents', 'tasks', 'children', 'fees'].forEach((name) => {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(REAL_RECORDS[name], 'id'),
        false,
        name + ' record should not carry a synthetic "id" field'
      );
    });
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exitCode = failed > 0 ? 1 : 0;
})();
