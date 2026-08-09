/**
 * ============================================================================
 * OfficeProfilePanel.js — js/office/OfficeProfilePanel.js
 * ----------------------------------------------------------------------------
 * "بيانات المكتب" Settings card — lets the office edit its own identity
 * data (office name, lawyer name, address, branches, phones, WhatsApp)
 * at any time, independently of the mandatory first-run screen
 * (js/office/OfficeSetupWizard.js). Both read/write the same data
 * through js/office/OfficeProfileService.js.
 *
 * Renders into the #officeProfilePanelMount element added to the
 * Settings page in index.html — same "plain mount point, all
 * logic/rendering lives in this file" convention as
 * js/license/LicenseManagerPanel.js / js/auth/UsersAdminPanel.js.
 *
 * 100% additive: defines exactly one new global, window.OfficeProfilePanel.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  function _fieldRow(id, label, value, placeholder, required) {
    return '<div class="form-group u-mb-11"><label>' + label +
      (required ? ' <span class="req">*</span>' : '') + '</label>' +
      '<input type="text" id="' + id + '" value="' +
      String(value || '').replace(/"/g, '&quot;') +
      '" placeholder="' + (placeholder || '') + '"></div>';
  }

  async function renderPanel() {
    var mount = document.getElementById('officeProfilePanelMount');
    if (!mount || !window.OfficeProfileService) return;

    if (typeof settingsRepositoryReadyPromise !== 'undefined') {
      try { await settingsRepositoryReadyPromise; } catch (e) {}
    }

    var profile = window.OfficeProfileService.getProfile() || window.OfficeProfileService.DEFAULTS;

    mount.innerHTML =
      '<p style="font-size:12px;color:var(--muted);margin-bottom:14px;">هذه البيانات تظهر بدلاً من البيانات الافتراضية في القائمة الجانبية، وبوابة الموكل، وتقارير الطباعة، وإشعارات البريد اليومية — لكل من يستخدم هذا البرنامج على أي جهاز.</p>' +
      '<div class="form-grid">' +
        _fieldRow('ofpPanelOfficeName', 'اسم المكتب', profile.officeName, 'مثال: مكتب [اسمك] للمحاماة والاستشارات القانونية', true) +
        _fieldRow('ofpPanelLawyerName', 'اسم المحامي / صاحب المكتب', profile.lawyerName, 'مثال: المستشار / [الاسم بالكامل]', true) +
        _fieldRow('ofpPanelAddress', 'عنوان المكتب', profile.address, 'اختياري', false) +
        _fieldRow('ofpPanelBranches', 'الفروع (إن وُجدت)', profile.branches, 'اختياري', false) +
        _fieldRow('ofpPanelPhones', 'أرقام الهواتف', profile.phones, 'اختياري', false) +
        _fieldRow('ofpPanelWhatsapp', 'رقم واتساب المكتب', profile.whatsapp, 'اختياري', false) +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:6px;">' +
        '<button type="button" class="btn btn-primary" id="ofpPanelSaveBtn">&#128190; حفظ بيانات المكتب</button>' +
        '<span id="ofpPanelResult" style="font-size:12px;"></span>' +
      '</div>';

    var saveBtn = document.getElementById('ofpPanelSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', onSaveClick);
  }

  async function onSaveClick() {
    var resultEl = document.getElementById('ofpPanelResult');
    var saveBtn = document.getElementById('ofpPanelSaveBtn');
    var get = function (id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    };

    var officeName = get('ofpPanelOfficeName').trim();
    var lawyerName = get('ofpPanelLawyerName').trim();
    if (!officeName || !lawyerName) {
      if (resultEl) resultEl.innerHTML = '<span style="color:var(--danger);">أدخل اسم المكتب واسم المحامي على الأقل</span>';
      return;
    }

    if (saveBtn) { saveBtn.disabled = true; }
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--muted);">&#9203; جارٍ الحفظ...</span>';

    try {
      await window.OfficeProfileService.saveProfile({
        officeName: officeName,
        lawyerName: lawyerName,
        address: get('ofpPanelAddress'),
        branches: get('ofpPanelBranches'),
        phones: get('ofpPanelPhones'),
        whatsapp: get('ofpPanelWhatsapp')
      });
      if (resultEl) resultEl.innerHTML = '<span style="color:var(--success);">&#10003; تم الحفظ بنجاح</span>';
      if (typeof toast === 'function') toast('تم حفظ بيانات المكتب', 'success');
      if (window.OfficeSetupWizard) window.OfficeSetupWizard.hide();
    } catch (e) {
      if (resultEl) resultEl.innerHTML = '<span style="color:var(--danger);">تعذر الحفظ — حاول مرة أخرى</span>';
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function init() {
    renderPanel();
  }

  window.OfficeProfilePanel = { init: init, render: renderPanel };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);
