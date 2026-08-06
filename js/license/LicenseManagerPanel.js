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
    if (updateBtn) updateBtn.addEventListener('click', function () {
      if (window.ActivationWizard) window.ActivationWizard.show();
    });

    var recheckBtn = document.getElementById('licRecheckOnlineBtn');
    if (recheckBtn) recheckBtn.addEventListener('click', async function () {
      recheckBtn.disabled = true;
      recheckBtn.textContent = 'جارٍ التحقق...';
      if (window.LicenseOnlineValidator) await window.LicenseOnlineValidator.checkNow(true);
      recheckBtn.disabled = false;
      recheckBtn.textContent = 'تحقق الآن عبر الإنترنت';
      renderPanel();
    });
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
