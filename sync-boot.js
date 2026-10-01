// ============================================================
//  sync-boot.js — Supabase cloud sync for Bhakta Mithai
//  Drop this file next to index.html.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ====== STEP 1: PASTE YOUR SUPABASE CREDENTIALS HERE ======
const SUPABASE_URL      = // ============================================================
//  sync-boot.js — Supabase cloud sync for Bhakta Mithai
//  Drop this file next to index.html.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ====== STEP 1: PASTE YOUR SUPABASE CREDENTIALS HERE ======
const SUPABASE_URL      = 'https://cfcizvsoxrhhfbdytihe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmY2l6dnNveHJoaGZiZHl0aWhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NjU5MjcsImV4cCI6MjEwNjQ0MTkyN30.ojR3qD9wNoZAV5lnsmoCUrHNmB1ZMybKX500FI6UXKg';
// ===========================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- UI references ----------
const panel      = document.getElementById('syncPanel');
const head       = document.getElementById('syncHead');
const dot        = document.getElementById('syncDot');
const label      = document.getElementById('syncLabel');
const chev       = document.getElementById('syncChev');
const signedOut  = document.getElementById('syncSignedOut');
const signedIn   = document.getElementById('syncSignedIn');
const emailInput = document.getElementById('syncEmail');
const signInBtn  = document.getElementById('syncSignIn');
const signOutBtn = document.getElementById('syncSignOut');
const syncNowBtn = document.getElementById('syncNow');
const userEl     = document.getElementById('syncUser');
const msgEl      = document.getElementById('syncMsg');
const msg2El     = document.getElementById('syncMsg2');

let currentUser    = null;
let isPushing      = false;
let lastPushedHash = null;
let lastPushedAt   = 0;

// ---------- Helpers ----------
function setStatus(state, text) {
  dot.className = 'dot ' + state;
  label.textContent = text;
}

function showMessage(el, text, isError) {
  el.textContent = text;
  el.className = isError ? 'err' : '';
}

function log() {
  console.log('[sync]', ...arguments);
}

// ---------- Panel toggle ----------
head.addEventListener('click', function () {
  panel.classList.toggle('open');
  chev.textContent = panel.classList.contains('open') ? '▴' : '▾';
});

// ---------- SIGN IN (magic link) ----------
signInBtn.addEventListener('click', async function () {
  const email = emailInput.value.trim();
  if (!email) return showMessage(msgEl, 'Enter your email', true);
  setStatus('busy', 'Sending link...');
  const { error } = await supabase.auth.signInWithOtp({ email: email });
  if (error) {
    setStatus('err', 'Sign-in failed');
    showMessage(msgEl, error.message, true);
  } else {
    setStatus('ok', 'Check your email');
    showMessage(msgEl, 'Magic link sent! Check your inbox.');
  }
});

// ---------- SIGN OUT ----------
signOutBtn.addEventListener('click', async function () {
  await supabase.auth.signOut();
  currentUser = null;
  lastPushedHash = null;
  lastPushedAt = 0;
  signedIn.hidden = true;
  signedOut.hidden = false;
  setStatus('', 'Sign in');
});

// ---------- AUTH STATE LISTENER ----------
supabase.auth.onAuthStateChange(async function (event, session) {
  if (session && session.user) {
    currentUser = session.user;
    userEl.textContent = currentUser.email;
    signedIn.hidden = false;
    signedOut.hidden = true;
    setStatus('busy', 'Syncing...');
    await initialSync();
  } else {
    currentUser = null;
    signedIn.hidden = true;
    signedOut.hidden = false;
    setStatus('', 'Sign in');
  }
});

// ---------- INITIAL SYNC (right after login) ----------
// Compare local vs cloud, decide who wins, sync.
async function initialSync() {
  const { data, error } = await supabase
    .from('ledger_data')
    .select('data, updated_at')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('Sync fetch error:', error);
    setStatus('err', 'Sync error');
    showMessage(msg2El, error.message, true);
    return;
  }

  const localState = window.LedgerBridge.getState();
  const localFYCount = Object.keys(localState.fyData || {}).length;
  const localHasData = localFYCount > 0 &&
    Object.values(localState.fyData).some(function (d) {
      return d && ((d.sales && d.sales.length) || (d.expenses && d.expenses.length) ||
                   (d.employees && d.employees.length));
    });

  // Case 1: No cloud row yet → push local up
  if (!data) {
    log('No cloud data yet — pushing local up');
    await pushData();
    return;
  }

  // Case 2: Local is empty → pull cloud down (new device first login)
  if (!localHasData) {
    log('Local empty — pulling cloud data');
    window.LedgerBridge.setState(data.data);
    lastPushedHash = JSON.stringify(data.data);
    lastPushedAt = Date.now();
    setStatus('ok', 'Synced from cloud');
    showMessage(msg2El, 'Loaded cloud data');
    return;
  }

  // Case 3: Both have data → ask user
  const useCloud = window.confirm(
    'Cloud backup found for ' + currentUser.email + '.\n\n' +
    'Click OK to LOAD the cloud data (recommended if you just logged in on a new device).\n\n' +
    'Click Cancel to OVERWRITE the cloud with this device\'s data.'
  );

  if (useCloud) {
    window.LedgerBridge.setState(data.data);
    lastPushedHash = JSON.stringify(data.data);
    lastPushedAt = Date.now();
    setStatus('ok', 'Loaded from cloud');
    showMessage(msg2El, 'Loaded cloud data');
  } else {
    await pushData();
  }
}

// ---------- PUSH to Supabase ----------
async function pushData() {
  if (!currentUser || isPushing) return;
  isPushing = true;
  setStatus('busy', 'Syncing...');

  const state = window.LedgerBridge.getState();
  const { error } = await supabase
    .from('ledger_data')
    .upsert(
      {
        user_id: currentUser.id,
        data: state,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('Push error:', error);
    setStatus('err', 'Sync error');
    showMessage(msg2El, error.message, true);
  } else {
    lastPushedHash = JSON.stringify(state);
    lastPushedAt = Date.now();
    setStatus('ok', 'Synced');
    showMessage(msg2El, 'Last sync: ' + new Date().toLocaleTimeString());
  }
  isPushing = false;
}

// ---------- PULL from Supabase ----------
async function pullData() {
  if (!currentUser) return;
  const { data, error } = await supabase
    .from('ledger_data')
    .select('data')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('Pull error:', error);
    setStatus('err', 'Sync error');
    return;
  }

  if (data && data.data) {
    window.LedgerBridge.setState(data.data);
    lastPushedHash = JSON.stringify(data.data);
    lastPushedAt = Date.now();
    setStatus('ok', 'Loaded from cloud');
  }
}

// ---------- MANUAL SYNC BUTTON ----------
syncNowBtn.addEventListener('click', async function () {
  await pullData();
  await pushData();
});

// ---------- AUTO-PUSH when local data changes ----------
setInterval(function () {
  if (!currentUser) return;
  const currentHash = JSON.stringify(window.LedgerBridge.getState());
  if (lastPushedHash === null) {
    lastPushedHash = currentHash;
    return;
  }
  if (currentHash !== lastPushedHash) {
    pushData();
  }
}, 3000);

// ---------- INITIAL SESSION CHECK ----------
supabase.auth.getSession().then(function (res) {
  const session = res.data.session;
  if (session && session.user) {
    currentUser = session.user;
    userEl.textContent = currentUser.email;
    signedIn.hidden = false;
    signedOut.hidden = true;
    setStatus('busy', 'Syncing...');
    initialSync();
  }
});;
const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_KEY_HERE';
// ===========================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- UI references ----------
const panel      = document.getElementById('syncPanel');
const head       = document.getElementById('syncHead');
const dot        = document.getElementById('syncDot');
const label      = document.getElementById('syncLabel');
const chev       = document.getElementById('syncChev');
const signedOut  = document.getElementById('syncSignedOut');
const signedIn   = document.getElementById('syncSignedIn');
const emailInput = document.getElementById('syncEmail');
const signInBtn  = document.getElementById('syncSignIn');
const signOutBtn = document.getElementById('syncSignOut');
const syncNowBtn = document.getElementById('syncNow');
const userEl     = document.getElementById('syncUser');
const msgEl      = document.getElementById('syncMsg');
const msg2El     = document.getElementById('syncMsg2');

let currentUser    = null;
let isPushing      = false;
let lastPushedHash = null;
let lastPushedAt   = 0;

// ---------- Helpers ----------
function setStatus(state, text) {
  dot.className = 'dot ' + state;
  label.textContent = text;
}

function showMessage(el, text, isError) {
  el.textContent = text;
  el.className = isError ? 'err' : '';
}

function log() {
  console.log('[sync]', ...arguments);
}

// ---------- Panel toggle ----------
head.addEventListener('click', function () {
  panel.classList.toggle('open');
  chev.textContent = panel.classList.contains('open') ? '▴' : '▾';
});

// ---------- SIGN IN (magic link) ----------
signInBtn.addEventListener('click', async function () {
  const email = emailInput.value.trim();
  if (!email) return showMessage(msgEl, 'Enter your email', true);
  setStatus('busy', 'Sending link...');
  const { error } = await supabase.auth.signInWithOtp({ email: email });
  if (error) {
    setStatus('err', 'Sign-in failed');
    showMessage(msgEl, error.message, true);
  } else {
    setStatus('ok', 'Check your email');
    showMessage(msgEl, 'Magic link sent! Check your inbox.');
  }
});

// ---------- SIGN OUT ----------
signOutBtn.addEventListener('click', async function () {
  await supabase.auth.signOut();
  currentUser = null;
  lastPushedHash = null;
  lastPushedAt = 0;
  signedIn.hidden = true;
  signedOut.hidden = false;
  setStatus('', 'Sign in');
});

// ---------- AUTH STATE LISTENER ----------
supabase.auth.onAuthStateChange(async function (event, session) {
  if (session && session.user) {
    currentUser = session.user;
    userEl.textContent = currentUser.email;
    signedIn.hidden = false;
    signedOut.hidden = true;
    setStatus('busy', 'Syncing...');
    await initialSync();
  } else {
    currentUser = null;
    signedIn.hidden = true;
    signedOut.hidden = false;
    setStatus('', 'Sign in');
  }
});

// ---------- INITIAL SYNC (right after login) ----------
// Compare local vs cloud, decide who wins, sync.
async function initialSync() {
  const { data, error } = await supabase
    .from('ledger_data')
    .select('data, updated_at')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('Sync fetch error:', error);
    setStatus('err', 'Sync error');
    showMessage(msg2El, error.message, true);
    return;
  }

  const localState = window.LedgerBridge.getState();
  const localFYCount = Object.keys(localState.fyData || {}).length;
  const localHasData = localFYCount > 0 &&
    Object.values(localState.fyData).some(function (d) {
      return d && ((d.sales && d.sales.length) || (d.expenses && d.expenses.length) ||
                   (d.employees && d.employees.length));
    });

  // Case 1: No cloud row yet → push local up
  if (!data) {
    log('No cloud data yet — pushing local up');
    await pushData();
    return;
  }

  // Case 2: Local is empty → pull cloud down (new device first login)
  if (!localHasData) {
    log('Local empty — pulling cloud data');
    window.LedgerBridge.setState(data.data);
    lastPushedHash = JSON.stringify(data.data);
    lastPushedAt = Date.now();
    setStatus('ok', 'Synced from cloud');
    showMessage(msg2El, 'Loaded cloud data');
    return;
  }

  // Case 3: Both have data → ask user
  const useCloud = window.confirm(
    'Cloud backup found for ' + currentUser.email + '.\n\n' +
    'Click OK to LOAD the cloud data (recommended if you just logged in on a new device).\n\n' +
    'Click Cancel to OVERWRITE the cloud with this device\'s data.'
  );

  if (useCloud) {
    window.LedgerBridge.setState(data.data);
    lastPushedHash = JSON.stringify(data.data);
    lastPushedAt = Date.now();
    setStatus('ok', 'Loaded from cloud');
    showMessage(msg2El, 'Loaded cloud data');
  } else {
    await pushData();
  }
}

// ---------- PUSH to Supabase ----------
async function pushData() {
  if (!currentUser || isPushing) return;
  isPushing = true;
  setStatus('busy', 'Syncing...');

  const state = window.LedgerBridge.getState();
  const { error } = await supabase
    .from('ledger_data')
    .upsert(
      {
        user_id: currentUser.id,
        data: state,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('Push error:', error);
    setStatus('err', 'Sync error');
    showMessage(msg2El, error.message, true);
  } else {
    lastPushedHash = JSON.stringify(state);
    lastPushedAt = Date.now();
    setStatus('ok', 'Synced');
    showMessage(msg2El, 'Last sync: ' + new Date().toLocaleTimeString());
  }
  isPushing = false;
}

// ---------- PULL from Supabase ----------
async function pullData() {
  if (!currentUser) return;
  const { data, error } = await supabase
    .from('ledger_data')
    .select('data')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('Pull error:', error);
    setStatus('err', 'Sync error');
    return;
  }

  if (data && data.data) {
    window.LedgerBridge.setState(data.data);
    lastPushedHash = JSON.stringify(data.data);
    lastPushedAt = Date.now();
    setStatus('ok', 'Loaded from cloud');
  }
}

// ---------- MANUAL SYNC BUTTON ----------
syncNowBtn.addEventListener('click', async function () {
  await pullData();
  await pushData();
});

// ---------- AUTO-PUSH when local data changes ----------
setInterval(function () {
  if (!currentUser) return;
  const currentHash = JSON.stringify(window.LedgerBridge.getState());
  if (lastPushedHash === null) {
    lastPushedHash = currentHash;
    return;
  }
  if (currentHash !== lastPushedHash) {
    pushData();
  }
}, 3000);

// ---------- INITIAL SESSION CHECK ----------
supabase.auth.getSession().then(function (res) {
  const session = res.data.session;
  if (session && session.user) {
    currentUser = session.user;
    userEl.textContent = currentUser.email;
    signedIn.hidden = false;
    signedOut.hidden = true;
    setStatus('busy', 'Syncing...');
    initialSync();
  }
});
