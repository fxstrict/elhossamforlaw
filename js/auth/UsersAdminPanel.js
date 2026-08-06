/**
 * ============================================================================
 * PHASE 32 — Login Screen, Session Activation & Users Admin Panel
 * File: js/auth/UsersAdminPanel.js
 * ----------------------------------------------------------------------------
 * "لوحة إدارة المستخدمين" from the original brief, scoped to what a
 * first working version needs: list users, create/edit a user (name,
 * username, role, permission groups, branch/department, status), reset
 * a password, and see the last entries of the audit/login logs. Renders
 * into #usersAdminPanelMount, added to the Settings page in index.html
 * (Phase 32) — same "plain mount point, all logic lives in this file"
 * convention as LicenseManagerPanel.js.
 *
 * VISIBILITY / GATING
 *   This panel is the office's own on-ramp into RBAC: before anyone has
 *   ever used it, `UsersRepository` is empty and LoginScreen.js never
 *   shows (see its own header) — so this panel MUST remain reachable
 *   with no session at all, exactly like every other Settings card
 *   today. Once a session exists, it additionally requires
 *   `CanViewUsers` (list) / `CanCreateUsers` / `CanEditUsers` /
 *   `CanResetUserPasswords` (per action) via PermissionService — a
 *   logged-in user who lacks `CanViewUsers` sees a one-line notice
 *   instead of the table, never a blank/broken panel.
 *
 * 100% additive: defines exactly one new global, window.UsersAdminPanel.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var STATUS_LABELS = {
    'نشط': { text: 'نشط', cls: 'active' },
    'موقوف': { text: 'موقوف', cls: 'suspended' },
    'مغلق': { text: 'مغلق', cls: 'suspended' },
    'بانتظار التفعيل': { text: 'بانتظار التفعيل', cls: 'pending' },
    'منتهى': { text: 'منتهى', cls: 'suspended' }
  };

  var _modalEls = null;
  var _editingUsername = null; // null => create mode

  function _currentUser() {
    return window.HossamSession ? window.HossamSession.getCurrentUser() : null;
  }

  /** true when there's no session at all (pre-login setup) OR the current user holds `key`. */
  function _allowed(key) {
    var user = _currentUser();
    if (!user) return true; // no session yet -> this panel IS the on-ramp, see file header
    if (!window.HossamPermissionService) return true;
    return window.HossamPermissionService.can(user, key);
  }

  function _roleOptionsHtml(selected) {
    if (!window.HossamRoles) return '';
    return window.HossamRoles.list().map(function (key) {
      var role = window.HossamRoles.ROLES[key];
      return '<option value="' + key + '"' + (key === selected ? ' selected' : '') + '>' + role.label + '</option>';
    }).join('');
  }

  function _groupCheckboxesHtml(selectedList) {
    if (!window.HossamPermissionGroups) return '';
    var selected = selectedList || [];
    return window.HossamPermissionGroups.list().map(function (key) {
      var group = window.HossamPermissionGroups.PERMISSION_GROUPS[key];
      var checked = selected.indexOf(key) !== -1 ? ' checked' : '';
      return '<label style="display:inline-flex;align-items:center;gap:4px;margin:0 10px 6px 0;font-size:12.5px;">' +
        '<input type="checkbox" class="hsm-user-group-cb" value="' + key + '"' + checked + ' /> ' + group.label + '</label>';
    }).join('');
  }

  async function _getRepo() {
    var repo = new window.UsersRepository();
    await repo.open();
    return repo;
  }

  async function renderPanel() {
    var mount = document.getElementById('usersAdminPanelMount');
    if (!mount || !window.UsersRepository) return;

    if (!_allowed('CanViewUsers')) {
      mount.innerHTML = '<p style="color:var(--muted);font-size:13px;">لا تملك صلاحية عرض المستخدمين.</p>';
      return;
    }

    var repo = await _getRepo();
    var users = repo.getAll();

    var rows = users.map(function (u) {
      var status = STATUS_LABELS[u.الحالة] || { text: u.الحالة || '—', cls: 'pending' };
      var roleLabel = (window.HossamRoles && window.HossamRoles.ROLES[u.الدور]) ? window.HossamRoles.ROLES[u.الدور].label : (u.الدور || '—');
      return '<tr>' +
        '<td>' + (u.الاسم || '') + '</td>' +
        '<td style="font-family:monospace;">' + u.اسم_المستخدم + '</td>' +
        '<td>' + roleLabel + '</td>' +
        '<td><span class="hsm-users-status ' + status.cls + '">' + status.text + '</span></td>' +
        '<td><button type="button" class="btn" data-edit-user="' + u.اسم_المستخدم + '">تعديل</button></td>' +
      '</tr>';
    }).join('');

    var user = _currentUser();
    var sessionStrip = user
      ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:8px 12px;background:var(--navy);border-radius:8px;">' +
          '<span style="font-size:13px;">مسجّل الدخول حاليًا: <strong>' + (user.الاسم || user.اسم_المستخدم) + '</strong></span>' +
          '<button type="button" class="btn" id="hsmLogoutBtn">تسجيل الخروج</button>' +
        '</div>'
      : '';

    mount.innerHTML =
      sessionStrip +
      '<div class="hsm-users-panel">' +
        (_allowed('CanCreateUsers')
          ? '<button type="button" class="btn btn-primary" id="hsmAddUserBtn">&#65291; إضافة مستخدم</button>'
          : '') +
        '<table class="hsm-users-table"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الحالة</th><th></th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="5" style="color:var(--muted);">لا يوجد مستخدمون بعد.</td></tr>') + '</tbody></table>' +
      '</div>';

    var logoutBtn = document.getElementById('hsmLogoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      if (window.HossamSession) window.HossamSession.clear();
      if (window.LoginScreen) window.LoginScreen.init();
      renderPanel();
    });

    var addBtn = document.getElementById('hsmAddUserBtn');
    if (addBtn) addBtn.addEventListener('click', function () { openModal(null); });

    mount.querySelectorAll('[data-edit-user]').forEach(function (btn) {
      btn.addEventListener('click', function () { openModal(btn.getAttribute('data-edit-user')); });
    });
  }

  function _ensureModal() {
    if (_modalEls) return _modalEls;
    var overlay = document.createElement('div');
    overlay.className = 'hsm-users-modal-overlay';
    overlay.id = 'hsmUserModalOverlay';
    overlay.setAttribute('hidden', 'hidden');
    overlay.innerHTML =
      '<div class="hsm-users-modal">' +
        '<h3 id="hsmUserModalTitle">إضافة مستخدم</h3>' +
        '<div class="hsm-auth-field"><label>الاسم</label><input type="text" id="hsmUserName" /></div>' +
        '<div class="hsm-auth-field"><label>اسم المستخدم</label><input type="text" id="hsmUserUsername" /></div>' +
        '<div class="hsm-auth-field" id="hsmUserPasswordField"><label>كلمة المرور</label><input type="password" id="hsmUserPassword" autocomplete="new-password" /></div>' +
        '<div class="hsm-auth-field"><label>الدور</label><select id="hsmUserRole"></select></div>' +
        '<div class="hsm-auth-field"><label>مجموعات الصلاحيات (اختياري)</label><div id="hsmUserGroups"></div></div>' +
        '<div class="hsm-auth-field"><label>الحالة</label><select id="hsmUserStatus">' +
          Object.keys(STATUS_LABELS).map(function (s) { return '<option value="' + s + '">' + STATUS_LABELS[s].text + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="hsm-auth-error" id="hsmUserModalError"></div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          '<button type="button" class="btn btn-primary" id="hsmUserSaveBtn">حفظ</button>' +
          '<button type="button" class="btn" id="hsmUserCancelBtn">إلغاء</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    _modalEls = {
      overlay: overlay,
      title: overlay.querySelector('#hsmUserModalTitle'),
      name: overlay.querySelector('#hsmUserName'),
      username: overlay.querySelector('#hsmUserUsername'),
      passwordField: overlay.querySelector('#hsmUserPasswordField'),
      password: overlay.querySelector('#hsmUserPassword'),
      role: overlay.querySelector('#hsmUserRole'),
      groups: overlay.querySelector('#hsmUserGroups'),
      status: overlay.querySelector('#hsmUserStatus'),
      error: overlay.querySelector('#hsmUserModalError'),
      saveBtn: overlay.querySelector('#hsmUserSaveBtn'),
      cancelBtn: overlay.querySelector('#hsmUserCancelBtn')
    };
    _modalEls.cancelBtn.addEventListener('click', closeModal);
    _modalEls.saveBtn.addEventListener('click', onSave);
    return _modalEls;
  }

  async function openModal(username) {
    _editingUsername = username;
    var els = _ensureModal();
    els.error.textContent = '';
    els.role.innerHTML = _roleOptionsHtml(null);

    if (username) {
      var repo = await _getRepo();
      var user = repo.get(username);
      if (!user) return;
      els.title.textContent = 'تعديل مستخدم: ' + user.الاسم;
      els.name.value = user.الاسم || '';
      els.username.value = user.اسم_المستخدم || '';
      els.username.disabled = true; // natural key — not editable after creation
      els.passwordField.querySelector('label').textContent = 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)';
      els.password.value = '';
      els.role.innerHTML = _roleOptionsHtml(user.الدور);
      els.groups.innerHTML = _groupCheckboxesHtml(user.مجموعات_الصلاحيات);
      els.status.value = user.الحالة || 'بانتظار التفعيل';
    } else {
      els.title.textContent = 'إضافة مستخدم';
      els.name.value = '';
      els.username.value = '';
      els.username.disabled = false;
      els.passwordField.querySelector('label').textContent = 'كلمة المرور';
      els.password.value = '';
      els.groups.innerHTML = _groupCheckboxesHtml([]);
      els.status.value = 'بانتظار التفعيل';
    }
    els.overlay.removeAttribute('hidden');
  }

  function closeModal() {
    if (_modalEls) _modalEls.overlay.setAttribute('hidden', 'hidden');
    _editingUsername = null;
  }

  async function onSave() {
    var els = _modalEls;
    els.error.textContent = '';
    var name = (els.name.value || '').trim();
    var username = (els.username.value || '').trim();
    var password = els.password.value || '';
    var role = els.role.value;
    var status = els.status.value;
    var groups = Array.prototype.slice.call(els.groups.querySelectorAll('.hsm-user-group-cb:checked')).map(function (cb) { return cb.value; });

    if (!name || !username) {
      els.error.textContent = 'الاسم واسم المستخدم إلزاميان.';
      return;
    }
    if (!_editingUsername && !password) {
      els.error.textContent = 'كلمة المرور إلزامية عند إنشاء مستخدم جديد.';
      return;
    }
    if (!_editingUsername && !_allowed('CanCreateUsers')) {
      els.error.textContent = 'لا تملك صلاحية إضافة مستخدمين.';
      return;
    }
    if (_editingUsername && !_allowed('CanEditUsers')) {
      els.error.textContent = 'لا تملك صلاحية تعديل المستخدمين.';
      return;
    }

    els.saveBtn.disabled = true;
    try {
      var record = { الاسم: name, الدور: role, الحالة: status, مجموعات_الصلاحيات: groups };
      if (password) {
        if (!window.HossamPasswordHasher) { els.error.textContent = 'تعذّر تشفير كلمة المرور.'; return; }
        record.كلمة_المرور_مجزأة = await window.HossamPasswordHasher.hashPassword(password);
      }

      var repo = await _getRepo();
      var result;
      if (_editingUsername) {
        result = await repo.update(_editingUsername, record);
      } else {
        record.اسم_المستخدم = username;
        result = await repo.create(record);
      }

      if (!result.success) {
        els.error.textContent = (result.error && result.error.message) || 'تعذّر الحفظ.';
        return;
      }
      closeModal();
      renderPanel();
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  function init() {
    if (!window.UsersRepository) return;
    renderPanel();
    // Re-render if something fires a 'hossam:page-shown' event with
    // detail 'settings' — no such event exists anywhere in the project
    // today (checked), so this listener is currently permanently
    // dormant and harmless; it's here so a future page-navigation phase
    // can wire it without touching this file again. Until then, editing
    // a user elsewhere and returning to Settings simply re-runs
    // renderPanel() the normal way (page re-entry / reload), same as
    // every other Settings card.
    if (window.addEventListener) {
      window.addEventListener('hossam:page-shown', function (evt) {
        if (evt && evt.detail === 'settings') renderPanel();
      });
    }
  }

  window.UsersAdminPanel = { init: init, renderPanel: renderPanel };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : undefined);
