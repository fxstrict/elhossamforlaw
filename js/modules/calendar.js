/**
 * ================================================================
 * js/modules/calendar.js — وحدة التقويم | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Calendar-related functions extracted from index.html.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data              : shared app data object  { sessions, … } —
 *                         Calendar only READS data.sessions to mark
 *                         session days and list them; it does not
 *                         own or write to data.sessions.
 *   - calYear           : shared global — currently displayed calendar
 *                         year. Initialized in index.html bootstrap
 *                         (`var currentPage=...,calYear,calMonth,
 *                         calSelectedDay=null,...;`) and also (re)set
 *                         to the current year on page load
 *                         (DOMContentLoaded handler) and on navigation
 *                         into the calendar page (navigate('calendar')
 *                         branch in index.html). NOT redeclared here —
 *                         it must remain a single shared global, same
 *                         pattern as data/editIdx/currentTplFilter.
 *   - calMonth          : shared global — currently displayed calendar
 *                         month (0-based). Same declaration/reset
 *                         pattern as calYear above. NOT redeclared here.
 *   - calSelectedDay     : shared global — the currently selected day
 *                         number within the displayed month, or null
 *                         when no day is selected (whole-month view).
 *                         Declared in index.html bootstrap. NOT
 *                         redeclared here.
 *   - parseLocalDate()  : date parser             (from ui-utils.js)
 *   - pad()             : zero-padding helper     (from ui-utils.js)
 *   - formatTime()      : time formatter          (from ui-utils.js)
 *   - statusBadge()     : status badge builder    (from ui-utils.js)
 *
 * GAS Sheet name: none — Calendar has NO backend sync and NO data slice
 * of its own. It is purely a read-only view over data.sessions (which
 * is owned/synced by the Sessions module, sessions.js). Calendar never
 * calls ApiService, never calls saveLocal(), and never mutates
 * data.sessions.
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, sessions, documents, tasks, fees,
 *     library, templates, settings)
 *   - Sessions CRUD (saveSession/editSession/deleteSession) — Calendar
 *     only reads data.sessions for display; ownership stays with
 *     sessions.js
 *   - navigate() — the calendar-page branch of navigate() (which resets
 *     calYear/calMonth to the current month and calls renderCalendar())
 *     lives in index.html's page-routing logic, not in this module,
 *     same precedent as renderDashboard()'s page-routing call
 *   - The DOMContentLoaded bootstrap initialization of calYear/calMonth
 *     in index.html
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 * ================================================================
 */

'use strict';

// ================================================================
// RENDER — عرض التقويم وجلسات اليوم/الشهر المحدد
// ================================================================

/**
 * renderCalendar — renders the month grid (#calGrid) for calYear/calMonth,
 * marking today and any days that have sessions, then renders the
 * sessions list for the whole month via renderCalSessions().
 * Reads: calYear, calMonth, data.sessions.
 * Writes to: #calTitle, #calGrid (also triggers renderCalSessions()).
 */
function renderCalendar() {
  var now = new Date();
  if (!calYear) calYear = now.getFullYear();
  if (calMonth === undefined) calMonth = now.getMonth();

  var todayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

  document.getElementById('calTitle').textContent =
    new Date(calYear, calMonth).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });

  var first = new Date(calYear, calMonth, 1).getDay();
  var days  = new Date(calYear, calMonth + 1, 0).getDate();

  var sDays = new Set(
    data.sessions
      .filter(function(s) {
        var d = parseLocalDate(s['التاريخ']);
        return d && d.getFullYear() === calYear && d.getMonth() === calMonth;
      })
      .map(function(s) {
        return parseLocalDate(s['التاريخ']).getDate();
      })
  );

  var dn = ['أح', 'إث', 'ثل', 'أر', 'خم', 'جم', 'سب'];
  var html = dn.map(function(d) { return '<div class="cal-day-name">' + d + '</div>'; }).join('');

  for (var i = 0; i < first; i++) html += '<div class="cal-day other-month"></div>';

  for (var d = 1; d <= days; d++) {
    var ds = calYear + '-' + pad(calMonth + 1) + '-' + pad(d);
    html +=
      '<div class="cal-day' +
        (ds === todayStr ? ' today' : '') +
        (sDays.has(d) ? ' has-session' : '') +
      '" onclick="calSelectDay(' + d + ')">' + d + '</div>';
  }

  document.getElementById('calGrid').innerHTML = html;
  renderCalSessions();
}

/**
 * calSelectDay — selects a specific day within the displayed month,
 * updates the sessions-list label, and re-renders the sessions list
 * filtered to that day.
 * @param {number} d - day-of-month number (1-31)
 * Writes to: calSelectedDay (global), #calSelectedLabel.
 */
function calSelectDay(d) {
  calSelectedDay = d;
  document.getElementById('calSelectedLabel').textContent =
    'يوم ' + d + ' — ' + new Date(calYear, calMonth, d).toLocaleDateString('ar-EG', { weekday: 'long' });
  renderCalSessions(d);
}

/**
 * renderCalSessions — renders the sessions list (#calSessionsList) for
 * the displayed calYear/calMonth, optionally filtered to a single day.
 * @param {number} [day] - optional day-of-month filter; when omitted,
 *                         shows all sessions in the displayed month.
 * Reads: data.sessions, calYear, calMonth.
 * Writes to: #calSessionsList.
 */
function renderCalSessions(day) {
  var c = document.getElementById('calSessionsList');

  var ss = data.sessions
    .filter(function(s) {
      var dt = parseLocalDate(s['التاريخ']);
      return dt && dt.getFullYear() === calYear && dt.getMonth() === calMonth && (!day || dt.getDate() === day);
    })
    .sort(function(a, b) {
      return (a['الوقت'] || '').localeCompare(b['الوقت'] || '');
    });

  if (!ss.length) {
    c.innerHTML = '<div class="empty-state" style="padding:25px"><p>لا توجد جلسات ' + (day ? 'لهذا اليوم' : 'هذا الشهر') + '</p></div>';
    return;
  }

  c.innerHTML = ss.map(function(s) {
    var d = parseLocalDate(s['التاريخ']);
    if (!d) return '';
    return (
      '<div class="session-item" style="margin-bottom:8px;">' +
        '<div class="session-date">' +
          '<div class="day">'   + d.getDate() + '</div>' +
          '<div class="month">' + d.toLocaleDateString('ar-EG', { month: 'short' }) + '</div>' +
        '</div>' +
        '<div class="session-info">' +
          '<div class="session-title">' + (s['عنوان_القضية'] || 'جلسة') + '</div>' +
          '<div class="session-meta">' +
            '<span>&#128336; ' + formatTime(s['الوقت']) + '</span>' +
            '<span>&#127963; ' + (s['المحكمة'] || '—') + '</span>' +
            statusBadge(s['الحالة']) +
          '</div>' +
          (s['القرار']
            ? '<div style="font-size:12px;color:var(--gold);margin-top:3px;">&#9878; ' + s['القرار'] + '</div>'
            : '') +
        '</div>' +
      '</div>'
    );
  }).join('');
}

// ================================================================
// NAVIGATION — التنقل بين الأشهر
// ================================================================

/**
 * calPrev — moves the calendar view back one month (wrapping the year
 * at January), clears the selected-day state, resets the sessions-list
 * label to the whole-month label, and re-renders.
 * Writes to: calMonth, calYear, calSelectedDay (globals), #calSelectedLabel.
 */
function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null;
  document.getElementById('calSelectedLabel').textContent = 'هذا الشهر';
  renderCalendar();
}

/**
 * calNext — moves the calendar view forward one month (wrapping the
 * year at December), clears the selected-day state, resets the
 * sessions-list label to the whole-month label, and re-renders.
 * Writes to: calMonth, calYear, calSelectedDay (globals), #calSelectedLabel.
 */
function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null;
  document.getElementById('calSelectedLabel').textContent = 'هذا الشهر';
  renderCalendar();
}
