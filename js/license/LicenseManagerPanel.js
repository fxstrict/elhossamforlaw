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
        unknown: 'تم الاتصال بالخادم لكن ورد رد غير معروف.'
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
