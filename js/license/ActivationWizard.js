/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/ActivationWizard.js
 * ----------------------------------------------------------------------------
 * Component 7 "Activation Wizard" + Component 8 "Offline Activation" of
 * the licensing brief. Full-screen overlay shown only while
 * LicenseCore's state is NOT_ACTIVATED or INVALID. Builds its own DOM
 * at runtime (matching the exact pattern already used by
 * SafeModeController.js elsewhere in this project) — it does NOT touch
 * index.html's markup beyond the one mount point + script tags added in
 * Phase 30 (see docs/phase30 for the exact index.html diff).
 *
 * Offline Activation flow (brief §8): shows the Machine ID, lets the
 * office send it to the vendor by any channel (WhatsApp/email/phone),
 * and lets the customer paste the resulting `.hsm` license text or
 * upload the file — no internet connection required at any point.
 *
 * 100% additive: defines exactly one new global, window.ActivationWizard.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var ERROR_MESSAGES = {
    malformed_file: 'ملف الترخيص غير صالح أو تالف. تأكد من نسخ/رفع الملف كاملاً.',
    malformed_json: 'الصيغة المدخلة ليست ترخيصًا صالحًا (JSON غير سليم).',
    malformed_payload: 'ملف الترخيص ناقص بيانات أساسية.',
    crypto_unavailable: 'المتصفح لا يدعم التحقق الرقمي المطلوب. الرجاء استخدام متصفح حديث.',
    invalid_signature: 'توقيع الترخيص غير صحيح — هذا الملف لم يصدر من نظام الحسام الرسمي.',
    machine_mismatch: 'هذا الترخيص صادر لجهاز آخر. يرجى إرسال معرّف هذا الجهاز (Machine ID) للحصول على ترخيص جديد أو نقل الترخيص.'
  };

  var _mounted = false;
  var _dismissible = false; // true only when opened voluntarily via "تحديث / نقل الترخيص" while a license already exists — see show()
  var els = {};

  function build() {
    var overlay = document.createElement('div');
    overlay.className = 'lic-activation-overlay';
    overlay.id = 'licActivationOverlay';
    overlay.setAttribute('hidden', 'hidden');
    overlay.innerHTML =
      '<div class="lic-card" role="dialog" aria-modal="true" aria-labelledby="licTitle">' +
        '<h2 id="licTitle">تفعيل نظام الحسام للمحاماة</h2>' +
        '<p class="lic-sub">هذا الجهاز يحتاج إلى ملف ترخيص صالح قبل المتابعة.</p>' +
        '<div class="lic-field">' +
          '<label>معرّف هذا الجهاز (Machine ID) — أرسله لجهة الترخيص</label>' +
          '<div class="lic-machine-id"><span id="licMachineIdText">...</span><button type="button" id="licCopyBtn">نسخ</button></div>' +
        '</div>' +
        '<div class="lic-field">' +
          '<label>ألصق محتوى ملف الترخيص هنا</label>' +
          '<textarea class="lic-textarea" id="licTextarea" placeholder="{ &quot;v&quot;: 1, &quot;payload&quot;: { ... }, &quot;signature&quot;: &quot;...&quot; }"></textarea>' +
          '<div class="lic-file-row">' +
            '<input type="file" id="licFileInput" accept=".hsm,.json,.txt" />' +
          '</div>' +
        '</div>' +
        '<button type="button" class="lic-btn-primary" id="licActivateBtn">تفعيل</button>' +
        // BUGFIX (no way back): previously this overlay had only the
        // "تفعيل" button — someone who opened it via "تحديث / نقل
        // الترخيص" and changed their mind had no way to close it and
        // return to the app (it's a full-screen, z-index:99999 overlay).
        // This Cancel button is hidden by CSS default and only revealed
        // by show({dismissible:true}) — i.e. never during a mandatory
        // NOT_ACTIVATED/INVALID activation, where there is nothing to
        // cancel back to.
        '<button type="button" class="lic-btn-secondary" id="licCancelBtn" hidden>إلغاء والعودة</button>' +
        '<div class="lic-error" id="licErrorBox"></div>' +
        '<p class="lic-footer-note">النظام يعمل بدون إنترنت بالكامل بعد التفعيل. لا حاجة لاتصال دائم بالشبكة.</p>' +
      '</div>';
    document.body.appendChild(overlay);

    els.overlay = overlay;
    els.machineIdText = overlay.querySelector('#licMachineIdText');
    els.copyBtn = overlay.querySelector('#licCopyBtn');
    els.textarea = overlay.querySelector('#licTextarea');
    els.fileInput = overlay.querySelector('#licFileInput');
    els.activateBtn = overlay.querySelector('#licActivateBtn');
    els.cancelBtn = overlay.querySelector('#licCancelBtn');
    els.errorBox = overlay.querySelector('#licErrorBox');

    els.copyBtn.addEventListener('click', function () {
      var text = els.machineIdText.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
      }
      els.copyBtn.textContent = 'تم النسخ';
      window.setTimeout(function () { els.copyBtn.textContent = 'نسخ'; }, 1500);
    });

    els.fileInput.addEventListener('change', function () {
      var file = els.fileInput.files && els.fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { els.textarea.value = String(reader.result || ''); };
      reader.readAsText(file);
    });

    els.activateBtn.addEventListener('click', onActivateClick);
    els.cancelBtn.addEventListener('click', function () {
      if (!_dismissible) return; // defensive: hidden+inert when not dismissible, but never act on it either way
      hide();
    });

    _mounted = true;
  }

  function showError(reasonCode) {
    els.errorBox.textContent = ERROR_MESSAGES[reasonCode] || 'تعذّر التفعيل. تحقق من ملف الترخيص وحاول مرة أخرى.';
    els.errorBox.classList.add('show');
  }

  function clearError() {
    els.errorBox.classList.remove('show');
    els.errorBox.textContent = '';
  }

  async function onActivateClick() {
    clearError();
    var raw = (els.textarea.value || '').trim();
    if (!raw) { showError('malformed_json'); return; }

    els.activateBtn.disabled = true;
    els.activateBtn.textContent = 'جارٍ التحقق...';

    var result = await window.LicenseCore.activate(raw);

    els.activateBtn.disabled = false;
    els.activateBtn.textContent = 'تفعيل';

    if (!result.ok) {
      showError(result.reason);
      return;
    }
    hide();
  }

  async function refreshMachineId() {
    if (!_mounted) return;
    var id = await window.MachineFingerprint.getMachineId();
    els.machineIdText.textContent = id;
  }

  /**
   * @param {Object} [options]
   * @param {boolean} [options.dismissible=false] When true, shows the
   *   "إلغاء والعودة" Cancel button so the person can close the wizard
   *   without entering a license (used only for the voluntary "تحديث /
   *   نقل الترخيص" flow, where a valid license already exists and
   *   nothing is lost by backing out). Left false — the default — for
   *   the mandatory NOT_ACTIVATED/INVALID flow driven by
   *   onLicenseState(), where there is no existing license to return to.
   */
  function show(options) {
    if (!_mounted) build();
    _dismissible = !!(options && options.dismissible);
    if (els.cancelBtn) els.cancelBtn.hidden = !_dismissible;
    clearError();
    refreshMachineId();
    els.overlay.removeAttribute('hidden');
  }

  function hide() {
    if (!_mounted) return;
    els.overlay.setAttribute('hidden', 'hidden');
    // Reset transient input so a future open (mandatory or voluntary)
    // never shows stale text/errors left over from a cancelled attempt.
    if (els.textarea) els.textarea.value = '';
    clearError();
  }

  /** Reacts to license:state events dispatched by LicenseCore. */
  function onLicenseState(evt) {
    var state = evt && evt.detail && evt.detail.state;
    var States = window.LicenseCore.States;
    if (state === States.NOT_ACTIVATED || state === States.INVALID) {
      show();
    } else {
      hide();
    }
  }

  function init() {
    if (!window.LicenseCore) return;
    window.addEventListener('license:state', onLicenseState);
    // Evaluate current (already-initialized) state immediately in case
    // LicenseCore.init() resolved before this listener was attached.
    var status = window.LicenseCore.getStatus();
    if (status) onLicenseState({ detail: status });
  }

  window.ActivationWizard = { init: init, show: show, hide: hide };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : undefined);
