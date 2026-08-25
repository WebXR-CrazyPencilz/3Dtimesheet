// ═══════════════════════════════════════════════════
// AUTH.JS — Employee + Manager + Team Leader login
// ═══════════════════════════════════════════════════

let USER           = null;
let LIVE_EMPLOYEES = [];
let MANAGER_MODE   = false;
let TL_MODE        = false;
let HR_MODE        = false;

async function initLogin() {
  console.log('[AUTH] initLogin | DEMO_MODE:', CONFIG.DEMO_MODE);
  await loadEmployeesAndRenderLogin();

  // Restore session
  try {
    const s = sessionStorage.getItem(CONFIG.LS_SESSION);
    if (s) {
      const u = JSON.parse(s);
      if (u?.id) {
        if (u.role === 'manager')    loginAsManager(u, true);
        else if (u.role === 'tl')    loginAsTL(u, true);
        else if (u.role === 'hr')    loginAsHR(u, true);
        else                         loginAs(u, true);
      }
    }
  } catch(e) {
    console.error('[AUTH] Session restore failed:', e.message);
  }
}

async function loadEmployeesAndRenderLogin() {
  const empSel = $('lemp');
  const tabs   = $('etabs');
  const errBox = $('empLoadErr');

  if (errBox) errBox.classList.remove('show');
  empSel.innerHTML = '<option value="">— Select your name —</option>';
  tabs.innerHTML   = '';

  if (CONFIG.DEMO_MODE) {
    LIVE_EMPLOYEES = EMPLOYEES;
  } else {
    try {
      const master   = await apiGetMasterData();
      LIVE_EMPLOYEES = master.employees || [];
      if (Array.isArray(master.clients)  && master.clients.length  > 0) CLIENTS  = master.clients;
      if (Array.isArray(master.projects) && master.projects.length > 0) PROJECTS = master.projects;
      if (LIVE_EMPLOYEES.length === 0) throw new Error('Employees sheet returned 0 rows.');
    } catch(e) {
      console.error('[AUTH] Failed to load from Sheet:', e.message);
      LIVE_EMPLOYEES = [];
      showEmployeeLoadError(e.message);
      return;
    }
  }

  renderEmployeeDropdown();
}

function showEmployeeLoadError(msg) {
  const errBox = $('empLoadErr');
  if (errBox) {
    errBox.classList.add('show');
    errBox.innerHTML = `
      <span>⚠️ Couldn't load employee list: ${esc(msg)}</span>
      <button type="button" class="btn bghost" id="empRetryBtn" style="margin-top:.5rem">↻ Retry</button>`;
    $('empRetryBtn').onclick = () => loadEmployeesAndRenderLogin();
  }
  toast('e', 'Could not load employees', msg, 8000);
}

// Every configured Team Leader account, e.g.
// [{id:'TL1',pw:'...',name:'Team Leader 1'}, {id:'TL2',...}].
// Centralized here so the dropdown, the quick-tabs, and the login
// submit handler all read from the same single list — add or remove
// a Team Leader in CONFIG.TEAM_LEADERS and every part of the login
// screen picks it up automatically, nothing else needs editing.
function getTeamLeaderAccounts() {
  return Array.isArray(CONFIG.TEAM_LEADERS) && CONFIG.TEAM_LEADERS.length
    ? CONFIG.TEAM_LEADERS
    : [{ id: CONFIG.TL_ID || 'TL', pw: CONFIG.TL_PW || 'teamlead123', name: 'Team Leader' }]; // fallback for old single-TL config
}

function renderEmployeeDropdown() {
  const empSel = $('lemp');
  const tabs   = $('etabs');

  // Add Manager option at top
  const mgrOpt = document.createElement('option');
  mgrOpt.value = CONFIG.MANAGER_ID || 'MGR';
  mgrOpt.textContent = '🔑 Manager';
  empSel.appendChild(mgrOpt);

  // Add one option per configured Team Leader account
  getTeamLeaderAccounts().forEach(tl => {
    const tlOpt = document.createElement('option');
    tlOpt.value = tl.id;
    tlOpt.textContent = `👥 ${tl.name}`;
    empSel.appendChild(tlOpt);
  });

  // Add HR option — same single-account pattern as Manager
  const hrOpt = document.createElement('option');
  hrOpt.value = CONFIG.HR_ID || 'HR';
  hrOpt.textContent = '🧑‍💼 HR';
  empSel.appendChild(hrOpt);

  LIVE_EMPLOYEES.forEach(e => {
    const o = document.createElement('option');
    o.value = e.id; o.textContent = e.name;
    empSel.appendChild(o);
  });

  // Quick tabs (first 5 employees)
  LIVE_EMPLOYEES.slice(0, 5).forEach(e => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'etab'; b.dataset.id = e.id;
    b.textContent = e.name.split(' ')[0];
    b.onclick = () => {
      empSel.value = e.id;
      empSel.dispatchEvent(new Event('change'));
      $('lpw').focus();
    };
    tabs.appendChild(b);
  });
  if (LIVE_EMPLOYEES.length > 5) {
    const m = document.createElement('button');
    m.type = 'button'; m.className = 'etab'; m.textContent = 'More ▾';
    m.onclick = () => empSel.focus();
    tabs.appendChild(m);
  }

  empSel.onchange = () => {
    const id  = empSel.value;
    const emp = LIVE_EMPLOYEES.find(e => e.id === id);
    const tl  = getTeamLeaderAccounts().find(t => t.id === id);
    const pill = $('idpill'), txt = $('idtxt');
    if (id === (CONFIG.MANAGER_ID || 'MGR')) {
      txt.textContent = 'Manager Access';
      pill.classList.add('show');
    } else if (id === (CONFIG.HR_ID || 'HR')) {
      txt.textContent = 'HR Access';
      pill.classList.add('show');
    } else if (tl) {
      txt.textContent = `${tl.name} Access`;
      pill.classList.add('show');
    } else if (emp) {
      txt.textContent = `${emp.id} · ${emp.team}`;
      pill.classList.add('show');
    } else {
      pill.classList.remove('show');
    }
    tabs.querySelectorAll('.etab').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    $('lerr').classList.remove('show');
  };

  $('pwt').onclick = () => {
    const pw = $('lpw'), s = pw.type === 'text';
    pw.type = s ? 'password' : 'text';
    $('eshow').style.display = s ? 'block' : 'none';
    $('ehide').style.display = s ? 'none'  : 'block';
  };

  $('lform').onsubmit = async ev => {
    ev.preventDefault();
    const id  = empSel.value;
    const pw  = $('lpw').value;
    const err = $('lerr'), msg = $('lerrmsg'), btn = $('lbtn');
    err.classList.remove('show');

    if (!id) { msg.textContent = 'Please select your name.'; err.classList.add('show'); return; }
    if (!pw) { msg.textContent = 'Please enter your password.'; err.classList.add('show'); return; }

    btn.classList.add('ld'); btn.disabled = true;
    try {
      // Manager login
      if (id === (CONFIG.MANAGER_ID || 'MGR')) {
        if (pw !== CONFIG.MANAGER_PW) throw new Error('Wrong manager password.');
        loginAsManager({ id: 'MGR', name: 'Manager', team: 'Management', role: 'manager' });
        return;
      }
      // HR login
      if (id === (CONFIG.HR_ID || 'HR')) {
        if (pw !== CONFIG.HR_PW) throw new Error('Wrong HR password.');
        loginAsHR({ id: 'HR', name: 'HR', team: 'Human Resources', role: 'hr' });
        return;
      }
      // Team Leader login — matched by whichever configured account
      // this dropdown selection corresponds to.
      const tlAccount = getTeamLeaderAccounts().find(t => t.id === id);
      if (tlAccount) {
        if (pw !== tlAccount.pw) throw new Error('Wrong team leader password.');
        loginAsTL({ id: tlAccount.id, name: tlAccount.name, team: 'All Teams', role: 'tl' });
        return;
      }
      // Employee login
      const user = await apiLogin(id, pw);
      loginAs(user);
    } catch(e) {
      msg.textContent = e.message || 'Login failed.';
      err.classList.add('show');
      $('lpw').value = ''; $('lpw').focus();
    } finally {
      btn.classList.remove('ld'); btn.disabled = false;
    }
  };
}

// ── EMPLOYEE LOGIN ────────────────────────────────
async function loginAs(emp, silent = false) {
  MANAGER_MODE = false;
  TL_MODE      = false;
  USER = emp;
  sessionStorage.setItem(CONFIG.LS_SESSION, JSON.stringify(emp));

  const av = $('av'), wn = $('wn'), wt = $('wt');
  if (av) av.textContent = emp.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  if (wn) wn.textContent = emp.name;
  if (wt) wt.textContent = `${emp.team} · ${emp.id}`;

  $('login').classList.add('gone');
  $('mgrPortal').classList.remove('on');
  $('tlPortal')?.classList.remove('on');
  $('app').classList.add('on');

  // Data load is wrapped separately from the UI-switch above — a
  // failure here must not leave the app shell stuck silently. Before
  // this fix, apiLoadEntries had no try/catch here, so a flaky-network
  // throw became an unhandled promise rejection with zero UI feedback
  // — indistinguishable from an infinite load. Same recovery pattern
  // as initTeamLeader()'s catch block in teamleader.js.
  try {
    ENTRIES = await apiLoadEntries(emp.id);
    initForm();
    refreshStats();
    refreshFilters();
    refreshTable();
    refreshChart();
    if (!silent) toast('s', `Welcome back, ${emp.name.split(' ')[0]}! 👋`, emp.team);
  } catch(err) {
    console.error('[AUTH] Failed to load entries for', emp.id, ':', err.message);
    toast('e', 'Could not load your timesheet', err.message, 8000);
    const appEl = $('app');
    if (appEl) {
      appEl.innerHTML = `<div class="slot-error" style="margin:2rem auto;max-width:420px;text-align:center;">
        Failed to load your timesheet: ${esc(err.message)}
        <br/><button class="btn bghost" style="margin-top:.75rem" onclick='loginAs(${JSON.stringify(emp)}, true)'>↻ Retry</button>
      </div>`;
    }
  }
}

// ── MANAGER LOGIN ─────────────────────────────────
async function loginAsManager(emp, silent = false) {
  MANAGER_MODE = true;
  TL_MODE      = false;
  USER = emp;
  sessionStorage.setItem(CONFIG.LS_SESSION, JSON.stringify({ ...emp, role: 'manager' }));

  const av = $('mgrAv');
  if (av) av.textContent = 'M';
  const mn = $('mgrName');
  if (mn) mn.textContent = emp.name;
  const mt = $('mgrTeam');
  if (mt) mt.textContent = 'Manager Portal';

  $('login').classList.add('gone');
  $('app').classList.remove('on');
  $('tlPortal')?.classList.remove('on');
  $('mgrPortal').classList.add('on');

  if (!silent) toast('s', `Welcome, Manager! 👋`, 'Manager Portal');
  initManager();
}

// ── TEAM LEADER LOGIN ─────────────────────────────
async function loginAsTL(emp, silent = false) {
  MANAGER_MODE = false;
  TL_MODE      = true;
  USER = emp;
  sessionStorage.setItem(CONFIG.LS_SESSION, JSON.stringify({ ...emp, role: 'tl' }));

  // Initials from the Team Leader's actual configured name (e.g.
  // "Team Leader 1" -> "TL", or a real name like "Priya Kumar" -> "PK")
  // instead of a hardcoded "TL" — so two different Team Leaders show
  // distinct avatars if given real names in CONFIG.TEAM_LEADERS.
  const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'TL';

  const av = $('tlAv');
  if (av) av.textContent = initials;
  const tn = $('tlName');
  if (tn) tn.textContent = emp.name;
  const tt = $('tlTeam');
  if (tt) tt.textContent = 'Team Leader Portal';

  $('login').classList.add('gone');
  $('app').classList.remove('on');
  $('mgrPortal').classList.remove('on');
  $('tlPortal').classList.add('on');

  if (!silent) toast('s', `Welcome, ${emp.name}! 👋`, 'Team Leader Portal');
  initTeamLeader();
}

// ── HR LOGIN ───────────────────────────────────────
async function loginAsHR(emp, silent = false) {
  MANAGER_MODE = false;
  TL_MODE      = false;
  HR_MODE      = true;
  USER = emp;
  sessionStorage.setItem(CONFIG.LS_SESSION, JSON.stringify({ ...emp, role: 'hr' }));

  const av = $('hrAv');
  if (av) av.textContent = 'HR';
  const hn = $('hrName');
  if (hn) hn.textContent = emp.name;
  const ht = $('hrTeam');
  if (ht) ht.textContent = 'HR Portal';

  $('login').classList.add('gone');
  $('app').classList.remove('on');
  $('mgrPortal').classList.remove('on');
  $('tlPortal')?.classList.remove('on');
  $('hrPortal')?.classList.add('on');

  if (!silent) toast('s', `Welcome, HR! 👋`, 'HR Portal');
  if (!$('hrPortal')) {
    console.error('[AUTH] #hrPortal not found in index.html — HR Portal cannot render. See humanresource.js bottom-of-file note for the markup needed.');
    toast('e', 'HR Portal markup missing', 'index.html needs an #hrPortal container — ask to have it added.');
    return;
  }
  initHR();
}

// ── LOGOUT ────────────────────────────────────────
// ── CHANGE PASSWORD (Employee portal — self-service only) ─────────
// Deliberately only wired up in the Employee portal's topbar (see
// index.html) — Manager/Team Leader/HR accounts are constants in
// config.js, not rows in the Employees sheet, so this feature has no
// meaning for them and isn't offered there. Requires the current
// password to be entered correctly server-side (see Code.gs's
// changeOwnPassword) before anything changes.
function openChangePasswordModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);'
    + 'display:flex;align-items:center;justify-content:center;z-index:9999;';
  overlay.innerHTML = `
    <div style="background:var(--surface1);border:1px solid var(--border-md);
      border-radius:14px;padding:1.25rem;width:340px;max-width:92vw;">
      <div style="font-weight:700;font-size:15px;color:var(--txt1);margin-bottom:2px;">🔒 Change Password</div>
      <div style="font-size:12px;color:var(--txt2);margin-bottom:12px;">${esc(USER ? USER.name : '')}</div>

      <label style="font-size:11px;color:var(--txt2);font-weight:600;display:block;margin:10px 0 4px;">Current Password</label>
      <input id="cpwCurrent" type="password" autocomplete="current-password" placeholder="Enter current password"
        style="width:100%;background:var(--inp);border:1px solid var(--inp-b);border-radius:7px;
          color:var(--txt);font-size:12.5px;padding:8px 10px;box-sizing:border-box;font-family:inherit;"/>

      <label style="font-size:11px;color:var(--txt2);font-weight:600;display:block;margin:10px 0 4px;">New Password</label>
      <input id="cpwNew" type="password" autocomplete="new-password" placeholder="At least 4 characters"
        style="width:100%;background:var(--inp);border:1px solid var(--inp-b);border-radius:7px;
          color:var(--txt);font-size:12.5px;padding:8px 10px;box-sizing:border-box;font-family:inherit;"/>

      <label style="font-size:11px;color:var(--txt2);font-weight:600;display:block;margin:10px 0 4px;">Confirm New Password</label>
      <input id="cpwConfirm" type="password" autocomplete="new-password" placeholder="Re-enter new password"
        style="width:100%;background:var(--inp);border:1px solid var(--inp-b);border-radius:7px;
          color:var(--txt);font-size:12.5px;padding:8px 10px;box-sizing:border-box;font-family:inherit;"/>

      <div id="cpwErr" style="display:none;font-size:11.5px;color:var(--err);margin-top:8px;"></div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button id="cpwCancel" style="background:none;border:1px solid var(--border-md);
          color:var(--txt2);border-radius:7px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;">Cancel</button>
        <button id="cpwSubmit" style="background:var(--a1);border:none;
          color:#fff;border-radius:7px;padding:7px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">Change Password</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const errEl = overlay.querySelector('#cpwErr');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#cpwCancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#cpwSubmit').addEventListener('click', async () => {
    const currentPw = overlay.querySelector('#cpwCurrent').value;
    const newPw     = overlay.querySelector('#cpwNew').value;
    const confirmPw = overlay.querySelector('#cpwConfirm').value;

    errEl.style.display = 'none';

    if (!currentPw) { showErr('Enter your current password.'); return; }
    if (newPw.length < 4) { showErr('New password must be at least 4 characters.'); return; }
    if (newPw !== confirmPw) { showErr('New password and confirmation do not match.'); return; }
    if (newPw === currentPw) { showErr('New password must be different from the current one.'); return; }

    const btn = overlay.querySelector('#cpwSubmit');
    btn.disabled = true;
    btn.textContent = 'Changing…';

    try {
      await apiChangeOwnPassword(USER.id, currentPw, newPw);
      toast?.('s', 'Password changed', 'Use your new password next time you sign in.');
      overlay.remove();
    } catch(err) {
      showErr(err.message || 'Failed to change password.');
      btn.disabled = false;
      btn.textContent = 'Change Password';
    }
  });
}

function logout() {
  sessionStorage.removeItem(CONFIG.LS_SESSION);
  USER = null; ENTRIES = []; MANAGER_MODE = false; TL_MODE = false; HR_MODE = false;

  $('app').classList.remove('on');
  $('mgrPortal').classList.remove('on');
  $('tlPortal')?.classList.remove('on');
  $('hrPortal')?.classList.remove('on');
  $('login').classList.remove('gone');
  $('lemp').value = ''; $('lpw').value = '';
  $('idpill').classList.remove('show');
  $('lerr').classList.remove('show');
  $('etabs').querySelectorAll('.etab').forEach(b => b.classList.remove('on'));
}