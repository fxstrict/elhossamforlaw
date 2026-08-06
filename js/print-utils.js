/**
 * print-utils.js
 * Al Hossam Law Office — Form Helper Utilities
 *
 * History: Originally extracted from index.html as a print/report-building module
 * (buildCaseReport, vf) plus several Case-related form/print helpers. A full dead-code
 * audit (PRINT_UTILS_DEAD_CODE_AUDIT_REPORT.md) found that 12 of the file's 15
 * functions were shadowed by later-loaded copies in js/modules/cases.js and
 * js/modules/clients.js and were never reachable at runtime. Those 12 were removed in
 * the Dead Code Cleanup stage (see PROJECT_HISTORY.md). This file now contains only the
 * 3 functions that were confirmed live.
 *
 * Current responsibility: shared, type-generic form helpers (reset / populate / read)
 * used as the base of the override chain that js/modules/cases.js builds on top of via
 * `_origResetForm`, `_origFill`, `_origCollect`. Every form open, edit, and save in the
 * app ultimately calls into these three functions.
 *
 * Dependencies (declared globals, NOT in-file — must be loaded first):
 *   - FIELDS, MAP   (form field/mapping config, from the inline bootstrap in index.html)
 *   - sanitizeTime  (from js/ui-utils.js)
 *
 * Load this file after js/ui-utils.js and before js/modules/cases.js, which captures
 * these three functions into its `_orig*` wrapper chain at load time.
 */

// Clears every field listed for `type` in FIELDS back to its default (blank, or the
// first <option> for <select> elements).
function resetForm(type){(FIELDS[type]||[]).forEach(function(id){var el=document.getElementById(id);if(!el)return;el.value=el.tagName==='SELECT'?(el.options[0]?el.options[0].value:''):'';});}

// Populates the form fields for `type` from a data object `obj`, using the type's
// MAP (fieldId -> dataKey) to know which field gets which value.
function fillForm(type,obj){var m=MAP[type]||{};Object.keys(m).forEach(function(fid){var el=document.getElementById(fid);if(el&&obj[m[fid]]!==undefined){var v=obj[m[fid]];if(el.type==='time')v=sanitizeTime(v);el.value=v;}});}

// Reads the current values of the form fields for `type` back into a plain data
// object, using the type's MAP (fieldId -> dataKey) in reverse.
function collectForm(type){var m=MAP[type]||{};var obj={};Object.keys(m).forEach(function(fid){var el=document.getElementById(fid);obj[m[fid]]=el?el.value:'';});return obj;}
