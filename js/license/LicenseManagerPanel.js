/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/LicenseManagerPanel.js
 * ----------------------------------------------------------------------------
 * Component 6 "License Manager" of the licensing brief: the in-app
 * settings screen showing customer name, edition, status, expiry,
 * days remaining, Machine ID, plus "Update License" (re-open the
 * Activation Wizard — covers §21 License Transfer / §22 Device Reset
 * in this offline-manual-process build) and "Deactivate on this
 * device" actions.
 *
 * Renders into the #licenseManagerPanelMount element added to the
 * Settings page in index.html (Phase 30). Also owns the floating,
 * dismissible subscription banner (SubscriptionManager.js supplies the
 * copy; this file owns the DOM for it, per the project convention of
 * "one file per concern").
 *
 * 100% additive: defines exactly one new global, window.LicenseManagerPanel.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var STATE_LABELS_AR = {
    NOT_ACTIVATED: 'غير مفعّل',
    INVALID: 'غير صالح',
    ACTIVE: 'نشط',
    GRACE: 'فترة سماح',
    READ_ONLY: 'قراءة فقط'
  };

  var _bannerDismissedFor = null; // remembers the last-dismissed state so it doesn't reappear until the state actually changes

  function _fmtDate(iso) {
    if (!iso) return 'دائم — بلا تاريخ انتهاء';
    try { return new Date(iso).toLocaleDateString('ar-EG'); } catch (e) { return iso; }
  }

  async function renderPanel() {
    var mount = document.getElementById('licenseManagerPanelMount');
    if (!mount || !window.LicenseCore) return;

    var status = window.LicenseCore.getStatus();
    var info = status.info || {};
    var machineId = await window.MachineFingerprint.getMachineId();
    var stateLabel = STATE_LABELS_AR[status.state] || status.state;

    mount.innerHTML =
      '<dl class="lic-grid">' +
        '<dt>الحالة</dt><dd><span class="lic-badge ' + status.state + '">' + stateLabel + '</span></dd>' +
        '<dt>العميل</dt><dd>' + ((info.customer && info.customer.name) || '—') + '</dd>' +
        '<dt>نوع النسخة</dt><dd>' + (info.edition || '—') + '</dd>' +
        '<dt>معرّف الترخيص</dt><dd style="font-family:monospace;font-size:12px;">' + (info.licenseId || '—') + '</dd>' +
        '<dt>تاريخ الانتهاء</dt><dd>' + _fmtDate(info.expiresAt) + '</dd>' +
        '<dt>الأيام المتبقية</dt><dd>' + (info.daysRemaining !== undefined && info.daysRemaining !== null ? info.daysRemaining : '—') + '</dd>' +
        '<dt>معرّف الجهاز</dt><dd style="font-family:monospace;font-size:12px;">' + machineId + '</dd>' +
        '<dt>آخر تحقق أونلاين</dt><dd>' + (window.LicenseCore.getStoredRecordMeta() && window.LicenseCore.getStoredRecordMeta().lastOnlineCheck ? _fmtDate(window.LicenseCore.getStoredRecordMeta().lastOnlineCheck) : 'لم يتم بعد') + '</dd>' +
      '</dl>' +
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-primary" id="licUpdateLicenseBtn">تحديث / نقل الترخيص</button>' +
        '<button type="button" class="btn" id="licRecheckOnlineBtn">تحقق الآن عبر الإنترنت</button>' +
        // PHASE F.4-PREP-IMPL-B — additive only. Visible only when this
        // device has no stored installation credential yet (see
        // InstallationRegistrar.hasLocalCredential()) — i.e. exactly the
        // legacy/already-active installations this backfill affordance
        // targets. Hidden again the moment a credential exists, since
        // renderPanel() re-runs on every 'license:state' event.
        (window.InstallationRegistrar && !window.InstallationRegistrar.hasLocalCredential()
          ? '<button type="button" class="btn" id="licRegisterInstallBtn">تسجيل هذا التثبيت</button>'
          : '') +
      '</div>' +
      // PHASE F.4-PREP-IMPL-B — Activation-Code entry step for the
      // backfill registration affordance above. Hidden until the button
      // is clicked; reuses the exact same .lic-field/.lic-btn-primary/
      // .lic-btn-secondary/.lic-reg-note classes ActivationWizard.js
      // already defines in css/license.css, so no new CSS is introduced.
      '<div class="lic-field" id="licRegisterInstallStep" hidden style="margin-top:14px;max-width:360px;">' +
        '<label>كود التفعيل — لتسجيل هذا الجهاز على الخادم</label>' +
        '<input type="text" id="licRegisterInstallCodeInput" autocomplete="off">' +
        '<div style="display:flex;gap:8px;margin-top:8px;">' +
          '<button type="button" class="lic-btn-primary" id="licRegisterInstallSubmitBtn">تسجيل</button>' +
          '<button type="button" class="lic-btn-secondary" id="licRegisterInstallCancelBtn">إلغاء</button>' +
        '</div>' +
        '<div class="lic-reg-note" id="licRegisterInstallNote"></div>' +
      '</div>';

    var updateBtn = document.getElementById('licUpdateLicenseBtn');
    if (updateBtn) updateBtn.addEventListener('click', async function () {
      // BUGFIX (dangerous no-warning transfer): this used to open the
      // full-screen Activation Wizard immediately, with no warning and
      // no way back (the wizard had no cancel button — see
      // ActivationWizard.js). It never actually erased the stored
      // license (LicenseCore.activate() only overwrites the record
      // AFTER a new file verifies successfully), but visually it looked
      // exactly like the person had been logged out, since the overlay
      // covers the whole app. We now (1) ask for explicit confirmation
      // first via the project's standard confirmDialog(), and (2) open
      // the wizard in "dismissible" mode so it renders a Cancel button
      // the person can use to back out without entering anything.
      if (window.confirmDialog) {
        var ok = await window.confirmDialog(
          'ستنتقل إلى شاشة إدخال ترخيص جديد. ترخيصك الحالي يبقى فعالاً كما هو ولن يُستبدل إلا بعد إدخال ترخيص جديد صالح — ويمكنك إلغاء العملية والعودة دون أي تغيير.',
          'تحديث / نقل الترخيص'
        );
        if (!ok) return;
      }
      if (window.ActivationWizard) window.ActivationWizard.show({ dismissible: true });
    });

    var recheckBtn = document.getElementById('licRecheckOnlineBtn');
    if (recheckBtn) recheckBtn.addEventListener('click', async function () {
      recheckBtn.disabled = true;
      recheckBtn.textContent = 'جارٍ التحقق...';
      // BUGFIX (silent no-feedback button): the previous version called
      // checkNow() and threw away its return value, so the button simply
      // reset itself with zero evidence of what happened — indistinguishable
      // from a no-op whether the check succeeded, failed, or the device was
      // offline. We now surface the actual result to the person via the
      // project's standard toast() helper.
      var result = window.LicenseOnlineValidator
        ? await window.LicenseOnlineValidator.checkNow(true)
        : { checked: false, reason: 'module_unavailable' };
      recheckBtn.disabled = false;
      recheckBtn.textContent = 'تحقق الآن عبر الإنترنت';
      if (window.toast) window.toast(_recheckResultMessage(result), result.checked ? 'success' : 'error');
      renderPanel();
    });

    // PHASE F.4-PREP-IMPL-B — wiring for the backfill registration
    // affordance (button + inline activation-code step) added above.
    var registerInstallBtn = document.getElementById('licRegisterInstallBtn');
    if (registerInstallBtn) registerInstallBtn.addEventListener('click', function () {
      var step = document.getElementById('licRegisterInstallStep');
      if (step) step.removeAttribute('hidden');
      registerInstallBtn.setAttribute('hidden', 'hidden');
    });

    var registerInstallCancelBtn = document.getElementById('licRegisterInstallCancelBtn');
    if (registerInstallCancelBtn) registerInstallCancelBtn.addEventListener('click', function () {
      // Cancel: no register() call, no credential/license mutation — just
      // collapses the step back and restores the button, same convention
      // as ActivationWizard.js's own "تخطي والمتابعة"/Cancel handling.
      _resetRegisterInstallStep();
    });

    var registerInstallSubmitBtn = document.getElementById('licRegisterInstallSubmitBtn');
    if (registerInstallSubmitBtn) registerInstallSubmitBtn.addEventListener('click', onRegisterInstallSubmit);
  }

  /** Restores the backfill registration affordance to its collapsed,
   *  pre-attempt state (used by Cancel and by a failed attempt). The
   *  button only reappears if a credential still doesn't exist — if one
   *  now does (e.g. a call actually succeeded), it stays hidden. */
  function _resetRegisterInstallStep() {
    var step = document.getElementById('licRegisterInstallStep');
    var btn = document.getElementById('licRegisterInstallBtn');
    var input = document.getElementById('licRegisterInstallCodeInput');
    var note = document.getElementById('licRegisterInstallNote');
    var submitBtn = document.getElementById('licRegisterInstallSubmitBtn');
    var cancelBtn = document.getElementById('licRegisterInstallCancelBtn');
    if (step) step.setAttribute('hidden', 'hidden');
    if (btn && window.InstallationRegistrar && !window.InstallationRegistrar.hasLocalCredential()) btn.removeAttribute('hidden');
    if (input) input.value = '';
    if (note) note.textContent = '';
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }

  /**
   * PHASE F.4-PREP-IMPL-B — invokes the EXISTING, unmodified
   * InstallationRegistrar.register() (see js/license/InstallationRegistrar.js)
   * with this device's existing, authoritative license identity — the
   * same licenseId/machineId sourcing ActivationWizard.js's own
   * onRegisterClick() already uses. No new registration API, no new
   * credential storage, no license mutation.
   */
  async function onRegisterInstallSubmit() {
    var input = document.getElementById('licRegisterInstallCodeInput');
    var note = document.getElementById('licRegisterInstallNote');
    var submitBtn = document.getElementById('licRegisterInstallSubmitBtn');
    var cancelBtn = document.getElementById('licRegisterInstallCancelBtn');
    if (!input || !submitBtn || !cancelBtn) return;

    var code = (input.value || '').trim();
    if (!code) {
      if (note) note.textContent = 'أدخل كود التفعيل أولًا، أو اضغط «إلغاء».';
      return; // Requirement §7/Test B — empty code: no register() call at all.
    }

    if (!window.LicenseCore || !window.MachineFingerprint || !window.InstallationRegistrar) {
      if (note) note.textContent = 'تعذّر إتمام التسجيل — وحدة الترخيص غير متاحة في هذا الإصدار.';
      return; // Fail-Open, same convention as ActivationWizard.js.
    }

    // In-flight/double-submission guard (Test G): disabled synchronously,
    // before any async work — same convention used throughout this
    // project's other license/activation-code flows.
    submitBtn.disabled = true;
    cancelBtn.disabled = true;

    // Security requirement (mirrors ActivationWizard.js's onRegisterClick()
    // exactly): capture the code into a local var and clear the input
    // BEFORE the network call — never persisted, never re-read from the
    // DOM afterwards.
    input.value = '';

    var meta = window.LicenseCore.getStoredRecordMeta();
    var machineId = await window.MachineFingerprint.getMachineId();

    // register() is Fail-Open by design and returns no status (see
    // InstallationRegistrar.js) — its public contract exposes exactly one
    // observable success signal, hasLocalCredential(). This does not
    // distinguish *why* a failed attempt failed (invalid code, revoked
    // license, network error, etc.) without modifying that module, which
    // is out of scope for this phase — see this phase's report §H.
    var hadCredentialBefore = window.InstallationRegistrar.hasLocalCredential();

    try {
      await window.InstallationRegistrar.register({
        licenseId: meta && meta.licenseId,
        activationCode: code,
        machineId: machineId
      });
    } catch (e) {
      // register() is designed to never throw — final Fail-Open safety
      // net regardless, identical to ActivationWizard.js's own catch.
    }

    var succeeded = !hadCredentialBefore && window.InstallationRegistrar.hasLocalCredential();
    if (succeeded) {
      if (window.toast) window.toast('تم تسجيل هذا التثبيت بنجاح.', 'success');
      renderPanel(); // re-render: hasLocalCredential() is now true, so the affordance disappears (Test E/§13).
      return;
    }

    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    if (note) note.textContent = 'تعذّر تسجيل هذا التثبيت. تأكد من صحة كود التفعيل ومن وجود اتصال بالإنترنت، ثم حاول مرة أخرى.';
    if (window.toast) window.toast('تعذّر تسجيل هذا التثبيت.', 'error');
  }

  /** Maps a LicenseOnlineValidator.checkNow() result to an Arabic
   *  message so the "تحقق الآن عبر الإنترنت" button always gives the
   *  person clear, visible evidence of what happened. */
  function _recheckResultMessage(result) {
    if (result && result.checked) {
      var STATUS_AR = {
        active: 'تم التحقق بنجاح — الترخيص سارٍ.',
        revoked: 'تم التحقق: تبيّن أن الترخيص أُلغي من جهة الإصدار.',
        transferred: 'تم التحقق: تبيّن أن الترخيص نُقل إلى جهاز آخر.',
        // BUGFIX (misleading "unknown response" wording): 'unknown' is NOT
        // an error — it's the expected, normal result for the vast
        // majority of licenses (every license issued by the local CLI
        // generator and never manually entered into the "التراخيص" sheet
        // — see Config/09_License.gs apiCheckLicenseStatus(), which
        // explicitly returns status:'unknown' to mean "no revocation on
        // record", not "something went wrong"). The old copy
        // ("تم الاتصال بالخادم لكن ورد رد غير معروف") read as a server
        // error/malfunction even though the toast was styled green
        // (result.checked === true), confusing non-technical users into
        // thinking the check had failed. Reworded to state plainly that
        // verification succeeded and nothing is flagged.
        unknown: 'تم التحقق بنجاح — لا توجد أي حالة إلغاء أو نقل مسجّلة لهذا الترخيص لدى الخادم.'
      };
      return STATUS_AR[result.status] || 'تم التحقق بنجاح.';
    }
    var REASON_AR = {
      offline: 'لا يوجد اتصال بالإنترنت حالياً. حاول مرة أخرى عند الاتصال بالشبكة.',
      not_activated: 'لا يوجد ترخيص مُفعّل على هذا الجهاز للتحقق منه.',
      module_unavailable: 'خدمة التحقق عبر الإنترنت غير متاحة في هذا الإصدار.',
      network_error: 'تعذّر الوصول إلى خادم الترخيص. حاول مرة أخرى لاحقاً.',
      not_due: 'تم التحقق مؤخراً بالفعل.'
    };
    return (result && REASON_AR[result.reason]) || 'تعذّر إجراء التحقق. حاول مرة أخرى.';
  }

  // BUGFIX ("العلامة... اريدها متزامنة يوميا ويتغير لونها تدريجيا إلى
  // الأحمر"): SubscriptionManager.js now supplies a 0..1 `urgency` number
  // on the ACTIVE-state countdown banner (0 = 7+ days left, 1 = expiry
  // day) instead of a fixed 'info' color for the whole 2–30 day window.
  // This file already owns all banner DOM/styling per its own header
  // convention ("SubscriptionManager.js supplies the copy; this file owns
  // the DOM for it"), so the actual blue→red interpolation lives here, as
  // a plain inline-style override applied ONLY on top of the existing
  // '.lic-banner.info' CSS class (css/license.css, untouched) — never
  // touching the 'warning'/'danger' GRACE/READ_ONLY colors, which keep
  // their own fixed, already-correct styling.
  var _INFO_RGB = [41, 128, 185]; // css/license.css --info
  var _DANGER_RGB = [192, 57, 43]; // css/license.css --danger

  function _lerp(a, b, t) { return Math.round(a + (b - a) * t); }

  function _applyUrgencyColor(el, urgency) {
    var t = Math.max(0, Math.min(1, urgency || 0));
    var r = _lerp(_INFO_RGB[0], _DANGER_RGB[0], t);
    var g = _lerp(_INFO_RGB[1], _DANGER_RGB[1], t);
    var b = _lerp(_INFO_RGB[2], _DANGER_RGB[2], t);
    el.style.color = 'rgb(' + r + ',' + g + ',' + b + ')';
    el.style.background = 'rgba(' + r + ',' + g + ',' + b + ',0.12)';
    el.style.borderColor = 'rgba(' + r + ',' + g + ',' + b + ',0.35)';
  }

  function _clearUrgencyColor(el) {
    // Reverts to whatever css/license.css's '.lic-banner.<level>' class
    // already defines (warning/danger/plain info) — must run every time a
    // non-urgent or non-info banner renders, or a previous urgency color
    // would otherwise linger as an inline-style override.
    el.style.color = '';
    el.style.background = '';
    el.style.borderColor = '';
  }

  function _ensureBannerEl() {
    var el = document.getElementById('licSubscriptionBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'licSubscriptionBanner';
    el.className = 'lic-banner';
    el.setAttribute('hidden', 'hidden');
    el.innerHTML = '<span id="licBannerText"></span><button type="button" id="licBannerCloseBtn" aria-label="إغلاق">&times;</button>';
    document.body.appendChild(el);
    el.querySelector('#licBannerCloseBtn').addEventListener('click', function () {
      var status = window.LicenseCore.getStatus();
      _bannerDismissedFor = status ? status.state : null;
      el.setAttribute('hidden', 'hidden');
    });
    return el;
  }

  function renderBanner(evt) {
    var banner = evt && evt.detail;
    var el = _ensureBannerEl();
    var status = window.LicenseCore.getStatus();

    if (!banner) { el.setAttribute('hidden', 'hidden'); return; }
    if (_bannerDismissedFor === status.state && status.state !== 'READ_ONLY') {
      // READ_ONLY is never dismissible — it materially affects what the
      // person can do right now, so it must stay visible. Everything
      // else can be dismissed once per state.
      el.setAttribute('hidden', 'hidden');
      return;
    }

    el.className = 'lic-banner ' + banner.level;
    el.querySelector('#licBannerText').textContent = banner.text;
    if (banner.level === 'info' && typeof banner.urgency === 'number' && banner.urgency > 0) {
      _applyUrgencyColor(el, banner.urgency);
    } else {
      _clearUrgencyColor(el);
    }
    el.removeAttribute('hidden');
  }

  function init() {
    if (!window.LicenseCore) return;
    window.addEventListener('license:state', renderPanel);
    window.addEventListener('license:banner', renderBanner);
    renderPanel();
  }

  window.LicenseManagerPanel = { init: init, renderPanel: renderPanel };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : undefined);
