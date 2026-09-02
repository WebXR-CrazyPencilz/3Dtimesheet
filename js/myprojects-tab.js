// ═══════════════════════════════════════════════════════════════
// MYPROJECTS-TAB.JS — Employee Portal "My Dashboard" tab
//
// Wires up the emp-tab-btn buttons (index.html scaffolded these
// with data-emp-tab attributes but nothing ever handled the click —
// this file is that missing piece) and renders "My Dashboard": every
// project the logged-in employee has personally logged hours
// against, each shown as a card with a budget-status bar.
//
// The bar is deliberately the SAME model as the Team Leader view in
// Client-Project.js: total project cost (every contributor's hours ×
// their own Points that month, summed) compared against the
// project's Constant. Green while under, solid red once over — no
// revenue, no cost figures, no per-teammate breakdown. An employee
// never sees a number here, only the color, exactly like a Team
// Leader.
//
// This file reuses Client-Project.js's pure calculation functions
// (getProjectCostBreakdown, getMonthlyPointsForEmployee,
// ensureSalaryDataLoaded) directly — that script loads on every
// portal already, not just Manager/Team Leader. To do this safely,
// this file populates Client-Project.js's own data globals
// (CP_PROJECTS, CP_CLIENTS, CP_EMPLOYEES, CP_TIMESHEET_DATA,
// CP_HISTORICAL_DATA) itself, but NEVER sets CP_ROLE to 'manager' or
// 'tl' — so none of that file's edit/delete/save UI paths, which key
// off CP_ROLE, can ever be reached from here. Only its calculation
// helpers are used.
// ═══════════════════════════════════════════════════════════════

let EMP_DASHBOARD_DATA_LOADED = false;
let EMP_DASH_ANCHOR_DATE = todayStr(); // end date for the "Last 5 Days" section, adjustable via its date picker
let EMP_DASHBOARD_RENDERED_FOR = null; // USER.id this was already rendered for, so it fires exactly once per login
let EMP_ATTEND_RANGE = 'last15'; // 'last15' | 'month' — My Attendance tab's selected range
let EMP_ATTEND_MONTH = todayStr().slice(0, 7); // 'YYYY-MM' — used only when EMP_ATTEND_RANGE === 'month'
let EMP_DASH_PROJECT_BY_NAME = {}; // rebuilt on every render — name -> project object, for the detail page lookup

// ENTRIES (loaded by auth.js at login) is capped to the last 10 days
// by the backend (see Code.gs getHistory) — fine for the Timesheet
// tab it was built for, but wrong for "all time" project totals and
// for My Attendance, both of which need this employee's FULL history.
// Loaded once via the uncapped getAllHistory action and cached.
let EMP_DASH_FULL_HISTORY = [];
let EMP_DASH_FULL_HISTORY_LOADED = false;

async function ensureEmpFullHistoryLoaded() {
  if (EMP_DASH_FULL_HISTORY_LOADED) return;
  try {
    const data = await sheetGET({ action: 'getAllHistory', uid: USER.id });
    EMP_DASH_FULL_HISTORY = Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[myprojects-tab] Failed to load full history:', err.message);
    EMP_DASH_FULL_HISTORY = [];
  }
  EMP_DASH_FULL_HISTORY_LOADED = true;
}

// ── TAB SWITCHING ─────────────────────────────────────────────
// The three containers this controls: #empTabProjects (My Dashboard,
// default/active), #empTabTimesheet, #empTabAttendance.
// Called directly from index.html's own startup script (already
// present there as `initMyProjectsTab();` alongside initTable() /
// initChart() / initLogin()) — this name has to match that call
// exactly, it isn't wired via DOMContentLoaded.
function initMyProjectsTab() {
  document.querySelectorAll('.emp-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchEmpTab(btn.dataset.empTab));
  });
  watchForEmployeeLogin();
  watchForViewportChange();
}

// Re-renders My Dashboard when resizing/rotating crosses the mobile
// breakpoint, so the card design (detailed desktop vs. minimal
// mobile) switches live instead of only being decided on first load.
// Debounced and only fires when the mobile/desktop boundary is
// actually crossed — resizing within the same "side" of 640px does
// nothing, so this doesn't re-render on every pixel of a drag-resize.
let EMP_DASH_WAS_MOBILE = null;
function watchForViewportChange() {
  let debounceTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const isMobile = isEmpDashMobileViewport();
      if (EMP_DASH_WAS_MOBILE === null) { EMP_DASH_WAS_MOBILE = isMobile; return; }
      if (isMobile === EMP_DASH_WAS_MOBILE) return;
      EMP_DASH_WAS_MOBILE = isMobile;
      // Only re-render if My Dashboard is the currently visible tab —
      // no point rendering into a hidden container.
      if ($('empTabProjects') && $('empTabProjects').style.display !== 'none') {
        renderMyDashboardTab();
      }
    }, 250);
  });
}

// The dashboard needs to render as soon as an employee logs in
// (it's the default tab, and it starts already marked "active" in
// the HTML, so no click ever fires to trigger it). Rather than
// depend on a manual one-line edit to auth.js's loginAs() — a single
// missed edit silently leaves this tab stuck on its loading
// placeholder forever, with no error anywhere — this polls for the
// same signal auth.js itself sets on successful employee login
// (the global USER, with MANAGER_MODE/TL_MODE/HR_MODE all false) and
// renders itself the moment that appears. Fires once per login;
// clears itself after logout (USER goes null/undefined again) so a
// second employee login in the same tab renders correctly too.
function watchForEmployeeLogin() {
  setInterval(() => {
    const isEmployeeSession =
      typeof USER !== 'undefined' && USER && USER.id &&
      !(typeof MANAGER_MODE !== 'undefined' && MANAGER_MODE) &&
      !(typeof TL_MODE !== 'undefined' && TL_MODE) &&
      !(typeof HR_MODE !== 'undefined' && HR_MODE);

    if (!isEmployeeSession) {
      EMP_DASHBOARD_RENDERED_FOR = null; // logged out / not an employee session — reset for next login
      EMP_DASHBOARD_DATA_LOADED = false; // cached project/timesheet/salary data belonged to the previous session
      EMP_DASH_FULL_HISTORY_LOADED = false; // full history belonged to the previous session too
      return;
    }
    if (EMP_DASHBOARD_RENDERED_FOR === USER.id) return; // already rendered for this login

    EMP_DASHBOARD_RENDERED_FOR = USER.id;
    // auth.js's own loginAs() fires its critical getHistory call at
    // nearly this exact same instant (both are reacting to the same
    // login moment). A short head start here lets that one request
    // clear the concurrency queue before this file's own heavier
    // burst of 5 requests begins, instead of all 6 competing for a
    // slot at once — see ensureEmpDashboardDataLoaded's own comment
    // for the full failure mode this is avoiding.
    setTimeout(renderMyDashboardTab, 600);
  }, 400);
}

function switchEmpTab(tab) {
  document.querySelectorAll('.emp-tab-btn').forEach(btn => {
    const active = btn.dataset.empTab === tab;
    btn.classList.toggle('active', active);
    btn.style.color = active ? 'var(--a1)' : 'var(--muted)';
    btn.style.borderBottomColor = active ? 'var(--a1)' : 'transparent';
  });

  const containerByTab = {
    projects:   'empTabProjects',
    timesheet:  'empTabTimesheet',
    attendance: 'empTabAttendance',
  };
  Object.entries(containerByTab).forEach(([key, id]) => {
    const el = $(id);
    if (el) el.style.display = key === tab ? '' : 'none';
  });

  if (tab === 'projects') renderMyDashboardTab();
  if (tab === 'attendance') renderMyAttendanceTab();
}

// ── DATA LOADING ──────────────────────────────────────────────
// Everything needed for the budget bars, loaded once per session and
// cached — a tab revisit after the first load is instant, no re-fetch.
async function ensureEmpDashboardDataLoaded() {
  if (EMP_DASHBOARD_DATA_LOADED) return;

  // Fetched ONE AT A TIME, not with Promise.all — firing all 5 of
  // these simultaneously (on top of the Timesheet tab's own
  // getHistory call, which fires around the same moment at login)
  // was exactly the request-burst failure mode api.js's own
  // concurrency-limiter comment already describes: Apps Script's
  // /exec redirect tokens can expire under a burst, especially on a
  // slow/unstable connection, and getTLData in particular is the
  // heaviest single request in this app (loops every employee's
  // sheet in one execution) — competing for a slot at the same
  // instant as everything else was dragging all of them down
  // together into cascading timeouts. Sequencing spreads the load
  // out over time instead, trading a little wall-clock time for
  // reliability. getTLData is fetched last on purpose, once the
  // lighter requests are already safely out of the way.
  const projects   = await sheetGET({ action: 'getProjectMasterList' });
  const clients     = await sheetGET({ action: 'getClientMasterList' });
  const historical = await sheetGET({ action: 'getHistoricalRecords', filters: encodeURIComponent(JSON.stringify({})) });
  await ensureEmpFullHistoryLoaded();
  const tlData = await sheetGET({ action: 'getTLData' });

  // Populate Client-Project.js's own globals — see the file header
  // comment for why this is safe (CP_ROLE is never touched here).
  CP_PROJECTS = (projects || []).map((p, idx) => ({ ...p, entryIndex: idx }));
  CP_CLIENTS  = (clients  || []).map((c, idx) => ({ ...c,  entryIndex: idx }));
  CP_EMPLOYEES = Array.isArray(LIVE_EMPLOYEES) ? LIVE_EMPLOYEES : [];
  CP_TIMESHEET_DATA  = Array.isArray(tlData?.entries) ? tlData.entries : [];
  CP_HISTORICAL_DATA = historical || [];

  await ensureSalaryDataLoaded();
  EMP_DASHBOARD_DATA_LOADED = true;
}

// This employee's own project names — matched against the full
// Project Master list the same way every other panel in this app
// matches Timesheet entries to a project (by name, since that's what
// a Timesheet entry actually carries). Uses full history, not the
// 10-day-capped ENTRIES, so a project worked on further back still
// shows a card.
function getMyWorkedProjects() {
  const myProjectNames = new Set(
    EMP_DASH_FULL_HISTORY.filter(e => e.status !== 'Leave' && e.project).map(e => e.project)
  );
  return CP_PROJECTS.filter(p => myProjectNames.has(p.projectName));
}

// Project names this employee has logged hours against that have NO
// matching row in the real Project Master list (e.g. "timesheet" or
// "Holiday" — values that appear in Timesheet entries but were never
// set up as an actual project). These can't get a budget card (no
// Constant, no client, no status to show), but they shouldn't just
// silently vanish from the dashboard either — buildEmpUnmatchedProjectCard
// gives them a minimal informational card instead.
function getMyUnmatchedProjectNames() {
  const matchedNames = new Set(CP_PROJECTS.map(p => p.projectName));
  const allNames = new Set(
    EMP_DASH_FULL_HISTORY.filter(e => e.status !== 'Leave' && e.project).map(e => e.project)
  );
  return [...allNames].filter(n => !matchedNames.has(n));
}

function buildEmpUnmatchedProjectCard(name) {
  // No real Project Master row exists for this name, so there's no
  // clientId/status/Constant to draw from — but getProjectCostBreakdown
  // and getMyProjectCost only need a projectName to match Timesheet
  // entries against, so the points figures still work fine (computed
  // inside the detail page). Building a minimal synthetic project
  // object and reusing buildEmpDashboardCard means this gets the
  // exact same minimal card + tap-through detail page as a real
  // project.
  const pseudoProject = { projectId: '', projectName: name, clientId: '', status: '', projectConstant: 0 };
  return buildEmpDashboardCard(pseudoProject, { unmatched: true });
}

// ── RENDER ────────────────────────────────────────────────────
async function renderMyDashboardTab() {
  const container = $('myProjCardsContainer');
  if (!container) return;

  // ensureCPStyles() (from Client-Project.js) injects the .cp-entity-
  // card/.cp-status-pill/etc. styles into <head> — it only ever runs
  // there via the Manager/TL tabs, which a normal employee session
  // may never open. Calling it here (it's idempotent — a no-op if
  // already injected) guarantees those styles exist regardless.
  if (typeof ensureCPStyles === 'function') ensureCPStyles();

  container.innerHTML = `<div class="slot-loading"><div class="slot-spinner"></div><span>Loading…</span></div>`;

  try {
    await ensureEmpDashboardDataLoaded();
  } catch (err) {
    container.innerHTML = `<div class="slot-error">Failed to load your dashboard: ${esc(err.message)}</div>`;
    return;
  }

  let myProjects, unmatchedNames;
  try {
    myProjects = getMyWorkedProjects();
    unmatchedNames = getMyUnmatchedProjectNames();
  } catch (err) {
    container.innerHTML = `<div class="slot-error">Failed to display your dashboard: ${esc(err.message)}</div>`;
    return;
  }

  // Personal stats — computed entirely from this employee's own
  // ENTRIES (already loaded at login, no extra fetch needed). Shown
  // above the project budget cards regardless of whether any project
  // cards exist, so a brand-new employee with zero project hours
  // still sees "no hours logged" states here rather than a blank page.
  const statsHtml = `
    <div style="display:flex;flex-direction:column;gap:1.25rem;margin-bottom:1.5rem;">
      ${buildTodayRingSection()}
      ${buildLast5DaysSection(EMP_DASH_ANCHOR_DATE)}
      ${buildAllTimeProjectsSection()}
    </div>`;

  const hasAnyCards = myProjects.length > 0 || unmatchedNames.length > 0;

  // Name -> project object, covering both real Project Master rows
  // and the synthetic pseudo-projects for unmatched names — lets
  // openEmpProjectDetailPage look up full project data (Constant,
  // dates, status) from just the name stored on the card's
  // data-project attribute, regardless of which kind it is.
  EMP_DASH_PROJECT_BY_NAME = {};
  myProjects.forEach(p => { EMP_DASH_PROJECT_BY_NAME[p.projectName] = p; });
  unmatchedNames.forEach(name => {
    EMP_DASH_PROJECT_BY_NAME[name] = { projectId: '', projectName: name, clientId: '', status: '', projectConstant: 0, __unmatched: true };
  });

  const projectsHtml = hasAnyCards
    ? `<div class="cp-card-grid" style="grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr));">
        ${myProjects.map(p => buildEmpDashboardCard(p)).join('')}
        ${unmatchedNames.map(buildEmpUnmatchedProjectCard).join('')}
      </div>`
    : `<div class="chart-empty">You haven't logged hours on any project yet.</div>`;

  container.innerHTML = statsHtml + projectsHtml;

  container.querySelectorAll('.emp-proj-card').forEach(card => {
    card.addEventListener('click', () => openEmpProjectDetailPage(card.dataset.project));
  });

  $('empDashAnchorDate')?.addEventListener('change', e => {
    EMP_DASH_ANCHOR_DATE = e.target.value || todayStr();
    renderMyDashboardTab(); // full re-render — cheap, everything used here is already in memory
  });

  $('empDashViewAttendanceBtn')?.addEventListener('click', () => switchEmpTab('attendance'));
}

// ── PERSONAL STATS — today's ring, last 5 days, all-time bars ──
// All three sections read only ENTRIES (this employee's own data,
// already loaded at login) — no network calls, no cross-employee
// data, nothing salary/cost-related.

// A stable color per project NAME (not ID — some entries carry a
// pseudo-project value like "internal" that has no real Project
// Master row), reusing Client-Project.js's own hashing so a
// project's color is consistent with everywhere else it's colored.
// Normalized (trimmed + lowercased) before hashing — the same
// project can otherwise get two different colors across days if the
// raw Timesheet data has inconsistent casing or stray whitespace for
// the same name (e.g. "VGN Meridian" one day, "VGN Meridian " with a
// trailing space another day — different strings, different hash,
// different color, even though it's clearly the same project).
function empDashProjectColor(name) {
  const key = String(name || '').trim().toLowerCase();
  return typeof getColorForKey === 'function' ? getColorForKey('proj:' + key) : '#4f8ef7';
}

function buildTodayRingSVG(segments, totalHours) {
  if (!totalHours) {
    return `<svg viewBox="0 0 200 200" width="160" height="160"><circle cx="100" cy="100" r="80" fill="none" stroke="var(--border-md,#3a3f4b)" stroke-width="18"/></svg>`;
  }
  let angle = -90;
  const paths = segments.map(seg => {
    const end = angle + (seg.hours / totalHours) * 360;
    const d = buildReportDonutPath(100, 100, 80, 62, angle, end);
    const color = empDashProjectColor(seg.name);
    angle = end;
    return `<path d="${d}" fill="${color}"/>`;
  }).join('');
  return `<svg viewBox="0 0 200 200" width="160" height="160" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function buildTodayRingSection() {
  const recentDates = new Set(getEmpDashRecentDays(todayStr(), EMP_DASH_RECENT_DAYS_COUNT));
  const byProj = {};
  EMP_DASH_FULL_HISTORY
    .filter(e => recentDates.has(e.date) && e.status !== 'Leave' && e.project)
    .forEach(e => { byProj[e.project] = (byProj[e.project] || 0) + Number(e.hours || 0); });

  const segments = Object.entries(byProj)
    .map(([name, hours]) => ({ name, hours }))
    .sort((a, b) => b.hours - a.hours);
  const totalHours = segments.reduce((s, x) => s + x.hours, 0);

  const legend = segments.length
    ? segments.map(seg => {
        const pct = totalHours ? Math.round((seg.hours / totalHours) * 100) : 0;
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
            <span style="width:9px;height:9px;border-radius:50%;background:${empDashProjectColor(seg.name)};flex-shrink:0;"></span>
            <span style="flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(seg.name)}</span>
            <span style="font-size:12px;font-weight:700;color:var(--txt1);white-space:nowrap;">${esc(fh(seg.hours))}</span>
            <span style="font-size:11px;color:var(--txt2,var(--muted));width:36px;text-align:right;">${pct}%</span>
          </div>`;
      }).join('')
    : `<div style="font-size:12px;color:var(--txt2,var(--muted));">No hours logged in the last ${EMP_DASH_RECENT_DAYS_COUNT} days.</div>`;

  return `
    <div class="cp-card" style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;">
      <div style="position:relative;width:160px;height:160px;flex-shrink:0;">
        ${buildTodayRingSVG(segments, totalHours)}
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 14px;text-align:center;">
          <div style="font-size:18px;font-weight:800;color:var(--txt1);line-height:1.1;white-space:nowrap;">${esc(fh(totalHours))}</div>
          <div style="font-size:8.5px;letter-spacing:.5px;color:var(--txt2,var(--muted));margin-top:2px;">LAST ${EMP_DASH_RECENT_DAYS_COUNT} DAYS</div>
        </div>
      </div>
      <div style="flex:1;min-width:220px;">${legend}</div>
    </div>`;
}

// 'anchor' -> that date plus the 6 before it, most recent first.
function getEmpDashRecentDays(anchor, count) {
  const dates = [];
  const base = new Date(anchor + 'T00:00:00');
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return dates;
}

const EMP_DASH_RECENT_DAYS_COUNT = 7;

function buildLast5DaysSection(anchor) {
  const dates = getEmpDashRecentDays(anchor, EMP_DASH_RECENT_DAYS_COUNT);

  const rows = dates.map(dateStr => {
    const dayEntries = EMP_DASH_FULL_HISTORY.filter(e => e.date === dateStr && e.status !== 'Leave' && e.project);
    const totalHours = dayEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
    const byProj = {};
    dayEntries.forEach(e => { byProj[e.project] = (byProj[e.project] || 0) + Number(e.hours || 0); });
    const segs = Object.entries(byProj).map(([name, hours]) => ({ name, hours })).sort((a, b) => b.hours - a.hours);

    const label = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

    if (!totalHours) {
      return `
        <div style="padding:10px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:700;color:var(--txt1);">${esc(label)}</span>
            <span style="font-size:13px;color:var(--txt2,var(--muted));">—</span>
          </div>
          <div style="font-size:11px;color:var(--txt2,var(--muted));margin-top:2px;">No entries</div>
        </div>`;
    }

    // The bar's full track length is a fixed 9-hour scale (the same
    // OT threshold used elsewhere), NOT each day's own total — so a
    // 3h day and a 9h day are visibly different lengths, instead of
    // every day always looking 100% full regardless of actual hours.
    // A project keeps its own color on the bar at all times —
    // including on an OT day — so the same project never appears in
    // two different colors depending on the day. OT itself is
    // signaled only by the "· OT" text label next to the hours, not
    // by recoloring the bar.
    const otThreshold = typeof OVERTIME_THRESHOLD_HOURS === 'number' ? OVERTIME_THRESHOLD_HOURS : 9;
    const fillPct = Math.min((totalHours / otThreshold) * 100, 100);
    const isOTDay = totalHours >= otThreshold;

    const barHtml = segs.map(seg => {
      const pct = (seg.hours / totalHours) * fillPct;
      return `<div style="width:${pct}%;height:100%;background:${empDashProjectColor(seg.name)};" title="${esc(seg.name)}: ${esc(fh(seg.hours))}"></div>`;
    }).join('');

    const chips = segs.map(seg => {
      const dotColor = empDashProjectColor(seg.name);
      return `
      <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--txt2,var(--muted));margin:4px 10px 0 0;">
        <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0;"></span>
        <strong style="color:var(--txt1);">${esc(seg.name)}</strong> ${esc(fh(seg.hours))}
      </span>`;
    }).join('');

    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:700;color:var(--txt1);">${esc(label)}</span>
          <span style="font-size:13px;font-weight:700;color:${isOTDay ? '#92400e' : 'var(--a1)'};">${esc(fh(totalHours))}${isOTDay ? ' · OT' : ''}</span>
        </div>
        <div style="height:6px;border-radius:4px;overflow:hidden;background:var(--surface2,#20242e);display:flex;">${barHtml}</div>
        <div>${chips}</div>
      </div>`;
  }).join('');

  return `
    <div class="cp-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;flex-wrap:wrap;gap:8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2,var(--muted));">Last ${EMP_DASH_RECENT_DAYS_COUNT} Days</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input type="date" id="empDashAnchorDate" value="${esc(anchor)}" max="${esc(todayStr())}"
            style="background:var(--surface2,#20242e);border:1px solid var(--border);border-radius:6px;
            color:var(--txt1);font-size:12px;padding:6px 8px;max-width:150px;"/>
          <button id="empDashViewAttendanceBtn" class="rbtn" style="white-space:nowrap;">View Attendance →</button>
        </div>
      </div>
      ${rows}
    </div>`;
}

function buildAllTimeProjectsSection() {
  const byProj = {}; // name -> { hours, days:Set }
  EMP_DASH_FULL_HISTORY
    .filter(e => e.status !== 'Leave' && e.project)
    .forEach(e => {
      if (!byProj[e.project]) byProj[e.project] = { hours: 0, days: new Set() };
      byProj[e.project].hours += Number(e.hours || 0);
      byProj[e.project].days.add(e.date);
    });

  const list = Object.entries(byProj)
    .map(([name, d]) => ({ name, hours: d.hours, days: d.days.size }))
    .sort((a, b) => b.hours - a.hours);

  const header = `<div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--txt2,var(--muted));margin-bottom:.9rem;">My Projects — All Time</div>`;

  if (!list.length) {
    return `<div class="cp-card">${header}<div style="font-size:12px;color:var(--txt2,var(--muted));">No hours logged yet.</div></div>`;
  }

  const maxHours = Math.max(...list.map(x => x.hours), 0.01);
  const bars = list.map(x => {
    const pct = Math.max((x.hours / maxHours) * 100, 4);
    return `
      <div style="display:flex;flex-direction:column;align-items:center;width:76px;flex-shrink:0;">
        <div style="height:110px;width:22px;display:flex;align-items:flex-end;background:var(--surface2,#20242e);border-radius:6px;overflow:hidden;">
          <div style="width:100%;height:${pct}%;background:${empDashProjectColor(x.name)};"></div>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--txt1);margin-top:8px;text-align:center;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:76px;" title="${esc(x.name)}">${esc(x.name)}</div>
        <div style="font-size:10px;color:var(--txt2,var(--muted));">${esc(fh(x.hours))}</div>
        <div style="font-size:10px;color:var(--txt2,var(--muted));">${x.days} day${x.days !== 1 ? 's' : ''}</div>
      </div>`;
  }).join('');

  return `<div class="cp-card">${header}<div style="display:flex;gap:14px;overflow-x:auto;padding-bottom:4px;">${bars}</div></div>`;
}

// One project's card: name/client/status, this employee's own hours
// on it (their own number — not project-wide, and not cost), and the
// green/red budget bar. The bar itself is whole-project cost vs
// Constant — same signal a Team Leader sees, same total absence of
// any number on it.
// This employee's own cost contribution to a project — their own
// hours each month × their OWN Points for that month, summed. Uses
// only this employee's data (USER.id/USER.name), never anyone
// else's — safe to show alongside the project-wide total, since it
// reveals nothing about a teammate's pay.
function getMyProjectCost(p) {
  const byMonth = {};
  EMP_DASH_FULL_HISTORY.forEach(e => {
    if (e.project !== p.projectName || e.status === 'Leave' || !e.date) return;
    const month = e.date.slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + Number(e.hours || 0);
  });

  let cost = 0;
  Object.entries(byMonth).forEach(([month, hrs]) => {
    cost += hrs * getMonthlyPointsForEmployee(USER.id, month, USER.name);
  });
  return cost;
}

// Detects mobile at render time (matches the CSS breakpoint used
// throughout index.html's @media(max-width:640px) block) — used to
// pick which of the two card designs below to render. Re-checked on
// resize (see the listener near the bottom of this file) so rotating
// a device or resizing a browser window switches the card design
// live, not just on first load.
function isEmpDashMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 640;
}

// Same detailed card everywhere now — desktop and mobile alike.
// buildEmpDashboardCardMinimal (below) is kept but unused; the grid
// itself switches to a single full-width column on mobile (see
// index.html's @media(max-width:640px) block) so this dense card
// still has room to read properly instead of being squeezed into a
// narrow 2-column layout.
function buildEmpDashboardCard(p, opts = {}) {
  return buildEmpDashboardCardDetailed(p, opts);
}

// Desktop/PC card — the full breakdown inline (Constant, Points Used,
// Profit/Loss, Your Points, Start/End dates, status, budget bar).
// There's real room for this on a wide screen, so it doesn't need to
// be pushed to the detail page the way the mobile card does.
function buildEmpDashboardCardDetailed(p, opts = {}) {
  const client = CP_CLIENTS.find(c => c.id === p.clientId);

  let totalCost = 0;
  try {
    totalCost = getProjectCostBreakdown(p).totalCost;
  } catch (err) {
    console.warn('[myprojects-tab] Cost calc failed for', p.projectId, ':', err.message);
  }

  let myCost = 0;
  try {
    myCost = getMyProjectCost(p);
  } catch (err) {
    console.warn('[myprojects-tab] My-cost calc failed for', p.projectId, ':', err.message);
  }

  const budget = parseFloat(p.projectConstant) || 0;
  const hasBudget = budget > 0;
  const isOverBudget = hasBudget && totalCost > budget;
  const fillPct = hasBudget
    ? Math.min((totalCost / budget) * 100, 100)
    : (totalCost > 0 ? 100 : 0);

  let barHtml, labelText, labelColor;
  if (!totalCost) {
    barHtml = `<div style="width:100%;height:100%;background:var(--border-md,#3a3f4b);"></div>`;
    labelText = 'No hours logged yet';
    labelColor = 'var(--txt1,var(--fg))';
  } else if (isOverBudget) {
    barHtml = `<div style="width:100%;height:100%;background:#f87171;"></div>`;
    labelText = 'Over budget';
    labelColor = '#f87171';
  } else {
    barHtml = `<div style="width:${fillPct}%;height:100%;background:#34d399;"></div>`;
    labelText = hasBudget ? 'Within budget' : 'No budget set';
    labelColor = hasBudget ? '#34d399' : 'var(--txt1,var(--fg))';
  }

  const myHours = EMP_DASH_FULL_HISTORY
    .filter(e => e.project === p.projectName && e.status !== 'Leave')
    .reduce((s, e) => s + Number(e.hours || 0), 0);

  const profit = budget - totalCost;
  const isProfit = profit >= 0;
  const moneyFmt = typeof fmtCPMoney === 'function' ? fmtCPMoney : (n => Math.round(Number(n) || 0).toLocaleString('en-IN'));

  const totalsHtml = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:.6rem;font-size:11px;">
      <div><span style="color:var(--muted);">Project Budget:</span> <strong style="color:var(--txt1);">${hasBudget ? esc(moneyFmt(budget)) : 'Not set'}</strong></div>
      <div><span style="color:var(--muted);">Total Points Used:</span> <strong style="color:var(--txt1);">${esc(moneyFmt(totalCost))}</strong></div>
      ${hasBudget ? `<div><span style="color:var(--muted);">${isProfit ? 'Profit Points' : 'Loss Points'}:</span> <strong style="color:${isProfit ? '#34d399' : '#f87171'};">${esc(moneyFmt(Math.abs(profit)))}</strong></div>` : ''}
      <div><span style="color:var(--muted);">My Points Used:</span> <strong style="color:#4f8ef7;">${esc(moneyFmt(myCost))}</strong></div>
    </div>`;

  const viewBtnHtml = `<button class="cp-view-btn" style="margin-top:0;">View Details →</button>`;

  const topRightHtml = opts.unmatched
    ? `<div style="position:absolute;top:14px;right:14px;">${viewBtnHtml}</div>`
    : `<div style="position:absolute;top:14px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        <span class="cp-status-pill" style="background:rgba(79,142,247,0.12);color:#4f8ef7;white-space:nowrap;">${esc(p.status || 'In Progress')}</span>
        ${viewBtnHtml}
      </div>`;

  const titleHtml = opts.unmatched
    ? `<div class="cp-entity-name" style="font-size:14px;padding-right:130px;">${esc(p.projectName)}
        <span style="font-size:9.5px;font-weight:700;color:var(--txt2);background:var(--surface2,#20242e);
          border-radius:8px;padding:1px 6px;margin-left:4px;vertical-align:middle;">No project record</span>
      </div>`
    : `<div style="padding-right:130px;">
        <div class="cp-entity-name" style="font-size:14px;">${esc(p.projectName || p.projectId)}</div>
        <div class="cp-entity-id">${esc(p.projectId)} · ${esc(client?.name || p.clientId || '—')}</div>
      </div>`;

  const datesHtml = opts.unmatched
    ? ''
    : `<div style="font-size:11px;color:var(--muted);margin-bottom:.4rem;">
        Start: <strong style="color:var(--txt1);">${esc(fmtCPDateShort(p.startDate))}</strong>
        · End: <strong style="color:var(--txt1);">${esc(fmtCPDateShort(p.endDate))}</strong>
      </div>`;

  return `
    <div class="cp-entity-card emp-proj-card" data-project="${esc(p.projectName)}" style="position:relative;cursor:pointer;min-width:0;overflow:hidden;">
      ${topRightHtml}
      <div style="margin-bottom:.6rem;">
        ${titleHtml}
      </div>
      ${datesHtml}
      <div style="font-size:11px;color:var(--muted);margin-bottom:.6rem;">Your hours on this project: <strong>${esc(fh(myHours))}</strong></div>
      ${totalsHtml}
      <div style="font-size:9px;font-weight:700;margin-bottom:4px;color:${labelColor};">${labelText}</div>
      <div style="height:6px;background:var(--surface2,#20242e);border-radius:4px;overflow:hidden;">${barHtml}</div>
    </div>`;
}

// Mobile card — icon, name, client, hours, and a single budget-status
// line. All the dense figures (Constant, Points Used, Profit/Loss,
// Your Points, Start/End dates) live on the detail page instead, so a
// clean 2-column mobile grid is possible without cramming.
function buildEmpDashboardCardMinimal(p, opts = {}) {
  const client = CP_CLIENTS.find(c => c.id === p.clientId);

  let totalCost = 0;
  try {
    totalCost = getProjectCostBreakdown(p).totalCost;
  } catch (err) {
    console.warn('[myprojects-tab] Cost calc failed for', p.projectId, ':', err.message);
  }

  const budget = parseFloat(p.projectConstant) || 0;
  const hasBudget = budget > 0;
  const isOverBudget = hasBudget && totalCost > budget;

  let labelText, labelColor, labelBg;
  if (!totalCost) {
    labelText = 'No hours logged yet';
    labelColor = 'var(--txt2,var(--muted))';
    labelBg = 'var(--surface2,#20242e)';
  } else if (isOverBudget) {
    labelText = 'Over budget';
    labelColor = '#f87171';
    labelBg = 'rgba(248,113,113,0.12)';
  } else {
    labelText = hasBudget ? 'Within budget' : 'No budget set';
    labelColor = '#34d399';
    labelBg = 'rgba(52,211,153,0.12)';
  }

  const myHours = EMP_DASH_FULL_HISTORY
    .filter(e => e.project === p.projectName && e.status !== 'Leave')
    .reduce((s, e) => s + Number(e.hours || 0), 0);

  const initials = (p.projectName || '?').trim().slice(0, 2).toUpperCase();
  const avatarColor = empDashProjectColor(p.projectName);
  const subtitle = opts.unmatched ? 'No project record' : esc(client?.name || p.clientId || '—');

  return `
    <div class="cp-entity-card emp-proj-card" data-project="${esc(p.projectName)}" style="cursor:pointer;padding:16px;min-width:0;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="width:38px;height:38px;border-radius:50%;background:${avatarColor};flex-shrink:0;
          display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;">${esc(initials)}</div>
        <span style="font-size:13px;color:var(--txt2,var(--muted));">›</span>
      </div>
      <div class="cp-entity-name" style="font-size:13.5px;line-height:1.3;margin-bottom:2px;">${esc(p.projectName || p.projectId)}</div>
      <div style="font-size:11px;color:var(--txt2,var(--muted));margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${subtitle}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Your hours: <strong style="color:var(--txt1);">${esc(fh(myHours))}</strong></div>
      <div style="display:inline-flex;align-items:center;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;background:${labelBg};color:${labelColor};">${labelText}</div>
    </div>`;
}

// Full project detail — everything that used to be crammed onto the
// card (Constant, Points Used, Profit/Loss, Your Points, Start/End,
// status, budget bar) now lives here instead, above the day-by-day
// entries log. Replaces the whole #myProjCardsContainer content (same
// container the dashboard cards render into) with a "← Back" button
// that re-renders the dashboard — same in-page navigation pattern
// Client-Project.js's own openProjectDetail() uses for Manager/TL,
// just without any of its edit/save/delete UI (this is read-only,
// own-data-only).
function openEmpProjectDetailPage(projectName) {
  const container = $('myProjCardsContainer');
  if (!container) return;

  const p = EMP_DASH_PROJECT_BY_NAME[projectName] || { projectId: '', projectName, clientId: '', status: '', projectConstant: 0, __unmatched: true };
  const client = CP_CLIENTS.find(c => c.id === p.clientId);
  const moneyFmt = typeof fmtCPMoney === 'function' ? fmtCPMoney : (n => Math.round(Number(n) || 0).toLocaleString('en-IN'));

  let totalCost = 0;
  try { totalCost = getProjectCostBreakdown(p).totalCost; } catch (err) { /* leave at 0 */ }
  let myCost = 0;
  try { myCost = getMyProjectCost(p); } catch (err) { /* leave at 0 */ }

  const budget = parseFloat(p.projectConstant) || 0;
  const hasBudget = budget > 0;
  const isOverBudget = hasBudget && totalCost > budget;
  const fillPct = hasBudget ? Math.min((totalCost / budget) * 100, 100) : (totalCost > 0 ? 100 : 0);
  const profit = budget - totalCost;
  const isProfit = profit >= 0;

  let barHtml, statusText, statusColor;
  if (!totalCost) {
    barHtml = `<div style="width:100%;height:100%;background:var(--border-md,#3a3f4b);"></div>`;
    statusText = 'No hours logged yet'; statusColor = 'var(--txt1,var(--fg))';
  } else if (isOverBudget) {
    barHtml = `<div style="width:100%;height:100%;background:#f87171;"></div>`;
    statusText = 'Over budget'; statusColor = '#f87171';
  } else {
    barHtml = `<div style="width:${fillPct}%;height:100%;background:#34d399;"></div>`;
    statusText = hasBudget ? 'Within budget' : 'No budget set'; statusColor = hasBudget ? '#34d399' : 'var(--txt1,var(--fg))';
  }

  const summaryHtml = p.__unmatched
    ? `<div style="font-size:11px;font-weight:700;color:var(--txt2);background:var(--surface2,#20242e);
        border-radius:8px;padding:3px 9px;display:inline-block;margin-bottom:10px;">No project record</div>`
    : `<div style="font-size:11px;color:var(--txt2,var(--muted));margin-bottom:10px;">
        ${esc(p.projectId)} · ${esc(client?.name || p.clientId || '—')}
        · Start: <strong style="color:var(--txt1);">${esc(fmtCPDateShort(p.startDate))}</strong>
        · End: <strong style="color:var(--txt1);">${esc(fmtCPDateShort(p.endDate))}</strong>
      </div>
      <span class="cp-status-pill" style="background:rgba(79,142,247,0.12);color:#4f8ef7;margin-bottom:10px;display:inline-block;">${esc(p.status || 'In Progress')}</span>`;

  const totalsHtml = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin:10px 0;font-size:11px;">
      <div><span style="color:var(--muted);">Project Budget:</span> <strong style="color:var(--txt1);">${hasBudget ? esc(moneyFmt(budget)) : 'Not set'}</strong></div>
      <div><span style="color:var(--muted);">Total Points Used:</span> <strong style="color:var(--txt1);">${esc(moneyFmt(totalCost))}</strong></div>
      ${hasBudget ? `<div><span style="color:var(--muted);">${isProfit ? 'Profit Points' : 'Loss Points'}:</span> <strong style="color:${isProfit ? '#34d399' : '#f87171'};">${esc(moneyFmt(Math.abs(profit)))}</strong></div>` : ''}
      <div><span style="color:var(--muted);">My Points Used:</span> <strong style="color:#4f8ef7;">${esc(moneyFmt(myCost))}</strong></div>
    </div>
    <div style="font-size:9px;font-weight:700;margin-bottom:4px;color:${statusColor};">${statusText}</div>
    <div style="height:6px;background:var(--surface2,#20242e);border-radius:4px;overflow:hidden;margin-bottom:4px;">${barHtml}</div>`;

  const entries = EMP_DASH_FULL_HISTORY
    .filter(e => e.project === projectName && e.status !== 'Leave' && e.date)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalHours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);

  const rowsHtml = entries.length
    ? entries.map(e => {
        const dateLabel = new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN',
          { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        return `
          <div style="padding:9px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span style="font-size:12.5px;font-weight:700;color:var(--txt1);">${esc(dateLabel)}</span>
              <span style="font-size:12.5px;font-weight:700;color:var(--a1);white-space:nowrap;">${esc(fh(e.hours))}</span>
            </div>
            ${e.task ? `<div style="font-size:11px;color:var(--txt2,var(--muted));margin-top:3px;"><span class="tpill">${esc(e.task)}</span></div>` : ''}
            <div style="font-size:11px;color:${e.notes ? 'var(--txt2,var(--muted))' : 'var(--muted)'};margin-top:3px;${e.notes ? '' : 'font-style:italic;'}">
              ${e.notes ? '📝 ' + esc(e.notes) : 'No notes'}
            </div>
          </div>`;
      }).join('')
    : `<div style="font-size:12px;color:var(--txt2,var(--muted));padding:12px 0;">No entries found for this project.</div>`;

  container.innerHTML = `
    <div style="margin-bottom:1rem;">
      <button id="empProjDetailBack" class="cp-back-btn">← Back</button>
    </div>
    <div class="cp-card">
      <div style="font-weight:700;font-size:16px;color:var(--txt1);margin-bottom:6px;">${esc(projectName)}</div>
      ${summaryHtml}
      ${totalsHtml}
      <div style="font-size:11px;color:var(--txt2,var(--muted));margin:10px 0 4px;">${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'} · ${esc(fh(totalHours))} total</div>
      <div>${rowsHtml}</div>
    </div>`;

  $('empProjDetailBack').addEventListener('click', () => renderMyDashboardTab());
}

// ══════════════════════════════════════════════════════════════
// MY ATTENDANCE — read-only, day-by-day: date, status, check-in/out,
// hours worked. Reuses STATUS_META and getDayStatus from
// emp-detail.js (already global, loaded on every portal) for the
// exact same status colors/labels the Manager/TL views use — but
// this is deliberately read-only: no resolution buttons (Force
// Leave/Force Entry/Holiday), since those are manager actions on
// OTHER people's timesheets, not something an employee does to
// their own.
// ══════════════════════════════════════════════════════════════

function computeAttendanceRange() {
  const today = todayStr();

  if (EMP_ATTEND_RANGE === 'month') {
    const fromDate = EMP_ATTEND_MONTH + '-01';
    const toDate = (EMP_ATTEND_MONTH === today.slice(0, 7))
      ? today
      : (typeof lastDayOfMonthStr_ === 'function' ? lastDayOfMonthStr_(EMP_ATTEND_MONTH) : today);
    return { fromDate, toDate };
  }

  // 'last15' — default
  const d = new Date();
  d.setDate(d.getDate() - 14);
  const fromDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { fromDate, toDate: today };
}

// Every calendar date from fromDate to toDate inclusive, most recent
// first — including days with no entries at all, so a missed day is
// visible rather than silently skipped.
function buildDateRangeArray(fromDate, toDate) {
  const dates = [];
  const cur = new Date(fromDate + 'T00:00:00');
  const end = new Date(toDate + 'T00:00:00');
  while (cur <= end) {
    dates.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates.reverse();
}

async function renderMyAttendanceTab() {
  const rangeBar = $('myAttendRangeBar');
  const gridWrap = $('myAttendGridWrap');
  if (!gridWrap) return;

  if (rangeBar) {
    const isMonth = EMP_ATTEND_RANGE === 'month';
    rangeBar.innerHTML = `
      <button class="rbtn ${EMP_ATTEND_RANGE === 'last15' ? 'active' : ''}" data-range="last15">Last 15 Days</button>
      <button class="rbtn ${isMonth ? 'active' : ''}" data-range="month">Select Month</button>
      ${isMonth ? `<input type="month" id="empAttendMonthPicker" value="${esc(EMP_ATTEND_MONTH)}" max="${esc(todayStr().slice(0, 7))}"
        style="margin-left:4px;background:var(--surface2,#20242e);border:1px solid var(--border);border-radius:6px;
        color:var(--txt1);font-size:12px;padding:6px 8px;"/>` : ''}`;

    if (!rangeBar.dataset.wired) {
      rangeBar.dataset.wired = '1';
      rangeBar.addEventListener('click', e => {
        const btn = e.target.closest('button[data-range]');
        if (!btn) return;
        EMP_ATTEND_RANGE = btn.dataset.range;
        renderMyAttendanceTab();
      });
      rangeBar.addEventListener('change', e => {
        if (e.target.id === 'empAttendMonthPicker') {
          EMP_ATTEND_MONTH = e.target.value || todayStr().slice(0, 7);
          renderMyAttendanceTab();
        }
      });
    }
  }

  gridWrap.innerHTML = `<div class="slot-loading"><div class="slot-spinner"></div><span>Loading…</span></div>`;

  try {
    await ensureEmpFullHistoryLoaded();
  } catch (err) {
    gridWrap.innerHTML = `<div class="slot-error">Failed to load your attendance: ${esc(err.message)}</div>`;
    return;
  }

  if (typeof ensureCPStyles === 'function') ensureCPStyles(); // for .cp-card

  const { fromDate, toDate } = computeAttendanceRange();
  const dates = buildDateRangeArray(fromDate, toDate);

  const byDate = {};
  EMP_DASH_FULL_HISTORY.forEach(e => {
    if (!e.date) return;
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const rows = dates.map(dateStr => buildEmpAttendanceRow(dateStr, byDate[dateStr] || [])).join('');
  gridWrap.innerHTML = `<div class="cp-card">${rows}</div>`;
}

function buildEmpAttendanceRow(dateStr, dayEntries) {
  const statusKey = typeof getDayStatus === 'function'
    ? getDayStatus(dateStr, dayEntries)
    : (dayEntries.length ? 'worked' : 'not_logged');

  const worked = dayEntries.filter(e => e.status !== 'Leave');
  const totalHours = worked.reduce((s, e) => s + Number(e.hours || 0), 0);

  let meta = (typeof STATUS_META !== 'undefined' && STATUS_META[statusKey])
    || { icon: '', label: statusKey, fg: 'var(--txt1)', bg: 'var(--surface2)' };

  // Worked days get a more specific label based on hours — same 9h
  // threshold table.js already uses for its own OT badge
  // (OVERTIME_THRESHOLD_HOURS), so "OT" here means the same thing it
  // does on the Timesheet tab. Leave/Holiday/Not Logged/etc. are left
  // exactly as STATUS_META defines them.
  if (statusKey === 'worked') {
    const otThreshold = typeof OVERTIME_THRESHOLD_HOURS === 'number' ? OVERTIME_THRESHOLD_HOURS : 9;
    if (totalHours >= otThreshold) {
      const overage = totalHours - otThreshold;
      meta = { icon: '⚡', label: `OT · ${fh(overage)}`, fg: '#92400e', bg: 'rgba(251,191,36,0.18)' };
    } else if (totalHours > 0) {
      const shortfall = otThreshold - totalHours;
      meta = { icon: '🔵', label: `Permission · ${fh(shortfall)}`, fg: '#4f8ef7', bg: 'rgba(79,142,247,0.12)' };
    }
  }

  const label = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const timeIns  = worked.map(e => e.timeIn).filter(Boolean).sort();
  const timeOuts = worked.map(e => e.timeOut).filter(Boolean).sort();
  const checkIn  = timeIns[0] || null;
  const checkOut = timeOuts[timeOuts.length - 1] || null;

  const checkTimesHtml = (checkIn || checkOut)
    ? `<span style="font-size:11px;color:var(--txt2,var(--muted));white-space:nowrap;">
         <b style="color:var(--txt1);">${esc(checkIn || '—')}</b> → <b style="color:var(--txt1);">${esc(checkOut || '—')}</b>
       </span>`
    : '';

  return `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <span style="font-size:13px;font-weight:700;color:var(--txt1);min-width:170px;">${esc(label)}</span>
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;
        background:${meta.bg};color:${meta.fg};white-space:nowrap;">${meta.icon} ${esc(meta.label)}</span>
      ${checkTimesHtml}
      <div style="flex:1;"></div>
      <span style="font-size:13px;font-weight:700;color:var(--txt1);white-space:nowrap;">${totalHours > 0 ? esc(fh(totalHours)) : '—'}</span>
    </div>`;
}