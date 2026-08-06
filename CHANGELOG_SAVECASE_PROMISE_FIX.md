## Fix — `saveCase()` Promise propagation restored (clients.js client-selector wrapper)

**File:** `js/modules/clients.js`

Fixed the outermost `saveCase()` wrapper (the client-selector override, applied after `cases.js`'s own wrapper and therefore the version actually bound to `window.saveCase` at runtime) to `return` the inner call's Promise instead of discarding it.

Previously, `_origSaveCaseForClientSelector()` was invoked without `return`, so `await saveCase()` would resolve one microtask early — before the underlying `Repository.create()`/`update()` call actually finished — even though the two inner layers in `cases.js` already returned correctly. Existing `onclick="saveCase()"` fire-and-forget usage was and remains unaffected. No business logic, validation, rendering, or repository behavior changed.
