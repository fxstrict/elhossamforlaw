/**
 * ================================================================
 * js/modules/opponent-fields.js — بيانات الخصم الموسّعة | نظام الحسام
 * ================================================================
 * PHASE 37 — Opponents Module
 *
 * إضافة جديدة كليًا (additive) — لا تُعدّل أي دالة موجودة في
 * js/modules/client-fields.js أو js/modules/clients.js. يستدعيها
 * js/modules/opponents.js (OpponentFields.*) من داخل
 * saveOpponent()/editOpponent()، بنفس النمط الحرفي المستخدم بالفعل
 * لـ ClientFields في client-fields.js — لكن مُبسَّط ليطابق حقول نافذة
 * "إضافة خصم جديد" فقط (بدون تبويبات شركة/توكيلات/مستندات/مديرين،
 * غير الموجودة في نموذج الخصم).
 *
 * الغرض: دعم الحقول المتكررة لبيانات الخصم (أرقام هواتف متعددة،
 * عناوين متعددة) دون كسر توافق نظام collectForm/fillForm العام
 * (FIELDS/MAP في index.html) الذي يتعامل فقط مع حقول قيمة-واحدة.
 *
 * التخزين: كل مجموعة متكررة تُخزَّن كنص JSON في عمود واحد إضافي بصف
 * الخصم (متوافق 100% مع Google Sheets): أرقام_الهواتف / العناوين.
 * أي خصم قديم لا يملك هذه الأعمدة يُعامَل بأمان كمصفوفة فارغة.
 * ================================================================
 */
(function (root) {
  'use strict';

  var PHONE_TYPES   = ['موبايل', 'منزل', 'عمل', 'فاكس'];
  var ADDRESS_TYPES = ['منزل', 'عمل', 'آخر'];

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
  // صفوف متكررة — أرقام الهواتف
  // ================================================================
  function addPhoneRow(data) {
    data = data || {};
    var container = document.getElementById('opponentPhonesContainer');
    if (!container) return;
    var rowId = 'oppPhoneRow_' + uidLocal();
    var typeOptions = PHONE_TYPES.map(function (t) {
      return '<option' + (data.type === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.innerHTML =
      '<div class="repeat-row-title">هاتف<button type="button" class="repeat-row-remove" onclick="OpponentFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>نوع الهاتف</label><select class="of-phone-type">' + typeOptions + '</select></div>' +
        '<div class="form-group"><label>رقم الهاتف</label><input type="text" class="of-phone-number" value="' + safeAttr(data.number) + '" placeholder="رقم الهاتف"></div>' +
      '</div>';
    container.appendChild(row);
  }

  // ================================================================
  // صفوف متكررة — العناوين
  // ================================================================
  function addAddressRow(data) {
    data = data || {};
    var container = document.getElementById('opponentAddressesContainer');
    if (!container) return;
    var rowId = 'oppAddrRow_' + uidLocal();
    var typeOptions = ADDRESS_TYPES.map(function (t) {
      return '<option' + (data.type === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.id = rowId;
    row.innerHTML =
      '<div class="repeat-row-title">عنوان<button type="button" class="repeat-row-remove" onclick="OpponentFields.removeRow(\'' + rowId + '\')" title="حذف">&times;</button></div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>نوع العنوان</label><select class="of-addr-type">' + typeOptions + '</select></div>' +
        '<div class="form-group"><label>العنوان</label><input type="text" class="of-addr-detail" value="' + safeAttr(data.detail) + '" placeholder="العنوان"></div>' +
      '</div>';
    container.appendChild(row);
  }

  function removeRow(rowId) {
    var row = document.getElementById(rowId);
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  // ================================================================
  // تصفير/تعبئة/تجميع المجموعتين المتكررتين
  // ================================================================
  function reset() {
    ['opponentPhonesContainer', 'opponentAddressesContainer'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    addPhoneRow();
    addAddressRow();

    var typeEl = document.getElementById('fOpponentType');
    if (typeEl) typeEl.value = 'شخص طبيعي';
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
   * fill(record) — يُستدعى من editOpponent() بعد fillForm('opponents', record)
   * لإعادة بناء صفوف الهواتف/العناوين المتكررة من بيانات الخصم الحالية.
   */
  function fill(record) {
    record = record || {};
    ['opponentPhonesContainer', 'opponentAddressesContainer'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    var phones = parseArr(record['أرقام_الهواتف']);
    phones.forEach(addPhoneRow);
    if (!phones.length) addPhoneRow();

    var addresses = parseArr(record['العناوين']);
    addresses.forEach(addAddressRow);
    if (!addresses.length) addAddressRow();
  }

  /**
   * collect() — يُستدعى من saveOpponent() قبل الحفظ. يُرجع Object يُدمج
   * مباشرة داخل obj — أعمدة JSON إضافية بدون أي تأثير على أي عمود آخر.
   */
  function collect() {
    function rowsOf(containerId) {
      var container = document.getElementById(containerId);
      return container ? Array.prototype.slice.call(container.children) : [];
    }

    var phones = rowsOf('opponentPhonesContainer').map(function (row) {
      var t = row.querySelector('.of-phone-type');
      var n = row.querySelector('.of-phone-number');
      return { type: t ? t.value : '', number: n ? n.value.trim() : '' };
    }).filter(function (p) { return p.number; });

    var addresses = rowsOf('opponentAddressesContainer').map(function (row) {
      var t = row.querySelector('.of-addr-type');
      var d = row.querySelector('.of-addr-detail');
      return { type: t ? t.value : '', detail: d ? d.value.trim() : '' };
    }).filter(function (a) { return a.detail; });

    var out = {
      'أرقام_الهواتف': JSON.stringify(phones),
      'العناوين': JSON.stringify(addresses)
    };

    return out;
  }

  root.OpponentFields = {
    PHONE_TYPES: PHONE_TYPES,
    ADDRESS_TYPES: ADDRESS_TYPES,
    addPhoneRow: addPhoneRow,
    addAddressRow: addAddressRow,
    removeRow: removeRow,
    reset: reset,
    fill: fill,
    collect: collect
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OpponentFields: root.OpponentFields };
  }

})(typeof window !== 'undefined' ? window : this);
