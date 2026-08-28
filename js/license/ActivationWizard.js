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
 *
 * UPDATE — First-run activation UX: added a short 3-step explanation
 * and a one-tap "Request free trial via WhatsApp" button that opens
 * wa.me with the current Machine ID pre-filled in the message. Purely
 * additive markup inside the existing .lic-card; no existing element,
 * id, or event listener was removed or renamed, and no fixed/sticky/
 * filter/backdrop-filter/transform was introduced (mobile-rendering-
 * compositing-safety-audit reviewed: safe).
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

  // ACTIVATION UX IMPROVEMENT — one-tap WhatsApp trial request.
  // Purely additive: a mailto/wa.me-style link built from the existing
  // Machine ID text; does not touch the crypto/activation logic at all.
  var WHATSAPP_NUMBER = '201016000360'; // مصر — بدون + وبدون صفر البداية، كما يتطلب رابط wa.me

  function buildWhatsAppUrl(machineId) {
    var msg =
      'مرحبًا، أطلب تفعيل تجريبي مجاني لنظام الحسام للمحاماة.\n' +
      'معرّف الجهاز (Machine ID): ' + machineId + '\n' +
      'برجاء إرسال ترخيص تجريبي لهذا الجهاز.';
    return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(msg);
  }

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
        '<ol class="lic-steps">' +
          '<li>انسخ معرّف الجهاز (Machine ID) الظاهر أدناه.</li>' +
          '<li>اضغط زر واتساب الأخضر لإرساله مباشرة — سيصلك ترخيص تجريبي مجاني للتجربة.</li>' +
          '<li>الصق محتوى ملف الترخيص الذي سيصلك في الحقل بالأسفل، ثم اضغط «تفعيل».</li>' +
        '</ol>' +
        '<div class="lic-field">' +
          '<label>معرّف هذا الجهاز (Machine ID) — أرسله لجهة الترخيص</label>' +
          '<div class="lic-machine-id"><span id="licMachineIdText">...</span><button type="button" id="licCopyBtn">نسخ</button></div>' +
          '<a href="#" target="_blank" rel="noopener noreferrer" class="lic-whatsapp-btn" id="licWhatsAppBtn" aria-label="طلب تفعيل تجريبي مجاني عبر واتساب">' +
            '<svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16 3C9.373 3 4 8.373 4 15c0 2.34.664 4.523 1.814 6.377L4 29l7.823-1.78A11.94 11.94 0 0 0 16 27c6.627 0 12-5.373 12-12S22.627 3 16 3zm0 21.6c-1.9 0-3.68-.55-5.18-1.5l-.37-.22-4.02.91.87-3.93-.24-.4A9.56 9.56 0 0 1 5.4 15C5.4 9.15 10.15 4.4 16 4.4S26.6 9.15 26.6 15 21.85 24.6 16 24.6zm5.3-7.02c-.29-.15-1.72-.85-1.99-.95-.27-.1-.46-.15-.65.15-.19.29-.75.95-.92 1.14-.17.19-.34.22-.63.07-.29-.15-1.23-.45-2.34-1.44-.86-.77-1.45-1.72-1.62-2.01-.17-.29-.02-.44.13-.59.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.15-.65-1.56-.89-2.14-.23-.56-.47-.48-.65-.49-.17-.01-.36-.01-.55-.01-.19 0-.51.07-.77.36-.27.29-1.01.99-1.01 2.41 0 1.42 1.03 2.79 1.18 2.98.15.19 2.03 3.1 4.93 4.35.69.3 1.23.48 1.65.61.69.22 1.32.19 1.82.11.55-.08 1.72-.7 1.96-1.38.24-.68.24-1.26.17-1.38-.07-.12-.26-.19-.55-.34z"/></svg>' +
            '<span>طلب تفعيل تجريبي مجاني عبر واتساب</span>' +
          '</a>' +
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
    els.whatsAppBtn = overlay.querySelector('#licWhatsAppBtn');
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
    if (els.whatsAppBtn) els.whatsAppBtn.setAttribute('href', buildWhatsAppUrl(id));
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
