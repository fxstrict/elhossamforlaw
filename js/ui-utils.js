/**
 * ui-utils.js
 * Al Hossam Law Office — Utility Functions
 *
 * Source: index.html lines 581, 585–608
 * Stage:  Preparation — file created, not yet loaded by index.html.
 *
 * All functions in this file are pure utilities:
 *   - No side effects
 *   - No DOM writes
 *   - No globals mutation
 *   - No onclick dependencies
 *   - No runtime order dependency outside this file
 *
 * Internal dependency order is satisfied by declaration order below.
 * Load this file before the main inline <script> blocks and before
 * js/modules/clients.js.
 */

/* ─── Identity ──────────────────────────────────────────────────── */

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

/* ─── Formatting primitives ─────────────────────────────────────── */

function pad(n){return String(n).padStart(2,'0');}

function sanitizeTime(t){if(!t)return'';var s=String(t).trim();if(/^\d{1,2}:\d{2}$/.test(s))return s;var m=s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);if(m)return m[1].padStart(2,'0')+':'+m[2];return s;}

function formatTime(t){var c=sanitizeTime(t);return c||'—';}

/* ─── Date parsing & formatting ─────────────────────────────────── */

function parseLocalDate(s){
  if(!s)return null;
  var str=String(s).trim();
  // already ISO: 2026-05-30 or 2026-05-30T...
  var m=str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return new Date(+m[1],+m[2]-1,+m[3]);
  // try native but guard 1899 (Excel serial 0 artifact)
  var d=new Date(str);
  if(!isNaN(d)&&d.getFullYear()>1900)return d;
  return null;
}

function formatDate(d){
  if(!d)return'—';
  var dt=parseLocalDate(d);
  if(!dt)return String(d);
  return dt.toLocaleDateString('ar-EG',{year:'numeric',month:'short',day:'numeric'});
}

/* ─── Status & urgency badges ───────────────────────────────────── */

function statusBadge(s){var m={'نشطة':'active','active':'active','منتهية':'closed','closed':'closed','معلقة':'pending','مُحالة':'info','مُرجأة':'pending','قادمة':'active'};return'<span class="badge badge-'+(m[s]||'pending')+'">'+(s||'—')+'</span>';}

function daysUntil(ds){if(!ds)return null;var d=parseLocalDate(ds);if(!d)return null;var n=new Date();n.setHours(0,0,0,0);d.setHours(0,0,0,0);return Math.round((d-n)/(864e5));}

function urgencyBadge(ds){var d=daysUntil(ds);if(d===null)return'';if(d<0)return'<span class="badge badge-closed">مضت</span>';if(d===0)return'<span class="badge badge-urgent">اليوم</span>';if(d<=2)return'<span class="badge badge-urgent">'+d+' أيام</span>';if(d<=7)return'<span class="badge badge-pending">'+d+' أيام</span>';return'<span class="badge badge-info">'+d+' يوم</span>';}

/* ─── DOM value reader (read-only, no write, no side effect) ─────── */

function val(id){var el=document.getElementById(id);return el?el.value:'';}
