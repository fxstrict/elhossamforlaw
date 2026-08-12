/* ============================================================================
 * js/debug/RuntimeDebugLayer.js
 * ----------------------------------------------------------------------------
 * TEMPORARY, ADDITIVE-ONLY RUNTIME DIAGNOSTIC LAYER — Phase 17.2 support tool.
 *
 * WHAT THIS FILE IS
 *   A pure observer. It does not fix, alter, refactor, or optimize anything.
 *   It wraps existing functions/objects (render*, DomRecycler, DomKeyIndex,
 *   Repository.prototype, ApiService, loadFromSheets, delete*, addEventListener,
 *   setTimeout/setInterval/rAF, localStorage/sessionStorage, fetch) so that
 *   every call is LOGGED, then calls straight through to the original with the
 *   same arguments and returns the same result. If a target it looks for does
 *   not exist yet, it skips it silently and logs that it was skipped — it
 *   never throws, and a failure in this file can never break the app.
 *
 * HOW IT IS ACTIVATED
 *   Fully dormant by default. Nothing is recorded unless:
 *     window.RUNTIME_DEBUG = true;
 *   or the small floating "RD" button (bottom-left, only visible once this
 *   script has installed itself) is tapped, or Ctrl+Shift+D on desktop.
 *   Toggling window.RUNTIME_DEBUG = false stops recording instantly (the
 *   wrapping stays installed — harmless no-ops — but nothing is stored).
 *
 * HOW TO REMOVE THIS ENTIRELY AFTER THE INVESTIGATION
 *   1. Delete this file (js/debug/RuntimeDebugLayer.js).
 *   2. Remove the single <script src="js/debug/RuntimeDebugLayer.js"></script>
 *      line that was added at the very top of index.html's <head>.
 *   That is the ONLY other change made to the project by this tool.
 *
 * WHY THIS SCRIPT MUST BE THE FIRST <script> IN <head>
 *   addEventListener/setTimeout/setInterval/requestAnimationFrame must be
 *   wrapped BEFORE any other script on the page registers a listener or
 *   timer, or those early registrations (e.g. index.html's own inline
 *   DOMContentLoaded listener, firstrun.js's) would be invisible to the
 *   Events tab. Everything that depends on later globals (renderTasks,
 *   DomRecycler, Repository.prototype, ApiService, loadFromSheets, delete*)
 *   is patched separately, once, inside a DOMContentLoaded handler — by the
 *   time DOMContentLoaded fires, every synchronous <script> on the page
 *   (all module files are non-deferred) has already executed and those
 *   globals already exist, regardless of this listener's registration order
 *   relative to any other DOMContentLoaded listener.
 *
 * KNOWN COVERAGE LIMITS (disclosed up front, not discovered later)
 *   - IndexedDB: patching indexedDB.open() is done only to log db name/
 *     version/open-timing. Per-transaction/per-record read-write tracing
 *     was deliberately NOT added — that requires instrumenting IDBDatabase/
 *     IDBTransaction/IDBObjectStore prototypes, which is materially more
 *     invasive and closer to "modifying storage behavior" than this tool's
 *     "observe only" mandate allows. Repository-level calls (import/delete/
 *     restore/create/update) are logged instead, which covers every write
 *     path the app actually uses to reach IndexedDB.
 *   - DomRecycler internals (created/reused/removed/moved counts) are NOT
 *     directly observable from outside without editing DomRecycler.js
 *     (forbidden). This layer instead logs: rows-in count, container child
 *     count immediately before and after reconcile(), and wall-clock
 *     duration, as an external proxy — sufficient to see whether the
 *     container ends up with more/fewer nodes than rows passed in.
 *   - "First incorrect event" causal chains (e.g. "did THIS deleteTask()
 *     call cause THAT reconcile() call") are not automatically linked.
 *     Every log entry carries a high-resolution timestamp (performance.now())
 *     specifically so they can be correlated manually/by the analyst after
 *     export, in the order they actually happened.
 *
 * PHASE 17.3 ADDITION — SELF-REPORTING RUNTIME DIAGNOSTIC (mobile-only use)
 *   Everything below is still observe-only. It changes WHEN this layer
 *   records and HOW its findings reach the analyst — never what the app
 *   itself does. Added because the person operating this build has no
 *   DevTools/Console/Playwright access (phone-only):
 *     - Recording now starts automatically on load (no console command or
 *       RD-button tap required), unless the person has explicitly turned
 *       it off from the panel in a previous session — that choice is
 *       remembered (localStorage) and respected.
 *     - The ring buffer is snapshotted to localStorage (throttled, plus on
 *       pagehide/visibilitychange) and restored on the next load, so a
 *       refresh/reload no longer erases the history needed to diagnose
 *       refresh-triggered bugs (e.g. "deleted task reappears").
 *     - A "Dashboard" tab summarizes counters (errors, renders, DomRecycler
 *       reconciles, repository ops, API calls, sync/import calls, last
 *       stack trace) so findings are readable without scrolling raw events.
 *     - A "Copy Runtime Report" button copies the full JSON report to the
 *       clipboard (Clipboard API with an execCommand fallback for
 *       restricted WebViews), since downloading a file is unreliable on
 *       some mobile browsers/WebViews.
 *
 * PHASE 17.3.1 — PERMANENT HIDDEN DEVELOPER DIAGNOSTICS FRAMEWORK
 *   This tool graduated from a temporary investigation aid to a permanent,
 *   hidden-by-default part of the project. What changed vs. Phase 17.3:
 *     - A master gate (`__RDL_DIAGNOSTICS_ENABLED__` in localStorage,
 *       surfaced as Settings → Developer Diagnostics → "Enable
 *       Diagnostics") now sits in front of EVERYTHING else in this file.
 *       Off by default. When off: no button, no panel, no wrapping of
 *       any kind, no console override, no timers, no observers, no
 *       localStorage snapshotting — this file reads exactly one
 *       localStorage key and returns. When on: the framework installs in
 *       full, exactly as before, plus the detectors below.
 *     - Toggling the Settings checkbox reloads the app, because this
 *       script must be the first thing to run (see "WHY THIS SCRIPT MUST
 *       BE THE FIRST <script>" above) to see the flag before anything
 *       else registers a listener/timer/observer.
 *     - New automatic problem detection (feeds a "Health" tab + a
 *       `problems` ring buffer, separate from the raw event log):
 *       duplicate DOM nodes, duplicate repository records, soft-delete
 *       resurrection, stuck splash/duplicated overlays, render loops,
 *       fetch/refresh loops, duplicate event listeners, growing
 *       listener/interval/observer counts (memory-leak indicator), long
 *       renders (>100ms), slow repository ops (>200ms), slow API calls
 *       (>1000ms), large DOM (>3000 elements), and a zombie-node
 *       heuristic (reconcile() leaving far more children than rows
 *       passed in). All of these are still *proxies* observed from
 *       outside — none of it required touching Repository.js,
 *       DomRecycler.js, or any business logic.
 *     - A "Generate Analysis" button + 60s auto-analysis tick surface
 *       most-frequent-error / most-expensive-render / most-active-module /
 *       slowest-module / largest-DOM, and a text "Smart Report"
 *       (Root Cause Candidates / Timeline / Warnings / Performance /
 *       Suggestions) — not just raw JSON.
 *     - Export now supports JSON, TXT (the smart report), and Markdown.
 *
 * PHASE 17.4 — RUNTIME DIAGNOSTICS REPAIR (framework bugs, not app bugs)
 *   A real session reported "DomRecycler reconciles: 0" alongside heavy
 *   list usage, and "DoubleEventListener: 25". Investigation (see
 *   docs/phase17/PHASE_17_4_RUNTIME_DIAGNOSTICS_REPAIR_REPORT.md for the
 *   full evidence trail) found two provable bugs IN THIS FILE, not in
 *   DomRecycler/Repository/ApiService/business logic:
 *     1. The DomRecycler.reconcile wrap called the real implementation
 *        completely unguarded. DomRecycler.reconcile throws BY DESIGN on
 *        a bad/duplicate key (see js/core/dom/DomRecycler.js, "SAFETY"),
 *        and every caller wraps it in its own try/catch with a silent
 *        fallback — so a throw used to skip every line of instrumentation
 *        below the old call, INCLUDING the reconciles++ counter, making a
 *        failing reconcile() indistinguishable from "never called."
 *        Fixed: the call is now inside try/catch, a throw is logged as
 *        `reconcile:threw` + a new `DomRecyclerReconcileThrew` problem +
 *        a new `reconcileErrors` counter, and then RE-THROWN UNCHANGED —
 *        callers see identical behavior, the analyst now sees the truth.
 *     2. DoubleEventListener flagged the Nth registration of ANY event
 *        type on ANY target as a "duplicate," with no regard for WHO
 *        registered it — so three independent, correct listeners (e.g.
 *        three different files each adding their own DOMContentLoaded
 *        listener on window, which is completely normal DOM usage) were
 *        indistinguishable from a real re-registration bug. Fixed: a
 *        duplicate is now defined as the SAME call site (captured via
 *        shortStack()) registering on the SAME target+type more than
 *        once — the pattern of an "open modal"/"init" function re-wiring
 *        a persistent element without removing the previous listener.
 *   Also added per Phase 17.4's request: a per-hook install/fail ledger
 *   (`_hooks`, surfaced via a new "Integrity" tab and
 *   `RuntimeDebug.getIntegrity()`), a non-invasive "Run Diagnostics Self
 *   Test" (`RuntimeDebug.runSelfTest()` — never calls real Repository/
 *   API methods against real data, only introspects what's installed
 *   plus a couple of throwaway-element round-trips), and
 *   `RuntimeDebug.uninstall()`/`reinstall()` which fully restore/re-wrap
 *   every late-patch hook (render-family / delete-family / ApiService /
 *   Repository / DomRecycler / DomKeyIndex) via a true-original ledger — scoped
 *   deliberately to NOT unwind the foundational parse-time interceptors
 *   (EventTarget.prototype/timers/console/storage/fetch/MutationObserver
 *   constructor), which stay installed as inert pass-throughs, exactly
 *   like this file's pre-existing `RUNTIME_DEBUG = false` behavior.
 * ==========================================================================*/
(function (global) {
  'use strict';

  if (global.__RDL_INSTALLED__) return; // idempotent — never double-install
  global.__RDL_INSTALLED__ = true;

  // ------------------------------------------------------------------
  // -1. PHASE 17.3 — Developer Diagnostics master gate.
  //   This is the ONLY thing that runs unconditionally. Everything below
  //   this block — every wrap, the console override, every timer/observer,
  //   the floating button — only exists if the person has explicitly
  //   switched "Developer Diagnostics" ON from Settings. Default is OFF:
  //   no button, no panel, no wrapping, no listeners, no storage reads
  //   beyond this one flag, zero measurable runtime cost. Toggling the
  //   Settings checkbox writes this flag and reloads the app, since this
  //   script must run first (see file header) to see it at parse time.
  // ------------------------------------------------------------------
  var DIAG_PREF_KEY = '__RDL_DIAGNOSTICS_ENABLED__';

  function readDiagnosticsPref() {
    try {
      return global.localStorage && global.localStorage.getItem(DIAG_PREF_KEY) === 'true';
    } catch (e) { return false; }
  }
  function writeDiagnosticsPref(val) {
    try {
      if (global.localStorage) global.localStorage.setItem(DIAG_PREF_KEY, val ? 'true' : 'false');
    } catch (e) { /* ignore */ }
  }

  var _diagnosticsEnabled = readDiagnosticsPref();

  if (!_diagnosticsEnabled) {
    // Dormant mode. Expose only the tiny control surface Settings needs.
    global.RuntimeDebug = {
      isDiagnosticsEnabled: function () { return false; },
      enableDiagnostics: function () { writeDiagnosticsPref(true); },
      disableDiagnostics: function () { writeDiagnosticsPref(false); },
      // Back-compat no-ops so any old console/UI call site never throws.
      isEnabled: function () { return false; },
      enable: function () {}, disable: function () {},
      getLog: function () { return []; }, clear: function () {},
      getSummary: function () { return null; },
      exportReport: function () {}, copyReport: function (cb) { if (typeof cb === 'function') cb(false); },
      generateAnalysisReport: function () { return ''; }
    };
    return; // nothing else in this file executes.
  }

  // ------------------------------------------------------------------
  // 0. Core state / logging primitive
  // ------------------------------------------------------------------
  var MAX_EVENTS = 5000; // ring buffer — protects mobile devices from OOM
  var PERSIST_KEY = '__RDL_SNAPSHOT_V1__';
  var PERSIST_PREF_KEY = '__RDL_ENABLED_PREF__';
  var PERSIST_EVERY_N_LOGS = 15; // throttle localStorage writes
  var _events = [];
  var _seq = 0;
  var _startTime = Date.now();
  var _startPerf = (global.performance && performance.now) ? performance.now() : 0;
  var _sinceLastPersist = 0;
  var _carriedOverCount = 0;

  // --- Phase 17.3: detected-problem ring buffer (separate from the raw
  // event log — this is "what's actually wrong", not "everything that
  // happened") + the counters/state the detectors below need.
  var MAX_PROBLEMS = 500;
  var _problems = [];
  var _problemSeq = 0;
  var _deletedIdsByEntity = Object.create(null); // entityKey -> Set-like object of ids
  var _renderCallTimestamps = Object.create(null); // fnName -> [t,...] sliding window
  var _fetchCallTimestamps = Object.create(null); // url -> [t,...] sliding window
  var _liveListenerCount = 0; // approx: ++ on addEventListener, -- on removeEventListener
  var _liveIntervalCount = 0; // approx: ++ on setInterval, -- on matching clearInterval
  var _mutationObserverInstances = 0; // ++ on `new MutationObserver()` (cannot reliably decrement)
  var _leakSamples = []; // last N samples of {listeners, intervals, observers}
  var _ownObserverCount = 0; // splash watcher + per-module mutation watchers actually attached
  var _ownObservers = []; // the actual MutationObserver instances, so uninstall() can disconnect() them
  var _domRecyclerStats = { reconciles: 0, createdApprox: 0, removedApprox: 0, reconcileErrors: 0 };
  var _lastAnalysis = null;

  // --- Phase 17.4: hook install/failure tracking (feeds the new
  // "Diagnostics Integrity" tab + Self Test). Every wrap site below sets
  // exactly one of these three states per hook: 'installed' (the target
  // existed and was wrapped), 'notFound' (the target didn't exist yet —
  // not a failure, just nothing to wrap), 'failed' (the target existed
  // but wrapping it threw). This is what makes "is the framework itself
  // actually working" answerable without guessing.
  var _hooks = Object.create(null);
  var _sessionId = 'rdl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  function setHookStatus(name, status, detail) {
    _hooks[name] = { status: status, detail: detail || null, at: new Date().toISOString() };
  }
  // Marks a function as already-wrapped-by-this-framework so a second
  // install pass (e.g. a manual RuntimeDebug.reinstall() call) can never
  // wrap an already-wrapped function a second time (Phase 17.4 §8: "عدم
  // Wrap لنفس الدالة مرتين").
  function markWrapped(fn) { try { fn.__rdlWrapped = true; } catch (e) {} return fn; }
  function isAlreadyWrapped(fn) { return !!(fn && fn.__rdlWrapped); }
  // Phase 17.4 §7/§8 — true-original ledger for the late-patch wraps
  // (render*/delete*/ApiService/Repository/DomRecycler/DomKeyIndex), so
  // uninstallFramework() can restore the exact pre-wrap function even
  // after multiple install/uninstall/reinstall cycles, and
  // verify_runtime_hooks.js can assert nothing was left double-wrapped.
  var _trueOriginals = Object.create(null);

  // ------------------------------------------------------------------
  // 0a. Auto-start + cross-reload persistence (Phase 17.3, see header).
  // ------------------------------------------------------------------
  function readEnabledPref() {
    return safe(function () {
      var v = global.localStorage && global.localStorage.getItem(PERSIST_PREF_KEY);
      if (v === 'false') return false;
      if (v === 'true') return true;
      return null; // no explicit preference recorded yet
    });
  }

  function writeEnabledPref(val) {
    safe(function () {
      if (global.localStorage) global.localStorage.setItem(PERSIST_PREF_KEY, val ? 'true' : 'false');
    });
  }

  // Record automatically from the moment the app opens, unless the person
  // explicitly turned recording OFF from the panel in a previous session.
  var _enabledPref = readEnabledPref();
  global.RUNTIME_DEBUG = (_enabledPref === false) ? false : true;

  function enabled() {
    return global.RUNTIME_DEBUG === true;
  }

  function loadSnapshot() {
    safe(function () {
      var raw = global.localStorage && global.localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      var snap = JSON.parse(raw);
      if (snap && Array.isArray(snap.events) && snap.events.length) {
        _events = snap.events.slice(-MAX_EVENTS);
        _carriedOverCount = _events.length;
        _seq = _events.reduce(function (m, e) { return Math.max(m, e.seq || 0); }, 0);
      }
    });
  }
  loadSnapshot();

  function persistSnapshot() {
    safe(function () {
      if (!global.localStorage) return;
      var payload = JSON.stringify({ savedAt: new Date().toISOString(), events: _events });
      try {
        global.localStorage.setItem(PERSIST_KEY, payload);
      } catch (e) {
        // Quota exceeded on a long session — keep the newer half and retry once.
        safe(function () {
          var half = _events.slice(-Math.floor(_events.length / 2));
          global.localStorage.setItem(PERSIST_KEY, JSON.stringify({
            savedAt: new Date().toISOString(), events: half, note: 'truncated: quota exceeded'
          }));
        });
      }
    });
  }

  function safe(fn) {
    try { return fn(); } catch (e) { return undefined; }
  }

  function shortStack() {
    return safe(function () {
      var s = new Error().stack || '';
      // Drop the first 2 lines (Error + this helper itself) — keep it short.
      return s.split('\n').slice(3, 10).join('\n');
    }) || '';
  }

  /**
   * log(category, name, detail)
   * category: one of Console|DOM|Repository|DomRecycler|API|Sync|Events|
   *           Performance|Storage|Startup|Splash
   */
  function log(category, name, detail) {
    if (!enabled()) return;
    safe(function () {
      _seq++;
      var entry = {
        seq: _seq,
        t: (global.performance && performance.now) ? +performance.now().toFixed(3) : (Date.now() - _startTime),
        iso: new Date().toISOString(),
        category: category,
        name: name,
        detail: detail === undefined ? null : detail,
        stack: shortStack()
      };
      _events.push(entry);
      if (_events.length > MAX_EVENTS) _events.shift();
      if (_uiRefresh) _uiRefresh(entry);
      _sinceLastPersist++;
      if (_sinceLastPersist >= PERSIST_EVERY_N_LOGS) {
        _sinceLastPersist = 0;
        persistSnapshot();
      }
    });
  }

  /**
   * reportProblem(severity, type, message, detail)
   * severity: 'critical' | 'warning'
   * Feeds both the Health tab and the "Console"-adjacent event log (as
   * category 'Health'), so a problem is visible whether the analyst is
   * looking at the raw timeline or the summarized dashboard.
   */
  function reportProblem(severity, type, message, detail) {
    if (!enabled()) return;
    safe(function () {
      _problemSeq++;
      var p = {
        seq: _problemSeq,
        t: (global.performance && performance.now) ? +performance.now().toFixed(3) : (Date.now() - _startTime),
        iso: new Date().toISOString(),
        severity: severity, // 'critical' | 'warning'
        type: type,
        message: message,
        detail: detail === undefined ? null : detail
      };
      _problems.push(p);
      if (_problems.length > MAX_PROBLEMS) _problems.shift();
      log('Health', type, { severity: severity, message: message, detail: p.detail });
    });
  }

  if (_carriedOverCount > 0) {
    log('Startup', 'session:reloaded', {
      carriedOverEvents: _carriedOverCount,
      note: 'Ring buffer restored from localStorage to preserve continuity across refresh/reload.'
    });
  }

  global.addEventListener('pagehide', function () { persistSnapshot(); });
  global.addEventListener('beforeunload', function () { persistSnapshot(); });
  global.addEventListener('visibilitychange', function () {
    if (global.document.visibilityState === 'hidden') persistSnapshot();
  });

  // Also mirror real console.* calls into the log (so "Console" tab shows
  // genuine app warnings/errors, e.g. unhandled promise rejections).
  ['log', 'warn', 'error', 'info', 'debug'].forEach(function (level) {
    var orig = console[level] ? console[level].bind(console) : function () {};
    console[level] = markWrapped(function () {
      var args = Array.prototype.slice.call(arguments);
      log('Console', level, safe(function () {
        return args.map(function (a) {
          if (a instanceof Error) return a.name + ': ' + a.message;
          try { return typeof a === 'object' ? JSON.stringify(a).slice(0, 500) : String(a); }
          catch (e) { return String(a); }
        }).join(' ');
      }));
      return orig.apply(console, args);
    });
  });

  global.addEventListener('error', function (e) {
    log('Console', 'window.onerror', {
      message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno
    });
  });
  global.addEventListener('unhandledrejection', function (e) {
    log('Console', 'unhandledrejection', {
      reason: safe(function () { return String(e.reason && e.reason.message || e.reason); })
    });
  });
  setHookStatus('console', 'installed', { note: 'console.log/warn/error/info/debug wrapped + window.onerror + unhandledrejection' });

  // ------------------------------------------------------------------
  // 1. addEventListener / removeEventListener — global + duplicate detect
  // ------------------------------------------------------------------
  var WATCHED_TYPES = ['DOMContentLoaded', 'load', 'visibilitychange', 'hashchange', 'storage', 'beforeunload'];
  var _listenerRegistry = Object.create(null); // "targetLabel|type" -> { total, sites: {callSiteSignature -> count} }

  function targetLabel(t) {
    if (t === global) return 'window';
    if (t === global.document) return 'document';
    if (t && t.id) return '#' + t.id;
    if (t && t.nodeName) return '<' + t.nodeName.toLowerCase() + '>';
    return safe(function () { return Object.prototype.toString.call(t); }) || 'unknown-target';
  }

  var _origAdd = global.EventTarget.prototype.addEventListener;
  var _origRemove = global.EventTarget.prototype.removeEventListener;

  global.EventTarget.prototype.addEventListener = markWrapped(function (type, listener, options) {
    if (enabled()) {
      safe(function () {
        var label = targetLabel(this);
        var key = label + '|' + type;
        // PHASE 17.4 FIX (proven false-positive, see docs/phase17/
        // PHASE_17_4_RUNTIME_DIAGNOSTICS_REPAIR_REPORT.md §2): the
        // previous version flagged the Nth registration of ANY type on
        // ANY target as a duplicate, with no regard for WHO registered
        // it. That is wrong — this app (and this framework itself) has
        // several independent, correct listeners of the same type on
        // `window`/`document` (e.g. three separate DOMContentLoaded
        // listeners from three separate files), which is completely
        // normal DOM usage, not a bug. A REAL duplicate is the SAME call
        // site registering another listener on the SAME target+type —
        // e.g. an "open modal" function that re-wires a persistent
        // button on every open without ever removing the previous
        // listener. That, and only that, is what gets flagged now.
        var callSite = shortStack();
        var entry = _listenerRegistry[key] || (_listenerRegistry[key] = { total: 0, sites: Object.create(null) });
        entry.total++;
        entry.sites[callSite] = (entry.sites[callSite] || 0) + 1;
        var sameSiteCount = entry.sites[callSite];
        var isRealDuplicate = sameSiteCount > 1;
        _liveListenerCount++;

        if (WATCHED_TYPES.indexOf(type) !== -1 || isRealDuplicate) {
          log('Events', 'addEventListener', {
            target: label,
            type: type,
            totalListenersForThisTargetAndType: entry.total,
            distinctCallSites: Object.keys(entry.sites).length,
            sameCallSiteRegistrationCount: sameSiteCount,
            possibleDuplicate: isRealDuplicate
          });
        }
        if (isRealDuplicate) {
          reportProblem('warning', 'DoubleEventListener',
            'The same call site has registered a "' + type + '" listener on ' + label + ' ' + sameSiteCount + ' times',
            { target: label, type: type, sameCallSiteRegistrationCount: sameSiteCount, callSite: callSite });
        }
      }.bind(this));
    }
    return _origAdd.call(this, type, listener, options);
  });

  global.EventTarget.prototype.removeEventListener = markWrapped(function (type, listener, options) {
    if (enabled()) {
      safe(function () {
        var label = targetLabel(this);
        var key = label + '|' + type;
        // Only the total is decremented here — we deliberately don't try
        // to attribute a removal back to one specific call-site bucket
        // (we'd need the exact listener reference matched against the
        // one captured at add-time, which addEventListener does not hand
        // us in a form worth the bookkeeping). The per-call-site counts
        // are a monotonic "how many times has this exact code path
        // registered" signal, which is what DoubleEventListener needs;
        // an accurate live total is a separate, coarser signal.
        if (_listenerRegistry[key] && _listenerRegistry[key].total > 0) _listenerRegistry[key].total--;
        if (_liveListenerCount > 0) _liveListenerCount--;
        log('Events', 'removeEventListener', { target: label, type: type });
      }.bind(this));
    }
    return _origRemove.call(this, type, listener, options);
  });
  setHookStatus('eventListener', 'installed', { note: 'EventTarget.prototype.addEventListener/removeEventListener wrapped at parse time' });

  // ------------------------------------------------------------------
  // 2. Timers — setTimeout / setInterval / requestAnimationFrame
  // ------------------------------------------------------------------
  var _origSetTimeout = global.setTimeout;
  var _origSetInterval = global.setInterval;
  var _origRAF = global.requestAnimationFrame;
  var _timerCounts = { setTimeout: 0, setInterval: 0, requestAnimationFrame: 0 };

  global.setTimeout = function (fn, delay) {
    if (enabled()) {
      _timerCounts.setTimeout++;
      log('Performance', 'setTimeout', { delay: delay, totalSoFar: _timerCounts.setTimeout });
    }
    return _origSetTimeout.apply(global, arguments);
  };
  global.setInterval = function (fn, delay) {
    if (enabled()) {
      _timerCounts.setInterval++;
      _liveIntervalCount++;
      log('Performance', 'setInterval', { delay: delay, totalSoFar: _timerCounts.setInterval });
    }
    return _origSetInterval.apply(global, arguments);
  };
  var _origClearInterval = global.clearInterval;
  global.clearInterval = function (id) {
    if (enabled() && _liveIntervalCount > 0) _liveIntervalCount--;
    return _origClearInterval.apply(global, arguments);
  };

  // MutationObserver instance counter — approximate memory-leak indicator
  // (can only count creations; a disconnect()'d observer is not reliably
  // detectable from outside, so this is a floor, not an exact live count).
  safe(function () {
    if (!global.MutationObserver) return;
    var OrigMO = global.MutationObserver;
    global.MutationObserver = markWrapped(function (cb) {
      if (enabled()) _mutationObserverInstances++;
      return new OrigMO(cb);
    });
    global.MutationObserver.prototype = OrigMO.prototype;
  });
  if (_origRAF) {
    global.requestAnimationFrame = function (fn) {
      if (enabled()) {
        _timerCounts.requestAnimationFrame++;
        // Only log every 30th rAF call — this one fires up to 60x/sec and
        // would otherwise flood the ring buffer with near-zero signal.
        if (_timerCounts.requestAnimationFrame % 30 === 0) {
          log('Performance', 'requestAnimationFrame', { totalSoFar: _timerCounts.requestAnimationFrame });
        }
      }
      return _origRAF.apply(global, arguments);
    };
  }
  setHookStatus('timers', 'installed', { note: 'setTimeout/setInterval/clearInterval/requestAnimationFrame/MutationObserver wrapped' });

  // ------------------------------------------------------------------
  // 3. localStorage / sessionStorage — same-tab writes (no native event
  //    fires for those, unlike cross-tab 'storage'), plus the real
  //    cross-tab 'storage' event.
  // ------------------------------------------------------------------
  function wrapStorage(storageObj, label) {
    if (!storageObj) return;
    var origSet = storageObj.setItem.bind(storageObj);
    var origRemove = storageObj.removeItem.bind(storageObj);
    var origClear = storageObj.clear.bind(storageObj);
    try {
      storageObj.setItem = markWrapped(function (key, value) {
        if (enabled()) {
          log('Storage', label + '.setItem', {
            key: key,
            oldValueLen: safe(function () { return (storageObj.getItem(key) || '').length; }),
            newValueLen: (value || '').length,
            preview: String(value).slice(0, 120)
          });
        }
        return origSet(key, value);
      });
      storageObj.removeItem = markWrapped(function (key) {
        if (enabled()) log('Storage', label + '.removeItem', { key: key });
        return origRemove(key);
      });
      storageObj.clear = markWrapped(function () {
        if (enabled()) log('Storage', label + '.clear', {});
        return origClear();
      });
    } catch (e) {
      log('Storage', label + '.wrapFailed', { error: String(e) });
    }
  }
  wrapStorage(global.localStorage, 'localStorage');
  wrapStorage(global.sessionStorage, 'sessionStorage');
  global.addEventListener('storage', function (e) {
    log('Storage', 'cross-tab storage event', { key: e.key, oldValue: e.oldValue, newValue: e.newValue, url: e.url });
  });
  setHookStatus('storage', (global.localStorage || global.sessionStorage) ? 'installed' : 'notFound', {});

  // ------------------------------------------------------------------
  // 4. IndexedDB — open() only (see "Known coverage limits" above)
  // ------------------------------------------------------------------
  safe(function () {
    if (!global.indexedDB || !global.indexedDB.open) return;
    var origOpen = global.indexedDB.open.bind(global.indexedDB);
    global.indexedDB.open = function (name, version) {
      var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
      var req = origOpen(name, version);
      req.addEventListener('success', function () {
        log('Repository', 'indexedDB.open success', {
          db: name, version: version,
          durationMs: safe(function () { return +(((global.performance ? performance.now() : Date.now()) - t0)).toFixed(2); })
        });
      });
      req.addEventListener('upgradeneeded', function () {
        log('Repository', 'indexedDB.open upgradeneeded', { db: name, version: version });
      });
      req.addEventListener('error', function () {
        log('Repository', 'indexedDB.open error', { db: name, version: version });
      });
      req.addEventListener('blocked', function () {
        log('Repository', 'indexedDB.open blocked', { db: name, version: version });
      });
      return req;
    };
  });

  // ------------------------------------------------------------------
  // 5. fetch — every network call, with special attention to the Apps
  //    Script sheet-loading pattern ("?sheet=...") so duplicate/parallel
  //    requests for the same sheet are visible.
  // ------------------------------------------------------------------
  safe(function () {
    if (!global.fetch) return;
    var origFetch = global.fetch.bind(global);
    global.fetch = markWrapped(function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
      if (enabled()) {
        log('Sync', 'fetch:start', { url: url, method: (init && init.method) || 'GET' });
        safe(function () {
          var arr = _fetchCallTimestamps[url] || (_fetchCallTimestamps[url] = []);
          arr.push(t0);
          while (arr.length && (t0 - arr[0]) > 5000) arr.shift();
          if (arr.length > 10) {
            reportProblem('critical', 'InfiniteRefresh',
              'Same URL fetched ' + arr.length + ' times in 5s — possible refresh loop',
              { url: url, callsInWindow: arr.length });
            arr.length = 0;
          }
        });
      }
      var p = origFetch(input, init);
      p.then(function (res) {
        if (!enabled()) return res;
        var durationMs = +(((global.performance ? performance.now() : Date.now()) - t0)).toFixed(2);
        // Clone so reading the body here never affects the caller's own read.
        safe(function () {
          res.clone().text().then(function (txt) {
            var rowCount = null;
            safe(function () {
              var parsed = JSON.parse(txt);
              if (Array.isArray(parsed)) rowCount = parsed.length;
            });
            log('Sync', 'fetch:done', {
              url: url, status: res.status, ok: res.ok, durationMs: durationMs,
              rowCount: rowCount, bytes: txt.length
            });
          }).catch(function () {
            log('Sync', 'fetch:done (non-JSON or unreadable body)', { url: url, status: res.status, durationMs: durationMs });
          });
        });
        return res;
      }).catch(function (err) {
        if (enabled()) {
          var durationMs = +(((global.performance ? performance.now() : Date.now()) - t0)).toFixed(2);
          log('Sync', 'fetch:error', { url: url, error: String(err), durationMs: durationMs });
        }
      });
      return p;
    });
  });
  setHookStatus('fetch', global.fetch ? 'installed' : 'notFound', {});

  // ------------------------------------------------------------------
  // 6. Splash screen observer — class/style changes + explicit show/hide
  // ------------------------------------------------------------------
  function computedFlags(el) {
    return safe(function () {
      var cs = global.getComputedStyle(el);
      return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents };
    }) || {};
  }

  var _splashWatcherInstalled = false;
  function installSplashWatcher() {
    if (_splashWatcherInstalled) return; // reinstall()-safe: never attach a second observer
    var splash = global.document.getElementById('splashScreen');
    if (!splash) { log('Splash', 'watcher:skipped', { reason: '#splashScreen not found in DOM' }); return; }
    log('Splash', 'watcher:installed', { classes: splash.className, computed: computedFlags(splash) });
    var mo = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        log('Splash', 'mutation:' + m.attributeName, {
          classes: splash.className,
          computed: computedFlags(splash)
        });
      });
    });
    mo.observe(splash, { attributes: true, attributeFilter: ['class', 'style'] });
    _ownObserverCount++;
    _ownObservers.push(mo);
    _splashWatcherInstalled = true;
  }

  // ------------------------------------------------------------------
  // 7. Tasks container mutation watcher — duplicate node / double-append
  //    detection. Generic enough to reuse for other list containers too.
  // ------------------------------------------------------------------
  var CONTAINER_MAP = {
    tasks: 'tasksListView',
    cases: 'casesTableBody',
    clients: 'clientsTableBody',
    sessions: 'sessionsListView',
    documents: 'documentsTableBody',
    fees: 'feesTableBody',
    children: 'childrenTableBody',
    library: 'libGrid',
    templates: 'templatesGrid'
  };

  var _mutationWatchersInstalled = Object.create(null); // containerId -> true
  function installMutationWatcher(moduleKey, containerId) {
    if (_mutationWatchersInstalled[containerId]) return; // reinstall()-safe
    var el = global.document.getElementById(containerId);
    if (!el) { log('DOM', 'mutationWatcher:skipped', { module: moduleKey, containerId: containerId }); return; }
    _mutationWatchersInstalled[containerId] = true;
    var mo = new MutationObserver(function (mutations) {
      var added = 0, removed = 0;
      mutations.forEach(function (m) { added += m.addedNodes.length; removed += m.removedNodes.length; });
      if (!added && !removed) return;

      // Duplicate-key check: look for repeated data-key / row identity
      // among direct children immediately after this mutation batch.
      var dupInfo = safe(function () {
        var seen = Object.create(null);
        var dups = [];
        Array.prototype.forEach.call(el.children, function (child) {
          var key = child.getAttribute('data-key') || child.outerHTML.slice(0, 80);
          if (seen[key]) dups.push(key.slice(0, 60));
          seen[key] = true;
        });
        return dups;
      }) || [];

      log('DOM', 'mutation:' + moduleKey, {
        containerId: containerId,
        addedNodes: added,
        removedNodes: removed,
        currentChildCount: el.children.length,
        duplicateChildrenDetected: dupInfo.length,
        duplicateSample: dupInfo.slice(0, 5)
      });

      if (dupInfo.length > 0) {
        reportProblem('critical', 'DuplicateDomNode',
          'Duplicate DOM nodes detected in ' + moduleKey + ' (' + containerId + ')',
          { module: moduleKey, containerId: containerId, count: dupInfo.length, sample: dupInfo.slice(0, 5) });
      }

      // Large DOM check, reused from this same mutation batch to avoid a
      // dedicated timer for a check that only matters after list renders.
      safe(function () {
        var total = global.document.getElementsByTagName('*').length;
        if (total > 3000) {
          reportProblem('warning', 'LargeDOM', 'Document node count is high', { totalElements: total });
        }
      });
    });
    mo.observe(el, { childList: true, subtree: false });
    _ownObserverCount++;
    _ownObservers.push(mo);
    log('DOM', 'mutationWatcher:installed', { module: moduleKey, containerId: containerId });
  }

  // ------------------------------------------------------------------
  // 8. Late patches — everything that depends on globals defined by the
  //    app's own <script> files. Runs once, on DOMContentLoaded.
  // ------------------------------------------------------------------
  var RENDER_LOOP_WINDOW_MS = 2000;
  var RENDER_LOOP_THRESHOLD = 20; // same render fn called this many times within the window
  var LONG_RENDER_MS = 100;

  function checkRenderLoop(fnName, tNow) {
    var arr = _renderCallTimestamps[fnName] || (_renderCallTimestamps[fnName] = []);
    arr.push(tNow);
    while (arr.length && (tNow - arr[0]) > RENDER_LOOP_WINDOW_MS) arr.shift();
    if (arr.length > RENDER_LOOP_THRESHOLD) {
      reportProblem('critical', 'RenderLoop',
        fnName + ' called ' + arr.length + ' times in ' + RENDER_LOOP_WINDOW_MS + 'ms — possible render loop',
        { fnName: fnName, callsInWindow: arr.length, windowMs: RENDER_LOOP_WINDOW_MS });
      arr.length = 0; // avoid re-flagging every single call once past threshold
    }
  }

  function wrapFunctionOnGlobal(name, category, extra) {
    var fn = global[name];
    if (typeof fn !== 'function') {
      log(category, name + ':notFound', {});
      setHookStatus('fn:' + name, 'notFound', { category: category });
      return;
    }
    if (isAlreadyWrapped(fn)) {
      setHookStatus('fn:' + name, 'installed', { note: 'already wrapped — skipped re-wrap', category: category });
      return;
    }
    _trueOriginals['fn:' + name] = fn;
    global[name] = markWrapped(function () {
      var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
      var args = Array.prototype.slice.call(arguments);
      var result = fn.apply(this, arguments);
      if (enabled()) {
        var durationMs = +(((global.performance ? performance.now() : Date.now()) - t0)).toFixed(2);
        var detail = { args: safe(function () { return JSON.stringify(args).slice(0, 300); }), durationMs: durationMs };
        if (extra) { try { Object.assign(detail, extra(args, result) || {}); } catch (e) {} }
        log(category, name, detail);
        if (category === 'DOM' && /^render/.test(name)) {
          checkRenderLoop(name, t0);
          if (durationMs > LONG_RENDER_MS) {
            reportProblem('warning', 'LongRender', name + ' took ' + durationMs + 'ms (>' + LONG_RENDER_MS + 'ms)',
              { fnName: name, durationMs: durationMs });
          }
        }
      }
      return result;
    });
    setHookStatus('fn:' + name, 'installed', { category: category });
    // Preserve function identity length/name isn't critical here since
    // this app calls these purely by global name (onclick="renderTasks()"),
    // never by reference comparison.
  }

  function containerCountFor(moduleKey) {
    var id = CONTAINER_MAP[moduleKey];
    var el = id && global.document.getElementById(id);
    return el ? el.children.length : null;
  }

  function installLatePatches() {
    // --- 8a. render* functions -------------------------------------
    var renderMap = {
      renderTasks: 'tasks', renderCases: 'cases', renderClients: 'clients',
      renderSessions: 'sessions', renderDocuments: 'documents', renderFees: 'fees',
      renderChildren: 'children', renderLibrary: 'library', renderTemplates: 'templates',
      renderDashboard: null
    };
    Object.keys(renderMap).forEach(function (fnName) {
      var moduleKey = renderMap[fnName];
      wrapFunctionOnGlobal(fnName, 'DOM', function () {
        return moduleKey ? { childCountAfter: containerCountFor(moduleKey) } : {};
      });
    });

    // --- 8b. loadFromSheets ------------------------------------------
    wrapFunctionOnGlobal('loadFromSheets', 'Sync', function () { return {}; });

    // --- 8c. delete* functions (per module) ---------------------------
    ['deleteTask', 'deleteCase', 'deleteClient', 'deleteDocument', 'deleteFee',
      'deleteChild', 'deleteSession', 'deleteLibraryItem', 'deleteTemplate'
    ].forEach(function (fnName) {
      wrapFunctionOnGlobal(fnName, 'Repository', function (args) { return { targetIndexArg: args[0] }; });
    });

    // --- 8d. ApiService.* ----------------------------------------------
    if (global.ApiService) {
      var apiInstalledAny = false;
      ['loadData', 'loadAllSheets', 'saveData', 'updateData', 'syncRow', 'deleteData'].forEach(function (m) {
        var orig = global.ApiService[m];
        if (typeof orig !== 'function') { log('API', 'ApiService.' + m + ':notFound', {}); return; }
        if (isAlreadyWrapped(orig)) { apiInstalledAny = true; return; }
        _trueOriginals['api:' + m] = orig;
        global.ApiService[m] = markWrapped(function () {
          var args = Array.prototype.slice.call(arguments);
          var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
          var p = orig.apply(global.ApiService, arguments);
          if (enabled()) {
            log('API', 'ApiService.' + m + ':called', {
              args: safe(function () { return JSON.stringify(args).slice(0, 300); })
            });
            if (p && typeof p.then === 'function') {
              p.then(function (res) {
                var durationMs = +(((global.performance ? performance.now() : Date.now()) - t0)).toFixed(2);
                log('API', 'ApiService.' + m + ':resolved', {
                  durationMs: durationMs,
                  result: safe(function () { return JSON.stringify(res).slice(0, 300); })
                });
                if (durationMs > 1000) {
                  reportProblem('warning', 'SlowAPI', 'ApiService.' + m + ' took ' + durationMs + 'ms',
                    { method: m, durationMs: durationMs });
                }
              }).catch(function (err) {
                log('API', 'ApiService.' + m + ':rejected', { error: String(err) });
              });
            }
          }
          return p;
        });
        apiInstalledAny = true;
      });
      setHookStatus('api', apiInstalledAny ? 'installed' : 'notFound', {});
    } else {
      log('API', 'ApiService:notFound', {});
      setHookStatus('api', 'notFound', {});
    }

    // --- 8e. Repository.prototype.import / delete / restore ------------
    if (global.Repository && global.Repository.prototype) {
      var proto = global.Repository.prototype;
      var repoInstalledAny = false;
      ['import', 'delete', 'restore', 'create', 'update'].forEach(function (m) {
        var orig = proto[m];
        if (typeof orig !== 'function') { log('Repository', 'Repository.prototype.' + m + ':notFound', {}); return; }
        if (isAlreadyWrapped(orig)) { repoInstalledAny = true; return; }
        _trueOriginals['repo:' + m] = orig;
        proto[m] = markWrapped(function () {
          var self = this;
          var args = Array.prototype.slice.call(arguments);
          var entityKey = safe(function () { return self.entityKey; }) || '?';
          var recordsBefore = safe(function () { return self._records ? self._records.length : null; });
          var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
          var p = orig.apply(this, arguments);
          if (enabled() && p && typeof p.then === 'function') {
            p.then(function (result) {
              var durationMs = +(((global.performance ? performance.now() : Date.now()) - t0)).toFixed(2);
              log('Repository', 'Repository.' + m, {
                entity: entityKey,
                mode: m === 'import' ? args[1] : undefined,
                argsPreview: safe(function () { return JSON.stringify(args).slice(0, 200); }),
                recordsBefore: recordsBefore,
                recordsAfter: safe(function () { return self._records ? self._records.length : null; }),
                durationMs: durationMs,
                success: result && result.success
              });

              if (durationMs > 200) {
                reportProblem('warning', 'SlowRepository', 'Repository.' + m + ' (' + entityKey + ') took ' + durationMs + 'ms',
                  { entity: entityKey, method: m, durationMs: durationMs });
              }

              // --- Duplicate Repository Records: same id appearing twice.
              safe(function () {
                var recs = self._records || [];
                var counts = Object.create(null);
                var dupIds = [];
                recs.forEach(function (r) {
                  var id = r && r.id;
                  if (id === undefined || id === null) return;
                  counts[id] = (counts[id] || 0) + 1;
                });
                Object.keys(counts).forEach(function (id) { if (counts[id] > 1) dupIds.push(id); });
                if (dupIds.length) {
                  reportProblem('critical', 'DuplicateRepositoryRecord',
                    'Duplicate record IDs found in ' + entityKey, { entity: entityKey, ids: dupIds.slice(0, 10) });
                }
              });

              // --- Soft Delete Resurrection: a record we saw deleted comes
              // back as active (deleted !== true) under the same id.
              safe(function () {
                var deletedSet = _deletedIdsByEntity[entityKey] || (_deletedIdsByEntity[entityKey] = Object.create(null));
                if (m === 'delete') {
                  var deletedId = args[0];
                  if (deletedId !== undefined && deletedId !== null) deletedSet[deletedId] = true;
                  return;
                }
                var recs = self._records || [];
                recs.forEach(function (r) {
                  if (!r || r.id === undefined || r.id === null) return;
                  if (deletedSet[r.id] && r.deleted !== true) {
                    reportProblem('warning', 'SoftDeleteResurrection',
                      'Previously-deleted record reappeared as active in ' + entityKey,
                      { entity: entityKey, id: r.id, viaMethod: m });
                    delete deletedSet[r.id]; // one warning per resurrection, not one per subsequent read
                  }
                });
              });
            }).catch(function (err) {
              log('Repository', 'Repository.' + m + ':rejected', { entity: entityKey, error: String(err) });
            });
          }
          return p;
        });
        repoInstalledAny = true;
      });
      setHookStatus('repository', repoInstalledAny ? 'installed' : 'notFound', {});
    } else {
      log('Repository', 'Repository.prototype:notFound', {});
      setHookStatus('repository', 'notFound', {});
    }

    // --- 8f. DomRecycler.reconcile / DomKeyIndex.reset ------------------
    if (global.DomRecycler && typeof global.DomRecycler.reconcile === 'function') {
      if (isAlreadyWrapped(global.DomRecycler.reconcile)) {
        setHookStatus('domRecycler', 'installed', { note: 'already wrapped — skipped re-wrap' });
      } else {
        var origReconcile = global.DomRecycler.reconcile;
        _trueOriginals.domRecycler = origReconcile;
        global.DomRecycler.reconcile = markWrapped(function (container, rows, options) {
          var childCountBefore = safe(function () { return container ? container.children.length : null; });
          var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
          var rowsIn = rows ? rows.length : null;
          var containerId = safe(function () { return container && container.id; }) || null;
          var threw = null;
          var result;
          try {
            result = origReconcile.apply(this, arguments);
          } catch (reconcileError) {
            threw = reconcileError;
          }
          if (enabled()) {
            var durationMs = +(((global.performance ? performance.now() : Date.now()) - t0)).toFixed(2);
            if (threw) {
              // PHASE 17.4: this branch used to not exist at all — the
              // original call was unguarded, so a throw here (which
              // DomRecycler.reconcile does BY DESIGN on a bad/duplicate/
              // missing key — see js/core/dom/DomRecycler.js header,
              // "SAFETY") skipped every line below the old call,
              // including the reconciles++ counter. Every module that
              // calls reconcile() wraps it in its OWN try/catch and
              // silently falls back to a full rebuild on failure, so a
              // reconcile() that fails on every single call in a
              // session would previously show up as "reconciles: 0"
              // with zero evidence of why — indistinguishable from
              // "reconcile was simply never called."
              _domRecyclerStats.reconcileErrors++;
              log('DomRecycler', 'reconcile:threw', {
                containerId: containerId, rowsIn: rowsIn, durationMs: durationMs,
                error: safe(function () { return String(threw && threw.message || threw); })
              });
              reportProblem('critical', 'DomRecyclerReconcileThrew',
                'DomRecycler.reconcile() threw and fell back to the legacy renderer for ' + (containerId || 'an unlabeled container'),
                { containerId: containerId, rowsIn: rowsIn, error: safe(function () { return String(threw && threw.message || threw); }) });
            } else {
              var childCountAfter = safe(function () { return container ? container.children.length : null; });
              log('DomRecycler', 'reconcile', {
                containerId: containerId, rowsIn: rowsIn,
                childCountBefore: childCountBefore, childCountAfter: childCountAfter,
                durationMs: durationMs
              });

              // Proxy statistics only (DomRecycler internals are not touched
              // or observed directly — see file header, "Known coverage
              // limits"). created/removed here are *external* deltas, not the
              // recycler's own counters.
              _domRecyclerStats.reconciles++;
              if (typeof childCountBefore === 'number' && typeof childCountAfter === 'number') {
                if (childCountAfter > childCountBefore) _domRecyclerStats.createdApprox += (childCountAfter - childCountBefore);
                else if (childCountAfter < childCountBefore) _domRecyclerStats.removedApprox += (childCountBefore - childCountAfter);

                // Zombie/orphaned-node heuristic: container ends up with
                // noticeably more children than rows actually passed in.
                if (rowsIn !== null && rowsIn >= 0 && childCountAfter > rowsIn + Math.max(3, Math.ceil(rowsIn * 0.5))) {
                  reportProblem('warning', 'PossibleZombieNodes',
                    'Container has more children than rows passed to reconcile()',
                    { containerId: containerId, rowsIn: rowsIn, childCountAfter: childCountAfter });
                }
              }
            }
          }
          // Behavior for the caller is UNCHANGED: a throw is re-thrown
          // as-is (same error, same stack), a success returns the same
          // stats object DomRecycler.reconcile always returned. This
          // wrapper only ever adds visibility, never changes outcome.
          if (threw) throw threw;
          return result;
        });
        setHookStatus('domRecycler', 'installed', { note: 'DomRecycler.reconcile wrapped' });
      }
    } else {
      log('DomRecycler', 'DomRecycler.reconcile:notFound', {});
      setHookStatus('domRecycler', 'notFound', { note: 'window.DomRecycler.reconcile did not exist at DOMContentLoaded time' });
    }

    if (global.DomKeyIndex && typeof global.DomKeyIndex.reset === 'function') {
      if (isAlreadyWrapped(global.DomKeyIndex.reset)) {
        setHookStatus('domKeyIndex', 'installed', { note: 'already wrapped — skipped re-wrap' });
      } else {
        var origReset = global.DomKeyIndex.reset;
        _trueOriginals.domKeyIndex = origReset;
        global.DomKeyIndex.reset = markWrapped(function (container) {
          if (enabled()) {
            log('DomRecycler', 'DomKeyIndex.reset', {
              containerId: safe(function () { return container && container.id; }) || null
            });
          }
          return origReset.apply(this, arguments);
        });
        setHookStatus('domKeyIndex', 'installed', {});
      }
    } else {
      log('DomRecycler', 'DomKeyIndex.reset:notFound', {});
      setHookStatus('domKeyIndex', 'notFound', {});
    }

    // --- 8g. Splash + mutation watchers ---------------------------------
    installSplashWatcher();
    Object.keys(CONTAINER_MAP).forEach(function (moduleKey) {
      installMutationWatcher(moduleKey, CONTAINER_MAP[moduleKey]);
    });
    setHookStatus('observers', _ownObserverCount > 0 ? 'installed' : 'notFound',
      { count: _ownObserverCount, note: 'splash watcher + per-module list-container watchers' });

    // --- 8h. Phase 17.3 periodic detectors (overlay, memory-leak samples,
    //         auto-analysis) — see functions defined below in this file.
    installPeriodicChecks();

    log('Startup', 'installLatePatches:complete', {
      elapsedMsSinceScriptParse: +((Date.now() - _startTime)).toFixed(2)
    });
  }

  global.addEventListener('DOMContentLoaded', installLatePatches);

  // ------------------------------------------------------------------
  // 8i. Phase 17.3 periodic detectors — DOM overlay stuck/duplicated,
  //     memory-leak sample trend, and a lightweight auto-analysis tick.
  //     These are the only detectors that need a clock rather than an
  //     event hook, so they share one interval to keep the "OFF costs
  //     nothing" story simple: exactly one timer exists, and only when
  //     Diagnostics is ON in the first place.
  // ------------------------------------------------------------------
  var OVERLAY_CHECK_INTERVAL_MS = 3000;
  var LEAK_SAMPLE_WINDOW = 10; // keep last 10 samples (~30s at the interval above)
  var AUTO_ANALYSIS_EVERY_N_TICKS = 20; // 20 * 3s = 60s
  var _periodicIntervalId = null;

  function checkSplashOverlay() {
    safe(function () {
      var splash = global.document.getElementById('splashScreen');
      if (!splash) return;
      var flags = computedFlags(splash);
      var stillVisible = flags.display !== 'none' && flags.visibility !== 'hidden' && flags.opacity !== '0';
      var msSinceStart = Date.now() - _startTime;
      if (stillVisible && msSinceStart > 15000) {
        reportProblem('critical', 'SplashStuck', 'Splash screen still visible ' + Math.round(msSinceStart / 1000) + 's after load', flags);
      }
    });
  }

  function checkOverlayStack() {
    safe(function () {
      var all = global.document.querySelectorAll('body *');
      var visibleLargeOverlays = 0;
      var vw = global.innerWidth || 0, vh = global.innerHeight || 0;
      var minArea = (vw * vh) * 0.5;
      for (var i = 0; i < all.length && i < 4000; i++) {
        var el = all[i];
        // Skip this framework's own UI so it never flags itself.
        if (el === _btnEl || el === _panelEl || (_panelEl && _panelEl.contains(el))) continue;
        var cs = safe(function () { return global.getComputedStyle(el); });
        if (!cs) continue;
        if ((cs.position === 'fixed' || cs.position === 'absolute') &&
            cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') {
          var r = safe(function () { return el.getBoundingClientRect(); });
          if (r && (r.width * r.height) >= minArea) visibleLargeOverlays++;
        }
      }
      if (visibleLargeOverlays > 1) {
        reportProblem('warning', 'DomOverlayDetected',
          visibleLargeOverlays + ' large fixed/absolute overlays visible at once (e.g. dashboard under a stuck modal/splash)',
          { count: visibleLargeOverlays });
      }
    });
  }

  var _tickCount = 0;
  function periodicTick() {
    if (!enabled()) return;
    _tickCount++;
    checkSplashOverlay();
    checkOverlayStack();

    // --- Memory-leak indicator: sample a few monotonic-risk counters and
    // flag only if EVERY recent sample strictly increased (a real leak
    // trend, not a one-off spike from a legitimate burst of activity).
    safe(function () {
      _leakSamples.push({
        t: Date.now(),
        listeners: _liveListenerCount,
        intervals: _liveIntervalCount,
        observers: _mutationObserverInstances
      });
      if (_leakSamples.length > LEAK_SAMPLE_WINDOW) _leakSamples.shift();
      if (_leakSamples.length === LEAK_SAMPLE_WINDOW) {
        ['listeners', 'intervals', 'observers'].forEach(function (metric) {
          var strictlyIncreasing = true;
          for (var i = 1; i < _leakSamples.length; i++) {
            if (_leakSamples[i][metric] <= _leakSamples[i - 1][metric]) { strictlyIncreasing = false; break; }
          }
          var grew = _leakSamples[_leakSamples.length - 1][metric] - _leakSamples[0][metric];
          if (strictlyIncreasing && grew > 5) {
            reportProblem('warning', 'PossibleMemoryLeak',
              'Live ' + metric + ' count has grown every sample for the last ' + LEAK_SAMPLE_WINDOW + ' checks (+' + grew + ')',
              { metric: metric, samples: _leakSamples.map(function (s) { return s[metric]; }) });
          }
        });
      }
    });

    if (_tickCount % AUTO_ANALYSIS_EVERY_N_TICKS === 0) {
      _lastAnalysis = computeAutoAnalysis();
      log('Health', 'autoAnalysis:tick', { at: _lastAnalysis.at });
    }
  }

  function installPeriodicChecks() {
    if (_periodicIntervalId !== null) return; // already running — never install a second interval
    _periodicIntervalId = global.setInterval(periodicTick, OVERLAY_CHECK_INTERVAL_MS);
    setHookStatus('periodicChecks', 'installed', { intervalMs: OVERLAY_CHECK_INTERVAL_MS });
  }

  // --- Auto Analysis (runs every ~60s; also computed on demand by
  //     generateAnalysisReport()) ---------------------------------------
  function computeAutoAnalysis() {
    var errorCounts = Object.create(null);
    var renderDurations = Object.create(null); // fnName -> [durationMs,...]
    var categoryCounts = Object.create(null);
    var categoryDurations = Object.create(null); // category -> [durationMs,...]

    _events.forEach(function (e) {
      categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
      if (e.detail && typeof e.detail.durationMs === 'number') {
        (categoryDurations[e.category] || (categoryDurations[e.category] = [])).push(e.detail.durationMs);
      }
      if (e.category === 'Console' && (e.name === 'error' || e.name === 'window.onerror' || e.name === 'unhandledrejection')) {
        var key = safe(function () { return (e.detail && (e.detail.message || JSON.stringify(e.detail))) || e.name; }) || e.name;
        errorCounts[key] = (errorCounts[key] || 0) + 1;
      }
      if (e.category === 'DOM' && /^render/.test(e.name) && e.detail && typeof e.detail.durationMs === 'number') {
        (renderDurations[e.name] || (renderDurations[e.name] = [])).push(e.detail.durationMs);
      }
    });

    function topByCount(obj) {
      var best = null, bestCount = -1;
      Object.keys(obj).forEach(function (k) { if (obj[k] > bestCount) { best = k; bestCount = obj[k]; } });
      return best ? { key: best, count: bestCount } : null;
    }
    function maxOf(arr) { return arr.length ? Math.max.apply(null, arr) : null; }
    function avgOf(arr) { return arr.length ? (arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) : null; }

    var mostExpensiveRenderFn = null, mostExpensiveRenderMs = -1;
    Object.keys(renderDurations).forEach(function (fnName) {
      var m = maxOf(renderDurations[fnName]);
      if (m !== null && m > mostExpensiveRenderMs) { mostExpensiveRenderMs = m; mostExpensiveRenderFn = fnName; }
    });

    var slowestModule = null, slowestModuleAvg = -1;
    Object.keys(categoryDurations).forEach(function (cat) {
      var a = avgOf(categoryDurations[cat]);
      if (a !== null && a > slowestModuleAvg) { slowestModuleAvg = a; slowestModule = cat; }
    });

    return {
      at: new Date().toISOString(),
      mostFrequentError: topByCount(errorCounts),
      mostActiveModule: topByCount(categoryCounts),
      mostExpensiveRender: mostExpensiveRenderFn ? { fnName: mostExpensiveRenderFn, durationMs: mostExpensiveRenderMs } : null,
      slowestModule: slowestModule ? { category: slowestModule, avgDurationMs: +slowestModuleAvg.toFixed(2) } : null,
      largestDOM: safe(function () { return global.document.getElementsByTagName('*').length; })
    };
  }

  // --- Health (color status + counts, powers the Health tab) -----------
  function computeHealth() {
    var recentWindowMs = 60000;
    var now = (global.performance && performance.now) ? performance.now() : Date.now();
    var recentCritical = 0, recentWarning = 0;
    var totalCritical = 0, totalWarning = 0;
    _problems.forEach(function (p) {
      if (p.severity === 'critical') { totalCritical++; if ((now - p.t) <= recentWindowMs) recentCritical++; }
      else { totalWarning++; if ((now - p.t) <= recentWindowMs) recentWarning++; }
    });
    var s = computeSummary();
    var status = 'healthy';
    if (recentCritical > 0 || s.errors > 0) status = 'critical';
    else if (recentWarning > 0) status = 'warning';
    return {
      status: status, // 'healthy' | 'warning' | 'critical'
      icon: status === 'critical' ? '\uD83D\uDD34' : (status === 'warning' ? '\uD83D\uDFE1' : '\uD83D\uDFE2'),
      errors: s.errors,
      totalProblems: _problems.length,
      criticalProblems: totalCritical,
      warningProblems: totalWarning,
      recentCriticalProblems: recentCritical,
      recentWarningProblems: recentWarning,
      domRecyclerStats: {
        reconciles: _domRecyclerStats.reconciles,
        createdApprox: _domRecyclerStats.createdApprox,
        removedApprox: _domRecyclerStats.removedApprox,
        reconcileErrors: _domRecyclerStats.reconcileErrors
      },
      lastAnalysis: _lastAnalysis
    };
  }

  // ------------------------------------------------------------------
  // Phase 17.4 §6 — Diagnostics Integrity: "is the framework itself
  // actually working," answered from the hook-status ledger every wrap
  // site above updates, never from assumption.
  // ------------------------------------------------------------------
  function computeIntegrity() {
    var hookNames = Object.keys(_hooks);
    var renderHookNames = hookNames.filter(function (k) { return /^fn:render/.test(k); });
    var deleteHookNames = hookNames.filter(function (k) { return /^fn:delete/.test(k); });

    function summarize(names) {
      var installed = 0, failed = 0, notFound = 0;
      names.forEach(function (k) {
        var st = _hooks[k] && _hooks[k].status;
        if (st === 'installed') installed++;
        else if (st === 'failed') failed++;
        else notFound++;
      });
      return { installed: installed, failed: failed, notFound: notFound, total: names.length };
    }

    var installedCount = hookNames.filter(function (k) { return _hooks[k].status === 'installed'; }).length;
    var failedNames = hookNames.filter(function (k) { return _hooks[k].status === 'failed'; });

    return {
      sessionId: _sessionId,
      runtimeLoaded: true, // if this code is executing at all, the file loaded
      diagnosticsEnabled: enabled(),
      hooksInstalled: installedCount,
      hooksFailed: failedNames.length,
      failedHookNames: failedNames,
      wrappedFunctions: hookNames.filter(function (k) { return k.indexOf('fn:') === 0; }).map(function (k) { return k.slice(3); }),
      domRecyclerHookStatus: (_hooks.domRecycler && _hooks.domRecycler.status) || 'unknown',
      domKeyIndexHookStatus: (_hooks.domKeyIndex && _hooks.domKeyIndex.status) || 'unknown',
      repositoryHookStatus: (_hooks.repository && _hooks.repository.status) || 'unknown',
      renderHookStatus: summarize(renderHookNames),
      deleteHookStatus: summarize(deleteHookNames),
      apiHookStatus: (_hooks.api && _hooks.api.status) || 'unknown',
      storageHookStatus: (_hooks.storage && _hooks.storage.status) || 'unknown',
      eventHookStatus: (_hooks.eventListener && _hooks.eventListener.status) || 'unknown',
      consoleHookStatus: (_hooks.console && _hooks.console.status) || 'unknown',
      fetchHookStatus: (_hooks.fetch && _hooks.fetch.status) || 'unknown',
      timersHookStatus: (_hooks.timers && _hooks.timers.status) || 'unknown',
      observersInstalled: _ownObservers.length,
      observersRunning: _ownObservers.filter(function (o) { return !o.__rdlDisconnected; }).length,
      intervalsRunning: _liveIntervalCount,
      currentSession: {
        id: _sessionId,
        startedAt: new Date(_startTime).toISOString(),
        eventCount: _events.length,
        problemCount: _problems.length
      },
      raw: _hooks
    };
  }

  // ------------------------------------------------------------------
  // Phase 17.4 §7 — Self Test. Deliberately non-invasive: it never calls
  // real Repository/API methods against real data (that would risk
  // mutating the person's actual case/task/client records just to run a
  // diagnostic). Instead it verifies, for each hook, that the live
  // function currently installed on the target object is the one THIS
  // framework put there (via the `__rdlWrapped` marker every wrap site
  // sets), plus one genuinely-exercised end-to-end check where it's safe
  // to do so (a throwaway DOM element + a real addEventListener/
  // removeEventListener round-trip, and a real MutationObserver on a
  // throwaway element).
  // ------------------------------------------------------------------
  function runSelfTest() {
    var results = [];
    function check(name, fn) {
      var r;
      try { r = fn(); } catch (e) { r = { pass: false, detail: 'threw: ' + String(e && e.message || e) }; }
      results.push({ name: name, pass: !!(r && r.pass), detail: (r && r.detail) || '', skipped: !!(r && r.skipped) });
    }

    check('DomRecycler Hook', function () {
      if (!global.DomRecycler) return { pass: false, skipped: true, detail: 'window.DomRecycler not present on this page load' };
      return { pass: isAlreadyWrapped(global.DomRecycler.reconcile), detail: 'reconcile.__rdlWrapped === ' + isAlreadyWrapped(global.DomRecycler.reconcile) };
    });

    check('Repository Hook', function () {
      if (!global.Repository || !global.Repository.prototype) return { pass: false, skipped: true, detail: 'window.Repository not present on this page load' };
      var anyWrapped = ['import', 'delete', 'restore', 'create', 'update'].some(function (m) {
        return isAlreadyWrapped(global.Repository.prototype[m]);
      });
      return { pass: anyWrapped, detail: 'at least one of import/delete/restore/create/update is wrapped: ' + anyWrapped };
    });

    check('Event Hook (real round-trip)', function () {
      var el = global.document.createElement('div');
      var before = _events.length;
      var fn = function () {};
      el.addEventListener('rdl-self-test', fn);
      el.removeEventListener('rdl-self-test', fn);
      var after = _events.length;
      return {
        pass: isAlreadyWrapped(global.EventTarget.prototype.addEventListener) && after > before,
        detail: 'addEventListener.__rdlWrapped=' + isAlreadyWrapped(global.EventTarget.prototype.addEventListener) + ', events logged for the round-trip=' + (after - before)
      };
    });

    check('Mutation Observer Hook (real round-trip)', function () {
      if (!global.MutationObserver) return { pass: false, skipped: true, detail: 'window.MutationObserver not present' };
      var wrapped = isAlreadyWrapped(global.MutationObserver);
      var before = _mutationObserverInstances;
      var el = global.document.createElement('div');
      var mo = new global.MutationObserver(function () {});
      mo.observe(el, { childList: true });
      mo.disconnect();
      return { pass: wrapped && _mutationObserverInstances > before, detail: 'constructor wrapped=' + wrapped + ', instance counter moved ' + before + ' -> ' + _mutationObserverInstances };
    });

    check('Console Hook', function () {
      return { pass: isAlreadyWrapped(console.log) && isAlreadyWrapped(console.error), detail: 'console.log/error wrapped' };
    });

    check('Storage Hook', function () {
      if (!global.localStorage) return { pass: false, skipped: true, detail: 'window.localStorage not present' };
      return { pass: isAlreadyWrapped(global.localStorage.setItem), detail: 'localStorage.setItem.__rdlWrapped=' + isAlreadyWrapped(global.localStorage.setItem) };
    });

    check('Fetch Hook', function () {
      if (!global.fetch) return { pass: false, skipped: true, detail: 'window.fetch not present' };
      return { pass: isAlreadyWrapped(global.fetch), detail: 'fetch.__rdlWrapped=' + isAlreadyWrapped(global.fetch) };
    });

    var summary = { passed: results.filter(function (r) { return r.pass; }).length,
      failed: results.filter(function (r) { return !r.pass && !r.skipped; }).length,
      skipped: results.filter(function (r) { return r.skipped; }).length,
      total: results.length, at: new Date().toISOString(), results: results };
    log('Health', 'selfTest:run', summary);
    return summary;
  }

  // ------------------------------------------------------------------
  // Phase 17.4 §8 — uninstall/reinstall. SCOPE, STATED PLAINLY: this
  // fully restores every late-patch wrap (render*/delete*/ApiService/
  // Repository.prototype/DomRecycler.reconcile/DomKeyIndex.reset) to the
  // exact pre-wrap function via `_trueOriginals`, disconnects every
  // observer and clears every interval THIS framework started, and tears
  // down the UI. It deliberately does NOT unwind the foundational
  // low-level interceptors installed once at parse time (EventTarget.
  // prototype.addEventListener/removeEventListener, setTimeout/
  // setInterval/clearInterval/requestAnimationFrame, console.*,
  // localStorage/sessionStorage, fetch, the MutationObserver
  // constructor) — those stay installed as inert pass-throughs for the
  // rest of this page load, exactly like this file's pre-existing
  // `RUNTIME_DEBUG = false` behavior already worked (see file header).
  // Rewinding those safely would mean trusting that nothing else on the
  // page captured a reference to the wrapped version in the meantime,
  // which cannot be proven from in here — so this is honest about what
  // "uninstall" does and does not undo, rather than claiming a full
  // teardown it can't guarantee.
  // ------------------------------------------------------------------
  function uninstallFramework() {
    if (_periodicIntervalId !== null) {
      (global.clearInterval || function () {}).call(global, _periodicIntervalId);
      _periodicIntervalId = null;
    }
    _ownObservers.forEach(function (o) { safe(function () { o.disconnect(); o.__rdlDisconnected = true; }); });
    _ownObservers.length = 0;
    _ownObserverCount = 0;
    _splashWatcherInstalled = false;
    _mutationWatchersInstalled = Object.create(null);

    Object.keys(_trueOriginals).forEach(function (k) {
      safe(function () {
        if (k.indexOf('fn:') === 0) { global[k.slice(3)] = _trueOriginals[k]; }
        else if (k.indexOf('api:') === 0) { if (global.ApiService) global.ApiService[k.slice(4)] = _trueOriginals[k]; }
        else if (k.indexOf('repo:') === 0) { if (global.Repository && global.Repository.prototype) global.Repository.prototype[k.slice(5)] = _trueOriginals[k]; }
        else if (k === 'domRecycler') { if (global.DomRecycler) global.DomRecycler.reconcile = _trueOriginals[k]; }
        else if (k === 'domKeyIndex') { if (global.DomKeyIndex) global.DomKeyIndex.reset = _trueOriginals[k]; }
      });
    });
    _trueOriginals = Object.create(null);

    if (_btnEl && _btnEl.parentNode) { safe(function () { _btnEl.parentNode.removeChild(_btnEl); }); }
    _btnEl = null;
    closePanel();

    global.RUNTIME_DEBUG = false;
    Object.keys(_hooks).forEach(function (k) { delete _hooks[k]; });
    log('Startup', 'uninstall:latePatchesAndUi:complete', {
      note: 'late-patch wraps restored to true originals; framework-owned timers/observers stopped; UI removed'
    });
  }

  function reinstallFramework() {
    global.RUNTIME_DEBUG = true;
    installLatePatches(); // every wrap site inside is guarded by isAlreadyWrapped() — never double-wraps
    log('Startup', 'reinstall:complete', {});
  }

  // --- Smart Report: human-readable text, not just JSON ------------------
  function generateAnalysisReport() {
    var analysis = _lastAnalysis || computeAutoAnalysis();
    var health = computeHealth();
    var lines = [];
    lines.push('Runtime Analysis Report');
    lines.push('Generated: ' + new Date().toISOString());
    lines.push('Status: ' + health.icon + ' ' + health.status.toUpperCase());
    lines.push('');
    lines.push('-- Root Cause Candidates --');
    var bySeverity = _problems.slice(-100).reverse();
    if (!bySeverity.length) {
      lines.push('(none detected this session)');
    } else {
      var typeCounts = Object.create(null);
      bySeverity.forEach(function (p) { typeCounts[p.type] = (typeCounts[p.type] || 0) + 1; });
      Object.keys(typeCounts).sort(function (a, b) { return typeCounts[b] - typeCounts[a]; }).slice(0, 8).forEach(function (t) {
        lines.push('  [' + typeCounts[t] + 'x] ' + t);
      });
    }
    lines.push('');
    lines.push('-- Timeline (most recent problems) --');
    bySeverity.slice(0, 20).forEach(function (p) {
      lines.push('  ' + p.iso + '  [' + p.severity + ']  ' + p.type + ' — ' + p.message);
    });
    lines.push('');
    lines.push('-- Warnings --');
    var warnings = _problems.filter(function (p) { return p.severity === 'warning'; }).slice(-15);
    if (!warnings.length) lines.push('(none)');
    warnings.forEach(function (p) { lines.push('  - ' + p.message); });
    lines.push('');
    lines.push('-- Performance --');
    lines.push('  Most expensive render: ' + (analysis.mostExpensiveRender ? analysis.mostExpensiveRender.fnName + ' (' + analysis.mostExpensiveRender.durationMs + 'ms)' : 'n/a'));
    lines.push('  Slowest module (avg): ' + (analysis.slowestModule ? analysis.slowestModule.category + ' (' + analysis.slowestModule.avgDurationMs + 'ms avg)' : 'n/a'));
    lines.push('  Most active module: ' + (analysis.mostActiveModule ? analysis.mostActiveModule.key + ' (' + analysis.mostActiveModule.count + ' events)' : 'n/a'));
    lines.push('  Largest DOM seen: ' + analysis.largestDOM + ' elements');
    lines.push('  DomRecycler reconciles: ' + health.domRecyclerStats.reconciles +
      ' (approx +' + health.domRecyclerStats.createdApprox + ' / -' + health.domRecyclerStats.removedApprox + ' nodes)');
    lines.push('');
    lines.push('-- Suggestions --');
    var suggestionMap = {
      DuplicateDomNode: 'Check the reconcile()/key-index logic for this list — the same key is producing two DOM nodes.',
      DuplicateRepositoryRecord: 'Check import()/merge logic — the same id is being inserted more than once.',
      SoftDeleteResurrection: 'Check import()/restore() ordering — a soft-deleted record is being re-activated.',
      SplashStuck: 'Check whatever is supposed to hide #splashScreen after boot — it never ran or threw before reaching that call.',
      DomOverlayDetected: 'Check for a modal/splash/loading screen that isn\'t being torn down when it should be.',
      RenderLoop: 'Check what is re-triggering this render — likely a listener or observer calling it recursively.',
      InfiniteRefresh: 'Check for a retry/poll loop hitting the same endpoint without backoff.',
      DoubleEventListener: 'Check for a listener being attached more than once (e.g. on every render instead of once at init).',
      PossibleMemoryLeak: 'Check for listeners/timers/observers created repeatedly without a matching cleanup.',
      LongRender: 'Check this render function for O(n^2) work or unnecessary full re-renders on a large list.',
      SlowRepository: 'Check this repository operation for large payloads or a missing index.',
      SlowAPI: 'Check network conditions or payload size for this API call.',
      LargeDOM: 'Check for nodes that should have been removed/recycled but weren\'t.',
      PossibleZombieNodes: 'Check reconcile() for a mismatch between rows passed in and nodes actually kept in the container.'
    };
    var seen = {};
    bySeverity.forEach(function (p) {
      if (seen[p.type]) return;
      seen[p.type] = true;
      if (suggestionMap[p.type]) lines.push('  - [' + p.type + '] ' + suggestionMap[p.type]);
    });
    if (!Object.keys(seen).length) lines.push('(nothing to suggest — no problems detected this session)');
    return lines.join('\n');
  }

  // ------------------------------------------------------------------
  // 9. Public API (usable from the console — important on mobile where
  //    Ctrl+Shift+D does not exist and DevTools may be unavailable; use
  //    the floating button instead, see UI section below).
  // ------------------------------------------------------------------
  global.RuntimeDebug = {
    enable: function () { global.RUNTIME_DEBUG = true; writeEnabledPref(true); log('Startup', 'RuntimeDebug.enable', {}); refreshBadge(); },
    disable: function () { log('Startup', 'RuntimeDebug.disable', {}); global.RUNTIME_DEBUG = false; writeEnabledPref(false); refreshBadge(); },
    clear: function () { _events.length = 0; _seq = 0; _carriedOverCount = 0; _problems.length = 0; safe(function () { global.localStorage && global.localStorage.removeItem(PERSIST_KEY); }); },
    getLog: function () { return _events.slice(); },
    getProblems: function () { return _problems.slice(); },
    exportReport: exportReport,
    copyReport: copyReportToClipboard,
    getSummary: computeSummary,
    getHealth: computeHealth,
    generateAnalysisReport: generateAnalysisReport,
    isEnabled: enabled,
    // --- Phase 17.3: master framework toggle (separate from `enable`/
    // `disable`, which only pause/resume *recording* while the framework
    // itself stays installed for the rest of this page load). These
    // control whether the framework installs at all on the *next* load.
    isDiagnosticsEnabled: function () { return true; },
    enableDiagnostics: function () { writeDiagnosticsPref(true); },
    disableDiagnostics: function () {
      writeDiagnosticsPref(false);
      global.RUNTIME_DEBUG = false;
      writeEnabledPref(false);
      if (_btnEl && _btnEl.parentNode) { _btnEl.parentNode.removeChild(_btnEl); }
      _btnEl = null;
      closePanel();
    },
    // --- Phase 17.4 additions ---
    getIntegrity: computeIntegrity,
    runSelfTest: runSelfTest,
    uninstall: uninstallFramework,
    reinstall: reinstallFramework
  };

  // ------------------------------------------------------------------
  // 8h. Summary counters — powers the "Dashboard" tab and the report's
  //     `summary` block, so findings are readable without scrolling raw
  //     events (useful when the only way to inspect this is a phone screen).
  // ------------------------------------------------------------------
  function computeSummary() {
    var s = {
      totalEvents: _events.length,
      carriedOverFromPreviousSession: _carriedOverCount,
      errors: 0,
      renders: {},
      domRecyclerReconciles: 0,
      repositoryOps: { create: 0, update: 0, delete: 0, import: 0, restore: 0 },
      deleteButtonCalls: 0,
      apiCalls: 0,
      syncFetches: 0,
      googleSheetsSync: 0,
      domMutations: 0,
      lastError: null,
      lastStackTrace: null
    };
    _events.forEach(function (e) {
      if (e.category === 'Console' && (e.name === 'error' || e.name === 'window.onerror' || e.name === 'unhandledrejection')) {
        s.errors++;
        s.lastError = { name: e.name, detail: e.detail, iso: e.iso };
        if (e.stack) s.lastStackTrace = e.stack;
      }
      if (e.category === 'DOM' && /^render/.test(e.name)) {
        s.renders[e.name] = (s.renders[e.name] || 0) + 1;
      }
      if (e.category === 'DomRecycler' && e.name === 'reconcile') s.domRecyclerReconciles++;
      if (e.category === 'Repository') {
        if (/^Repository\.create/.test(e.name)) s.repositoryOps.create++;
        else if (/^Repository\.update/.test(e.name)) s.repositoryOps.update++;
        else if (/^Repository\.delete/.test(e.name)) s.repositoryOps.delete++;
        else if (/^Repository\.import/.test(e.name)) s.repositoryOps.import++;
        else if (/^Repository\.restore/.test(e.name)) s.repositoryOps.restore++;
        else if (/^delete[A-Z]/.test(e.name)) s.deleteButtonCalls++;
      }
      if (e.category === 'API' && /:called$/.test(e.name)) s.apiCalls++;
      if (e.category === 'Sync' && e.name === 'fetch:done') s.syncFetches++;
      if (e.category === 'Sync' && e.name === 'loadFromSheets') s.googleSheetsSync++;
      if (e.category === 'DOM' && /mutation/i.test(e.name)) s.domMutations++;
    });
    return s;
  }

  function buildReportObject() {
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        sessionStartedAt: new Date(_startTime).toISOString(),
        userAgent: global.navigator ? global.navigator.userAgent : null,
        url: global.location ? global.location.href : null,
        eventCount: _events.length,
        carriedOverFromPreviousSession: _carriedOverCount,
        note: 'Diagnostic-only export. See js/debug/RuntimeDebugLayer.js header for coverage limits.'
      },
      summary: computeSummary(),
      health: computeHealth(),
      problems: _problems,
      events: _events
    };
  }

  function downloadTextFile(filename, mime, text) {
    safe(function () {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = filename;
      global.document.body.appendChild(a);
      a.click();
      safe(function () { global.document.body.removeChild(a); });
      safe(function () { URL.revokeObjectURL(url); });
    });
  }

  function buildMarkdownReport() {
    var report = buildReportObject();
    var lines = ['# Runtime Diagnostics Report', '', '_Generated: ' + report.meta.generatedAt + '_', ''];
    lines.push('## Health');
    lines.push('- Status: ' + report.health.icon + ' ' + report.health.status);
    lines.push('- Errors: ' + report.health.errors);
    lines.push('- Critical problems: ' + report.health.criticalProblems);
    lines.push('- Warning problems: ' + report.health.warningProblems);
    lines.push('');
    lines.push('## Summary');
    Object.keys(report.summary).forEach(function (k) {
      if (k === 'lastError' || k === 'lastStackTrace' || k === 'renders' || k === 'repositoryOps') return;
      lines.push('- ' + k + ': ' + report.summary[k]);
    });
    lines.push('');
    lines.push('## Problems (' + report.problems.length + ')');
    report.problems.slice(-100).forEach(function (p) {
      lines.push('- `' + p.severity + '` **' + p.type + '** — ' + p.message + ' _(' + p.iso + ')_');
    });
    lines.push('');
    lines.push('## Analysis');
    lines.push('```');
    lines.push(generateAnalysisReport());
    lines.push('```');
    return lines.join('\n');
  }

  function exportReport(format) {
    var report = buildReportObject();
    format = format || 'json';
    if (format === 'txt') {
      downloadTextFile('runtime-analysis.txt', 'text/plain', generateAnalysisReport());
    } else if (format === 'md') {
      downloadTextFile('runtime-report.md', 'text/markdown', buildMarkdownReport());
    } else {
      downloadTextFile('runtime-report.json', 'application/json', JSON.stringify(report, null, 2));
    }
    return report;
  }

  // ------------------------------------------------------------------
  // 8i. Clipboard copy — the primary export path on phones, where a file
  //     download is often unavailable or hard to reach (no Files app
  //     access, in-app WebView, etc.). Report can then be pasted straight
  //     into a chat with the analyst.
  // ------------------------------------------------------------------
  function legacyCopy(text, done) {
    var ok = safe(function () {
      var ta = global.document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      global.document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var res = global.document.execCommand && global.document.execCommand('copy');
      global.document.body.removeChild(ta);
      return !!res;
    });
    done(!!ok);
  }

  function copyReportToClipboard(onDone) {
    var json = JSON.stringify(buildReportObject(), null, 2);
    function done(ok) { if (typeof onDone === 'function') onDone(ok); }
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(json).then(function () { done(true); })
        .catch(function () { legacyCopy(json, done); });
    } else {
      legacyCopy(json, done);
    }
  }

  // ------------------------------------------------------------------
  // 10. Minimal debug UI — floating button (mobile-friendly, no keyboard
  //     needed) + Ctrl+Shift+D on desktop. Tabs filter the same log.
  // ------------------------------------------------------------------
  var _panelEl = null, _btnEl = null, _uiRefresh = null;
  var TABS = ['Dashboard', 'Health', 'Integrity', 'Console', 'DOM', 'Repository', 'DomRecycler', 'API', 'Sync', 'Events', 'Performance', 'Storage', 'Splash', 'Startup'];
  var _activeTab = 'Dashboard';
  var _lastSelfTest = null;

  function refreshBadge() {
    if (_btnEl) _btnEl.style.background = enabled() ? '#c0392b' : '#555';
  }

  function buildUI() {
    if (_btnEl || !global.document.body) return;

    _btnEl = global.document.createElement('div');
    _btnEl.textContent = 'RD';
    _btnEl.title = 'Runtime Debug (tap to open, long-press-safe)';
    _btnEl.setAttribute('style',
      'position:fixed;left:10px;bottom:10px;z-index:2147483647;' +
      'width:40px;height:40px;border-radius:50%;background:#555;color:#fff;' +
      'display:flex;align-items:center;justify-content:center;font:bold 12px sans-serif;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer;opacity:.85;user-select:none;');
    _btnEl.addEventListener('click', function () { togglePanel(); });
    global.document.body.appendChild(_btnEl);
    refreshBadge();

    global.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        togglePanel();
      }
    });
  }

  function togglePanel() {
    if (_panelEl) { closePanel(); return; }
    openPanel();
  }

  function closePanel() {
    if (_panelEl && _panelEl.parentNode) _panelEl.parentNode.removeChild(_panelEl);
    _panelEl = null;
    _uiRefresh = null;
  }

  function openPanel() {
    _panelEl = global.document.createElement('div');
    _panelEl.setAttribute('style',
      'position:fixed;left:8px;right:8px;bottom:56px;top:8px;z-index:2147483647;' +
      'background:#111;color:#ddd;font:11px/1.4 monospace;border-radius:8px;' +
      'display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.5);');

    var header = global.document.createElement('div');
    header.setAttribute('style', 'display:flex;align-items:center;gap:6px;padding:6px;background:#000;flex-wrap:wrap;');

    var toggleBtn = mkBtn(enabled() ? 'Recording: ON' : 'Recording: OFF', function () {
      if (enabled()) global.RuntimeDebug.disable(); else global.RuntimeDebug.enable();
      toggleBtn.textContent = enabled() ? 'Recording: ON' : 'Recording: OFF';
      toggleBtn.style.background = enabled() ? '#c0392b' : '#333';
    });
    toggleBtn.style.background = enabled() ? '#c0392b' : '#333';

    var exportBtn = mkBtn('Export JSON', function () { exportReport('json'); });
    var exportTxtBtn = mkBtn('Export TXT', function () { exportReport('txt'); });
    var exportMdBtn = mkBtn('Export MD', function () { exportReport('md'); });
    var analysisBtn = mkBtn('Generate Analysis', function () {
      _lastAnalysis = computeAutoAnalysis();
      _activeTab = 'Health';
      renderList();
      highlightTab();
    });
    var selfTestBtn = mkBtn('Run Diagnostics Self Test', function () {
      _lastSelfTest = runSelfTest();
      _activeTab = 'Integrity';
      renderList();
      highlightTab();
    });
    var copyBtn = mkBtn('Copy Runtime Report', function () {
      copyBtn.textContent = 'Copying…';
      copyReportToClipboard(function (ok) {
        copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
        copyBtn.style.background = ok ? '#2e7d32' : '#c0392b';
        _origSetTimeout(function () {
          copyBtn.textContent = 'Copy Runtime Report';
          copyBtn.style.background = '#222';
        }, 1600);
      });
    });
    var clearBtn = mkBtn('Clear', function () { global.RuntimeDebug.clear(); renderList(); });
    var closeBtn = mkBtn('Close', function () { closePanel(); });
    var countEl = global.document.createElement('span');
    countEl.style.marginLeft = 'auto';
    countEl.style.color = '#888';

    [toggleBtn, exportBtn, exportTxtBtn, exportMdBtn, analysisBtn, selfTestBtn, copyBtn, clearBtn].forEach(function (b) { header.appendChild(b); });
    header.appendChild(countEl);
    header.appendChild(closeBtn);

    var tabBar = global.document.createElement('div');
    tabBar.setAttribute('style', 'display:flex;gap:2px;padding:4px 6px;background:#000;overflow-x:auto;flex-wrap:wrap;');
    var tabButtons = {};
    TABS.forEach(function (tab) {
      var b = mkBtn(tab, function () { _activeTab = tab; renderList(); highlightTab(); });
      tabButtons[tab] = b;
      tabBar.appendChild(b);
    });
    function highlightTab() {
      Object.keys(tabButtons).forEach(function (t) {
        tabButtons[t].style.background = (t === _activeTab) ? '#c9a84c' : '#222';
        tabButtons[t].style.color = (t === _activeTab) ? '#000' : '#ddd';
      });
    }

    var body = global.document.createElement('div');
    body.setAttribute('style', 'flex:1;overflow:auto;padding:6px;white-space:pre-wrap;word-break:break-word;');

    function renderList() {
      if (_activeTab === 'Dashboard') { renderDashboard(); return; }
      if (_activeTab === 'Health') { renderHealth(); return; }
      if (_activeTab === 'Integrity') { renderIntegrity(); return; }
      var filtered = _events.filter(function (e) { return e.category === _activeTab; });
      countEl.textContent = filtered.length + ' / ' + _events.length + ' events';
      var slice = filtered.slice(-300); // last 300 of this tab — keeps DOM light on mobile
      body.innerHTML = '';
      slice.forEach(function (e) {
        var line = global.document.createElement('div');
        line.style.borderBottom = '1px solid #222';
        line.style.padding = '3px 0';
        var detailStr = safe(function () { return JSON.stringify(e.detail); }) || '';
        line.textContent = '#' + e.seq + '  t=' + e.t + 'ms  ' + e.name + '  ' + detailStr;
        body.appendChild(line);
      });
      body.scrollTop = body.scrollHeight;
    }

    function renderDashboard() {
      var s = computeSummary();
      countEl.textContent = s.totalEvents + ' events (' + s.carriedOverFromPreviousSession + ' carried over from before reload)';
      body.innerHTML = '';
      var lines = [
        'Errors (JS + Promise rejections): ' + s.errors,
        'DomRecycler reconciles: ' + s.domRecyclerReconciles,
        'Repository create/update/delete/import/restore: ' +
          s.repositoryOps.create + ' / ' + s.repositoryOps.update + ' / ' + s.repositoryOps.delete + ' / ' +
          s.repositoryOps.import + ' / ' + s.repositoryOps.restore,
        'Delete-button calls (deleteTask/deleteCase/...): ' + s.deleteButtonCalls,
        'ApiService calls: ' + s.apiCalls,
        'Sync fetches: ' + s.syncFetches,
        'Google Sheets sync (loadFromSheets): ' + s.googleSheetsSync,
        'DOM mutations observed: ' + s.domMutations,
        '',
        'Render call counts:'
      ];
      Object.keys(s.renders).forEach(function (k) { lines.push('  ' + k + ': ' + s.renders[k]); });
      lines.push('', 'Last error: ' + (s.lastError ? (s.lastError.name + ' @ ' + s.lastError.iso) : 'none'));
      if (s.lastStackTrace) lines.push('', 'Last stack trace:', s.lastStackTrace);
      lines.forEach(function (t) {
        var line = global.document.createElement('div');
        line.style.padding = '2px 0';
        line.style.whiteSpace = 'pre-wrap';
        line.textContent = t;
        body.appendChild(line);
      });
    }

    function renderHealth() {
      var h = computeHealth();
      countEl.textContent = h.totalProblems + ' problems detected this session';
      body.innerHTML = '';
      var lines = [
        h.icon + '  Application Health: ' + h.status.toUpperCase(),
        '',
        'Errors: ' + h.errors,
        'Critical problems (all-time / last 60s): ' + h.criticalProblems + ' / ' + h.recentCriticalProblems,
        'Warning problems (all-time / last 60s): ' + h.warningProblems + ' / ' + h.recentWarningProblems,
        '',
        'DomRecycler — reconciles: ' + h.domRecyclerStats.reconciles +
          '  (approx created +' + h.domRecyclerStats.createdApprox + ' / removed -' + h.domRecyclerStats.removedApprox + ')',
        ''
      ];
      if (h.lastAnalysis) {
        lines.push('Last auto-analysis (' + h.lastAnalysis.at + '):');
        lines.push('  Most frequent error: ' + (h.lastAnalysis.mostFrequentError ? h.lastAnalysis.mostFrequentError.key + ' x' + h.lastAnalysis.mostFrequentError.count : 'none'));
        lines.push('  Most expensive render: ' + (h.lastAnalysis.mostExpensiveRender ? h.lastAnalysis.mostExpensiveRender.fnName + ' (' + h.lastAnalysis.mostExpensiveRender.durationMs + 'ms)' : 'n/a'));
        lines.push('  Most active module: ' + (h.lastAnalysis.mostActiveModule ? h.lastAnalysis.mostActiveModule.key : 'n/a'));
        lines.push('  Slowest module: ' + (h.lastAnalysis.slowestModule ? h.lastAnalysis.slowestModule.category + ' (' + h.lastAnalysis.slowestModule.avgDurationMs + 'ms avg)' : 'n/a'));
        lines.push('  Largest DOM seen: ' + h.lastAnalysis.largestDOM + ' elements');
        lines.push('');
      }
      lines.push('Recent problems:');
      lines.forEach(function (t) {
        var line = global.document.createElement('div');
        line.style.padding = '2px 0';
        line.style.whiteSpace = 'pre-wrap';
        line.textContent = t;
        body.appendChild(line);
      });
      _problems.slice(-80).reverse().forEach(function (p) {
        var line = global.document.createElement('div');
        line.style.borderBottom = '1px solid #222';
        line.style.padding = '3px 0';
        line.style.color = p.severity === 'critical' ? '#e74c3c' : '#f1c40f';
        line.textContent = (p.severity === 'critical' ? '\uD83D\uDD34' : '\uD83D\uDFE1') + ' ' + p.iso + '  ' + p.type + ' — ' + p.message;
        body.appendChild(line);
      });
    }

    function renderIntegrity() {
      var integ = computeIntegrity();
      countEl.textContent = integ.hooksInstalled + ' hooks installed, ' + integ.hooksFailed + ' failed';
      body.innerHTML = '';
      function addLine(t, color) {
        var line = global.document.createElement('div');
        line.style.padding = '2px 0';
        line.style.whiteSpace = 'pre-wrap';
        if (color) line.style.color = color;
        line.textContent = t;
        body.appendChild(line);
      }
      addLine('Runtime Loaded: yes');
      addLine('Session: ' + integ.sessionId);
      addLine('Diagnostics Enabled (recording): ' + integ.diagnosticsEnabled);
      addLine('Hooks Installed: ' + integ.hooksInstalled + '   Hooks Failed: ' + integ.hooksFailed + (integ.failedHookNames.length ? ' (' + integ.failedHookNames.join(', ') + ')' : ''), integ.hooksFailed > 0 ? '#e74c3c' : '#2e7d32');
      addLine('Wrapped Functions: ' + (integ.wrappedFunctions.join(', ') || 'none'));
      addLine('');
      addLine('DomRecycler Hook Status: ' + integ.domRecyclerHookStatus);
      addLine('DomKeyIndex Hook Status: ' + integ.domKeyIndexHookStatus);
      addLine('Repository Hook Status: ' + integ.repositoryHookStatus);
      addLine('Render Hook Status: ' + integ.renderHookStatus.installed + '/' + integ.renderHookStatus.total + ' installed');
      addLine('Delete Hook Status: ' + integ.deleteHookStatus.installed + '/' + integ.deleteHookStatus.total + ' installed');
      addLine('API Hook Status: ' + integ.apiHookStatus);
      addLine('Storage Hook Status: ' + integ.storageHookStatus);
      addLine('Event Hook Status: ' + integ.eventHookStatus);
      addLine('Console Hook Status: ' + integ.consoleHookStatus);
      addLine('Fetch Hook Status: ' + integ.fetchHookStatus);
      addLine('Timers Hook Status: ' + integ.timersHookStatus);
      addLine('');
      addLine('Observers Installed / Running: ' + integ.observersInstalled + ' / ' + integ.observersRunning);
      addLine('Intervals Running (live estimate): ' + integ.intervalsRunning);
      addLine('');
      if (_lastSelfTest) {
        addLine('-- Last Self Test (' + _lastSelfTest.at + ') --');
        addLine('PASS ' + _lastSelfTest.passed + '   FAIL ' + _lastSelfTest.failed + '   SKIP ' + _lastSelfTest.skipped);
        _lastSelfTest.results.forEach(function (r) {
          var mark = r.skipped ? 'SKIP' : (r.pass ? 'PASS' : 'FAIL');
          addLine('  [' + mark + '] ' + r.name + (r.detail ? ' — ' + r.detail : ''),
            r.skipped ? '#888' : (r.pass ? '#2e7d32' : '#e74c3c'));
        });
      } else {
        addLine('(Tap "Run Diagnostics Self Test" above to test each hook end-to-end.)');
      }
    }

    _uiRefresh = function () {
      // Cheap: only re-render if the panel is open and showing the tab
      // that just received a new event, throttled via rAF.
      if (!_panelEl) return;
      safe(function () {
        if (global.requestAnimationFrame) {
          if (_uiRefresh._pending) return;
          _uiRefresh._pending = true;
          global.requestAnimationFrame(function () { _uiRefresh._pending = false; renderList(); });
        } else {
          renderList();
        }
      });
    };

    _panelEl.appendChild(header);
    _panelEl.appendChild(tabBar);
    _panelEl.appendChild(body);
    global.document.body.appendChild(_panelEl);
    highlightTab();
    renderList();
  }

  function mkBtn(text, onClick) {
    var b = global.document.createElement('button');
    b.textContent = text;
    b.setAttribute('style',
      'background:#222;color:#ddd;border:1px solid #444;border-radius:4px;' +
      'padding:5px 8px;font:11px sans-serif;cursor:pointer;');
    b.addEventListener('click', onClick);
    return b;
  }

  global.addEventListener('DOMContentLoaded', buildUI);

  log('Startup', 'RuntimeDebugLayer:parsed', { note: 'dormant until window.RUNTIME_DEBUG = true or RD button tapped' });
})(window);
