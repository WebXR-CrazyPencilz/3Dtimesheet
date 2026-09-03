// ═══════════════════════════════════════════════════
// MANAGER.JS — Manager Portal shell
// Tabs: Dashboard | Project | Employees | Salary | Client | ...
//
// This file is ONLY a loading/navigation platform. It owns the
// Employee module (timesheet data, employee cards, Employee Detail
// hook) and the top-level tab shell — it never calculates or renders
// Client, Project, or Dashboard data itself. Each other tab is a pure
// hand-off to the module that owns it:
//
//   Dashboard → dashboard.js (renderManagerDashboard) ← default tab
//   Project   → client-project.js (renderProjectTab) — also covers Clients (folded in, sort A→Z/Z→A/New→Old/Old→New)
//   Employees → this file (renderEmployeesTab)
//   Salary    → salary.js (renderSalaryTab)
//
// Master data (employees/clients/projects) is fetched once here and
// the clients/projects portion is handed off to client-project.js via
// ClientProjectAPI.ingestMasterData(), so there's a single shared
// fetch instead of client-project.js re-requesting the same data.
//
// Desktop-only layout: no mobile breakpoints/media queries are used
// anywhere in this file — grids are fixed-column, sized for a PC
// screen.
// ═══════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────
let MGR_DATA           = [];
let MGR_EMPLOYEES      = [];

let MGR_TAB            = 'dashboard'; // dashboard|project|employees|timesheet|... — Dashboard is the default landing tab
let MGR_RANGE          = 'week';
let MGR_DAY_OFFSET     = 0;
let MGR_SELECTED_MONTH = '';

// Timesheet tab's own range/filter/page state — deliberately separate
// from Employees tab's MGR_RANGE/MGR_DAY_OFFSET/MGR_SELECTED_MONTH
// above, so switching the date range on one tab doesn't silently
// change what the other tab shows when you navigate back to it.
let MGR_TS_RANGE          = 'day15';
let MGR_TS_DAY_OFFSET     = 0;
let MGR_TS_SELECTED_MONTH = '';
let MGR_TS_MONTH_DAY      = ''; // 'YYYY-MM-DD' — a specific day within the selected month; '' = whole month
let MGR_TS_EMP_FILTER     = '';
let MGR_TS_SEARCH         = '';
let MGR_TS_PAGE           = 0;
const MGR_TS_PAGE_SIZE    = 10; // dates per page

const MGR_PALETTE = [
  '#4f8ef7','#7c5cfc','#34d399','#fbbf24',
  '#5eead4','#22d3ee','#fb923c','#a78bfa',
  '#f472b6','#84cc16','#38bdf8','#4ade80',
];

// ── INIT ──────────────────────────────────────────
async function initManager() {
  MGR_SELECTED_MONTH = todayStr().slice(0,7);
  MGR_TS_SELECTED_MONTH = todayStr().slice(0,7);
  const container = $('mgrApp');
  if (!container) return;

  const av = $('mgrAv');
  if (av) av.textContent = 'M';

  container.innerHTML = `<div class="mgr-loading">
    <div class="slot-spinner"></div>
    <span>Loading all data…</span>
  </div>`;

  try {
    // Load master data once. Only the employees portion is this
    // file's concern — clients/projects are handed off wholesale to
    // client-project.js, which owns everything about them.
    // Reuses the master data auth.js ALREADY fetched once during
    // login (LIVE_EMPLOYEES/CLIENTS/PROJECTS) instead of calling
    // apiGetMasterData() again from scratch — same reasoning as
    // teamleader.js's/humanresource.js's identical fix: one fewer
    // redundant round-trip, one fewer chance to fail on a flaky
    // connection. Falls back to a real fetch only if those globals
    // are somehow still empty.
    const master = (typeof LIVE_EMPLOYEES !== 'undefined' && LIVE_EMPLOYEES.length)
      ? { employees: LIVE_EMPLOYEES, clients: (typeof CLIENTS !== 'undefined' ? CLIENTS : []), projects: (typeof PROJECTS !== 'undefined' ? PROJECTS : []) }
      : await apiGetMasterData();
    MGR_EMPLOYEES = master.employees || [];

    if (typeof ClientProjectAPI !== 'undefined' && typeof ClientProjectAPI.ingestMasterData === 'function') {
      ClientProjectAPI.ingestMasterData(master);
    }

    // Each employee's history is fetched independently and tagged
    // with whether it actually succeeded — NOT silently swallowed to
    // an empty array on failure. See teamleader.js's identical fix
    // for the full reasoning: a single flaky request out of up to 19
    // firing in parallel used to make that employee's real timesheet
    // data vanish everywhere with no warning at all — indistinguishable
    // from them genuinely having no entries.
    const results = await Promise.all(
      MGR_EMPLOYEES.map(emp =>
        apiGetAllHistory(emp.id)
          .then(entries => ({ ok: true, empName: emp.name, entries: entries.map(e => ({ ...e, empId: emp.id, empName: emp.name, empTeam: emp.team })) }))
          .catch(err => ({ ok: false, empName: emp.name, error: err.message, entries: [] }))
      )
    );
    const failed = results.filter(r => !r.ok);
    MGR_DATA = results.flatMap(r => r.entries);

    if (failed.length) {
      toast?.('e', `Couldn't load ${failed.length} employee${failed.length > 1 ? "s'" : "'s"} timesheet data`,
        `${failed.map(f => f.empName).join(', ')} — their hours may show as missing below. Reload to retry.`, 12000);
    }

    if (typeof ClientProjectAPI !== 'undefined' && typeof ClientProjectAPI.ingestTimesheetData === 'function') {
      ClientProjectAPI.ingestTimesheetData(MGR_DATA);
    }

    renderManagerPortal();
  } catch(err) {
    container.innerHTML = `<div class="slot-error">Failed to load: ${err.message}</div>`;
  }
}

// ── RENDER PORTAL SHELL ───────────────────────────
function renderManagerPortal() {
  const container = $('mgrApp');
  if (!container) return;

  container.innerHTML = `
    <!-- Top nav tabs -->
    <div style="display:flex;gap:4px;margin-bottom:1.5rem;border-bottom:1px solid var(--border);padding-bottom:0;">
      ${[
        { id:'dashboard', icon:'🏠', label:'Dashboard' },
        { id:'project',   icon:'📁', label:'Projects & Clients' },
        { id:'employees', icon:'👥', label:'Employees' },
        { id:'timesheet', icon:'🕐', label:'Timesheet' },
        { id:'attendance',icon:'🕒', label:'Attendance' },
        { id:'timeline',   icon:'📊', label:'Project Timeline' },
        { id:'salary',    icon:'💼', label:'Salary'    },
      ].map(t => `
        <button class="mgr-tab${MGR_TAB===t.id?' active':''}" data-tab="${t.id}" style="
          padding:8px 16px;border:none;background:none;cursor:pointer;
          font-size:13px;font-weight:600;
          color:${MGR_TAB===t.id ? 'var(--a1)' : 'var(--txt2)'};
          border-bottom:2px solid ${MGR_TAB===t.id ? 'var(--a1)' : 'transparent'};
          margin-bottom:-1px;transition:all .2s;
        ">${t.icon} ${t.label}</button>
      `).join('')}
    </div>
    <div id="mgrTabContent"></div>
  `;

  container.querySelectorAll('.mgr-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      MGR_TAB = btn.dataset.tab;
      container.querySelectorAll('.mgr-tab').forEach(b => {
        const active = b === btn;
        b.style.color       = active ? 'var(--a1)' : 'var(--txt2)';
        b.style.borderBottom= active ? '2px solid var(--a1)' : '2px solid transparent';
      });
      renderMgrTab();
    });
  });

  renderMgrTab();
}

// ── ROUTE TO TAB ──────────────────────────────────
// Each non-Employees tab is a pure hand-off to the module that owns
// it. If that module's script hasn't loaded, show a plain message
// instead of throwing — manager.js never substitutes its own logic.
function renderMgrTab() {
  const content = $('mgrTabContent');
  if (!content) return;

  if (MGR_TAB === 'dashboard') {
    if (typeof renderManagerDashboard === 'function') renderManagerDashboard(content);
    else content.innerHTML = `<div class="chart-empty">Dashboard module (dashboard.js) is not loaded.</div>`;
    return;
  }

  if (MGR_TAB === 'project') {
    if (typeof renderProjectTab === 'function') renderProjectTab(content);
    else content.innerHTML = `<div class="chart-empty">Project module (client-project.js) is not loaded.</div>`;
    return;
  }

  if (MGR_TAB === 'employees') { renderEmployeesTab(content); return; }

  if (MGR_TAB === 'timesheet') { renderMgrTimesheetTab(content); return; }

  if (MGR_TAB === 'attendance') {
    if (typeof renderAttendanceTab === 'function') renderAttendanceTab(content);
    else content.innerHTML = `<div class="chart-empty">Attendance module (client-project.js) is not loaded.</div>`;
    return;
  }


  if (MGR_TAB === 'timeline') {
    if (typeof initGantt === 'function') initGantt(content);
    else content.innerHTML = `<div class="chart-empty">Project Timeline module (gantt.js) is not loaded.</div>`;
    return;
  }

  if (MGR_TAB === 'salary') {
    if (typeof renderSalaryTab === 'function') renderSalaryTab(content);
    else content.innerHTML = `<div class="chart-empty">Salary module (salary.js) is not loaded.</div>`;
    return;
  }

}

// ══════════════════════════════════════════════════
// EMPLOYEES MODULE — timesheet data, employee cards,
// day/week/month/all-time filtering, Employee Detail hook.
// ══════════════════════════════════════════════════
function renderEmployeesTab(content) {
  const filtered = getMgrFiltered();
  const worked   = filtered.filter(isWorkedEntry);
  const totHours = calcHours(worked);

  content.innerHTML = `
    <!-- Summary strip -->
    <div class="strip" style="margin-bottom:1.25rem">
      <div class="sitem"><span class="slbl">Total Hours</span><span class="sval hi" id="mTot">${fh(totHours)}</span></div>
      <div class="sitem"><span class="slbl">Employees</span><span class="sval" id="mEmpCnt">${new Set(filtered.map(e=>e.empId)).size}</span></div>
      <div class="sitem"><span class="slbl">Active Projects</span><span class="sval" id="mProjCnt">${new Set(worked.filter(e=>e.project).map(e=>e.project)).size}</span></div>
      <div class="sitem"><span class="slbl">Clients</span><span class="sval" id="mCliCnt">${new Set(worked.filter(e=>e.client&&e.client!=='Leave').map(e=>e.client)).size}</span></div>
    </div>

    <!-- Range controls -->
    <div class="mgr-controls">
      <div class="chart-range" id="mgrRange">
        <button class="rbtn${MGR_RANGE==='day15'?' active':''}"  data-range="day15">15 Days</button>
        <button class="rbtn${MGR_RANGE==='week'?' active':''}"   data-range="week">This Week</button>
        <button class="rbtn${MGR_RANGE==='month'?' active':''}"  data-range="month">This Month</button>
        <button class="rbtn${MGR_RANGE==='all'?' active':''}"    data-range="all">All Time</button>
      </div>
    </div>

    <!-- 15-day scroll -->
    <div id="mgrDayScroll" style="display:${MGR_RANGE==='day15'?'flex':'none'};
      gap:6px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;"></div>

    <!-- Month picker -->
    <div id="mgrMonthPicker" style="display:${MGR_RANGE==='month'?'flex':'none'};
      gap:8px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;"></div>

    <div id="mgrEmpContent"></div>
  `;

  // Range buttons
  $('mgrRange').addEventListener('click', e => {
    const btn = e.target.closest('.rbtn');
    if (!btn) return;
    MGR_RANGE = btn.dataset.range;
    MGR_DAY_OFFSET = 0;
    $('mgrRange').querySelectorAll('.rbtn').forEach(b => b.classList.toggle('active', b===btn));
    $('mgrDayScroll').style.display   = MGR_RANGE === 'day15'  ? 'flex' : 'none';
    $('mgrMonthPicker').style.display = MGR_RANGE === 'month'  ? 'flex' : 'none';
    if (MGR_RANGE === 'day15')  buildDayScrollBar();
    if (MGR_RANGE === 'month')  buildMonthPicker();
    renderEmpContent();
  });

  if (MGR_RANGE === 'day15') buildDayScrollBar();
  if (MGR_RANGE === 'month') buildMonthPicker();
  renderEmpContent();
}

function renderEmpContent() {
  const content = $('mgrEmpContent');
  if (!content) return;
  const filtered = getMgrFiltered();
  const worked   = filtered.filter(isWorkedEntry);

  const mTot = $('mTot'); if (mTot) mTot.textContent = fh(calcHours(worked));
  const mEmpCnt  = $('mEmpCnt');  if (mEmpCnt)  mEmpCnt.textContent  = new Set(filtered.map(e=>e.empId)).size;
  const mProjCnt = $('mProjCnt'); if (mProjCnt) mProjCnt.textContent = new Set(worked.filter(e=>e.project).map(e=>e.project)).size;
  const mCliCnt  = $('mCliCnt');  if (mCliCnt)  mCliCnt.textContent  = new Set(worked.filter(e=>e.client&&e.client!=='Leave').map(e=>e.client)).size;

  renderEmpCards(content, worked, filtered);
}

// ── EMPLOYEE CARDS ────────────────────────────────
function renderEmpCards(content, worked, all) {
  const empMap = {};
  MGR_EMPLOYEES.forEach((emp, idx) => {
    empMap[emp.id] = {
      id: emp.id, name: emp.name, team: emp.team, entryIndex: idx,
      hours: 0, days: new Set(), leaves: 0,
      projectMap: {}, missedDays: [],
      monthHours: 0, monthDays: 0, monthLeaves: 0, monthNotLogged: 0,
      monthProjectMap: {}, todayHours: 0, todayStatus: 'Working', lastActivityDate: '',
    };
  });

  worked.forEach(e => {
    if (!empMap[e.empId]) return;
    const h = parseH(e.hours);
    empMap[e.empId].hours += h;
    empMap[e.empId].days.add(e.date);
    if (e.project) empMap[e.empId].projectMap[e.project] = (empMap[e.empId].projectMap[e.project]||0) + h;
  });

  all.filter(e => e.status==='Leave').forEach(e => {
    if (empMap[e.empId]) { empMap[e.empId].leaves++; empMap[e.empId].days.add(e.date); }
  });

  // Missed days
  const rangeDates = getWorkingDaysInRange();
  Object.values(empMap).forEach(emp => {
    emp.missedDays = rangeDates.filter(d => !emp.days.has(d));
  });

  // Monthly summary + current-month project breakdown + today's status —
  // always computed from full MGR_DATA, independent of the active range filter.
  const curMonth  = todayStr().slice(0,7);
  const tod       = todayStr();
  const todayDow  = new Date().getDay(); // 0 = Sun, 6 = Sat

  const monthWorkingDaysSoFar = (() => {
    const [y, m] = curMonth.split('-').map(Number);
    const days = [];
    for (let d = 1; d <= new Date().getDate(); d++) {
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay();
      if (dow === 0 || dow === 6) continue;
      days.push(toLocalDateStr(dt));
    }
    return days;
  })();

  Object.values(empMap).forEach(emp => {
    const me = MGR_DATA.filter(e => e.empId === emp.id && e.date && e.date.startsWith(curMonth));
    const mw = me.filter(isWorkedEntry);
    emp.monthHours  = mw.reduce((s,e) => s + parseH(e.hours), 0);
    emp.monthDays   = new Set(mw.map(e => e.date)).size;
    // Unique DATES with a Leave entry, not raw entry count — the
    // partial-permission Leave feature lets one day have two Leave
    // entries (e.g. a morning window + an afternoon window), which
    // was inflating this to 2x the real number of leave days. Matches
    // Code.gs's getEmployeeDetail, which already counts unique dates.
    emp.monthLeaves = new Set(me.filter(e => e.status === 'Leave').map(e => e.date)).size;

    mw.forEach(e => {
      if (e.project) emp.monthProjectMap[e.project] = (emp.monthProjectMap[e.project]||0) + parseH(e.hours);
    });

    const loggedDatesThisMonth = new Set(me.map(e => e.date));
    emp.monthNotLogged = monthWorkingDaysSoFar.filter(d => !loggedDatesThisMonth.has(d)).length;

    const todayEntries = MGR_DATA.filter(e => e.empId === emp.id && e.date === tod);
    const todayLeave    = todayEntries.some(e => e.status === 'Leave');
    const todayWorked   = todayEntries.filter(isWorkedEntry);
    emp.todayHours = todayWorked.reduce((s,e) => s + parseH(e.hours), 0);

    if (todayLeave)                              emp.todayStatus = 'Leave';
    else if (todayDow === 0 || todayDow === 6)   emp.todayStatus = 'Weekend';
    else                                          emp.todayStatus = 'Working';

    // "Last entered" means last TIMESHEET ACTIVITY — whoever most
    // recently logged an actual entry — not when their employee
    // record was added to the sheet. entryIndex (row position) was
    // the wrong signal: it put employees at the top just because
    // they were added recently, even with zero recent activity.
    emp.lastActivityDate = MGR_DATA
      .filter(e => e.empId === emp.id)
      .reduce((max, e) => (e.date > max ? e.date : max), '');
  });

  // Most recently active employee first — whoever has the most
  // recent logged entry (of any kind) shows first; someone with no
  // recent activity sorts toward the end regardless of when they
  // were hired. Ties broken by total hours in the current range.
  const rows = Object.values(empMap).sort((a, b) => {
    if (a.lastActivityDate !== b.lastActivityDate) return b.lastActivityDate.localeCompare(a.lastActivityDate);
    return b.hours - a.hours;
  });
  if (!rows.length) { content.innerHTML = `<div class="chart-empty">No employees found.</div>`; return; }

  content.innerHTML = `
    <div style="margin-top:.5rem;">
      ${rows.map(emp => buildEmpCard(emp)).join('')}
    </div>`;

  content.querySelectorAll('.view-emp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openEmpDetail(btn.dataset.empId, btn.dataset.empName);
    });
  });
}

function buildEmpCard(emp) {
  const initials      = emp.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const monthProjects = Object.entries(emp.monthProjectMap).sort((a,b) => b[1]-a[1]);
  const curMonthLabel = new Date(todayStr().slice(0,7)+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'});

  const STATUS_STYLE = {
    Working: { bg:'rgba(52,211,153,0.12)',  fg:'#34d399', label:'Working'  },
    Leave:   { bg:'rgba(251,191,36,0.12)',  fg:'#fbbf24', label:'On Leave' },
    Weekend: { bg:'rgba(124,92,252,0.12)',  fg:'#a78bfa', label:'Weekend'  },
  };
  const st = STATUS_STYLE[emp.todayStatus] || STATUS_STYLE.Working;

  const sliderHtml = monthProjects.length === 0
    ? `<div style="font-size:11px;color:var(--txt2);padding:6px 2px;">No projects logged this month</div>`
    : `<div style="display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;-webkit-overflow-scrolling:touch;scrollbar-width:thin;">
        ${monthProjects.map(([proj,hrs],i) => `
          <div style="flex-shrink:0;display:flex;align-items:center;gap:6px;
            background:var(--surface2);border:1px solid var(--border);border-radius:20px;
            padding:6px 12px;white-space:nowrap;">
            <span style="width:7px;height:7px;border-radius:50%;background:${MGR_PALETTE[i%MGR_PALETTE.length]};flex-shrink:0;"></span>
            <span style="font-size:11px;color:var(--txt1);font-weight:600;max-width:130px;
              overflow:hidden;text-overflow:ellipsis;" title="${esc(proj)}">${esc(proj)}</span>
            <span style="font-size:11px;color:var(--txt2);">— ${fh(hrs)}</span>
          </div>`).join('')}
      </div>`;

  return `
    <div class="emp-card" style="background:var(--surface1);
      border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.3rem;margin-bottom:1.1rem;">

      <!-- Identity + status + quick stats + View Details, all in one row -->
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:20px;">
        <div style="display:flex;align-items:center;gap:10px;flex:0 0 auto;min-width:170px;">
          <div style="width:38px;height:38px;border-radius:50%;
            background:linear-gradient(135deg,var(--a1),#7c5cfc);
            display:flex;align-items:center;justify-content:center;
            font-weight:700;font-size:13px;color:#fff;flex-shrink:0;">${initials}</div>
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:14px;color:var(--txt1);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(emp.name)}</div>
            <div style="font-size:11px;color:var(--txt2);">${esc(emp.id)}</div>
          </div>
        </div>

        <span style="display:inline-flex;align-items:center;gap:5px;background:${st.bg};color:${st.fg};
          border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;flex-shrink:0;">
          <span style="width:6px;height:6px;border-radius:50%;background:${st.fg};"></span>${st.label}
        </span>

        <div style="display:flex;gap:22px;flex-wrap:wrap;flex:1;">
          <div>
            <div style="font-size:9.5px;color:var(--txt2);text-transform:uppercase;letter-spacing:.4px;">Today</div>
            <div style="font-size:14px;font-weight:800;color:var(--txt1);">${fh(emp.todayHours)}</div>
          </div>
          <div>
            <div style="font-size:9.5px;color:var(--txt2);text-transform:uppercase;letter-spacing:.4px;">This Month</div>
            <div style="font-size:14px;font-weight:800;color:var(--a1);">${fh(emp.monthHours)}</div>
          </div>
          <div>
            <div style="font-size:9.5px;color:var(--txt2);text-transform:uppercase;letter-spacing:.4px;">Leaves</div>
            <div style="font-size:14px;font-weight:800;color:#fbbf24;">${emp.monthLeaves}</div>
          </div>
          <div>
            <div style="font-size:9.5px;color:var(--txt2);text-transform:uppercase;letter-spacing:.4px;">Not Logged</div>
            <div style="font-size:14px;font-weight:800;color:${emp.monthNotLogged > 0 ? '#f87171' : 'var(--txt1)'};">${emp.monthNotLogged}</div>
          </div>
        </div>

        <button class="view-emp-btn" data-emp-id="${emp.id}" data-emp-name="${esc(emp.name)}"
          style="background:var(--a1);color:#fff;border:none;border-radius:6px;
            padding:8px 16px;font-size:11px;font-weight:600;cursor:pointer;
            white-space:nowrap;flex-shrink:0;">
          View Details →
        </button>
      </div>

      <!-- Projects -->
      <div style="margin-top:1rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:10px;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px;">Projects · ${esc(curMonthLabel)}</span>
          <span style="font-size:10px;color:var(--txt1);font-weight:700;background:var(--surface2);
            border-radius:10px;padding:2px 8px;">${monthProjects.length} total</span>
        </div>
        ${sliderHtml}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════
// TIMESHEET MODULE — every employee's entries, grouped date-wise.
// Reuses MGR_DATA (already loaded once in initManager, tagged with
// empId/empName/empTeam on every entry) — no new fetch needed. Own
// range/filter/page state (MGR_TS_*), independent of the Employees
// tab's own MGR_RANGE/MGR_DAY_OFFSET/MGR_SELECTED_MONTH.
// ══════════════════════════════════════════════════
function getMgrTimesheetFiltered() {
  let rows;
  if (MGR_TS_RANGE === 'month') {
    rows = MGR_TS_MONTH_DAY
      ? MGR_DATA.filter(e => e.date === MGR_TS_MONTH_DAY)
      : MGR_DATA.filter(e => e.date.startsWith(MGR_TS_SELECTED_MONTH));
  } else {
    // 'day15' — the only other/default mode now
    const d = getLast15Days()[MGR_TS_DAY_OFFSET];
    rows = MGR_DATA.filter(e => e.date === d);
  }

  if (MGR_TS_EMP_FILTER) rows = rows.filter(e => e.empId === MGR_TS_EMP_FILTER);

  if (MGR_TS_SEARCH) {
    const q = MGR_TS_SEARCH.toLowerCase();
    rows = rows.filter(e =>
      [e.empName, e.project, e.client, e.task, e.notes].some(v => v && String(v).toLowerCase().includes(q))
    );
  }

  return rows;
}

// One color per range mode, used for its active pill state and its
// section's accent border below — purely visual, makes the three
// tiers (day-by-day / month / all-time) easy to tell apart at a
// glance instead of every mode looking identical.
const MGR_TS_RANGE_COLORS = {
  day15: { bg: 'linear-gradient(135deg,#4f8ef7,#38bdf8)', fg: '#4f8ef7' },
  month: { bg: 'linear-gradient(135deg,#f59e0b,#fbbf24)', fg: '#f59e0b' },
};

function renderMgrTimesheetTab(content) {
  content.innerHTML = `
    <div class="mgr-controls">
      <div style="display:flex;gap:6px;flex-wrap:wrap;" id="mgrTsRange">
        ${[
          { id:'day15', label:'📅 15 Days' },
          { id:'month', label:'📆 This Month' },
        ].map(r => {
          const active = MGR_TS_RANGE === r.id;
          const c = MGR_TS_RANGE_COLORS[r.id];
          return `<button class="mgr-ts-rbtn" data-range="${r.id}" style="padding:7px 14px;border-radius:20px;
            border:1px solid ${active ? 'transparent' : 'var(--border-md)'};
            background:${active ? c.bg : 'var(--surface2)'};
            color:${active ? '#fff' : 'var(--txt2)'};
            font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;">${r.label}</button>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="mgrTsEmpFilter" class="filt">
          <option value="">All Employees</option>
          ${MGR_EMPLOYEES.filter(emp => emp.active).map(emp => `<option value="${esc(emp.id)}" ${MGR_TS_EMP_FILTER===emp.id?'selected':''}>${esc(emp.name)}</option>`).join('')}
        </select>
        <input type="search" id="mgrTsSearch" class="srch" placeholder="Search project, notes…" value="${esc(MGR_TS_SEARCH)}"/>
      </div>
    </div>

    <div id="mgrTsDayScroll" style="display:${MGR_TS_RANGE==='day15'?'flex':'none'};
      gap:6px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;min-width:0;"></div>

    <div id="mgrTsMonthPicker" style="display:${MGR_TS_RANGE==='month'?'flex':'none'};
      gap:8px;margin-bottom:1rem;align-items:center;min-width:0;"></div>

    <div id="mgrTsMonthDayScroll" style="display:${MGR_TS_RANGE==='month'?'flex':'none'};
      gap:6px;margin-bottom:1rem;overflow-x:auto;padding-bottom:4px;min-width:0;"></div>

    <div id="mgrTsContent"></div>
  `;

  $('mgrTsRange').addEventListener('click', e => {
    const btn = e.target.closest('.mgr-ts-rbtn');
    if (!btn) return;
    MGR_TS_RANGE = btn.dataset.range;
    MGR_TS_DAY_OFFSET = 0;
    MGR_TS_MONTH_DAY = '';
    MGR_TS_PAGE = 0;
    renderMgrTimesheetTab(content); // full re-render — rebuilds the pills' active colors and swaps which picker shows
  });

  $('mgrTsEmpFilter').addEventListener('change', e => {
    MGR_TS_EMP_FILTER = e.target.value;
    MGR_TS_PAGE = 0;
    renderMgrTsContent();
  });

  $('mgrTsSearch').addEventListener('input', e => {
    MGR_TS_SEARCH = e.target.value;
    MGR_TS_PAGE = 0;
    renderMgrTsContent();
  });

  if (MGR_TS_RANGE === 'day15') buildMgrTsDayScrollBar();
  if (MGR_TS_RANGE === 'month') { buildMgrTsMonthPicker(); buildMgrTsMonthDayScrollBar(); }
  renderMgrTsContent();
}

function buildMgrTsDayScrollBar() {
  const bar = $('mgrTsDayScroll'); if (!bar) return;
  const days = getLast15Days();
  bar.innerHTML = days.map((d,i) => {
    const isActive  = i===MGR_TS_DAY_OFFSET;
    const isWeekend = new Date(d+'T00:00:00').getDay()%6===0;
    // "Today"/"Yesterday" for the two most recent chips, weekday+date
    // for everything else — matches getLast15Days()'s own ordering
    // (index 0 = today, going backward).
    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmtDateShort(d);
    return `<button data-offset="${i}" style="flex-shrink:0;padding:6px 14px;border-radius:20px;
      border:1px solid ${isActive?'transparent':'var(--border)'};
      background:${isActive?'linear-gradient(135deg,#4f8ef7,#38bdf8)':'var(--surface2)'};
      color:${isActive?'#fff':isWeekend?'#a78bfa':'var(--txt1)'};
      font-size:11px;font-weight:${isActive?'700':'500'};cursor:pointer;white-space:nowrap;transition:all .15s;">${label}</button>`;
  }).join('');
  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      MGR_TS_DAY_OFFSET = parseInt(btn.dataset.offset);
      MGR_TS_PAGE = 0;
      buildMgrTsDayScrollBar();
      renderMgrTsContent();
    });
  });

  // A normal mouse wheel only scrolls vertically by default — this
  // strip is horizontal, so without this, scrolling it on desktop
  // would require holding Shift (which most people never discover).
  // Rebuilding innerHTML above already dropped any previous listener
  // on this element, so this one only ever gets attached once per
  // build, not stacking up on every re-render.
  if (!bar.dataset.wheelWired) {
    bar.dataset.wheelWired = '1';
    bar.addEventListener('wheel', e => {
      if (e.deltaY === 0) return; // already a horizontal gesture (trackpad) — let it through untouched
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    }, { passive: false });
  }
}

function stepMgrTsMonth(dir) {
  const [y, m] = MGR_TS_SELECTED_MONTH.split('-').map(Number);
  const next = new Date(y, (m - 1) + dir, 1);
  const nextVal = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  if (nextVal > todayStr().slice(0, 7)) return; // never step past the current month into the future
  MGR_TS_SELECTED_MONTH = nextVal;
  MGR_TS_MONTH_DAY = ''; // switching months always drops back to "whole month" view
  MGR_TS_PAGE = 0;
  buildMgrTsMonthPicker();
  buildMgrTsMonthDayScrollBar();
  renderMgrTsContent();
}

function buildMgrTsMonthPicker() {
  const picker = $('mgrTsMonthPicker'); if (!picker) return;
  const isCurrentMonth = MGR_TS_SELECTED_MONTH >= todayStr().slice(0, 7);

  picker.innerHTML = `
    <button id="mgrTsMonthPrev" class="pbtn" title="Previous month">‹</button>
    <input type="month" id="mgrTsMonthInput" value="${esc(MGR_TS_SELECTED_MONTH)}" max="${esc(todayStr().slice(0,7))}"
      style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;
      color:var(--txt1);font-size:13px;padding:8px 12px;cursor:pointer;"/>
    <button id="mgrTsMonthNext" class="pbtn" ${isCurrentMonth ? 'disabled' : ''} title="Next month">›</button>`;

  const input = $('mgrTsMonthInput');
  input.addEventListener('change', e => {
    MGR_TS_SELECTED_MONTH = e.target.value || todayStr().slice(0,7);
    MGR_TS_MONTH_DAY = ''; // new month picked directly — drop back to whole-month view
    MGR_TS_PAGE = 0;
    buildMgrTsMonthPicker();
    buildMgrTsMonthDayScrollBar();
    renderMgrTsContent();
  });

  $('mgrTsMonthPrev').addEventListener('click', () => stepMgrTsMonth(-1));
  $('mgrTsMonthNext').addEventListener('click', () => stepMgrTsMonth(1));

  // Scroll-to-change kept as a bonus for anyone who tries it, but the
  // ‹ › buttons above are the actual visible, discoverable control —
  // an invisible wheel-only interaction on a plain box gave no hint
  // that scrolling did anything.
  input.addEventListener('wheel', e => {
    e.preventDefault();
    stepMgrTsMonth(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
}

// Every day of the currently selected month, as a horizontally
// scrollable chip strip — same visual language as the 15 Days strip
// (colored active pill, weekend days tinted, wheel-scrollable). An
// "All Month" chip at the front resets back to the whole-month view;
// clicking any day chip narrows the list below to just that one day.
function buildMgrTsMonthDayScrollBar() {
  const bar = $('mgrTsMonthDayScroll'); if (!bar) return;

  const [y, m] = MGR_TS_SELECTED_MONTH.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayStr();
  const isCurrentMonth = MGR_TS_SELECTED_MONTH === today.slice(0, 7);
  const lastDay = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth; // don't show future days in the current month

  const allChip = `<button data-day="" style="flex-shrink:0;padding:6px 14px;border-radius:20px;
    border:1px solid ${!MGR_TS_MONTH_DAY?'transparent':'var(--border)'};
    background:${!MGR_TS_MONTH_DAY?'linear-gradient(135deg,#f59e0b,#fbbf24)':'var(--surface2)'};
    color:${!MGR_TS_MONTH_DAY?'#fff':'var(--txt1)'};
    font-size:11px;font-weight:${!MGR_TS_MONTH_DAY?'700':'500'};cursor:pointer;white-space:nowrap;transition:all .15s;">All Month</button>`;

  const dayChips = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${MGR_TS_SELECTED_MONTH}-${String(d).padStart(2,'0')}`;
    const isActive  = MGR_TS_MONTH_DAY === dateStr;
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
      MGR_TS_MONTH_DAY = btn.dataset.day;
      MGR_TS_PAGE = 0;
      buildMgrTsMonthDayScrollBar();
      renderMgrTsContent();
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

function renderMgrTsContent() {
  const content = $('mgrTsContent');
  if (!content) return;

  const rows = getMgrTimesheetFiltered();

  const byDate = {};
  rows.forEach(e => {
    if (!e.date) return;
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });
  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a)); // most recent first

  if (!dates.length) {
    content.innerHTML = `<div class="chart-empty">No timesheet entries for this range.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(dates.length / MGR_TS_PAGE_SIZE));
  if (MGR_TS_PAGE >= totalPages) MGR_TS_PAGE = totalPages - 1;
  const pageDates = dates.slice(MGR_TS_PAGE * MGR_TS_PAGE_SIZE, (MGR_TS_PAGE + 1) * MGR_TS_PAGE_SIZE);

  content.innerHTML = `
    <div class="card" style="padding:1.25rem;">
      ${pageDates.map(d => buildMgrTsDateSection(d, byDate[d])).join('')}
    </div>
    <div id="mgrTsPager" style="margin-top:1rem;"></div>
  `;

  renderMgrTsPager(totalPages);

  // Event delegation on the container itself (not per-button) since
  // buildMgrTsDateSection's rows are rebuilt on every render — a
  // wired-flag guard means this is attached exactly once, ever, on
  // this fixed #mgrTsContent element, instead of accumulating a new
  // duplicate listener each time renderMgrTsContent runs.
  if (!content.dataset.wired) {
    content.dataset.wired = '1';
    content.addEventListener('click', e => {
      const entryBtn = e.target.closest('.mgr-ts-force-entry');
      if (entryBtn) {
        openForceEntry(entryBtn.dataset.empId, entryBtn.dataset.empName, entryBtn.dataset.date, () => renderManagerPortal());
        return;
      }
      const leaveBtn = e.target.closest('.mgr-ts-force-leave');
      if (leaveBtn) {
        applyMgrTsForceLeave(leaveBtn, leaveBtn.dataset.empId, leaveBtn.dataset.empName, leaveBtn.dataset.date);
      }
    });
  }
}

// Force Leave here is a single lightweight action (unlike Force
// Entry, which opens its own full page) — same forceLeave backend
// action teamleader.js's applyTLLeave already uses. Updates MGR_DATA
// locally so the Timesheet view reflects it immediately, instead of
// requiring a full reload of everyone's history.
async function applyMgrTsForceLeave(btn, empId, empName, dateStr) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '…';
  try {
    await sheetGET({ action: 'forceLeave', data: encodeURIComponent(JSON.stringify({ uid: empId, date: dateStr })) });
    MGR_DATA.push({ empId, empName, date: dateStr, status: 'Leave', hours: '0h', slot: '', project: '', notes: 'Force leave applied by manager' });
    toast?.('s', 'Leave applied', `${empName} marked on leave for ${dateStr}`);
    renderMgrTsContent();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
    toast?.('e', 'Failed', err.message);
  }
}

// One date's section — a header (date, employee count, total hours)
// followed by one block per employee who logged anything that day,
// each showing every entry they made (project/status, hours, notes).
// Consistent color per employee/project name — same hashing approach
// used throughout this app (Client-Project.js's getColorForKey,
// emp-detail.js's getProjectColor) so the same name always renders
// in the same color everywhere. Self-contained here rather than
// depending on either of those other files' load order.
function mgrColorForKey(key) {
  const str = String(key || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return MGR_PALETTE[hash % MGR_PALETTE.length];
}

function buildMgrTsDateSection(dateStr, entries) {
  const dateLabel = new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',
    { weekday:'long', day:'numeric', month:'short', year:'numeric' });
  const totalHours = calcHours(entries);
  const empCount = new Set(entries.map(e => e.empId)).size;

  const byEmp = {};
  entries.forEach(e => {
    if (!byEmp[e.empId]) byEmp[e.empId] = { empName: e.empName || e.empId, rows: [] };
    byEmp[e.empId].rows.push(e);
  });

  // When no specific-employee filter is active, show EVERY employee
  // for this date — including those who logged nothing that day —
  // rather than only the ones who happened to have an entry. Makes
  // it immediately visible who hasn't logged their morning/evening
  // slots, not just who has. If a specific employee IS selected in
  // the filter, entries is already scoped to just them upstream, so
  // this naturally reduces to showing only that one person.
  let displayEmpIds;
  if (MGR_TS_EMP_FILTER) {
    displayEmpIds = Object.keys(byEmp);
  } else {
    displayEmpIds = MGR_EMPLOYEES.filter(emp => emp.active).map(emp => emp.id);
    Object.keys(byEmp).forEach(id => { if (!displayEmpIds.includes(id)) displayEmpIds.push(id); }); // stale/former employee with an entry but no current roster row
  }

  const empNameFor = empId => {
    if (byEmp[empId]) return byEmp[empId].empName;
    const emp = MGR_EMPLOYEES.find(e => e.id === empId);
    return emp ? emp.name : empId;
  };

  const sortedEmpIds = displayEmpIds.slice().sort((a,b) => empNameFor(a).localeCompare(empNameFor(b)));

  const rowsHtml = sortedEmpIds.map(empId => {
    const empName  = empNameFor(empId);
    const empColor = mgrColorForKey(empName);
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
            <button class="pbtn mgr-ts-force-entry" data-emp-id="${esc(empId)}" data-emp-name="${esc(empName)}" data-date="${esc(dateStr)}" style="flex-shrink:0;">Force Entry</button>
            <button class="pbtn mgr-ts-force-leave" data-emp-id="${esc(empId)}" data-emp-name="${esc(empName)}" data-date="${esc(dateStr)}" style="flex-shrink:0;">Force Leave</button>
          </div>
        </div>`;
    }

    const { rows } = entryData;
    const empHours = calcHours(rows);

    // Quick per-slot totals — sums every Morning entry's hours
    // together, every Afternoon entry's hours together, etc. (an
    // employee can have more than one entry in the same slot), so
    // there's a one-glance answer to "how much in the morning vs.
    // the afternoon" without manually adding up each row below.
    const slotHourTotals = {};
    rows.forEach(e => {
      if (e.status === 'Leave' || e.status === 'Holiday') return;
      if (!(e.timeIn && e.timeOut)) return; // same "real times only" rule as the per-entry slot badge
      const key = e.slot;
      if (!key) return;
      slotHourTotals[key] = (slotHourTotals[key] || 0) + parseH(e.hours);
    });
    // Only worth showing when there's more than one slot involved —
    // with just one (e.g. a single Morning entry), this would just
    // repeat the exact same "Morning: 3h 23m" the entry row right
    // below it already says.
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
      const projectColor = isLeave ? '#fbbf24' : isHoliday ? '#9ca3af' : mgrColorForKey(e.project || '—');
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
          <span style="flex:0 0 70px;color:var(--txt2);text-align:right;">${(isLeave||isHoliday) ? '—' : fh(parseH(e.hours))}</span>
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

function renderMgrTsPager(totalPages) {
  const pagerEl = $('mgrTsPager');
  if (!pagerEl) return;
  if (totalPages <= 1) { pagerEl.innerHTML = ''; return; }

  const pageNums = [];
  for (let p = 0; p < totalPages; p++) pageNums.push(p);

  pagerEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;">
      <button class="pbtn" id="mgrTsPagePrev" ${MGR_TS_PAGE===0?'disabled':''}>‹ Prev</button>
      ${pageNums.map(p => `<button class="pbtn${p===MGR_TS_PAGE?' cur':''}" data-page="${p}">${p+1}</button>`).join('')}
      <button class="pbtn" id="mgrTsPageNext" ${MGR_TS_PAGE===totalPages-1?'disabled':''}>Next ›</button>
    </div>`;

  $('mgrTsPagePrev')?.addEventListener('click', () => { if (MGR_TS_PAGE>0) { MGR_TS_PAGE--; renderMgrTsContent(); } });
  $('mgrTsPageNext')?.addEventListener('click', () => { if (MGR_TS_PAGE<totalPages-1) { MGR_TS_PAGE++; renderMgrTsContent(); } });
  pagerEl.querySelectorAll('.pbtn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { MGR_TS_PAGE = parseInt(btn.dataset.page, 10); renderMgrTsContent(); });
  });
}

// ══════════════════════════════════════════════════
// RANGE / SCROLL / PICKER HELPERS
// ══════════════════════════════════════════════════
function buildDayScrollBar() {
  const bar = $('mgrDayScroll'); if (!bar) return;
  const days = getLast15Days();
  bar.innerHTML = days.map((d,i) => {
    const isActive  = i===MGR_DAY_OFFSET;
    const isWeekend = new Date(d+'T00:00:00').getDay()%6===0;
    return `<button data-offset="${i}" style="flex-shrink:0;padding:5px 14px;border-radius:20px;
      border:1px solid ${isActive?'var(--a1)':'var(--border)'};
      background:${isActive?'var(--a1)':'var(--surface2)'};
      color:${isActive?'#fff':isWeekend?'#a78bfa':'var(--txt1)'};
      font-size:11px;cursor:pointer;white-space:nowrap;">${fmtDateShort(d)}</button>`;
  }).join('');
  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', ()=>{ MGR_DAY_OFFSET=parseInt(btn.dataset.offset); buildDayScrollBar(); renderEmpContent(); });
  });
}

function buildMonthPicker() {
  const picker = $('mgrMonthPicker'); if (!picker) return;
  const months = [];
  const now = new Date();
  for (let i=0;i<12;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    months.push({val:toLocalDateStr(d).slice(0,7),label:d.toLocaleDateString('en-IN',{month:'short',year:'numeric'})});
  }
  picker.innerHTML = `
    <div style="display:flex;gap:6px;overflow-x:auto;flex:1;padding-bottom:2px;">
      ${months.map(m=>`<button data-month="${m.val}" style="flex-shrink:0;padding:5px 14px;border-radius:20px;
        border:1px solid ${m.val===MGR_SELECTED_MONTH?'var(--a1)':'var(--border)'};
        background:${m.val===MGR_SELECTED_MONTH?'var(--a1)':'var(--surface2)'};
        color:${m.val===MGR_SELECTED_MONTH?'#fff':'var(--txt1)'};
        font-size:11px;cursor:pointer;white-space:nowrap;">${m.label}</button>`).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">
      <span style="font-size:11px;color:var(--txt2);white-space:nowrap;">Pick date:</span>
      <input type="date" id="mgrDatePicker" max="${todayStr()}" value="${MGR_SELECTED_MONTH+'-01'}"
        style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;
        color:var(--txt1);font-size:11px;padding:4px 8px;cursor:pointer;"/>
    </div>`;

  picker.querySelectorAll('button[data-month]').forEach(btn => {
    btn.addEventListener('click', ()=>{ MGR_SELECTED_MONTH=btn.dataset.month; buildMonthPicker(); renderEmpContent(); });
  });

  const dp = document.getElementById('mgrDatePicker');
  if (dp) {
    dp.addEventListener('change', ()=>{
      const picked = dp.value; if (!picked) return;
      MGR_RANGE='day15';
      $('mgrRange')?.querySelectorAll('.rbtn').forEach(b=>b.classList.toggle('active',b.dataset.range==='day15'));
      const diffDays=Math.round((new Date().setHours(0,0,0,0)-new Date(picked+'T00:00:00').getTime())/86400000);
      MGR_DAY_OFFSET=Math.max(0,Math.min(14,diffDays));
      $('mgrMonthPicker').style.display='none';
      $('mgrDayScroll').style.display='flex';
      buildDayScrollBar(); renderEmpContent();
    });
  }
}

function getMgrFiltered() {
  const tod=todayStr(), ws=weekStart();
  if (MGR_RANGE==='day15') { const s=getLast15Days()[MGR_DAY_OFFSET]; return MGR_DATA.filter(e=>e.date===s); }
  if (MGR_RANGE==='week')  return MGR_DATA.filter(e=>e.date>=ws&&e.date<=tod);
  if (MGR_RANGE==='month') return MGR_DATA.filter(e=>e.date.startsWith(MGR_SELECTED_MONTH));
  return MGR_DATA;
}

function getMgrRangeLabel() {
  if (MGR_RANGE==='day15') return fmtDateShort(getLast15Days()[MGR_DAY_OFFSET]);
  if (MGR_RANGE==='week')  return 'This Week';
  if (MGR_RANGE==='month') {
    const [y,m]=MGR_SELECTED_MONTH.split('-');
    return new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-IN',{month:'short',year:'numeric'});
  }
  return 'All Time';
}

function getWorkingDaysInRange() {
  const tod=todayStr(); let start,end;
  if (MGR_RANGE==='day15') return [getLast15Days()[MGR_DAY_OFFSET]];
  if (MGR_RANGE==='week')  { start=weekStart(); end=tod; }
  else if (MGR_RANGE==='month') {
    const [y,m]=MGR_SELECTED_MONTH.split('-').map(Number);
    start=MGR_SELECTED_MONTH+'-01';
    end=MGR_SELECTED_MONTH+'-'+String(new Date(y,m,0).getDate()).padStart(2,'0');
    if (end>tod) end=tod;
  } else { const d=new Date(); d.setDate(d.getDate()-90); start=toLocalDateStr(d); end=tod; }
  const dates=[]; const cur=new Date(start+'T00:00:00'); const endDate=new Date(end+'T00:00:00');
  while(cur<=endDate){ const day=cur.getDay(); if(day!==0&&day!==6) dates.push(toLocalDateStr(cur)); cur.setDate(cur.getDate()+1); }
  return dates;
}

function getLast15Days() {
  const dates=[];
  for(let i=0;i<15;i++){ const d=new Date(); d.setDate(d.getDate()-i); dates.push(toLocalDateStr(d)); }
  return dates;
}

// Force Leave is handled in emp-detail.js

// ── GENERAL HELPERS ───────────────────────────────
// Timezone-safe 'YYYY-MM-DD' from a Date's LOCAL components. Every
// .toISOString().slice(0,N) call in this file was silently wrong in
// any UTC+ timezone (like IST): toISOString() always converts to
// UTC first, and a date built as local midnight (e.g. the 1st of a
// month) rolls back to the previous day/month once converted —
// exactly the "month picker shows Jul but loads Jun" bug. This uses
// the Date's own local getFullYear/getMonth/getDate instead, same
// safe approach utils.js's todayStr() already uses elsewhere.
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// An entry counts as "worked" only if it's neither a Leave nor a
// Holiday — both are non-working statuses. Every filter in this file
// that used to check `status !== 'Leave'` alone was letting Holiday
// entries slip through as if they were worked days (with 0 hours,
// but still counted toward "Days" totals) — Holiday needs the same
// exclusion Leave already gets, everywhere "worked" is computed.
function isWorkedEntry(e) { return e.status !== 'Leave' && e.status !== 'Holiday'; }

function calcHours(arr) { return arr.filter(isWorkedEntry).reduce((s,e)=>s+parseH(e.hours),0); }

function parseH(val) {
  if(!val) return 0;
  const s=String(val).trim();
  const h=(s.match(/(\d+)h/)||[])[1], m=(s.match(/(\d+)m/)||[])[1];
  if(!h&&!m) return parseFloat(s)||0;
  return (parseInt(h||0)*60+parseInt(m||0))/60;
}

function fmtDateShort(dateStr) {
  return new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
}

function fmtNum(n) {
  return Number(n).toLocaleString('en-IN',{maximumFractionDigits:0});
}

function toMinutes(t) {
  if(!t) return 0;
  const [h,m]=t.split(':').map(Number);
  return h*60+m;
}

function fmt12(t) {
  if(!t) return '--:--';
  const [h,m]=t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}