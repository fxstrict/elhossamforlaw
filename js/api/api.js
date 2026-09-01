/**
 * ================================================================
 * api.js — طبقة API المركزية | نظام الحسام للمحاماة
 * ================================================================
 * Centralizes ALL Google Apps Script / network communication.
 *
 * Replaces:
 *   - syncToSheets()
 *   - syncDeleteToSheets()
 *   - loadFromSheets()
 *   - testConnection()  (fetch portions)
 *   - pingConnection()  (fetch portions)
 *   - portal URL construction in genClientQR() / displayPortalModal()
 *   - QR image URL via api.qrserver.com
 *
 * Does NOT touch:
 *   - Business logic (save*, delete*, toggle*, render*)
 *   - UI / HTML / CSS
 *   - Data structures / sheet names / field names
 *   - Google Apps Script backend
 *   - localStorage helpers (saveLocal, data object)
 * ================================================================
 */

const ApiService = {

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  /**
   * Returns the currently configured Apps Script URL.
   * Reads from the global API_URL variable set by the host page.
   * @returns {string}
   */
  _url() {
    return (typeof API_URL !== 'undefined' ? API_URL : '') || '';
  },

  /**
   * Core POST to Apps Script.
   * Uses Content-Type: text/plain to avoid CORS preflight (P7 workaround).
   *
   * FIX P5 (DATABASE_FORENSIC_REPORT.md §P5, "فشل صامت غير مُعاد المحاولة
   * عند خطأ HTTP تطبيقي"): a resolved fetch() promise (HTTP 200, or any
   * non-network-error status) previously meant "success" to every caller
   * below, even though Config/06_Api.gs's own doPost()/doGet() return an
   * ordinary 200 response with a `{error: "..."}` body on internal
   * failures (bad sheet name, thrown exception inside apiUpdateRow/
   * apiAddRow/etc). Nobody ever read that body, so an application-level
   * failure was indistinguishable from a real success — no retry, no
   * OfflineQueue entry, no user-visible signal.
   *
   * This now inspects BOTH the HTTP status and the parsed JSON body's
   * `error` field, and throws in either failure case. Every existing
   * caller (saveData/updateData/deleteData) already wraps its `await
   * this._post(body)` call in a try/catch that enqueues the operation
   * into OfflineQueue on any thrown error (see below) — so this change
   * needs NO caller-side modification to start retrying application-level
   * failures exactly the same way network failures already were retried.
   * response.clone() is used so callers that still read the body
   * themselves (uploadFile()) keep working unchanged.
   * @param {Object} body  - Plain object; will be JSON-stringified.
   * @returns {Promise<Response>}
   */
  async _post(body) {
    const response = await fetch(this._url(), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain' }
    });
    let parsed = null;
    try { parsed = await response.clone().json(); } catch (parseErr) { /* non-JSON body — fall through to status-only check */ }
    if (!response.ok) {
      throw new Error('[ApiService] HTTP ' + response.status + ' من Apps Script');
    }
    if (parsed && parsed.error) {
      throw new Error('[ApiService] فشل تطبيقي من الخادم: ' + parsed.error);
    }
    return response;
  },

  /**
   * Core GET to Apps Script.
   * @param {string} queryString  - Full query string, e.g. "?sheet=القضايا"
   * @param {number} [timeoutMs]  - Optional AbortSignal timeout in ms.
   * @returns {Promise<Response>}
   */
  async _get(queryString, timeoutMs) {
    const opts = timeoutMs
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {};
    return fetch(this._url() + queryString, opts);
  },

  // ================================================================
  // READ
  // ================================================================

  /**
   * Loads a single sheet from Apps Script as a JSON array.
   *
   * Replaces: the inner fetch inside loadFromSheets()
   *
   * @param {string} sheetName  - Arabic sheet name, e.g. 'القضايا'
   * @returns {Promise<Array>}  - Parsed row array, or [] on error.
   */
  async loadData(sheetName) {
    try {
      const r = await this._get('?sheet=' + encodeURIComponent(sheetName));
      const arr = await r.json();
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn('[ApiService.loadData] Sheet:', sheetName, e);
      return [];
    }
  },

  /**
   * PHASE A7 — STEP 9 (Frontend Pull Sync). يستدعي المسار الجديد
   * ?sheet=<sheet>&action=sync&cursor=<cursor> (راجع Config/06_Api.gs:
   * apiSyncSheet()). لا يستبدل loadData() أعلاه — إضافة كليًا مستقلة،
   * لا تغيير على أي دالة موجودة فى هذا الملف.
   * @param {string} sheetName  - Arabic sheet name, e.g. 'القضايا'
   * @param {?string} [cursor]  - Base64 cursor من نداء سابق، أو null/'' للبداية
   * @returns {Promise<{sheet:string, items:Array, nextCursor:?string, hasMore:boolean}>}
   *          عند فشل الشبكة: يرجع {items:[], nextCursor: cursor (كما هو،
   *          بلا تقدّم), hasMore:false} — Checkpoint القديم لا يتحرك أبدًا
   *          عند فشل، بنفس فلسفة §31 (Checkpoint Safety) فى الطلب.
   */
  async syncSheet(sheetName, cursor) {
    try {
      const qs = '?sheet=' + encodeURIComponent(sheetName) + '&action=sync' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const r = await this._get(qs);
      const body = await r.json();
      if (!r.ok || (body && body.error)) {
        throw new Error('[ApiService.syncSheet] ' + (body && body.error ? body.error : ('HTTP ' + r.status)));
      }
      return body;
    } catch (e) {
      console.warn('[ApiService.syncSheet] Sheet:', sheetName, e);
      return { sheet: sheetName, items: [], nextCursor: cursor || null, hasMore: false };
    }
  },

  /**
   * Loads ALL sheets in one call (sequential — preserves original behaviour).
   *
   * Replaces: loadFromSheets() fetch loop
   *
   * Sheet→key pairs are the canonical mapping used across the entire app:
   *   القضايا    → cases
   *   الجلسات    → sessions
   *   الموكلين   → clients
   *   الأطفال    → children
   *   المستندات  → documents
   *   المهام     → tasks
   *   الأتعاب    → fees
   *
   * @returns {Promise<{loaded: number, results: Object}>}
   *   loaded  — count of sheets that returned ≥1 row
   *   results — { [dataKey]: Array }  for every sheet attempted
   */
  async loadAllSheets() {
    const pairs = [
      ['القضايا',   'cases'],
      ['الجلسات',   'sessions'],
      ['الموكلين',  'clients'],
      ['الأطفال',   'children'],
      ['المستندات', 'documents'],
      ['الأعمال الإدارية', 'tasks'],
      ['الأتعاب',   'fees']
    ];

    const results = {};
    let loaded = 0;

    for (let i = 0; i < pairs.length; i++) {
      const [sh, k] = pairs[i];
      const arr = await this.loadData(sh);
      results[k] = arr;
      if (arr.length > 0) loaded++;
    }

    return { loaded, results };
  },

  // ================================================================
  // WRITE (add / update)
  // ================================================================

  /**
   * Adds a new row to a sheet.
   *
   * Replaces: syncToSheets(sheet, rowData, -1)
   *
   * @param {string} sheetName  - Arabic sheet name
   * @param {Object} rowData    - Full row object
   * @returns {Promise<void>}
   */
  async saveData(sheetName, rowData) {
    if (!this._url()) return;
    const body = { action: 'add', sheet: sheetName, data: rowData };
    try {
      await this._post(body);
    } catch (e) {
      console.warn('[ApiService.saveData] Sheet:', sheetName, e);
      if (typeof OfflineQueue !== 'undefined') OfflineQueue.enqueue(body); // Phase 29
    }
  },

  /**
   * Updates an existing row in a sheet by its 0-based frontend index.
   *
   * Replaces: syncToSheets(sheet, rowData, rowIndex) when rowIndex >= 0
   *
   * NOTE: rowIndex is converted to 1-based (+1 for header offset) when
   * sent to Apps Script, exactly matching the original syncToSheets logic.
   *
   * @param {string} sheetName  - Arabic sheet name
   * @param {Object} rowData    - Updated row object
   * @param {number} rowIndex   - 0-based index in the frontend data array
   * @returns {Promise<void>}
   */
  async updateData(sheetName, rowData, rowIndex) {
    if (!this._url()) return;
    const body = {
      action: 'update',
      sheet: sheetName,
      data: rowData,
      rowIndex: rowIndex + 1   // +1: GAS header offset (matches original)
    };
    try {
      await this._post(body);
    } catch (e) {
      console.warn('[ApiService.updateData] Sheet:', sheetName, e);
      if (typeof OfflineQueue !== 'undefined') OfflineQueue.enqueue(body); // Phase 29
    }
  },

  /**
   * Convenience wrapper: calls saveData() for new records (idx === -1)
   * or updateData() for existing records (idx >= 0).
   *
   * Direct replacement for the original:
   *   if (API_URL) syncToSheets(sheet, obj, idx);
   *
   * @param {string} sheetName
   * @param {Object} rowData
   * @param {number} rowIndex   - -1 for new, ≥0 for update
   * @returns {Promise<void>}
   */
  async syncRow(sheetName, rowData, rowIndex) {
    if (rowIndex >= 0) {
      return this.updateData(sheetName, rowData, rowIndex);
    } else {
      return this.saveData(sheetName, rowData);
    }
  },

  // ================================================================
  // DELETE
  // ================================================================

  /**
   * Deletes a row from a sheet by its 0-based frontend index.
   *
   * Replaces: syncDeleteToSheets(sheet, rowIndex)
   *
   * FIX C1 (DATABASE_FORENSIC_REPORT.md §P6-C1): now accepts an optional
   * `recordId` (the entity's own unique-id field value, e.g. رقم_القضية)
   * and forwards it as `body.id`. Config/06_Api.gs's apiDeleteRow() tries
   * this id FIRST (matching against the sheet's real idField column) and
   * only falls back to the legacy rowIndex-based deletion when no id is
   * supplied or no match is found — so this is purely additive: any
   * existing call site that doesn't pass recordId keeps the exact prior
   * behavior.
   * @param {string} sheetName  - Arabic sheet name
   * @param {number} rowIndex   - 0-based index in the frontend data array
   * @param {string} [recordId] - the record's own unique-id field value (recommended)
   * @returns {Promise<void>}
   */
  async deleteData(sheetName, rowIndex, recordId) {
    if (!this._url()) return;
    const body = {
      action: 'delete',
      sheet: sheetName,
      rowIndex: rowIndex + 1,   // +1: GAS header offset (matches original) — fallback only now
      id: (recordId !== undefined && recordId !== null) ? recordId : undefined
    };
    try {
      await this._post(body);
    } catch (e) {
      console.warn('[ApiService.deleteData] Sheet:', sheetName, e);
      if (typeof OfflineQueue !== 'undefined') OfflineQueue.enqueue(body); // Phase 29
    }
  },

  // ================================================================
  // CONNECTION / SETTINGS
  // ================================================================

  /**
   * Pings the Apps Script deployment to verify connectivity.
   *
   * Replaces: fetch(API_URL + '?action=ping', ...) in pingConnection()
   *
   * @param {string} [url]        - URL to ping; falls back to this._url()
   * @param {number} [timeoutMs]  - Default 8 000 ms
   * @returns {Promise<{ok: boolean, version?: string, spreadsheet_url?: string}>}
   */
  async ping(url, timeoutMs = 8000) {
    const target = url || this._url();
    if (!target) return { ok: false };
    try {
      const r = await fetch(target + '?action=ping', {
        signal: AbortSignal.timeout(timeoutMs)
      });
      const d = await r.json();
      return {
        ok: d.status === 'ok',
        version: d.version || '',
        spreadsheet_url: d.spreadsheet_url || ''
      };
    } catch (e) {
      console.warn('[ApiService.ping]', e);
      return { ok: false };
    }
  },

  /**
   * Runs Apps Script setup action (creates spreadsheet if needed).
   *
   * Replaces: fetch(url + '?action=setup', ...) in testConnection()
   *
   * @param {string} url          - The Apps Script URL to test
   * @param {number} [timeoutMs]  - Default 30 000 ms
   * @returns {Promise<{ok: boolean, spreadsheet_url?: string, error?: string}>}
   */
  async setup(url, timeoutMs = 30000) {
    try {
      const r = await fetch(url + '?action=setup', {
        signal: AbortSignal.timeout(timeoutMs)
      });
      const d = await r.json();
      return {
        ok: d.status === 'ok',
        spreadsheet_url: d.spreadsheet_url || '',
        error: d.error || ''
      };
    } catch (e) {
      console.warn('[ApiService.setup]', e);
      return { ok: false, error: e.message };
    }
  },

  /**
   * Returns the Apps Script settings stored in the backend.
   *
   * Placeholder for future use — maps to ?action=settings if/when added to GAS.
   *
   * @returns {Promise<Object|null>}
   */
  async getSettings() {
    if (!this._url()) return null;
    try {
      const r = await this._get('?action=settings');
      return await r.json();
    } catch (e) {
      console.warn('[ApiService.getSettings]', e);
      return null;
    }
  },

  // ================================================================
  // FILE / DRIVE
  // ================================================================

  /**
   * Uploads a file to Google Drive via the Apps Script endpoint.
   *
   * Wired to Config/06_Api.gs's `action:'uploadFile'` handler (apiUploadFile)
   * and Config/03_Drive.gs's uploadBase64FileToDrive() (Phase: بيانات الموكل
   * الموسّعة). Used today by js/modules/client-fields.js to upload client
   * powers-of-attorney (فولدر "توكيلات المكتب") and client documents
   * (فولدر "مستندات القضايا") — folderKey selects which default folder is
   * used server-side when folderId is not explicitly given.
   *
   * PHASE 38 — Process Server Works Module (أعمال المحضرين): adds the
   * optional `clientFolderName` param, forwarded as-is to the backend and
   * used only when folderKey==='process_server' — Config/03_Drive.gs then
   * uploads into a subfolder named after that client, inside the existing
   * "مستندات القضايا" folder (see getOrCreateClientDocsFolder()). Omitted
   * or irrelevant for every other existing folderKey, so this is a
   * backward-compatible, additive parameter — no existing call site needs
   * to change.
   *
   * @param {string} fileName    - Desired filename in Drive
   * @param {string} base64Data  - Base64-encoded file content
   * @param {string} mimeType    - e.g. 'application/pdf'
   * @param {string} [folderId]  - Target Drive folder ID (optional, takes precedence)
   * @param {string} [folderKey] - 'powers' → توكيلات المكتب folder;
   *                               'process_server' → a per-client subfolder
   *                               of مستندات القضايا (requires clientFolderName);
   *                               anything else/omitted → مستندات القضايا folder
   * @param {string} [clientFolderName] - client name, used only when
   *                               folderKey === 'process_server'
   * @returns {Promise<{ok: boolean, url?: string, error?: string}>}
   */
  async uploadFile(fileName, base64Data, mimeType, folderId, folderKey, clientFolderName) {
    if (!this._url()) return { ok: false, error: 'API_URL not set' };
    try {
      const r = await this._post({
        action: 'uploadFile',
        fileName,
        base64Data,
        mimeType,
        folderId: folderId || '',
        folderKey: folderKey || '',
        clientFolderName: clientFolderName || ''
      });
      const d = await r.json();
      return { ok: d.status === 'ok', url: d.url || '', id: d.id || '', error: d.error || '' };
    } catch (e) {
      console.warn('[ApiService.uploadFile]', e);
      return { ok: false, error: e.message };
    }
  },

  // ================================================================
  // PORTAL / QR
  // ================================================================

  /**
   * Builds the client portal URL for a given portal token.
   *
   * Replaces:
   *   var portalUrl = API_URL + '?action=portal&token=' + encodeURIComponent(token);
   *   (in displayPortalModal and genClientQR)
   *
   * @param {string} token  - The portal_token stored on the client record
   * @returns {string}      - Full URL to the client portal page
   */
  getPortalUrl(token) {
    return this._url() + '?action=portal&token=' + encodeURIComponent(token);
  },

  /**
   * Builds a QR code image URL using the free api.qrserver.com service.
   *
   * Replaces:
   *   'https://api.qrserver.com/v1/create-qr-code/?size='+qrSize+'x'+qrSize+
   *   '&ecc=M&data=' + encodeURIComponent(portalUrl)
   *   (in displayPortalModal)
   *
   * @param {string} data     - The URL / text to encode in the QR
   * @param {number} [size]   - Pixel size for both width and height (default 200)
   * @param {string} [ecc]    - Error correction level: L | M | Q | H (default 'M')
   * @returns {string}        - QR image src URL
   */
  getQrImageUrl(data, size = 200, ecc = 'M') {
    return (
      'https://api.qrserver.com/v1/create-qr-code/' +
      '?size=' + size + 'x' + size +
      '&ecc=' + ecc +
      '&data=' + encodeURIComponent(data)
    );
  }

};

// ================================================================
// BUGFIX (client-file-upload availability check, Phase: بيانات الموكل
// الموسّعة): `const ApiService = {...}` above is a top-level `const` in a
// classic (non-module) <script>. Browsers give top-level `const`/`let` a
// separate global *lexical* binding — `ApiService` resolves fine as a bare
// identifier everywhere else in the codebase (clients.js, cases.js,
// tasks.js, ...) — but that binding is NOT copied onto the `window`
// object the way a top-level `var` would be. `window.ApiService` was
// therefore ALWAYS `undefined`, regardless of network/Drive/deployment
// state.
//
// Two existing call sites explicitly gate on the `window`/`global` form
// and were silently short-circuiting because of this:
//   - js/modules/client-fields.js#uploadRowFile(): `if (!window.ApiService
//     || ...)` — this is the exact cause of the "⚠️ خدمة الرفع غير متاحة
//     حاليًا (اعمل أونلاين)" message appearing on every توكيل/مستند file
//     upload attempt, even with a fully working Apps Script deployment.
//   - js/debug/RuntimeDebugLayer.js's API instrumentation pass:
//     `if (global.ApiService) { ... }` (global === window there) — the
//     debug layer was silently never installing its ApiService.* timing/
//     logging wrappers.
// This one-line addition is purely additive: no existing method, call
// site using the bare `ApiService` identifier, or business logic is
// touched or renamed.
if (typeof window !== 'undefined') { window.ApiService = ApiService; }
