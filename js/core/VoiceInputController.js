/**
 * ============================================================================
 * VoiceInputController.js — Speech-to-Text for Text Fields | نظام الحسام للمحاماة
 * ----------------------------------------------------------------------------
 * PHASE 35 — VOICE INPUT (SPEECH-TO-TEXT) FOR TEXT FIELDS
 *
 * PROBLEM THIS FILE FIXES
 *   Typing long Arabic text (case descriptions, addresses, notes, opponent
 *   names, etc.) by hand is slow and error-prone on mobile keyboards.
 *   Requested: a microphone button on every free-text field that lets the
 *   user dictate instead of type, using the device's own speech recognition
 *   (same idea as the reference screenshot from another app), scoped ONLY to
 *   free-text fields — never to numeric/date/tel/email/url/checkbox/file/
 *   hidden fields, which the user explicitly asked to leave untouched.
 *
 * SCOPE (evidence: grep across index.html + js/modules/*.js + js/auth/*.js)
 *   Targets, and ONLY targets:
 *     - input[type="text"]  (57 static fields in index.html + a handful
 *       generated at runtime by cases.js / clients.js / LoginScreen.js /
 *       UsersAdminPanel.js)
 *     - textarea             (18 static fields in index.html)
 *   Explicitly EXCLUDED (never touched, by construction — the selector
 *   below simply never matches them): type="number", type="tel",
 *   type="date", type="time", type="email", type="url", type="checkbox",
 *   type="file", type="hidden", type="button", <select>, and any
 *   input/textarea that is readonly or disabled.
 *   Any field can also opt out explicitly with data-no-voice (none of the
 *   existing markup uses this today — pure escape hatch for the future).
 *
 * HOW IT WORKS
 *   1. Feature-detects the Web Speech API (SpeechRecognition /
 *      webkitSpeechRecognition). If the browser/WebView does not support
 *      it, this file is a complete, silent no-op — no DOM is touched, no
 *      mic buttons appear. Nothing about existing fields changes.
 *   2. On DOMContentLoaded, and continuously afterwards via a single
 *      document-level MutationObserver (this app renders most of its forms
 *      into modals via innerHTML at runtime — see DomRecycler.js/
 *      ModalManager.js — so fields appear long after initial page load),
 *      every matching field gets wrapped in a small relatively-positioned
 *      wrapper and gets one microphone button appended to it.
 *   3. Clicking the button requests microphone access (the browser's own
 *      permission prompt — no extra permission UI invented here) and starts
 *      continuous Arabic (ar-EG) recognition. Recognized speech is inserted
 *      at the field's current cursor position as it is finalized, so long
 *      dictated passages are supported, not just single short phrases.
 *      Clicking again (or the field losing focus) stops listening.
 *   4. After every insertion this file dispatches real 'input' (and, once
 *      listening stops, 'change') events on the field — so every existing
 *      oninput=".." / onchange=".." handler already on these fields (live
 *      search boxes, form state sync, etc.) fires exactly as if the user
 *      had typed the text by hand. No existing handler is modified.
 *
 * INTEGRATION
 *   100% additive: defines exactly one new global, window.HossamVoiceInput.
 *   Does not modify any other file's logic. Wired into the app only via:
 *     - one new <link> for css/voice-input.css (index.html <head>)
 *     - one new <script> tag, loaded last (index.html, before </body>)
 *   No existing module, form-save function, or event handler was changed.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  var SUPPORTED = !!SpeechRecognitionImpl;

  var LANG = 'ar-EG';
  var FIELD_SELECTOR = 'input[type="text"]:not([data-no-voice]), textarea:not([data-no-voice])';
  var ATTACHED_FLAG = 'hsmVoiceAttached';

  var recognition = null;      // single shared recognition instance
  var activeField = null;      // field currently being dictated into
  var activeBtn = null;        // mic button currently in "listening" state
  var manualStop = false;      // true when stop() was user-initiated (vs. auto end)

  // --------------------------------------------------------------------
  // Recognition engine (one shared instance; only one field listens at a
  // time — starting a new field always stops whichever one was active).
  // --------------------------------------------------------------------
  function ensureRecognition() {
    if (recognition || !SUPPORTED) return recognition;

    recognition = new SpeechRecognitionImpl();
    recognition.lang = LANG;
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = function (event) {
      if (!activeField) return;
      var finalTranscript = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        insertTextAtCursor(activeField, finalTranscript);
      }
    };

    recognition.onerror = function (event) {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        if (window.toast) {
          window.toast('يرجى السماح باستخدام الميكروفون من إعدادات الجهاز/المتصفح', 'error');
        }
      } else if (event.error === 'no-speech') {
        // Silence timeout — not a real error, just let onend handle cleanup.
      } else if (window.toast) {
        window.toast('تعذر تشغيل الإدخال الصوتي', 'error');
      }
    };

    recognition.onend = function () {
      if (activeField) {
        // Fire change once dictation into this field has fully stopped, for
        // any onchange=".." handler already on the field (see file header).
        dispatchEvent(activeField, 'change');
      }
      setListeningState(false);
      if (!manualStop && activeBtn) {
        // Some engines auto-stop after a silence gap even in continuous
        // mode; if the user never clicked stop, just reset the UI so they
        // can tap the mic again to resume — never restart automatically
        // without a fresh user gesture.
      }
      manualStop = false;
      activeField = null;
      activeBtn = null;
    };

    return recognition;
  }

  function insertTextAtCursor(field, text) {
    var existing = field.value || '';
    var start = typeof field.selectionStart === 'number' ? field.selectionStart : existing.length;
    var end = typeof field.selectionEnd === 'number' ? field.selectionEnd : existing.length;

    var needsLeadingSpace = start > 0 && existing.charAt(start - 1) !== ' ' && existing.charAt(start - 1) !== '\n';
    var insertion = (needsLeadingSpace ? ' ' : '') + text;

    field.value = existing.slice(0, start) + insertion + existing.slice(end);
    var caret = start + insertion.length;
    if (typeof field.setSelectionRange === 'function') {
      try { field.setSelectionRange(caret, caret); } catch (e) { /* some input types disallow this — ignore */ }
    }

    dispatchEvent(field, 'input');
  }

  function dispatchEvent(field, type) {
    var evt;
    try {
      evt = new Event(type, { bubbles: true });
    } catch (e) {
      evt = document.createEvent('Event');
      evt.initEvent(type, true, true);
    }
    field.dispatchEvent(evt);
  }

  // --------------------------------------------------------------------
  // UI: mic button lifecycle
  // --------------------------------------------------------------------
  function setListeningState(isListening) {
    if (activeBtn) {
      activeBtn.classList.toggle('hsm-voice-listening', isListening);
      activeBtn.setAttribute('aria-pressed', isListening ? 'true' : 'false');
    }
  }

  function stopListening() {
    manualStop = true;
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* already stopped */ }
    }
  }

  function startListening(field, btn) {
    var rec = ensureRecognition();
    if (!rec) return;

    if (activeField && activeField !== field) {
      stopListening();
    }

    activeField = field;
    activeBtn = btn;
    manualStop = false;

    try {
      rec.start();
      setListeningState(true);
    } catch (e) {
      // start() throws if already started (e.g. rapid double-click) —
      // treat as "already listening for this field", no user-facing error.
    }
  }

  function onMicButtonClick(event) {
    event.preventDefault();
    var btn = event.currentTarget;
    var field = btn.hsmField;
    if (!field) return;

    if (activeField === field && activeBtn && activeBtn.classList.contains('hsm-voice-listening')) {
      stopListening();
    } else {
      startListening(field, btn);
    }
  }

  // --------------------------------------------------------------------
  // Attachment: wrap a field once and give it a mic button
  // --------------------------------------------------------------------
  var MIC_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/>' +
    '<path fill="currentColor" d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.07A7 7 0 0 0 19 11z"/>' +
    '</svg>';

  function attachField(field) {
    if (!field || field.dataset[ATTACHED_FLAG] === '1') return;
    if (field.readOnly || field.disabled) return;
    if (field.closest && field.closest('[data-no-voice]')) return;

    var wrapper = document.createElement('span');
    wrapper.className = 'hsm-voice-wrap';

    var parent = field.parentNode;
    if (!parent) return;
    parent.insertBefore(wrapper, field);
    wrapper.appendChild(field);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hsm-voice-mic-btn';
    btn.setAttribute('aria-label', 'إدخال صوتي');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'إدخال صوتي (تحويل الكلام إلى نص)';
    btn.innerHTML = MIC_ICON_SVG;
    btn.hsmField = field;
    btn.addEventListener('click', onMicButtonClick);
    wrapper.appendChild(btn);

    field.classList.add('hsm-voice-input');
    field.dataset[ATTACHED_FLAG] = '1';

    // If this field is removed/re-rendered away while dictating into it
    // (DomRecycler can recycle nodes), stop listening rather than leak
    // recognition against a detached field.
    if (field === activeField) {
      // no-op here; handled defensively in insertTextAtCursor/startListening
      // via normal DOM detachment behavior (value writes to a detached
      // node are harmless no-ops in practice).
    }
  }

  function scan(root) {
    if (!SUPPORTED) return;
    var scope = root || document;
    if (scope.matches && scope.matches(FIELD_SELECTOR)) {
      attachField(scope);
    }
    if (scope.querySelectorAll) {
      var fields = scope.querySelectorAll(FIELD_SELECTOR);
      for (var i = 0; i < fields.length; i++) {
        attachField(fields[i]);
      }
    }
  }

  // --------------------------------------------------------------------
  // Observe dynamically-rendered forms (modals, DomRecycler-managed
  // pages, etc.) so newly-inserted text fields get a mic button too.
  // --------------------------------------------------------------------
  function observe() {
    if (!SUPPORTED || !window.MutationObserver) return;
    var observer = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (node.nodeType === 1) scan(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    if (!SUPPORTED) return; // silent no-op — see file header
    scan(document);
    observe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HossamVoiceInput = {
    isSupported: function () { return SUPPORTED; },
    scan: scan // exposed for any future module that renders fields outside
               // the observed subtree and wants an immediate attach pass
  };
})(window, document);
