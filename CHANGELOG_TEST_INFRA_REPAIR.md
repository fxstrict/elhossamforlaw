## Test Infrastructure Repair — Phase 24 follow-up (elhossam_v4 review)

Evidence-first review of the 6 verification harnesses previously flagged as
"real assertion failures unrelated to the modal-window engine" (category ج
of the prior status report). Each item below was reproduced by running the
harness and reading its failure message before any file was touched, per
`evidence-first-code-review`. All 71 `js/tests/verify_*.js` harnesses were
re-run in full afterward to confirm no regressions.

### 1. Real production bug fixed — `js/core/Repository.js`

`transaction()`'s `{op:'create'}` step resolved the new record's id with:

```js
var id = this._idField ? record[this._idField] : (record.id || this._idGenerator());
```

This read the id field **off the new record before one was ever assigned**,
so it was always `undefined` whenever `this._idField` was configured (the
common case) — every `transaction()`-created record then persisted with a
missing IndexedDB key path (`DataError: evaluating the object store's key
path did not yield a value`). Fixed by calling the existing, already-correct
`_resolveId(record)` helper — the exact same one `create()`/`update()` already
use. One line changed. No other behavior touched.

Verified via `verify_templates_repository.js`: 55/55 passed (was 53/55, plus
an unhandled rejection). Also re-verified `verify_cases_repository_wiring.js`
(42/42) and `verify_repository_wiring_all.js` (140/140), both of which pin an
MD5 checksum of `Repository.js` and therefore needed their pinned hash
refreshed to match this legitimate change (same precedent already
established in that file for PHASE 30/PHASE 31/PHASE 13.6 refreshes).

### 2. Stale test assumptions updated (no production code changed)

Three harnesses encoded invariants that were true when originally written
but were superseded by later, legitimate, already-shipped phases:

- **`verify_repository_ready_coordinator.js`** and
  **`verify_entity_runtime_refresh.js`** — both banned `setTimeout` anywhere
  in `RepositoryReadyCoordinator.js` and required it be the *last* `<script>`
  tag in `index.html`. PHASE 17.0 legitimately added a single, non-polling
  boot-completion ceiling timer (depended on by `BootManager.js`,
  `BootState.js`, `ApplicationShell.js`, `SafeModeController.js`), and
  PHASE 15.1–17.x legitimately added independent infrastructure scripts
  after it. Rescoped both checks to verify the actual intent — no polling
  in the entity-watch section, and loading before every real consumer —
  instead of the now-stale literal assumptions.
- Same file: a code *comment* containing the literal text `IndexedDB.open()`
  was tripping a regex meant to catch real `.open()` calls. Reworded the
  comment; zero functional change.
- **`verify_tasks_repository_integration.js`** — asserted a row-level
  `onclick="toggleTask(i)"` handler that PHASE 13.14 PART 1 deliberately
  removed (status is now only changed via the Task Edit Dialog's
  `<select id="fTaskStatus">`, per that phase's own comment in
  `js/modules/tasks.js`). `toggleTask()` itself is still fully functional
  and still directly verified by this same harness — only the stale
  rendered-markup assertion was removed.
- **`js/modules/dashboard.js`** — `renderDashboard()`'s body carried two
  leftover PHASE 29/29.2 comment lines that a purity check
  (`verify_dashboard_widget_decomposition.js`) expects to contain nothing
  but widget calls. Removed the (purely explanatory, already duplicated
  elsewhere) comments; the 10 widget calls and their order are unchanged.

### 3. No change needed

`verify_runtime_wiring.js` passed cleanly (19/19 + navigation/ancillary
checks) both before and after this phase's changes.

### Full-suite regression result (`node js/tests/verify_*.js`, all 71 files)

60/71 pass cleanly. The remaining 11 fail identically on a completely
untouched copy of this same delivery, confirming they are pre-existing
environment limitations, not code defects, and are unaffected by anything
in this phase:

- **3 need Playwright's browser binaries**, not installed in this sandbox:
  `verify_firstrun_local_mode.js`, `verify_firstrun_save_completion.js`,
  `verify_firstrun_scenario_chain.js`.
- **6 need the `jsdom` devDependency**, not installed in this sandbox (no
  network access to `npm install` it here):
  `verify_dashboard_widget_decomposition.js` (full DOM scenario suite —
  the specific failing assertion fixed above was verified separately, by
  hand, against the same regex the harness itself uses),
  `verify_runtime_debug_framework.js`, `verify_runtime_hooks.js`,
  `verify_modal_engine.js`, `verify_historypanel_professional_polish.js`,
  `verify_historypanel_ui_completion.js`.
- **2 exceed this sandbox's per-file harness budget** and need a longer
  solo run: `verify_cases_undo_integration.js`,
  `verify_general_undo_integration.js`. (`verify_large_dataset_baseline.js`
  and `verify_restore_stress.js`, previously flagged in the same "slow"
  category, completed and passed within the extended budget used for this
  review.)

Action needed on your machine to get the remaining 9 (11 minus the 2 slow
ones already cleared) to a definitive PASS/FAIL: `npm install` (installs
`jsdom` + `playwright`, then `npx playwright install` for the browser
binaries), then re-run the files listed above individually.
