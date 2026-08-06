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
   * @param {Object} body  - Plain object; will be JSON-stringified.
   * @returns {Promise<Response>}
   */
  async _post(body) {
    return fetch(this._url(), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain' }
    });
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
      ['المهام',    'tasks'],
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
   * @param {string} sheetName  - Arabic sheet name
   * @param {number} rowIndex   - 0-based index in the frontend data array
   * @returns {Promise<void>}
   */
  async deleteData(sheetName, rowIndex) {
    if (!this._url()) return;
    const body = {
      action: 'delete',
      sheet: sheetName,
      rowIndex: rowIndex + 1   // +1: GAS header offset (matches original)
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
   * This is a forward-looking stub: the current GAS backend does not
   * expose a file-upload action, but the interface is defined here so
   * all Drive communication lives in one place when it is added.
   *
   * @param {string} fileName   - Desired filename in Drive
   * @param {string} base64Data - Base64-encoded file content
   * @param {string} mimeType   - e.g. 'application/pdf'
   * @param {string} [folderId] - Target Drive folder ID (optional)
   * @returns {Promise<{ok: boolean, url?: string, error?: string}>}
   */
  async uploadFile(fileName, base64Data, mimeType, folderId) {
    if (!this._url()) return { ok: false, error: 'API_URL not set' };
    try {
      const r = await this._post({
        action: 'uploadFile',
        fileName,
        base64Data,
        mimeType,
        folderId: folderId || ''
      });
      const d = await r.json();
      return { ok: d.status === 'ok', url: d.url || '', error: d.error || '' };
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
