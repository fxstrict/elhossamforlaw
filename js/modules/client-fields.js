/**
 * ================================================================
 * js/modules/client-fields.js — بيانات الموكل الموسّعة | نظام الحسام
 * ================================================================
 * إضافة جديدة كليًا (additive) — لا تُعدّل أي دالة موجودة في
 * js/modules/clients.js، بل يستدعيها ذلك الملف صراحة (ClientFields.*)
 * من داخل saveClient()/editClient()/viewClient().
 *
 * الغرض: دعم تقسيم الموكل إلى "شخص طبيعي" / "شخص اعتباري" (شركة)،
 * ودعم الحقول المتكررة (أرقام هواتف متعددة، عناوين متعددة، توكيلات
 * متعددة مع رفع ملف كل توكيل على Drive، مستندات متعددة، مديرو الشركة)
 * دون كسر توافق نظام collectForm/fillForm العام (FIELDS/MAP في
 * index.html) الذي يتعامل فقط مع حقول قيمة-واحدة.
 *
 * التخزين: كل مجموعة متكررة تُخزَّن كنص JSON في عمود واحد إضافي بصف
 * الموكل (متوافق 100% مع Google Sheets ولا يمسّ أي عمود قديم):
 *   أرقام_الهواتف / العناوين / التوكيلات / المستندات / المديرين
 * أي موكل قديم لا يملك هذه الأعمدة يُعامَل بأمان كمصفوفة فارغة.
 * ================================================================
 */
(function (root) {
  'use strict';

  var PHONE_TYPES   = ['موبايل', 'منزل', 'عمل', 'فاكس'];
  var ADDRESS_TYPES = ['منزل', 'عمل', 'آخر'];
  var POWER_CAPACITY = ['بشخصه', 'بشخصه وصفته', 'بصفته'];

  function esc(v) {
    return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v == null ? '' : v);
  }
  function safeAttr(v) {
    return esc(v).replace(/"/g, '&quot;');
  }
  function uidLocal() {
    return (typeof uid === 'function') ? uid() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  }

  // ================================================================
  // تبويبات نافذة الموكل
  // ================================================================
  function switchClientFormTab(tabId) {
    var panes = document.querySelectorAll('.client-form-pane');
    for (var i = 0; i < panes.length; i++) panes[i].style.display = 'none';
    var pane = document.getElementById('clientPane-' + tabId);
    if (pane) pane.style.display = '';

    var btns = document.querySelectorAll('#clientFormTabs .tab-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('active', btns[j].getAttribute('data-client-tab') === tabId);
    }
  }
  root.switchClientFormTab = switchClientFormTab;

  /**
   * toggleClientTypeSections — يُظهر/يُخفي حقول "شخص طبيعي" مقابل
   * "شخص اعتباري" حسب اختيار select#fClientType، ويُبدّل تسمية حقل
   * الاسم بين "الاسم الكامل" و"اسم الشركة" (نفس حقل fClientName
   * المشترك — كما هو مصمَّم بالفعل بحقل "الاسم" الموحّد بالشيت).
   */
  function toggleClientTypeSections() {
    var typeEl = document.getElementById('fClientType');
    var isCompany = typeEl && typeEl.value === 'شخص اعتباري';

    var indiv = document.getElementById('clientIndividualFields');
    var comp  = document.getElementById('clientCompanyFields');
    if (indiv) indiv.style.display = isCompany ? 'none' : '';
    if (comp)  comp.style.display  = isCompany ? '' : 'none';

    var nameLabel = document.getElementById('fClientNameLabel');
    var nameInput = document.getElementById('fClientName');
    if (nameLabel) nameLabel.innerHTML = (isCompany ? 'اسم الشركة' : 'الاسم الكامل') + '<span class="req">*</span>';
    if (nameInput) nameInput.placeholder = isCompany ? 'الاسم التجاري الكامل للشركة' : 'الاسم الرباعي';
  }
  root.toggleClientTypeSections = toggleClientTypeSections;

  // ================================================================
  // صفوف متكررة — أرقام الهواتف
  // ================================================================
  function addPhoneRow(data) {
    data = data || {};
    var container = document.getElementById('clientPhonesContainer');
    if (!container) return;
    var rowId = 'phoneRow_' + uidLocal();
    var typeOptions = PHONE_TYPES.map(function (t) {
      return '<option' + (data.type === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.innerHTML =
      '<div class="repeat-row-title">هاتف<button type="button" class="repeat-row-remove" onclick="ClientFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>النوع</label><select class="cf-phone-type">' + typeOptions + '</select></div>' +
        '<div class="form-group"><label>الرقم</label><input type="text" class="cf-phone-number" value="' + safeAttr(data.number) + '" placeholder="01xxxxxxxxx"></div>' +
      '</div>';
    container.appendChild(row);
  }

  // ================================================================
  // صفوف متكررة — العناوين
  // ================================================================
  function addAddressRow(data) {
    data = data || {};
    var container = document.getElementById('clientAddressesContainer');
    if (!container) return;
    var rowId = 'addrRow_' + uidLocal();
    var typeOptions = ADDRESS_TYPES.map(function (t) {
      return '<option' + (data.type === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.innerHTML =
      '<div class="repeat-row-title">عنوان<button type="button" class="repeat-row-remove" onclick="ClientFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>النوع</label><select class="cf-addr-type">' + typeOptions + '</select></div>' +
        '<div class="form-group"><label>العنوان التفصيلي</label><input type="text" class="cf-addr-detail" value="' + safeAttr(data.detail) + '" placeholder="المحافظة — المدينة — الشارع"></div>' +
      '</div>';
    container.appendChild(row);
  }

  // ================================================================
  // صفوف متكررة — التوكيلات (+ رفع ملف على Drive)
  // ================================================================
  function addPowerRow(data) {
    data = data || {};
    var container = document.getElementById('clientPowersContainer');
    if (!container) return;
    var rowId = 'powerRow_' + uidLocal();
    var capacityOptions = POWER_CAPACITY.map(function (t) {
      return '<option' + (data.capacity === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
    var idx = container.children.length + 1;
    var powerVisible = data.visible === 'نعم';
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.setAttribute('data-file-url', data.fileUrl || '');
    row.innerHTML =
      '<div class="repeat-row-title">توكيل رقم ' + idx + '<button type="button" class="repeat-row-remove" onclick="ClientFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-grid">' +
        '<div class="form-group full"><label>نوع التوكيل</label><input type="text" class="cf-power-type" value="' + safeAttr(data.type) + '" placeholder="توكيل عام / خاص..."></div>' +
        '<div class="form-group"><label>سنة</label><input type="text" class="cf-power-year" value="' + safeAttr(data.year) + '" placeholder="2026"></div>' +
        '<div class="form-group"><label>حرف</label><input type="text" class="cf-power-letter" value="' + safeAttr(data.letter) + '" placeholder="أ"></div>' +
        '<div class="form-group"><label>رقم</label><input type="text" class="cf-power-number" value="' + safeAttr(data.number) + '"></div>' +
        '<div class="form-group full"><label>مكتب التوثيق</label><input type="text" class="cf-power-notary" value="' + safeAttr(data.notaryOffice) + '"></div>' +
        '<div class="form-group full"><label>صفة التوكيل</label><select class="cf-power-capacity">' + capacityOptions + '</select></div>' +
        '<div class="form-group full"><label>ظاهر للموكل ببوابته؟</label><select class="cf-power-visible"><option value="لا"' + (!powerVisible ? ' selected' : '') + '>لا</option><option value="نعم"' + (powerVisible ? ' selected' : '') + '>نعم</option></select></div>' +
      '</div>' +
      '<div class="repeat-file-row">' +
        '<input type="file" class="cf-power-file" accept=".pdf,.jpg,.jpeg,.png" onchange="ClientFields.uploadRowFile(this,\'' + rowId + '\',\'powers\')">' +
        '<span class="repeat-file-status' + (data.fileUrl ? ' ok' : '') + '">' + (data.fileUrl ? '&#10003; تم رفع ملف التوكيل — <a href="' + safeAttr(data.fileUrl) + '" target="_blank">فتح</a>' : 'لم يُرفع ملف بعد') + '</span>' +
      '</div>';
    container.appendChild(row);
  }

  // ================================================================
  // صفوف متكررة — المستندات (+ رفع ملف على Drive)
  // ================================================================
  function addDocumentRow(data) {
    data = data || {};
    var container = document.getElementById('clientDocumentsContainer');
    if (!container) return;
    var rowId = 'docRow_' + uidLocal();
    var docVisible = data.visible === 'نعم';
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.setAttribute('data-file-url', data.fileUrl || '');
    row.innerHTML =
      '<div class="repeat-row-title">مستند<button type="button" class="repeat-row-remove" onclick="ClientFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-group full"><label>اسم المستند</label><input type="text" class="cf-doc-name" value="' + safeAttr(data.name) + '" placeholder="بطاقة رقم قومي / عقد..."></div>' +
      '<div class="form-group full"><label>ظاهر للموكل ببوابته؟</label><select class="cf-doc-visible"><option value="لا"' + (!docVisible ? ' selected' : '') + '>لا</option><option value="نعم"' + (docVisible ? ' selected' : '') + '>نعم</option></select></div>' +
      '<div class="repeat-file-row">' +
        '<input type="file" class="cf-doc-file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onchange="ClientFields.uploadRowFile(this,\'' + rowId + '\',\'documents\')">' +
        '<span class="repeat-file-status' + (data.fileUrl ? ' ok' : '') + '">' + (data.fileUrl ? '&#10003; تم رفع الملف — <a href="' + safeAttr(data.fileUrl) + '" target="_blank">فتح</a>' : 'لم يُرفع ملف بعد') + '</span>' +
      '</div>';
    container.appendChild(row);
  }

  // ================================================================
  // صفوف متكررة — مديرو الشركة
  // ================================================================
  function addManagerRow(data) {
    data = data || {};
    var container = document.getElementById('clientManagersContainer');
    if (!container) return;
    var rowId = 'mgrRow_' + uidLocal();
    var idx = container.children.length + 1;
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.innerHTML =
      '<div class="repeat-row-title">اسم المدير ' + idx + '<button type="button" class="repeat-row-remove" onclick="ClientFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<input type="text" class="cf-manager-name" value="' + safeAttr(data.name) + '" placeholder="اسم المدير">';
    container.appendChild(row);
  }

  function removeRow(rowId) {
    var row = document.getElementById(rowId);
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  // ================================================================
  // رفع ملف (توكيل/مستند) إلى Drive — مجلد "توكيلات المكتب" أو
  // "مستندات الموكلين" حسب folderType، عبر ApiService.uploadFile
  // الموجودة بالفعل في js/api/api.js (كانت stub جاهزة على انتظار
  // وصلة الباك إند — راجع Config/03_Drive.gs و Config/06_Api.gs).
  // ================================================================
  function uploadRowFile(inputEl, rowId, folderType) {
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
      var clientName = (document.getElementById('fClientName') && document.getElementById('fClientName').value.trim()) || 'موكل';
      var fileName = clientName + ' - ' + file.name;

      if (!window.ApiService || typeof ApiService.uploadFile !== 'function') {
        if (statusEl) { statusEl.className = 'repeat-file-status err'; statusEl.textContent = '⚠️ خدمة الرفع غير متاحة حاليًا (اعمل أونلاين)'; }
        return;
      }

      ApiService.uploadFile(fileName, base64, file.type || 'application/octet-stream', '', folderType)
        .then(function (res) {
          if (res && res.ok && res.url) {
            row.setAttribute('data-file-url', res.url);
            if (statusEl) {
              statusEl.className = 'repeat-file-status ok';
              statusEl.innerHTML = '&#10003; تم رفع الملف — <a href="' + safeAttr(res.url) + '" target="_blank">فتح</a>';
            }
            if (typeof toast === 'function') toast('تم رفع الملف بنجاح', 'success');
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
  // تصفير/تعبئة/تجميع المجموعات المتكررة بالكامل
  // ================================================================
  function reset() {
    ['clientPhonesContainer', 'clientAddressesContainer', 'clientPowersContainer', 'clientDocumentsContainer', 'clientManagersContainer'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    addPhoneRow();
    addAddressRow();

    var typeEl = document.getElementById('fClientType');
    if (typeEl) typeEl.value = 'شخص طبيعي';
    toggleClientTypeSections();

    var acc = document.getElementById('fClientCreateAccount');
    if (acc) acc.value = 'لا';
    var box = document.getElementById('clientAccountInfoBox');
    if (box) box.style.display = 'none';
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
   * fill(record) — يُستدعى من editClient() بعد fillForm('clients', record)
   * لإعادة بناء كل الصفوف المتكررة + تفعيل قسم النوع الصحيح + عرض
   * بيانات حساب البوابة الحالية إن وُجدت.
   */
  function fill(record) {
    record = record || {};
    ['clientPhonesContainer', 'clientAddressesContainer', 'clientPowersContainer', 'clientDocumentsContainer', 'clientManagersContainer'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    var phones = parseArr(record['أرقام_الهواتف']);
    if (!phones.length && record['الهاتف']) phones = [{ type: 'موبايل', number: record['الهاتف'] }];
    phones.forEach(addPhoneRow);
    if (!phones.length) addPhoneRow();

    var addresses = parseArr(record['العناوين']);
    if (!addresses.length && record['العنوان']) addresses = [{ type: 'منزل', detail: record['العنوان'] }];
    addresses.forEach(addAddressRow);
    if (!addresses.length) addAddressRow();

    var powers = parseArr(record['التوكيلات']);
    if (!powers.length && record['رقم_التوكيل']) powers = [{ number: record['رقم_التوكيل'] }];
    powers.forEach(addPowerRow);

    parseArr(record['المستندات']).forEach(addDocumentRow);
    parseArr(record['المديرين']).forEach(addManagerRow);

    toggleClientTypeSections();

    var acc = document.getElementById('fClientCreateAccount');
    var hasAccount = record['حساب_مفعل'] === 'نعم' || record['اسم_المستخدم'];
    if (acc) acc.value = hasAccount ? 'نعم' : 'لا';
    var box = document.getElementById('clientAccountInfoBox');
    var userEl = document.getElementById('fClientAccountUser');
    var passEl = document.getElementById('fClientAccountPass');
    if (hasAccount && box) {
      box.style.display = '';
      if (userEl) userEl.value = record['اسم_المستخدم'] || '';
      if (passEl) passEl.value = record['كلمة_المرور'] || '';
    } else if (box) {
      box.style.display = 'none';
    }
  }

  /**
   * collect() — يُستدعى من saveClient() قبل الحفظ. يُرجع Object يُدمج
   * مباشرة داخل obj (نفس النمط المستخدم بالفعل لـ portal_token) —
   * أعمدة JSON إضافية بدون أي تأثير على الأعمدة القديمة.
   */
  function collect() {
    function rowsOf(containerId) {
      var container = document.getElementById(containerId);
      return container ? Array.prototype.slice.call(container.children) : [];
    }

    var phones = rowsOf('clientPhonesContainer').map(function (row) {
      var t = row.querySelector('.cf-phone-type');
      var n = row.querySelector('.cf-phone-number');
      return { type: t ? t.value : '', number: n ? n.value.trim() : '' };
    }).filter(function (p) { return p.number; });

    var addresses = rowsOf('clientAddressesContainer').map(function (row) {
      var t = row.querySelector('.cf-addr-type');
      var d = row.querySelector('.cf-addr-detail');
      return { type: t ? t.value : '', detail: d ? d.value.trim() : '' };
    }).filter(function (a) { return a.detail; });

    var powers = rowsOf('clientPowersContainer').map(function (row) {
      return {
        type: (row.querySelector('.cf-power-type') || {}).value || '',
        year: (row.querySelector('.cf-power-year') || {}).value || '',
        letter: (row.querySelector('.cf-power-letter') || {}).value || '',
        number: (row.querySelector('.cf-power-number') || {}).value || '',
        notaryOffice: (row.querySelector('.cf-power-notary') || {}).value || '',
        capacity: (row.querySelector('.cf-power-capacity') || {}).value || '',
        visible: (row.querySelector('.cf-power-visible') || {}).value || 'لا',
        fileUrl: row.getAttribute('data-file-url') || ''
      };
    // إصلاح: كان الشرط لا يتضمن fileUrl، فأي توكيل رُفع له ملف فقط بدون
    // كتابة رقم/نوع/مكتب توثيق كان يُستبعَد بالكامل صامتًا عند الحفظ
    // (لا الملف ولا أي أثر له يصل لأي مكان). راجع تقرير المحادثة.
    }).filter(function (p) { return p.number || p.type || p.notaryOffice || p.fileUrl; });

    var documents = rowsOf('clientDocumentsContainer').map(function (row) {
      return {
        name: (row.querySelector('.cf-doc-name') || {}).value || '',
        visible: (row.querySelector('.cf-doc-visible') || {}).value || 'لا',
        fileUrl: row.getAttribute('data-file-url') || ''
      };
    }).filter(function (d) { return d.name || d.fileUrl; });

    var managers = rowsOf('clientManagersContainer').map(function (row) {
      return { name: (row.querySelector('.cf-manager-name') || {}).value || '' };
    }).filter(function (m) { return m.name; });

    var out = {
      'أرقام_الهواتف': JSON.stringify(phones),
      'العناوين': JSON.stringify(addresses),
      'التوكيلات': JSON.stringify(powers),
      'المستندات': JSON.stringify(documents),
      'المديرين': JSON.stringify(managers)
    };

    // مزامنة الحقول القديمة المفردة (توافق خلفي — يقرأها كود آخر مثل
    // بوابة الموكل/تقرير الموكل/اختيار الموكل بالقضية) بأول عنصر.
    out['الهاتف'] = phones.length ? phones[0].number : '';
    out['العنوان'] = addresses.length ? addresses[0].detail : '';
    out['رقم_التوكيل'] = powers.length ? [powers[0].letter, powers[0].number, powers[0].year].filter(Boolean).join('/') : '';

    return out;
  }

  root.ClientFields = {
    PHONE_TYPES: PHONE_TYPES,
    ADDRESS_TYPES: ADDRESS_TYPES,
    POWER_CAPACITY: POWER_CAPACITY,
    addPhoneRow: addPhoneRow,
    addAddressRow: addAddressRow,
    addPowerRow: addPowerRow,
    addDocumentRow: addDocumentRow,
    addManagerRow: addManagerRow,
    removeRow: removeRow,
    uploadRowFile: uploadRowFile,
    reset: reset,
    fill: fill,
    collect: collect
  };

})(typeof window !== 'undefined' ? window : this);
