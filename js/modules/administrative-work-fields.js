/**
 * ================================================================
 * js/modules/administrative-work-fields.js — مستندات الأعمال الإدارية | نظام الحسام
 * ================================================================
 * ADMINISTRATIVE WORKS TRANSFORM (تحويل وحدة "المهام" إلى "الأعمال
 * الإدارية" وفق ADMINISTRATIVE_WORKS_PRE_IMPLEMENTATION_AUDIT.md).
 *
 * نسخة شبه حرفية من js/modules/process-server-fields.js (نفس التوصية
 * الصريحة في طلب التنفيذ §9: "لا تخترع نظام رفع جديد إذا كان النظام
 * الموجود يمكن إعادة استخدامه"). الفرق الوحيد: الـid الجذري
 * (twDocumentsContainer/twDocRow_.../fTaskClientNameHidden بدل
 * pswDocumentsContainer/pswDocRow_.../fPswClientNameHidden) والـclass
 * الاسمي (tw-doc-name/tw-doc-file بدل psw-doc-name/psw-doc-file) —
 * كل شيء آخر (repeat-row/repeat-file-row/repeat-file-status CSS
 * classes، تسلسل uploadRowFile، بنية JSON المخزَّنة) مطابق 100%.
 *
 * التخزين: مصفوفة JSON في عمود 'المستندات' بصف العمل الإداري —
 *   [{name, fileUrl, fileId, uploadedAt}]
 *
 * مسار الرفع (Drive): يستدعي ApiService.uploadFile(...) بنفس
 * folderKey='process_server' المستخدم فعليًا في process-server-fields.js
 * — هذا المفتاح لا يعني "خاص بالمحضرين" فعليًا، بل ينفّذ في
 * Config/03_Drive.gs (getOrCreateClientDocsFolder) منطقًا عامًا: "أنشئ/
 * استخدم فولدر باسم الموكل المُمرَّر داخل مستندات القضايا" — لا علاقة
 * له بنوع العمل. إعادة استخدامه هنا حرفيًا (بدل إضافة مفتاح فولدر جديد)
 * يعني صفر تعديل على Config/03_Drive.gs، ونفس ضمانات Offline/الاسترجاع/
 * المزامنة المُختبرة مسبقًا لأعمال المحضرين.
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
   * currentClientFolderName — يقرأ اسم الموكل الحالي من نموذج العمل
   * الإداري المفتوح (يضعه tasks.js في #fTaskClientNameHidden عند اختيار
   * الموكل من selectTaskClient()). يُستخدم فقط كاسم فولدر Drive.
   */
  function currentClientFolderName() {
    var el = document.getElementById('fTaskClientNameHidden');
    var name = el ? (el.value || '').trim() : '';
    return name || 'بدون_اسم_موكل';
  }

  // ================================================================
  // صفوف متكررة — المستندات (+ رفع ملف مباشرة داخل فولدر الموكل)
  // ================================================================
  function addDocumentRow(data) {
    data = data || {};
    var container = document.getElementById('twDocumentsContainer');
    if (!container) return;
    var rowId = 'twDocRow_' + uidLocal();
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.setAttribute('data-file-url', data.fileUrl || '');
    row.setAttribute('data-file-id', data.fileId || '');
    row.setAttribute('data-uploaded-at', data.uploadedAt || '');
    row.innerHTML =
      '<div class="repeat-row-title">مستند<button type="button" class="repeat-row-remove" onclick="AdministrativeWorkFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-group full"><label>اسم المستند</label><input type="text" class="tw-doc-name" value="' + safeAttr(data.name) + '" placeholder="محضر / إفادة / إيصال..."></div>' +
      '<div class="repeat-file-row">' +
        '<input type="file" class="tw-doc-file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onchange="AdministrativeWorkFields.uploadRowFile(this,\'' + rowId + '\')">' +
        '<span class="repeat-file-status' + (data.fileUrl ? ' ok' : '') + '">' + (data.fileUrl ? '&#10003; تم رفع الملف — <a href="' + safeAttr(data.fileUrl) + '" target="_blank">فتح</a>' : 'لم يُرفع ملف بعد') + '</span>' +
      '</div>';
    container.appendChild(row);
  }

  function removeRow(rowId) {
    var row = document.getElementById(rowId);
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  /**
   * uploadRowFile — يرفع ملف مستند العمل الإداري مباشرة إلى فولدر Drive
   * الخاص باسم الموكل الحالي (داخل "مستندات القضايا")، بنفس أسلوب
   * ProcessServerFields.uploadRowFile حرفيًا — نفس folderKey.
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
            var nameInput = row.querySelector('.tw-doc-name');
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
    var container = document.getElementById('twDocumentsContainer');
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
   * fill(record) — يُستدعى من editTask() بعد fillForm() لإعادة بناء
   * صفوف المستندات المتكررة من بيانات العمل الإداري الحالي.
   */
  function fill(record) {
    record = record || {};
    var container = document.getElementById('twDocumentsContainer');
    if (container) container.innerHTML = '';
    var docs = parseArr(record['المستندات']);
    docs.forEach(addDocumentRow);
  }

  /**
   * collect() — يُستدعى من saveTask() قبل الحفظ. يُرجع Object يُدمج
   * مباشرة داخل obj — عمود JSON إضافي واحد بدون أي تأثير على أي عمود
   * آخر.
   */
  function collect() {
    var container = document.getElementById('twDocumentsContainer');
    var rows = container ? Array.prototype.slice.call(container.children) : [];
    var docs = rows.map(function (row) {
      var nameEl = row.querySelector('.tw-doc-name');
      return {
        name: nameEl ? nameEl.value.trim() : '',
        fileUrl: row.getAttribute('data-file-url') || '',
        fileId: row.getAttribute('data-file-id') || '',
        uploadedAt: row.getAttribute('data-uploaded-at') || ''
      };
    }).filter(function (d) { return d.name || d.fileUrl; });

    return { 'المستندات': JSON.stringify(docs) };
  }

  root.AdministrativeWorkFields = {
    addDocumentRow: addDocumentRow,
    removeRow: removeRow,
    uploadRowFile: uploadRowFile,
    reset: reset,
    fill: fill,
    collect: collect
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AdministrativeWorkFields: root.AdministrativeWorkFields };
  }

})(typeof window !== 'undefined' ? window : this);
