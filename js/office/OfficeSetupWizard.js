/**
 * ============================================================================
 * OfficeSetupWizard.js — js/office/OfficeSetupWizard.js
 * ----------------------------------------------------------------------------
 * Full-screen, mandatory "بيانات المكتب" (office data) overlay, shown
 * exactly once per installation: after the license is confirmed valid
 * (LicenseCore state ACTIVE/GRACE/READ_ONLY — see js/license/LicenseCore.js)
 * and before the office has entered its own office name / lawyer name
 * (see js/office/OfficeProfileService.js `isConfigured()`). This is
 * deliberately placed BEFORE any client/case data entry screen — the
 * overlay blocks the entire app underneath it, exactly like
 * js/license/ActivationWizard.js already does for the license gate.
 *
 * Once the office saves its data here, `isConfigured()` becomes true and
 * this overlay never appears again automatically — the same data can
 * still be edited any time afterwards from Settings → "بيانات المكتب"
 * (js/office/OfficeProfilePanel.js).
 *
 * 100% additive: defines exactly one new global, window.OfficeSetupWizard.
 * Builds its own DOM at runtime (same pattern as ActivationWizard.js) —
 * does not touch index.html's markup beyond the one mount point/script
 * tag. Reuses the existing css/license.css classes (.lic-activation-overlay,
 * .lic-card, .lic-field, .lic-btn-primary) — no new stylesheet needed.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var _mounted = false;
  var els = {};

  function build() {
    var overlay = document.createElement('div');
    // Reuses the exact same overlay/card/field/button classes as
    // js/license/ActivationWizard.js (css/license.css) — same visual
    // language, no new CSS file. Only one of the two overlays is ever
    // shown at a time in practice (this one only appears once LicenseCore
    // has already left NOT_ACTIVATED/INVALID, at which point
    // ActivationWizard has already hidden itself).
    overlay.className = 'lic-activation-overlay';
    overlay.id = 'officeSetupOverlay';
    overlay.setAttribute('hidden', 'hidden');
    overlay.innerHTML =
      '<div class="lic-card" role="dialog" aria-modal="true" aria-labelledby="ofpTitle">' +
        '<h2 id="ofpTitle">بيانات المكتب</h2>' +
        '<p class="lic-sub">قبل البدء بإضافة الموكلين والقضايا، أدخل بيانات مكتبك — ستظهر هذه البيانات بدلاً من البيانات الافتراضية في القائمة الجانبية وبوابة الموكل وكل تقارير الطباعة. يمكنك تعديلها لاحقاً في أي وقت من الإعدادات.</p>' +
        '<div class="lic-field">' +
          '<label>اسم المكتب <span style="color:var(--danger, #c0392b)">*</span></label>' +
          '<input type="text" id="ofpOfficeName" placeholder="مثال: مكتب [اسمك] للمحاماة والاستشارات القانونية">' +
        '</div>' +
        '<div class="lic-field">' +
          '<label>اسم المحامي / صاحب المكتب <span style="color:var(--danger, #c0392b)">*</span></label>' +
          '<input type="text" id="ofpLawyerName" placeholder="مثال: المستشار / [الاسم بالكامل]">' +
        '</div>' +
        '<div class="lic-field">' +
          '<label>عنوان المكتب</label>' +
          '<input type="text" id="ofpAddress" placeholder="اختياري">' +
        '</div>' +
        '<div class="lic-field">' +
          '<label>الفروع (إن وُجدت)</label>' +
          '<input type="text" id="ofpBranches" placeholder="اختياري — مثال: فرع القاهرة، فرع الإسكندرية">' +
        '</div>' +
        '<div class="lic-field">' +
          '<label>أرقام الهواتف</label>' +
          '<input type="text" id="ofpPhones" placeholder="اختياري">' +
        '</div>' +
        '<div class="lic-field">' +
          '<label>رقم واتساب المكتب</label>' +
          '<input type="text" id="ofpWhatsapp" placeholder="اختياري">' +
        '</div>' +
        '<button type="button" class="lic-btn-primary" id="ofpSaveBtn">حفظ ومتابعة</button>' +
        '<div class="lic-error" id="ofpErrorBox"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    els.overlay = overlay;
    els.officeName = overlay.querySelector('#ofpOfficeName');
    els.lawyerName = overlay.querySelector('#ofpLawyerName');
    els.address = overlay.querySelector('#ofpAddress');
    els.branches = overlay.querySelector('#ofpBranches');
    els.phones = overlay.querySelector('#ofpPhones');
    els.whatsapp = overlay.querySelector('#ofpWhatsapp');
    els.saveBtn = overlay.querySelector('#ofpSaveBtn');
    els.errorBox = overlay.querySelector('#ofpErrorBox');

    els.saveBtn.addEventListener('click', onSaveClick);

    _mounted = true;
  }

  function showError(message) {
    els.errorBox.textContent = message;
    els.errorBox.classList.add('show');
  }

  function clearError() {
    els.errorBox.classList.remove('show');
    els.errorBox.textContent = '';
  }

  async function onSaveClick() {
    clearError();
    var officeName = (els.officeName.value || '').trim();
    var lawyerName = (els.lawyerName.value || '').trim();
    if (!officeName || !lawyerName) {
      showError('يرجى إدخال اسم المكتب واسم المحامي على الأقل.');
      return;
    }

    els.saveBtn.disabled = true;
    els.saveBtn.textContent = 'جارٍ الحفظ...';

    try {
      await window.OfficeProfileService.saveProfile({
        officeName: officeName,
        lawyerName: lawyerName,
        address: els.address.value,
        branches: els.branches.value,
        phones: els.phones.value,
        whatsapp: els.whatsapp.value
      });
      hide();
      if (typeof toast === 'function') {
        toast('تم حفظ بيانات المكتب بنجاح', 'success');
      }
    } catch (e) {
      showError('تعذر حفظ البيانات. حاول مرة أخرى.');
    } finally {
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = 'حفظ ومتابعة';
    }
  }

  function show() {
    if (!_mounted) build();
    clearError();
    els.officeName.value = '';
    els.lawyerName.value = '';
    els.address.value = '';
    els.branches.value = '';
    els.phones.value = '';
    els.whatsapp.value = '';
    els.overlay.removeAttribute('hidden');
  }

  function hide() {
    if (!_mounted) return;
    els.overlay.setAttribute('hidden', 'hidden');
  }

  /**
   * Re-evaluates whether the mandatory screen should be visible right
   * now: only once a valid license state is confirmed AND the office
   * has not yet entered its data. Safe to call repeatedly/idempotently
   * (mirrors ActivationWizard.js's onLicenseState()).
   */
  async function _evaluate() {
    if (!window.OfficeProfileService) return;
    if (typeof settingsRepositoryReadyPromise !== 'undefined') {
      try { await settingsRepositoryReadyPromise; } catch (e) {}
    }
    if (window.OfficeProfileService.isConfigured()) {
      hide();
      return;
    }
    show();
  }

  var LICENSED_STATES = { ACTIVE: 1, GRACE: 1, READ_ONLY: 1 };

  /** Reacts to license:state events dispatched by LicenseCore. */
  function onLicenseState(evt) {
    var state = evt && evt.detail && evt.detail.state;
    if (LICENSED_STATES[state]) {
      _evaluate();
    } else {
      // Not yet licensed (NOT_ACTIVATED/INVALID) — ActivationWizard.js
      // already owns blocking the app in this case; nothing to show here.
      hide();
    }
  }

  function init() {
    if (!window.LicenseCore) return;
    window.addEventListener('license:state', onLicenseState);
    // Evaluate current (already-initialized) state immediately in case
    // LicenseCore.init() resolved before this listener was attached —
    // same defensive pattern as ActivationWizard.js's init().
    var status = window.LicenseCore.getStatus();
    if (status) onLicenseState({ detail: status });
  }

  window.OfficeSetupWizard = { init: init, show: show, hide: hide };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : undefined);
