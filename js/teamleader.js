// ═══════════════════════════════════════════════════
// TEAMLEADER.JS — Team Leader Portal shell
// Tabs: Project | Client | Employees
//
// Like manager.js, this file is ONLY a loading/navigation platform
// for its own Employees tab — Project and Client are handed off
// wholesale to client-project.js, the single shared module that owns
// everything about Clients and Projects (cards, per-project "candle"
// performance charts, Manager/Team Leader Notes, Timeline, Team &
// Hours). That gives the Team Leader the exact same Project/Client
// experience as the Manager Portal, automatically, with no separate
// implementation to maintain — Project Constant/Value and
// Profit/Loss still never appear here, the same permission boundary
// client-project.js already enforces (backend-checked in Code.gs,
// not just hidden in this UI).
//
//   Project   → client-project.js (renderProjectTab) — also covers Clients (folded in, same merged view as Manager Portal)
//   Employees → this file (renderTLEmployeesTab)
//
// Access: all employees, force leave, project/client cards + hours.
// No financial data (Project Constant/Value/Profit — Manager only).
// ═══════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────
let TL_DATA        = [];
let TL_EMPLOYEES   = [];
let TL_CLIENTS     = [];
let TL_PROJECTS    = [];

let TL_TAB         = 'employees';  // project|employees|timesheet|attendance|historical — Employees is the default landing tab (Team Leader manages people first)
let TL_RANGE       = 'week';
let TL_DAY_OFFSET  = 0;
let TL_MONTH       = '';

// Timesheet tab's own state — same shape as manager.js's MGR_TS_*,
// showing the exact same thing Manager sees (this tab has no
// cost/points/financial figures at all, so there's no permission
// boundary being crossed by matching Manager's view exactly here).
let TL_TS_RANGE          = 'day15';
let TL_TS_DAY_OFFSET     = 0;
let TL_TS_SELECTED_MONTH = '';
let TL_TS_MONTH_DAY      = ''; // 'YYYY-MM-DD' — a specific day within the selected month; '' = whole month
let TL_TS_EMP_FILTER     = '';
let TL_TS_SEARCH         = '';
let TL_TS_PAGE           = 0;
const TL_TS_PAGE_SIZE    = 10; // dates per page

const TL_PALETTE = [
  '#4f8ef7','#7c5cfc','#34d399','#fbbf24',
  '#5eead4','#22d3ee','#fb923c','#a78bfa',
  '#f472b6','#84cc16','#38bdf8','#4ade80',
];

// ── INIT ──────────────────────────────────────────
async function initTeamLeader() {
  TL_MONTH = todayStr().slice(0,7);
  TL_TS_SELECTED_MONTH = todayStr().slice(0,7);
  const container = $('tlApp');
  if (!container) return;

  container.innerHTML = `<div class="mgr-loading">
    <div class="slot-spinner"></div>
    <span>Loading team data…</span>
  </div>`;

  try {
    // ── SINGLE BULK REQUEST ──────────────────────────
    // Replaces the old N-request architecture (19 separate
    // apiGetAllHistory() calls via Promise.all, one per employee —
    // the actual root cause of the slow/failing loads, since more
    // concurrency or longer timeouts just meant more simultaneous
    // requests that could each fail on a flaky connection) with the
    // existing backend action getTLData(), which already loops every
    // employee sheet server-side and returns one combined payload:
    // { employees, clients, projects, entries }. This single call
    // also replaces the earlier separate getMasterData() (whether
    // fresh or reused from auth.js's LIVE_EMPLOYEES) — getTLData()
    // already includes employees/clients/projects itself, so a
    // second source for the same data would just be redundant.
    const data = await sheetGET({ action: 'getTLData' });

    TL_EMPLOYEES = data.employees || [];
    TL_CLIENTS   = data.clients   || [];
    TL_PROJECTS  = data.projects  || [];
    TL_DATA      = data.entries   || [];

    // Lightweight in-memory index so Employee Detail (and anything
    // else that needs "this one employee's entries") never has to
    // re-scan the full TL_DATA array — see emp-detail.js's use of
    // this for the local (no-network) detail path.
    rebuildTLEmployeeIndex();

    // Forward to client-project.js — without this, its Project/Client
    // cards can't resolve employee names or populate the Team Hours /
    // candle charts (CP_EMPLOYEES / CP_TIMESHEET_DATA are only ever
    // set via these two calls, same as manager.js).
    if (typeof ClientProjectAPI !== 'undefined' && typeof ClientProjectAPI.ingestMasterData === 'function') {
      ClientProjectAPI.ingestMasterData({ employees: TL_EMPLOYEES, clients: TL_CLIENTS, projects: TL_PROJECTS });
    }
    if (typeof ClientProjectAPI !== 'undefined' && typeof ClientProjectAPI.ingestTimesheetData === 'function') {
      ClientProjectAPI.ingestTimesheetData(TL_DATA);
    }

    renderTLPortal();
  } catch(err) {
    // A real bulk-request failure is shown honestly, not silently
    // converted into empty/zero data for every employee — an empty
    // TL_DATA should only ever mean "genuinely no entries exist",
    // never "the request failed".
    container.innerHTML = `<div class="slot-error">Failed to load Team Leader data: ${esc(err.message)}
      <br/><button class="btn bghost" style="margin-top:.75rem" onclick="initTeamLeader()">↻ Retry</button></div>`;
  }
}

// Rebuilt every time TL_DATA changes (initial bulk load, or a
// targeted update after a manual save — see wireEmpDetailManualSave
// in emp-detail.js). Employee Detail filters this instead of
// scanning the full TL_DATA array on every open/date-range/month
// change, and — more importantly — instead of making a network
// request the way it used to.
let TL_EMPLOYEE_INDEX = {};
function rebuildTLEmployeeIndex() {
  TL_EMPLOYEE_INDEX = {};
  (TL_DATA || []).forEach(e => {
    if (!TL_EMPLOYEE_INDEX[e.empId]) TL_EMPLOYEE_INDEX[e.empId] = [];
    TL_EMPLOYEE_INDEX[e.empId].push(e);
  });
}

// ── RENDER PORTAL SHELL ───────────────────────────
function renderTLPortal() {
  const container = $('tlApp');
  if (!container) return;

  container.innerHTML = `
    <!-- Top nav tabs -->
    <div style="display:flex;gap:4px;margin-bottom:1.5rem;border-bottom:1px solid var(--border);padding-bottom:0;">
      ${[
        { id:'project',      icon:'📁', label:'Projects & Clients' },
        { id:'employees',    icon:'👥', label:'Employees'  },
        { id:'timesheet',    icon:'🕐', label:'Timesheet' },
        { id:'attendance',   icon:'🕒', label:'Attendance' },
        { id:'historical',   icon:'📜', label:'Historical Import' },
      ].map(t => `
        <button class="tl-tab${TL_TAB===t.id?' active':''}" data-tab="${t.id}" style="
          padding:8px 16px;border:none;background:none;cursor:pointer;
          font-size:13px;font-weight:600;
          color:${TL_TAB===t.id?'var(--a1)':'var(--txt2)'};
          border-bottom:2px solid ${TL_TAB===t.id?'var(--a1)':'transparent'};
          margin-bottom:-1px;transition:all .2s;
        ">${t.icon} ${t.label}</button>
      `).join('')}
    </div>
    <div id="tlTabContent"></div>
  `;

  container.querySelectorAll('.tl-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      TL_TAB = btn.dataset.tab;
      container.querySelectorAll('.tl-tab').forEach(b => {
        const active = b === btn;
        b.style.color        = active ? 'var(--a1)' : 'var(--txt2)';
        b.style.borderBottom = active ? '2px solid var(--a1)' : '2px solid transparent';
      });
      renderTLTab();
    });
  });

  renderTLTab();
}

// ── ROUTE TO TAB ──────────────────────────────────
// Project and Client are pure hand-offs to client-project.js, same
// pattern as manager.js — if that module hasn't loaded, show a plain
// message instead of falling back to any old local implementation.
function renderTLTab() {
  const content = $('tlTabContent');
  if (!content) return;

  if (TL_TAB === 'project') {
    if (typeof renderProjectTab === 'function') renderProjectTab(content);
    else content.innerHTML = `<div class="chart-empty">Project module (client-project.js) is not loaded.</div>`;
    return;
  }

  if (TL_TAB === 'employees') { renderTLEmployeesTab(content); return; }

  if (TL_TAB === 'timesheet') { renderTLTimesheetTab(content); return; }

  if (TL_TAB === 'attendance') {
    if (typeof renderAttendanceTab === 'function') renderAttendanceTab(content);
    else content.innerHTML = `<div class="chart-empty">Attendance module (client-project.js) is not loaded.</div>`;
    return;
  }

  if (TL_TAB === 'historical') {
    if (typeof renderHistoricalImportTab === 'function') renderHistoricalImportTab(content);
    else content.innerHTML = `<div class="chart-empty">Historical Import module (historical-import.js) is not loaded.</div>`;
    return;
  }
}

// ══════════════════════════════════════════════════
// EMPLOYEES TAB
// ══════════════════════════════════════════════════
function renderTLEmployeesTab(content) {
  const filtered = getTLFiltered();
  const worked   = filtered.filter(isWorkedEntry);
  const totHours = tlCalcHours(worked);

  content.innerHTML = `
    <!-- Summary strip -->
    <div class="strip" style="margin-bottom:1.25rem">
      <div class="sitem"><span class="slbl">Total Hours</span><span class="sval hi" id="tlTot">${fh(totHours)}</span></div>
      <div class="sitem"><span class="slbl">Employees</span><span class="sval" id="tlEmpCnt">${new Set(filtered.map(e=>e.empId)).size}</span></div>
      <div class="sitem"><span class="slbl">Active Projects</span><span class="sval" id="tlProjCnt">${new Set(worked.filter(e=>e.project).map(e=>e.project)).size}</span></div>
      <div class="sitem"><span class="slbl">Clients</span><span class="sval" id="tlCliCnt">${new Set(worked.filter(e=>e.client&&e.client!=='Leave').map(e=>e.client)).size}</span></div>
    </div>

    <!-- Range controls -->
    <div class="mgr-controls" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <div class="chart-range" id="tlRange">
        <button class="rbtn${TL_RANGE==='day15'?' active':''}"  data-range="day15">15 Days</button>
        <button class="rbtn${TL_RANGE==='week'?' active':''}"   data-range="week">This Week</button>
        <button class="rbtn${TL_RANGE==='month'?' active':''}"  data-range="month">This Month</button>
        <button class="rbtn${TL_RANGE==='all'?' active':''}"    data-range="all">All Time</button>
      </div>
      <button id="tlEmpRefreshBtn" title="Refresh this tab's data" style="background:var(--elevated);
        border:1px solid var(--border-md);border-radius:6px;color:var(--txt2);cursor:pointer;
        padding:7px 10px;font-size:13px;line-height:1;display:flex;align-items:center;">🔄</button>
    </div>

    <!-- 15-day scroll -->
    <div id="tlDayScroll" style="display:${TL_RANGE==='day15'?'flex':'none'};
      gap:6px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;"></div>

    <!-- Month picker -->
    <div id="tlMonthPicker" style="display:${TL_RANGE==='month'?'flex':'none'};
      gap:8px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;"></div>

    <!-- Employee cards -->
    <div id="tlEmpCards"></div>
  `;

  // Employees pulls from TL_EMPLOYEES/TL_DATA — the same bulk payload
  // every TL tab shares — so the correct "refresh" here is the same
  // full reload initTeamLeader() already does on first login, just
  // re-invoked on demand. TL_TAB isn't touched by it, so it lands
  // back on this tab once the reload finishes.
  $('tlEmpRefreshBtn').addEventListener('click', async () => {
    const btn = $('tlEmpRefreshBtn');
    btn.disabled = true; btn.style.opacity = '.5';
    try {
      await initTeamLeader();
      toast?.('s', 'Refreshed', 'Employee data is up to date.');
    } catch (err) {
      toast?.('e', 'Refresh failed', err.message);
      btn.disabled = false; btn.style.opacity = '';
    }
  });

  $('tlRange').addEventListener('click', e => {
    const btn = e.target.closest('.rbtn');
    if (!btn) return;
    TL_RANGE = btn.dataset.range;
    TL_DAY_OFFSET = 0;
    $('tlRange').querySelectorAll('.rbtn').forEach(b => b.classList.toggle('active', b===btn));
    $('tlDayScroll').style.display   = TL_RANGE==='day15' ? 'flex' : 'none';
    $('tlMonthPicker').style.display = TL_RANGE==='month' ? 'flex' : 'none';
    if (TL_RANGE==='day15') buildTLDayScroll();
    if (TL_RANGE==='month') buildTLMonthPicker();
    renderTLEmpCards();
  });

  if (TL_RANGE==='day15') buildTLDayScroll();
  if (TL_RANGE==='month') buildTLMonthPicker();
  renderTLEmpCards();
}

function renderTLEmpCards() {
  const content  = $('tlEmpCards');
  if (!content) return;
  const filtered = getTLFiltered();
  const worked   = filtered.filter(isWorkedEntry);

  // Update summary strip
  const tlTot     = $('tlTot');     if (tlTot)     tlTot.textContent     = fh(tlCalcHours(worked));
  const tlEmpCnt  = $('tlEmpCnt');  if (tlEmpCnt)  tlEmpCnt.textContent  = new Set(filtered.map(e=>e.empId)).size;
  const tlProjCnt = $('tlProjCnt'); if (tlProjCnt) tlProjCnt.textContent = new Set(worked.filter(e=>e.project).map(e=>e.project)).size;
  const tlCliCnt  = $('tlCliCnt');  if (tlCliCnt)  tlCliCnt.textContent  = new Set(worked.filter(e=>e.client&&e.client!=='Leave').map(e=>e.client)).size;

  // Build employee map
  const empMap = {};
  TL_EMPLOYEES.forEach((emp, idx) => {
    empMap[emp.id] = {
      id: emp.id, name: emp.name, team: emp.team, entryIndex: idx,
      hours: 0, days: new Set(), leaves: 0,
      projectMap: {}, missedDays: [],
      monthHours: 0, monthDays: 0, monthLeaves: 0, lastActivityDate: '',
    };
  });

  worked.forEach(e => {
    if (!empMap[e.empId]) return;
    const h = tlParseH(e.hours);
    empMap[e.empId].hours += h;
    empMap[e.empId].days.add(e.date);
    if (e.project) empMap[e.empId].projectMap[e.project] = (empMap[e.empId].projectMap[e.project]||0) + h;
  });

  filtered.filter(e=>e.status==='Leave').forEach(e => {
    if (empMap[e.empId]) { empMap[e.empId].leaves++; empMap[e.empId].days.add(e.date); }
  });

  // Missed working days
  const rangeDates = getTLWorkingDays();
  Object.values(empMap).forEach(emp => {
    emp.missedDays = rangeDates.filter(d => !emp.days.has(d));
  });

  // Monthly summary
  const curMonth  = todayStr().slice(0,7);
  Object.values(empMap).forEach(emp => {
    const me = TL_DATA.filter(e => e.empId===emp.id && e.date.startsWith(curMonth));
    const mw = me.filter(isWorkedEntry);
    emp.monthHours  = mw.reduce((s,e) => s+tlParseH(e.hours), 0);
    emp.monthDays   = new Set(mw.map(e=>e.date)).size;
    // Unique DATES with a Leave entry, not raw entry count — same fix
    // as manager.js. The partial-permission Leave feature lets one
    // day have two Leave entries (morning + afternoon windows), which
    // was inflating this to 2x the real number of leave days.
    emp.monthLeaves = new Set(me.filter(e=>e.status==='Leave').map(e => e.date)).size;

    // "Last entered" means last TIMESHEET ACTIVITY — whoever most
    // recently logged an actual entry — not when their employee
    // record was added to the sheet (that's what entryIndex was,
    // and it's the wrong signal: someone with zero recent activity
    // could still show up at the top just for being a newer hire).
    emp.lastActivityDate = TL_DATA
      .filter(e => e.empId === emp.id)
      .reduce((max, e) => (e.date > max ? e.date : max), '');
  });

  // Most recently active employee first — matches manager.js.
  const rows = Object.values(empMap).sort((a, b) => {
    if (a.lastActivityDate !== b.lastActivityDate) return b.lastActivityDate.localeCompare(a.lastActivityDate);
    return b.hours - a.hours;
  });
  if (!rows.length) { content.innerHTML = `<div class="chart-empty">No employees found.</div>`; return; }

  content.innerHTML = `
    <div style="margin-top:.5rem;">
      ${rows.map(emp => buildTLEmpCard(emp)).join('')}
    </div>`;

  content.querySelectorAll('.tl-leave-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await applyTLLeave(btn, btn.dataset.empId, btn.dataset.date, btn.dataset.empName);
    });
  });

  content.querySelectorAll('.view-emp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof openEmpDetail === 'function') openEmpDetail(btn.dataset.empId, btn.dataset.empName);
      else toast?.('e', 'Employee Detail unavailable', 'emp-detail.js is not loaded.');
    });
  });
}

// ── EMPLOYEE CARD ─────────────────────────────────
function buildTLEmpCard(emp) {
  const projects   = Object.entries(emp.projectMap).sort((a,b)=>b[1]-a[1]);
  const totalHours = emp.hours;
  const hasMissed  = emp.missedDays.length > 0;
  const initials   = emp.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const rangeLabel = getTLRangeLabel();
  const curMonth   = new Date(todayStr().slice(0,7)+'-01')
    .toLocaleDateString('en-IN',{month:'long',year:'numeric'});

  // Legend
  const legendHtml = projects.length === 0
    ? `<div style="font-size:12px;color:var(--txt2);">No projects logged</div>`
    : projects.slice(0,5).map(([proj,hrs],i) => `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${TL_PALETTE[i%TL_PALETTE.length]};flex-shrink:0;"></span>
          <span style="font-size:11px;color:var(--txt2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(proj)}">${esc(proj)}</span>
          <span style="font-size:11px;color:var(--txt1);font-weight:600;">${fh(hrs)}</span>
        </div>`).join('') +
      (projects.length>5?`<div style="font-size:10px;color:var(--txt2);">+${projects.length-5} more</div>`:'');

  // Missed days
  const missedSection = hasMissed ? `
    <div class="missed-section" style="margin-top:10px;border-top:1px solid rgba(239,68,68,0.25);padding-top:10px;">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:7px;">
        <span>⚠️</span>
        <span class="tl-missed-count" style="color:#ef4444;font-size:11px;font-weight:600;">
          ${emp.missedDays.length} day${emp.missedDays.length>1?'s':''} not logged
        </span>
      </div>
      ${emp.missedDays.map(date=>`
        <div class="tl-missed-row" style="display:flex;align-items:center;justify-content:space-between;
          padding:5px 10px;margin-bottom:5px;background:rgba(239,68,68,0.07);
          border:1px solid rgba(239,68,68,0.2);border-radius:7px;gap:8px;">
          <span style="font-size:11px;color:var(--txt1);white-space:nowrap;">${tlFmtDate(date)}</span>
          <button class="tl-leave-btn"
            data-emp-id="${emp.id}" data-emp-name="${esc(emp.name)}" data-date="${date}"
            style="background:#ef4444;color:#fff;border:none;border-radius:5px;
              padding:4px 12px;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;">
            Force Leave</button>
        </div>`).join('')}
    </div>` : '';

  // Day view: check-in/out
  const isDayView = TL_RANGE === 'day15';
  let dayInfoHtml = '';
  if (isDayView && totalHours > 0) {
    const selDate  = getTL15Days()[TL_DAY_OFFSET];
    const dayEnts  = TL_DATA.filter(e=>e.empId===emp.id&&e.date===selDate).filter(isWorkedEntry);
    const timesIn  = dayEnts.map(e=>e.timeIn).filter(Boolean).sort();
    const timesOut = dayEnts.map(e=>e.timeOut).filter(Boolean).sort();
    const tIn      = timesIn[0] || null;
    const tOut     = timesOut[timesOut.length-1] || null;
    const outMins  = tOut ? tlToMins(tOut) : 0;
    const isExt    = outMins > tlToMins('19:30');
    const extH     = isExt ? (outMins - tlToMins('19:30'))/60 : 0;

    dayInfoHtml = `
      <div style="margin-top:10px;padding:10px 12px;background:var(--surface2);border-radius:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span>🕘</span>
            <span style="font-size:11px;color:var(--txt2);">Check In</span>
            <span style="font-size:12px;font-weight:700;color:var(--txt1);">${tlFmt12(tIn)}</span>
          </div>
          <span style="font-size:11px;color:var(--txt2);">→</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span>🕔</span>
            <span style="font-size:11px;color:var(--txt2);">Check Out</span>
            <span style="font-size:12px;font-weight:700;color:var(--txt1);">${tlFmt12(tOut)}</span>
          </div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:8px;display:flex;gap:14px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:4px;">
            <span>🍽</span><span style="font-size:11px;color:var(--txt2);">Lunch</span>
            <span style="font-size:12px;font-weight:700;color:var(--txt1);">45m</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span>⏱</span><span style="font-size:11px;color:var(--txt2);">Worked</span>
            <span style="font-size:12px;font-weight:700;color:var(--txt1);">${fh(totalHours)}</span>
          </div>
          ${isExt?`<div style="display:flex;align-items:center;gap:4px;">
            <span>🌙</span><span style="font-size:11px;color:var(--txt2);">Extended</span>
            <span style="font-size:12px;font-weight:700;color:#a78bfa;">${fh(extH)}</span>
          </div>`:''}
        </div>
        ${isExt?`<div style="margin-top:6px;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.3);
          border-radius:6px;padding:4px 8px;font-size:10px;color:#a78bfa;font-weight:600;">
          🌙 Extended: stayed until ${tlFmt12(tOut)}</div>`:''}
      </div>`;
  }

  const donutSvg = buildTLDonut(projects, totalHours);

  return `
    <div class="emp-card" style="background:var(--surface1);
      border:1px solid ${hasMissed?'rgba(239,68,68,0.4)':'var(--border)'};border-radius:14px;padding:1.1rem 1.3rem;margin-bottom:1.1rem;">

      <!-- Identity + monthly quick stats + View Details, all in one row -->
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:20px;">
        <div style="display:flex;align-items:center;gap:10px;flex:0 0 auto;min-width:170px;">
          <div style="width:36px;height:36px;border-radius:50%;
            background:linear-gradient(135deg,var(--a1),#7c5cfc);
            display:flex;align-items:center;justify-content:center;
            font-weight:700;font-size:13px;color:#fff;flex-shrink:0;">${initials}</div>
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:14px;color:var(--txt1);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(emp.name)}</div>
            <div style="font-size:11px;color:var(--txt2);">${esc(emp.team)}</div>
          </div>
        </div>

        <div style="display:flex;gap:22px;flex-wrap:wrap;flex:1;align-items:center;">
          <span style="font-size:10.5px;color:var(--txt2);font-weight:600;white-space:nowrap;">📅 ${curMonth}</span>
          <div>
            <div style="font-size:9.5px;color:var(--txt2);text-transform:uppercase;letter-spacing:.4px;">Worked</div>
            <div style="font-size:14px;font-weight:800;color:var(--a1);">${fh(emp.monthHours)}</div>
          </div>
          <div>
            <div style="font-size:9.5px;color:var(--txt2);text-transform:uppercase;letter-spacing:.4px;">Days</div>
            <div style="font-size:14px;font-weight:800;color:var(--txt1);">${emp.monthDays}</div>
          </div>
          <div>
            <div style="font-size:9.5px;color:var(--txt2);text-transform:uppercase;letter-spacing:.4px;">Leaves</div>
            <div style="font-size:14px;font-weight:800;color:#fbbf24;">${emp.monthLeaves}</div>
          </div>
        </div>

        <button class="view-emp-btn" data-emp-id="${emp.id}" data-emp-name="${esc(emp.name)}"
          style="background:var(--a1);color:#fff;border:none;border-radius:6px;
            padding:8px 16px;font-size:11px;font-weight:600;cursor:pointer;
            white-space:nowrap;flex-shrink:0;">
          View Details →
        </button>
      </div>

      <!-- Donut LEFT + Legend RIGHT -->
      <div style="display:flex;align-items:center;gap:1.2rem;margin-top:1rem;">
        <div style="position:relative;width:160px;height:160px;flex-shrink:0;">
          ${donutSvg}
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;
            align-items:center;justify-content:center;pointer-events:none;">
            <span style="font-size:18px;font-weight:800;color:var(--txt1);line-height:1.1;">${fh(totalHours)}</span>
            <span style="font-size:9px;color:var(--txt2);text-transform:uppercase;letter-spacing:.6px;margin-top:3px;">${rangeLabel}</span>
          </div>
        </div>
        <div style="flex:1;min-width:0;">${legendHtml}</div>
      </div>

      ${dayInfoHtml}
      ${missedSection}
    </div>`;
}

// ── FORCE LEAVE ───────────────────────────────────
async function applyTLLeave(btn, empId, date, empName) {
  btn.disabled=true; btn.textContent='…';
  try {
    await sheetGET({ action:'forceLeave', data: encodeURIComponent(JSON.stringify({ uid:empId, date })) });
    const row=btn.closest('.tl-missed-row');
    if(row){ row.style.opacity='.4'; btn.textContent='✓ Done'; btn.style.background='#34d399'; }
    TL_DATA.push({empId,date,status:'Leave',hours:'0h',empName,empTeam:''});
    const card=btn.closest('.emp-card');
    if(card){
      const rem=card.querySelectorAll('.tl-leave-btn:not([disabled])').length-1;
      const badge=card.querySelector('.tl-missed-count');
      if(badge){
        if(rem<=0){ card.querySelector('.missed-section')?.remove(); card.style.borderColor='var(--border)'; }
        else badge.textContent=`${rem} day${rem>1?'s':''} not logged`;
      }
    }
    tlToast(`✅ Leave applied — ${empName} on ${tlFmtDate(date)}`);
  } catch(err) {
    btn.disabled=false; btn.textContent='Force Leave';
    tlToast(`❌ Failed: ${err.message}`, true);
  }
}

// ══════════════════════════════════════════════════
// TIMESHEET MODULE — every employee's entries, grouped date-wise.
// Ported directly from manager.js's own Timesheet tab, showing the
// exact same thing Manager sees. Reuses TL_DATA (already loaded once
// in initTeamLeader via the same getTLData action Manager uses, so
// it already carries every employee, not just this TL's own team —
// tagged with empId/empName on every entry) — no new fetch needed.
// Own range/filter/page state (TL_TS_*), independent of the
// Employees tab's own TL_RANGE/TL_DAY_OFFSET/TL_MONTH. This tab
// shows no cost/points/financial figures at all, so there's no
// Manager-only boundary being crossed by matching Manager's view
// exactly here (unlike, say, Project Constant/Profit-Loss elsewhere
// in this portal, which stays Manager-only by design).
// ══════════════════════════════════════════════════
function getTLTimesheetFiltered() {
  let rows;
  if (TL_TS_RANGE === 'month') {
    rows = TL_TS_MONTH_DAY
      ? TL_DATA.filter(e => e.date === TL_TS_MONTH_DAY)
      : TL_DATA.filter(e => e.date.startsWith(TL_TS_SELECTED_MONTH));
  } else {
    // 'day15' — the only other/default mode
    const d = getTL15Days()[TL_TS_DAY_OFFSET];
    rows = TL_DATA.filter(e => e.date === d);
  }

  if (TL_TS_EMP_FILTER) rows = rows.filter(e => e.empId === TL_TS_EMP_FILTER);

  if (TL_TS_SEARCH) {
    const q = TL_TS_SEARCH.toLowerCase();
    rows = rows.filter(e =>
      [e.empName, e.project, e.client, e.task, e.notes].some(v => v && String(v).toLowerCase().includes(q))
    );
  }

  return rows;
}

const TL_TS_RANGE_COLORS = {
  day15: { bg: 'linear-gradient(135deg,#4f8ef7,#38bdf8)', fg: '#4f8ef7' },
  month: { bg: 'linear-gradient(135deg,#f59e0b,#fbbf24)', fg: '#f59e0b' },
};

function renderTLTimesheetTab(content) {
  content.innerHTML = `
    <div class="mgr-controls">
      <div style="display:flex;gap:6px;flex-wrap:wrap;" id="tlTsRange">
        ${[
          { id:'day15', label:'📅 15 Days' },
          { id:'month', label:'📆 This Month' },
        ].map(r => {
          const active = TL_TS_RANGE === r.id;
          const c = TL_TS_RANGE_COLORS[r.id];
          return `<button class="tl-ts-rbtn" data-range="${r.id}" style="padding:7px 14px;border-radius:20px;
            border:1px solid ${active ? 'transparent' : 'var(--border-md)'};
            background:${active ? c.bg : 'var(--surface2)'};
            color:${active ? '#fff' : 'var(--txt2)'};
            font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;">${r.label}</button>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="tlTsEmpFilter" class="filt">
          <option value="">All Employees</option>
          ${TL_EMPLOYEES.filter(emp => emp.active).map(emp => `<option value="${esc(emp.id)}" ${TL_TS_EMP_FILTER===emp.id?'selected':''}>${esc(emp.name)}</option>`).join('')}
        </select>
        <input type="search" id="tlTsSearch" class="srch" placeholder="Search project, notes…" value="${esc(TL_TS_SEARCH)}"/>
      </div>
    </div>

    <div id="tlTsDayScroll" style="display:${TL_TS_RANGE==='day15'?'flex':'none'};
      gap:6px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;min-width:0;"></div>

    <div id="tlTsMonthPicker" style="display:${TL_TS_RANGE==='month'?'flex':'none'};
      gap:8px;margin-bottom:1rem;align-items:center;min-width:0;"></div>

    <div id="tlTsMonthDayScroll" style="display:${TL_TS_RANGE==='month'?'flex':'none'};
      gap:6px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;min-width:0;"></div>

    <div id="tlTsContent"></div>
  `;

  $('tlTsRange').addEventListener('click', e => {
    const btn = e.target.closest('.tl-ts-rbtn');
    if (!btn) return;
    TL_TS_RANGE = btn.dataset.range;
    TL_TS_DAY_OFFSET = 0;
    TL_TS_MONTH_DAY = '';
    TL_TS_PAGE = 0;
    renderTLTimesheetTab(content); // full re-render — rebuilds the pills' active colors and swaps which picker shows
  });

  $('tlTsEmpFilter').addEventListener('change', e => {
    TL_TS_EMP_FILTER = e.target.value;
    TL_TS_PAGE = 0;
    renderTLTsContent();
  });

  $('tlTsSearch').addEventListener('input', e => {
    TL_TS_SEARCH = e.target.value;
    TL_TS_PAGE = 0;
    renderTLTsContent();
  });

  if (TL_TS_RANGE === 'day15') buildTLTsDayScrollBar();
  if (TL_TS_RANGE === 'month') { buildTLTsMonthPicker(); buildTLTsMonthDayScrollBar(); }
  renderTLTsContent();
}

function buildTLTsDayScrollBar() {
  const bar = $('tlTsDayScroll'); if (!bar) return;
  const days = getTL15Days();
  bar.innerHTML = days.map((d,i) => {
    const isActive  = i===TL_TS_DAY_OFFSET;
    const isWeekend = new Date(d+'T00:00:00').getDay()%6===0;
    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : tlFmtDate(d);
    return `<button data-offset="${i}" style="flex-shrink:0;padding:6px 14px;border-radius:20px;
      border:1px solid ${isActive?'transparent':'var(--border)'};
      background:${isActive?'linear-gradient(135deg,#4f8ef7,#38bdf8)':'var(--surface2)'};
      color:${isActive?'#fff':isWeekend?'#a78bfa':'var(--txt1)'};
      font-size:11px;font-weight:${isActive?'700':'500'};cursor:pointer;white-space:nowrap;transition:all .15s;">${label}</button>`;
  }).join('');
  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      TL_TS_DAY_OFFSET = parseInt(btn.dataset.offset);
      TL_TS_PAGE = 0;
      buildTLTsDayScrollBar();
      renderTLTsContent();
    });
  });

  if (!bar.dataset.wheelWired) {
    bar.dataset.wheelWired = '1';
    bar.addEventListener('wheel', e => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    }, { passive: false });
  }
}

function stepTLTsMonth(dir) {
  const [y, m] = TL_TS_SELECTED_MONTH.split('-').map(Number);
  const next = new Date(y, (m - 1) + dir, 1);
  const nextVal = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  if (nextVal > todayStr().slice(0, 7)) return; // never step past the current month into the future
  TL_TS_SELECTED_MONTH = nextVal;
  TL_TS_MONTH_DAY = '';
  TL_TS_PAGE = 0;
  buildTLTsMonthPicker();
  buildTLTsMonthDayScrollBar();
  renderTLTsContent();
}

function buildTLTsMonthPicker() {
  const picker = $('tlTsMonthPicker'); if (!picker) return;
  const isCurrentMonth = TL_TS_SELECTED_MONTH >= todayStr().slice(0, 7);

  picker.innerHTML = `
    <button id="tlTsMonthPrev" class="pbtn" title="Previous month">‹</button>
    <input type="month" id="tlTsMonthInput" value="${esc(TL_TS_SELECTED_MONTH)}" max="${esc(todayStr().slice(0,7))}"
      style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;
      color:var(--txt1);font-size:13px;padding:8px 12px;cursor:pointer;"/>
    <button id="tlTsMonthNext" class="pbtn" ${isCurrentMonth ? 'disabled' : ''} title="Next month">›</button>`;

  const input = $('tlTsMonthInput');
  input.addEventListener('change', e => {
    TL_TS_SELECTED_MONTH = e.target.value || todayStr().slice(0,7);
    TL_TS_MONTH_DAY = '';
    TL_TS_PAGE = 0;
    buildTLTsMonthPicker();
    buildTLTsMonthDayScrollBar();
    renderTLTsContent();
  });

  $('tlTsMonthPrev').addEventListener('click', () => stepTLTsMonth(-1));
  $('tlTsMonthNext').addEventListener('click', () => stepTLTsMonth(1));

  input.addEventListener('wheel', e => {
    e.preventDefault();
    stepTLTsMonth(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
}

function buildTLTsMonthDayScrollBar() {
  const bar = $('tlTsMonthDayScroll'); if (!bar) return;

  const [y, m] = TL_TS_SELECTED_MONTH.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayStr();
  const isCurrentMonth = TL_TS_SELECTED_MONTH === today.slice(0, 7);
  const lastDay = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth;

  const allChip = `<button data-day="" style="flex-shrink:0;padding:6px 14px;border-radius:20px;
    border:1px solid ${!TL_TS_MONTH_DAY?'transparent':'var(--border)'};
    background:${!TL_TS_MONTH_DAY?'linear-gradient(135deg,#f59e0b,#fbbf24)':'var(--surface2)'};
    color:${!TL_TS_MONTH_DAY?'#fff':'var(--txt1)'};
    font-size:11px;font-weight:${!TL_TS_MONTH_DAY?'700':'500'};cursor:pointer;white-space:nowrap;transition:all .15s;">All Month</button>`;

  const dayChips = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${TL_TS_SELECTED_MONTH}-${String(d).padStart(2,'0')}`;
    const isActive  = TL_TS_MONTH_DAY === dateStr;
    const weekday   = new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
    const isWeekend = new Date(dateStr+'T00:00:00').getDay() % 6 === 0;
    const isToday   = dateStr === today;
    const label     = isToday ? 'Today' : `${weekday} ${d}`;
    dayChips.push(`<button data-day="${dateStr}" style="flex-shrink:0;padding:6px 14px;border-radius:20px;
      border:1px solid ${isActive?'transparent':isToday?'#4f8ef7':'var(--border)'};
      background:${isActive?'linear-gradient(135deg,#f59e0b,#fbbf24)':'var(--surface2)'};
      color:${isActive?'#fff':isWeekend?'#a78bfa':'var(--txt1)'};
      font-size:11px;font-weight:${isActive?'700':'500'};cursor:pointer;white-space:nowrap;transition:all .15s;">${label}</button>`);
  }

  bar.innerHTML = allChip + dayChips.join('');

  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      TL_TS_MONTH_DAY = btn.dataset.day;
      TL_TS_PAGE = 0;
      buildTLTsMonthDayScrollBar();
      renderTLTsContent();
    });
  });

  if (!bar.dataset.wheelWired) {
    bar.dataset.wheelWired = '1';
    bar.addEventListener('wheel', e => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    }, { passive: false });
  }
}

function renderTLTsContent() {
  const content = $('tlTsContent');
  if (!content) return;

  const rows = getTLTimesheetFiltered();

  const byDate = {};
  rows.forEach(e => {
    if (!e.date) return;
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });
  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

  if (!dates.length) {
    content.innerHTML = `<div class="chart-empty">No timesheet entries for this range.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(dates.length / TL_TS_PAGE_SIZE));
  if (TL_TS_PAGE >= totalPages) TL_TS_PAGE = totalPages - 1;
  const pageDates = dates.slice(TL_TS_PAGE * TL_TS_PAGE_SIZE, (TL_TS_PAGE + 1) * TL_TS_PAGE_SIZE);

  content.innerHTML = `
    <div class="card" style="padding:1.25rem;">
      ${pageDates.map(d => buildTLTsDateSection(d, byDate[d])).join('')}
    </div>
    <div id="tlTsPager" style="margin-top:1rem;"></div>
  `;

  renderTLTsPager(totalPages);

  if (!content.dataset.wired) {
    content.dataset.wired = '1';
    content.addEventListener('click', e => {
      const entryBtn = e.target.closest('.tl-ts-force-entry');
      if (entryBtn) {
        openForceEntry(entryBtn.dataset.empId, entryBtn.dataset.empName, entryBtn.dataset.date, () => renderTLPortal());
        return;
      }
      const leaveBtn = e.target.closest('.tl-ts-force-leave');
      if (leaveBtn) {
        applyTLTsForceLeave(leaveBtn, leaveBtn.dataset.empId, leaveBtn.dataset.empName, leaveBtn.dataset.date);
      }
    });
  }
}

// Same lightweight single-action Force Leave as manager.js's version
// — reuses the exact same forceLeave backend action applyTLLeave
// (elsewhere in this file) already uses. Updates TL_DATA locally so
// the Timesheet view reflects it immediately.
async function applyTLTsForceLeave(btn, empId, empName, dateStr) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '…';
  try {
    await sheetGET({ action: 'forceLeave', data: encodeURIComponent(JSON.stringify({ uid: empId, date: dateStr })) });
    TL_DATA.push({ empId, empName, date: dateStr, status: 'Leave', hours: '0h', slot: '', project: '', notes: 'Force leave applied by team leader' });
    toast?.('s', 'Leave applied', `${empName} marked on leave for ${dateStr}`);
    renderTLTsContent();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
    toast?.('e', 'Failed', err.message);
  }
}


// Consistent color per employee/project name — same hashing approach
// as manager.js's mgrColorForKey, using this file's own TL_PALETTE.
function tlColorForKey(key) {
  const str = String(key || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return TL_PALETTE[hash % TL_PALETTE.length];
}

function buildTLTsDateSection(dateStr, entries) {
  const dateLabel = new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',
    { weekday:'long', day:'numeric', month:'short', year:'numeric' });
  const totalHours = tlCalcHours(entries);
  const empCount = new Set(entries.map(e => e.empId)).size;

  const byEmp = {};
  entries.forEach(e => {
    if (!byEmp[e.empId]) byEmp[e.empId] = { empName: e.empName || e.empId, rows: [] };
    byEmp[e.empId].rows.push(e);
  });

  // Same "show everyone" behavior as manager.js's version — when no
  // specific-employee filter is active, every employee on the roster
  // appears for this date, including those who logged nothing.
  let displayEmpIds;
  if (TL_TS_EMP_FILTER) {
    displayEmpIds = Object.keys(byEmp);
  } else {
    displayEmpIds = TL_EMPLOYEES.filter(emp => emp.active).map(emp => emp.id);
    Object.keys(byEmp).forEach(id => { if (!displayEmpIds.includes(id)) displayEmpIds.push(id); });
  }

  const empNameFor = empId => {
    if (byEmp[empId]) return byEmp[empId].empName;
    const emp = TL_EMPLOYEES.find(e => e.id === empId);
    return emp ? emp.name : empId;
  };

  const sortedEmpIds = displayEmpIds.slice().sort((a,b) => empNameFor(a).localeCompare(empNameFor(b)));

  const rowsHtml = sortedEmpIds.map(empId => {
    const empName  = empNameFor(empId);
    const empColor = tlColorForKey(empName);
    const initials = empName.trim().slice(0, 2).toUpperCase();
    const entryData = byEmp[empId];

    if (!entryData) {
      return `
        <div style="padding:10px 0;border-bottom:1px solid var(--border);opacity:.75;min-width:0;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;">
            <div style="width:26px;height:26px;border-radius:50%;background:${empColor};flex-shrink:0;
              display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;">${esc(initials)}</div>
            <span style="font-size:13px;font-weight:700;color:var(--txt1);flex:1 1 auto;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(empName)}</span>
            <span style="font-size:11px;font-style:italic;color:var(--txt2);flex-shrink:0;">No entries logged</span>
            <button class="pbtn tl-ts-force-entry" data-emp-id="${esc(empId)}" data-emp-name="${esc(empName)}" data-date="${esc(dateStr)}" style="flex-shrink:0;">Force Entry</button>
            <button class="pbtn tl-ts-force-leave" data-emp-id="${esc(empId)}" data-emp-name="${esc(empName)}" data-date="${esc(dateStr)}" style="flex-shrink:0;">Force Leave</button>
          </div>
        </div>`;
    }

    const { rows } = entryData;
    const empHours = tlCalcHours(rows);

    const slotHourTotals = {};
    rows.forEach(e => {
      if (e.status === 'Leave' || e.status === 'Holiday') return;
      if (!(e.timeIn && e.timeOut)) return;
      const key = e.slot;
      if (!key) return;
      slotHourTotals[key] = (slotHourTotals[key] || 0) + tlParseH(e.hours);
    });
    const slotSummaryHtml = Object.keys(slotHourTotals).length > 1
      ? ['morning', 'afternoon', 'extended']
          .filter(key => slotHourTotals[key] > 0)
          .map(key => {
            const meta = { morning: { icon: '🌅', label: 'Morning' }, afternoon: { icon: '☀️', label: 'Afternoon' }, extended: { icon: '🌙', label: 'Extended' } }[key];
            return `<span style="white-space:nowrap;">${meta.icon} ${meta.label}: <strong style="color:var(--txt1);">${fh(slotHourTotals[key])}</strong></span>`;
          }).join('<span style="color:var(--border-md);">·</span>')
      : '';

    const entryRows = rows.map(e => {
      const isLeave   = e.status === 'Leave';
      const isHoliday = e.status === 'Holiday';
      const projectLabel = isLeave ? '🏖️ Leave' : isHoliday ? '🎉 Holiday' : (e.project || '—');
      const projectColor = isLeave ? '#fbbf24' : isHoliday ? '#9ca3af' : tlColorForKey(e.project || '—');
      const hasRealTimes = !!(e.timeIn && e.timeOut);
      const slotMeta = hasRealTimes ? { morning: { icon: '🌅', label: 'Morning' }, afternoon: { icon: '☀️', label: 'Afternoon' }, extended: { icon: '🌙', label: 'Extended' } }[e.slot] : null;
      const slotBadge = slotMeta
        ? `<span style="flex:0 0 auto;font-size:9.5px;font-weight:700;color:var(--txt2);background:var(--surface2);
            border:1px solid var(--border);border-radius:10px;padding:2px 8px;white-space:nowrap;">${slotMeta.icon} ${slotMeta.label}</span>`
        : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:4px 0;font-size:12px;flex-wrap:wrap;">
          ${slotBadge}
          <span style="flex:0 1 170px;min-width:80px;color:${projectColor};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(projectLabel)}</span>
          <span style="flex:0 0 70px;color:var(--txt2);text-align:right;">${(isLeave||isHoliday) ? '—' : fh(tlParseH(e.hours))}</span>
          <span style="flex:1;min-width:0;color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(e.notes||'')}">${e.notes ? esc(e.notes) : ''}</span>
        </div>`;
    }).join('');

    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${slotSummaryHtml ? '2px' : '4px'};">
          <div style="width:26px;height:26px;border-radius:50%;background:${empColor};flex-shrink:0;
            display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;">${esc(initials)}</div>
          <span style="font-size:13px;font-weight:700;color:var(--txt1);flex:1 1 auto;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(empName)}</span>
          <span style="font-size:12px;font-weight:700;color:var(--a1);">${fh(empHours)}</span>
        </div>
        ${slotSummaryHtml ? `<div style="padding-left:36px;margin-bottom:6px;font-size:11px;color:var(--txt2);display:flex;gap:8px;flex-wrap:wrap;">${slotSummaryHtml}</div>` : ''}
        <div style="padding-left:36px;">${entryRows}</div>
      </div>`;
  }).join('');

  return `
    <div style="margin-bottom:1.5rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:2px solid var(--border-md);">
        <span style="display:inline-flex;align-items:center;font-size:12px;font-weight:700;color:#38bdf8;
          background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.3);
          border-radius:8px;padding:4px 12px;">${esc(dateLabel)}</span>
        <span style="font-size:12px;color:var(--txt2);">${empCount} employee${empCount!==1?'s':''} · ${fh(totalHours)} total</span>
      </div>
      ${rowsHtml}
    </div>`;
}

function renderTLTsPager(totalPages) {
  const pagerEl = $('tlTsPager');
  if (!pagerEl) return;
  if (totalPages <= 1) { pagerEl.innerHTML = ''; return; }

  const pageNums = [];
  for (let p = 0; p < totalPages; p++) pageNums.push(p);

  pagerEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;">
      <button class="pbtn" id="tlTsPagePrev" ${TL_TS_PAGE===0?'disabled':''}>‹ Prev</button>
      ${pageNums.map(p => `<button class="pbtn${p===TL_TS_PAGE?' cur':''}" data-page="${p}">${p+1}</button>`).join('')}
      <button class="pbtn" id="tlTsPageNext" ${TL_TS_PAGE===totalPages-1?'disabled':''}>Next ›</button>
    </div>`;

  $('tlTsPagePrev')?.addEventListener('click', () => { if (TL_TS_PAGE>0) { TL_TS_PAGE--; renderTLTsContent(); } });
  $('tlTsPageNext')?.addEventListener('click', () => { if (TL_TS_PAGE<totalPages-1) { TL_TS_PAGE++; renderTLTsContent(); } });
  pagerEl.querySelectorAll('.pbtn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { TL_TS_PAGE = parseInt(btn.dataset.page, 10); renderTLTsContent(); });
  });
}

// ── DAY SCROLL ────────────────────────────────────
function buildTLDayScroll() {
  const bar = $('tlDayScroll'); if (!bar) return;
  const days = getTL15Days();
  bar.innerHTML = days.map((d,i) => {
    const isActive  = i===TL_DAY_OFFSET;
    const isWeekend = new Date(d+'T00:00:00').getDay()%6===0;
    return `<button data-offset="${i}" style="flex-shrink:0;padding:5px 14px;border-radius:20px;
      border:1px solid ${isActive?'var(--a1)':'var(--border)'};
      background:${isActive?'var(--a1)':'var(--surface2)'};
      color:${isActive?'#fff':isWeekend?'#a78bfa':'var(--txt1)'};
      font-size:11px;cursor:pointer;white-space:nowrap;">${tlFmtDate(d)}</button>`;
  }).join('');
  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click',()=>{ TL_DAY_OFFSET=parseInt(btn.dataset.offset); buildTLDayScroll(); renderTLEmpCards(); });
  });
}

// ── MONTH PICKER ──────────────────────────────────
function buildTLMonthPicker() {
  const picker = $('tlMonthPicker'); if (!picker) return;
  const months=[];
  const now=new Date();
  for(let i=0;i<12;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    months.push({val:toLocalDateStr(d).slice(0,7),label:d.toLocaleDateString('en-IN',{month:'short',year:'numeric'})});
  }
  picker.innerHTML=months.map(m=>`<button data-month="${m.val}" style="flex-shrink:0;padding:5px 14px;border-radius:20px;
    border:1px solid ${m.val===TL_MONTH?'var(--a1)':'var(--border)'};
    background:${m.val===TL_MONTH?'var(--a1)':'var(--surface2)'};
    color:${m.val===TL_MONTH?'#fff':'var(--txt1)'};
    font-size:11px;cursor:pointer;white-space:nowrap;">${m.label}</button>`).join('');
  picker.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click',()=>{ TL_MONTH=btn.dataset.month; buildTLMonthPicker(); renderTLEmpCards(); });
  });
}

// ── FILTER + RANGE HELPERS ────────────────────────
function getTLFiltered() {
  const tod=todayStr(), ws=weekStart();
  if (TL_RANGE==='day15') { const s=getTL15Days()[TL_DAY_OFFSET]; return TL_DATA.filter(e=>e.date===s); }
  if (TL_RANGE==='week')  return TL_DATA.filter(e=>e.date>=ws&&e.date<=tod);
  if (TL_RANGE==='month') return TL_DATA.filter(e=>e.date.startsWith(TL_MONTH));
  return TL_DATA;
}

function getTLRangeLabel() {
  if (TL_RANGE==='day15') return tlFmtDate(getTL15Days()[TL_DAY_OFFSET]);
  if (TL_RANGE==='week')  return 'This Week';
  if (TL_RANGE==='month') {
    const [y,m]=TL_MONTH.split('-');
    return new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-IN',{month:'short',year:'numeric'});
  }
  return 'All Time';
}

function getTLWorkingDays() {
  const tod=todayStr(); let start,end;
  if (TL_RANGE==='day15') return [getTL15Days()[TL_DAY_OFFSET]];
  if (TL_RANGE==='week')  { start=weekStart(); end=tod; }
  else if (TL_RANGE==='month') {
    const [y,m]=TL_MONTH.split('-').map(Number);
    start=TL_MONTH+'-01';
    end=TL_MONTH+'-'+String(new Date(y,m,0).getDate()).padStart(2,'0');
    if (end>tod) end=tod;
  } else { const d=new Date(); d.setDate(d.getDate()-90); start=toLocalDateStr(d); end=tod; }
  const dates=[]; const cur=new Date(start+'T00:00:00'); const endDate=new Date(end+'T00:00:00');
  while(cur<=endDate){ const day=cur.getDay(); if(day!==0&&day!==6) dates.push(toLocalDateStr(cur)); cur.setDate(cur.getDate()+1); }
  return dates;
}

function getTL15Days() {
  const dates=[];
  for(let i=0;i<15;i++){ const d=new Date(); d.setDate(d.getDate()-i); dates.push(toLocalDateStr(d)); }
  return dates;
}

// ── SVG DONUT (per-employee project-hours breakdown) ─────────────
function buildTLDonut(projects, total) {
  const size=160, cx=80, cy=80, r=66, innerR=44;
  if (!total||!projects.length) return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface2,#2a2a3e)" stroke-width="18"/></svg>`;
  let a=-90;
  const slices=projects.map(([proj,hrs],i)=>{
    const end=a+(hrs/total)*360;
    const path=tlDonutPath(cx,cy,r,innerR,a,end);
    a=end;
    return `<path d="${path}" fill="${TL_PALETTE[i%TL_PALETTE.length]}" stroke="var(--surface1)" stroke-width="2"><title>${esc(proj)}: ${fh(hrs)}</title></path>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${slices}</svg>`;
}

function tlDonutPath(cx,cy,ro,ri,s,e) {
  if((e-s)>=359.999) e=s+359.999;
  const sO=tlPt(cx,cy,ro,s),eO=tlPt(cx,cy,ro,e),sI=tlPt(cx,cy,ri,e),eI=tlPt(cx,cy,ri,s);
  const lg=(e-s)>180?1:0;
  return [`M ${sO.x} ${sO.y}`,`A ${ro} ${ro} 0 ${lg} 1 ${eO.x} ${eO.y}`,`L ${sI.x} ${sI.y}`,`A ${ri} ${ri} 0 ${lg} 0 ${eI.x} ${eI.y}`,'Z'].join(' ');
}
function tlPt(cx,cy,r,deg){ const rad=deg*Math.PI/180; return {x:+(cx+r*Math.cos(rad)).toFixed(3),y:+(cy+r*Math.sin(rad)).toFixed(3)}; }

// ── HELPERS ───────────────────────────────────────
// ── HELPERS ───────────────────────────────────────
// Timezone-safe 'YYYY-MM-DD' from a Date's LOCAL components — same
// fix as manager.js. Every .toISOString().slice(0,N) call in this
// file was silently wrong in any UTC+ timezone (like IST): a date
// built at local midnight (e.g. the 1st of a month) rolls back to
// the previous day/month once converted to UTC by toISOString() —
// exactly the "Jul 2026 button loads June data" bug.
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Same fix as manager.js — an entry only counts as "worked" if it's
// neither Leave nor Holiday. Filters checking `status !== 'Leave'`
// alone let Holiday entries through as if they were worked days
// (0 hours, but still inflating "Days" totals).
function isWorkedEntry(e) { return e.status !== 'Leave' && e.status !== 'Holiday'; }

function tlCalcHours(arr) { return arr.filter(isWorkedEntry).reduce((s,e)=>s+tlParseH(e.hours),0); }

function tlParseH(val) {
  if(!val) return 0;
  const s=String(val).trim();
  const h=(s.match(/(\d+)h/)||[])[1], m=(s.match(/(\d+)m/)||[])[1];
  if(!h&&!m) return parseFloat(s)||0;
  return (parseInt(h||0)*60+parseInt(m||0))/60;
}

function tlFmtDate(dateStr) {
  return new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
}

function tlToMins(t) { if(!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; }

function tlFmt12(t) {
  if(!t) return '--:--';
  const [h,m]=t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}

function tlToast(msg, isError=false) {
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${isError?'#ef4444':'#1e293b'};color:#fff;padding:10px 20px;
    border-radius:8px;font-size:13px;z-index:99999;
    box-shadow:0 4px 20px rgba(0,0,0,.4);white-space:nowrap;`;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}