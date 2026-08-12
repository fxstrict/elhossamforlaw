/**
 * ================================================================
 * js/modules/process-server-fields.js — مستندات عمل المحضرين | نظام الحسام
 * ================================================================
 * PHASE 38 — Process Server Works Module (أعمال المحضرين)
 *
 * إضافة جديدة كليًا (additive) — لا تُعدّل أي دالة موجودة في
 * js/modules/client-fields.js أو js/modules/opponent-fields.js. يستدعيها
 * js/modules/process-server-works.js (ProcessServerFields.*) من داخل
 * saveProcessServerWork()/editProcessServerWork()، بنفس النمط الحرفي
 * المستخدم بالفعل لـ ClientFields.addDocumentRow()/uploadRowFile() في
 * client-fields.js — لكن موجَّه لرفع مستند أو أكثر مباشرة داخل مجلد
 * Drive الخاص بالموكل صاحب هذا العمل (وليس مجلد "مستندات القضايا" العام).
 *
 * التخزين: مصفوفة JSON في عمود واحد إضافي بصف العمل — 'المستندات':
 *   [{name, fileUrl, fileId, uploadedAt}]
 * متوافق 100% مع Google Sheets (نفس فلسفة أرقام_الهواتف/العناوين في
 * ClientsRepository/OpponentsRepository).
 *
 * مسار الرفع الفعلي (Drive): يستدعي ApiService.uploadFile(...) بتمرير
 * folderKey='process_server' + clientFolderName=اسم الموكل الحالي —
 * Config/03_Drive.gs (getOrCreateClientDocsFolder) ينشئ/يستخدم فولدر
 * باسم الموكل داخل فولدر "مستندات القضايا" الموجود أصلاً داخل فولدر
 * النسخ الاحتياطي الرئيسي — لا يُعدَّل أي فولدر أو مسار قديم آخر.
 * ================================================================
 */
(function (root) {
  'use strict';

  function esc(v) {
    return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v == null ? '' : v);
  }
  function safeAttr(v) {
    return esc(v).replace(/"/g, '&quot;');
  }
  function uidLocal() {
    return (typeof uid === 'function') ? uid() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  }

  /**
   * currentClientFolderName — يقرأ اسم الموكل الحالي من نموذج عمل
   * المحضرين المفتوح (يضعه process-server-works.js في هذا الحقل عند
   * اختيار الموكل من القائمة). يُستخدم فقط كاسم فولدر Drive — لا علاقة
   * له بأي عمود مخزَّن.
   */
  function currentClientFolderName() {
    var el = document.getElementById('fPswClientNameHidden');
    var name = el ? (el.value || '').trim() : '';
    return name || 'بدون_اسم_موكل';
  }

  // ================================================================
  // صفوف متكررة — المستندات (+ رفع ملف مباشرة داخل فولدر الموكل)
  // ================================================================
  function addDocumentRow(data) {
    data = data || {};
    var container = document.getElementById('pswDocumentsContainer');
    if (!container) return;
    var rowId = 'pswDocRow_' + uidLocal();
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.setAttribute('data-file-url', data.fileUrl || '');
    row.setAttribute('data-file-id', data.fileId || '');
    row.setAttribute('data-uploaded-at', data.uploadedAt || '');
    row.innerHTML =
      '<div class="repeat-row-title">مستند<button type="button" class="repeat-row-remove" onclick="ProcessServerFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-group full"><label>اسم المستند</label><input type="text" class="psw-doc-name" value="' + safeAttr(data.name) + '" placeholder="صورة الإعلان / محضر التسليم..."></div>' +
      '<div class="repeat-file-row">' +
        '<input type="file" class="psw-doc-file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onchange="ProcessServerFields.uploadRowFile(this,\'' + rowId + '\')">' +
        '<span class="repeat-file-status' + (data.fileUrl ? ' ok' : '') + '">' + (data.fileUrl ? '&#10003; تم رفع الملف — <a href="' + safeAttr(data.fileUrl) + '" target="_blank">فتح</a>' : 'لم يُرفع ملف بعد') + '</span>' +
      '</div>';
    container.appendChild(row);
  }

  function removeRow(rowId) {
    var row = document.getElementById(rowId);
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  /**
   * uploadRowFile — يرفع ملف مستند العمل مباشرة إلى فولدر Drive الخاص
   * باسم الموكل الحالي (داخل "مستندات القضايا")، عبر ApiService.uploadFile
   * بنفس أسلوب ClientFields.uploadRowFile تمامًا — الفرق الوحيد تمرير
   * folderKey='process_server' + اسم الموكل كـ clientFolderName.
   */
  function uploadRowFile(inputEl, rowId) {
    var file = inputEl && inputEl.files && inputEl.files[0];
    var row = document.getElementById(rowId);
    var statusEl = row ? row.querySelector('.repeat-file-status') : null;
    if (!file || !row) return;

    if (statusEl) {
      statusEl.className = 'repeat-file-status';
      statusEl.textContent = '⏳ جارِ رفع الملف...';
    }

    var reader = new FileReader();
    reader.onload = function () {
      var base64 = String(reader.result || '').split(',')[1] || '';
      var clientName = currentClientFolderName();
      var fileName = clientName + ' - ' + file.name;

      if (!window.ApiService || typeof ApiService.uploadFile !== 'function') {
        if (statusEl) { statusEl.className = 'repeat-file-status err'; statusEl.textContent = '⚠️ خدمة الرفع غير متاحة حاليًا (اعمل أونلاين)'; }
        return;
      }

      ApiService.uploadFile(fileName, base64, file.type || 'application/octet-stream', '', 'process_server', clientName)
        .then(function (res) {
          if (res && res.ok && res.url) {
            row.setAttribute('data-file-url', res.url);
            row.setAttribute('data-file-id', res.id || '');
            row.setAttribute('data-uploaded-at', new Date().toISOString());
            if (statusEl) {
              statusEl.className = 'repeat-file-status ok';
              statusEl.innerHTML = '&#10003; تم رفع الملف — <a href="' + safeAttr(res.url) + '" target="_blank">فتح</a>';
            }
            var nameInput = row.querySelector('.psw-doc-name');
            if (nameInput && !nameInput.value.trim()) nameInput.value = file.name;
            if (typeof toast === 'function') toast('تم رفع المستند بنجاح', 'success');
          } else {
            if (statusEl) { statusEl.className = 'repeat-file-status err'; statusEl.textContent = '⚠️ تعذّر رفع الملف — حاول مرة أخرى'; }
          }
        })
        .catch(function () {
          if (statusEl) { statusEl.className = 'repeat-file-status err'; statusEl.textContent = '⚠️ تعذّر رفع الملف — تحقق من الاتصال'; }
        });
    };
    reader.readAsDataURL(file);
  }

  // ================================================================
  // تصفير / تعبئة / تجميع صفوف المستندات
  // ================================================================
  function reset() {
    var container = document.getElementById('pswDocumentsContainer');
    if (container) container.innerHTML = '';
  }

  function parseArr(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * fill(record) — يُستدعى من editProcessServerWork() بعد fillForm() لإعادة
   * بناء صفوف المستندات المتكررة من بيانات العمل الحالية.
   */
  function fill(record) {
    record = record || {};
    var container = document.getElementById('pswDocumentsContainer');
    if (container) container.innerHTML = '';
    var docs = parseArr(record['المستندات']);
    docs.forEach(addDocumentRow);
  }

  /**
   * collect() — يُستدعى من saveProcessServerWork() قبل الحفظ. يُرجع
   * Object يُدمج مباشرة داخل obj — عمود JSON إضافي واحد بدون أي تأثير
   * على أي عمود آخر.
   */
  function collect() {
    var container = document.getElementById('pswDocumentsContainer');
    var rows = container ? Array.prototype.slice.call(container.children) : [];
    var docs = rows.map(function (row) {
      var nameEl = row.querySelector('.psw-doc-name');
      return {
        name: nameEl ? nameEl.value.trim() : '',
        fileUrl: row.getAttribute('data-file-url') || '',
        fileId: row.getAttribute('data-file-id') || '',
        uploadedAt: row.getAttribute('data-uploaded-at') || ''
      };
    }).filter(function (d) { return d.name || d.fileUrl; });

    return { 'المستندات': JSON.stringify(docs) };
  }

  root.ProcessServerFields = {
    addDocumentRow: addDocumentRow,
    removeRow: removeRow,
    uploadRowFile: uploadRowFile,
    reset: reset,
    fill: fill,
    collect: collect
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProcessServerFields: root.ProcessServerFields };
  }

})(typeof window !== 'undefined' ? window : this);
