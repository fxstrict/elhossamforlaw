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
   * PHASE D — INSTALLATION CREDENTIAL ENFORCEMENT. Reads this device's
   * already-issued credential from the single existing storage location
   * (js/license/InstallationRegistrar.js — no new/duplicate storage is
   * created here). Returns null if none exists yet (never registered,
   * or local storage was cleared) — every caller below treats that as
   * "omit the fields", never as an error; the server's Stage 1 policy
   * already graces a request with no credential (see Config/11_Auth.gs).
   * @returns {?{installationId:string, credential:string}}
   */
  _phaseDCredential() {
    try {
      if (typeof window !== 'undefined' && window.InstallationRegistrar &&
          typeof window.InstallationRegistrar.getCredential === 'function') {
        return window.InstallationRegistrar.getCredential();
      }
    } catch (e) { /* ignore — Fail-Open, same convention as InstallationRegistrar itself */ }
    return null;
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
    // PHASE D — attach installationId/credential if this device has
    // already been issued one (registerInstallation/checkLicenseStatus
    // requests simply ignore these extra fields server-side — see
    // Config/06_Api.gs, both are routed before the Phase D auth gate).
    // Never overwrites a field the caller explicitly set on `body`.
    const cred = this._phaseDCredential();
    const outgoingBody = cred ? Object.assign({ installationId: cred.installationId, credential: cred.credential }, body) : body;

    const response = await fetch(this._url(), {
      method: 'POST',
      body: JSON.stringify(outgoingBody),
      headers: { 'Content-Type': 'text/plain' }
    });
    let parsed = null;
    try { parsed = await response.clone().json(); } catch (parseErr) { /* non-JSON body — fall through to status-only check */ }
    if (!response.ok) {
      throw new Error('[ApiService] HTTP ' + response.status + ' من Apps Script');
    }
    if (parsed && parsed.error) {
      // PHASE D — distinguish an authentication rejection (structured
      // {error:'AUTH_FAILED', authCode:'...'} from Config/11_Auth.gs's
      // _authFailureResponseIfAny_()) from an ordinary application error.
      // Tagging isAuthError lets callers (saveData/updateData/deleteData
      // below) decide NOT to hand this to OfflineQueue for endless retry
      // — see brief §20 — without needing any change to OfflineQueue.js
      // itself (a Protected Component).
      const err = new Error('[ApiService] فشل تطبيقي من الخادم: ' + parsed.error);
      if (parsed.authCode) {
        err.isAuthError = true;
        err.authCode = parsed.authCode;
      }
      throw err;
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
    // PHASE D — attach installationId/credential as query parameters.
    // ⚠️ DOCUMENTED LIMITATION (brief §14 explicitly disfavors this,
    // "unless an explicit architectural reason requires it" — this is
    // that case): a custom Authorization header would trigger a CORS
    // preflight (OPTIONS) request, which this Apps Script Web App does
    // not implement (see this file's own _post() comment: "Uses
    // Content-Type: text/plain to avoid CORS preflight" — the exact
    // same constraint applies to GET + custom headers). A GET request
    // has no body. Query parameters are therefore the only mechanism
    // available for this transport without a larger change (converting
    // these reads to POST), which was deliberately NOT done here to
    // keep the Phase D diff minimal and avoid altering this method's
    // existing timeout/AbortSignal behavior relied on by loadDataWithStatus()
    // and syncSheet(). Risk: the credential may appear in Apps Script's
    // own platform-level request logs (outside this codebase's control).
    // Reported as a limitation in the Phase D implementation report, not
    // silently accepted.
    const cred = this._phaseDCredential();
    const credSuffix = cred
      ? (queryString.indexOf('?') === -1 ? '?' : '&') +
        'installationId=' + encodeURIComponent(cred.installationId) +
        '&credential=' + encodeURIComponent(cred.credential)
      : '';
    const opts = timeoutMs
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {};
    return fetch(this._url() + queryString + credSuffix, opts);
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
   * PHASE B — BOOTSTRAP RACE FIX. loadData() above intentionally
   * swallows every failure (network error, non-OK HTTP status, invalid
   * JSON, or a backend-level `{error:...}` response) into the exact
   * same `[]` it returns for "the sheet genuinely exists and is empty"
   * — correct for every one of its ~17 existing callers (a normal
   * repository read degrading gracefully offline), but WRONG for a
   * caller that needs to tell "confirmed empty" apart from "could not
   * confirm anything" (see js/office/OfficeProfileService.js
   * bootstrap()/_discoverServerProfile(), Phase B). This method is a
   * fully independent, additive sibling — it does not alter loadData()
   * or any of its existing call sites.
   *
   * Adds an 8s timeout (AbortSignal via the existing optional
   * `timeoutMs` param on _get(), already used by syncSheet() below —
   * no change to _get() itself) so a caller awaiting this can never
   * hang indefinitely on a stalled connection.
   *
   * @param {string} sheetName
   * @returns {Promise<{ok:true, rows:Array}|{ok:false, reason:string}>}
   *   reason is one of: 'network' | 'http' | 'parse' | 'app_error'
   */
  async loadDataWithStatus(sheetName) {
    let response;
    try {
      response = await this._get('?sheet=' + encodeURIComponent(sheetName), 8000);
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
    if (!response.ok) {
      return { ok: false, reason: 'http' };
    }
    let parsed;
    try {
      parsed = await response.json();
    } catch (e) {
      return { ok: false, reason: 'parse' };
    }
    if (!Array.isArray(parsed)) {
      // Backend returns a plain {error:'...'} object (see Config/06_Api.gs
      // doGet()'s catch-all and its "sheet مطلوب" guards) on failure —
      // never an object on success (success is always a JSON array, even
      // an empty one for a genuinely empty sheet).
      return { ok: false, reason: 'app_error' };
    }
    return { ok: true, rows: parsed };
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
      // PHASE D — an authentication rejection (wrong/unknown/revoked
      // credential) is not a transient network condition: retrying the
      // exact same request via OfflineQueue will fail identically every
      // time, forever (OfflineQueue.js itself is a Protected Component
      // and is NOT modified — this check happens here instead, per
      // brief §20). Network/HTTP failures fall through unchanged.
      if (e && e.isAuthError) {
        console.warn('[ApiService.saveData] AUTH_FAILED (' + e.authCode + ') — not queued for retry:', sheetName);
      } else if (typeof OfflineQueue !== 'undefined') {
        OfflineQueue.enqueue(body); // Phase 29
      }
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
      // PHASE D — see saveData() above for the reasoning.
      if (e && e.isAuthError) {
        console.warn('[ApiService.updateData] AUTH_FAILED (' + e.authCode + ') — not queued for retry:', sheetName);
      } else if (typeof OfflineQueue !== 'undefined') {
        OfflineQueue.enqueue(body); // Phase 29
      }
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
      // PHASE D — see saveData() above for the reasoning.
      if (e && e.isAuthError) {
        console.warn('[ApiService.deleteData] AUTH_FAILED (' + e.authCode + ') — not queued for retry:', sheetName);
      } else if (typeof OfflineQueue !== 'undefined') {
        OfflineQueue.enqueue(body); // Phase 29
      }
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

  /**
   * PHASE C v3/v3.1/v3.2 — Per-Installation Registration.
   * Routes to Config/11_Auth.gs → apiRegisterInstallation() (see that
   * file for the full contract: REGISTERED / ALREADY_REGISTERED /
   * REISSUED / and the failure `status` values).
   *
   * DELIBERATE DEVIATION from this file's usual wrapper convention
   * (compare uploadFile()/setup() above, which catch internally and
   * return a normalized {ok, ...} shape): this method does NOT catch
   * anything and does NOT parse the body. It returns exactly what
   * `_post()` returns, and lets a network/HTTP-level failure THROW,
   * exactly like `_post()` itself.
   *
   * This is required, not an oversight: js/license/InstallationRegistrar.js
   * must distinguish a network exception (fetch rejection, timeout, non-2xx
   * HTTP) from a fully-valid server response that merely carries
   * `success:false` (e.g. ALREADY_USED, REQUEST_ID_MISMATCH) — the two
   * cases drive very different, security-relevant behavior there
   * (see PHASE_C_V3_2_AMENDMENT.md §2.4/§4.5, "IMPORTANT HTTP ERROR
   * RULE"). Swallowing the exception here the way uploadFile() does
   * would erase that distinction and was explicitly disallowed by the
   * approved design. Also note: Config/11_Auth.gs never puts an
   * `error` field in its JSON body (only `status`/`message`), so this
   * call also never trips `_post()`'s own generic
   * `if (parsed && parsed.error) throw ...` path for a legitimate
   * business rejection — only a real HTTP/network failure throws here.
   *
   * @param {{licenseId:string, activationCode:string, machineId:string,
   *          requestId:string, forceReissue?:boolean}} fields
   * @returns {Promise<Response>}
   */
  async registerInstallation(fields) {
    return this._post({
      action: 'registerInstallation',
      licenseId: fields.licenseId,
      activationCode: fields.activationCode,
      machineId: fields.machineId,
      requestId: fields.requestId,
      forceReissue: !!fields.forceReissue
    });
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
