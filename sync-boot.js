// ============================================================
//  sync-boot.js — Cloud sync for the Ledger app
//  Uses Supabase (free tier) for auth + database
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ====== 1. REPLACE THESE WITH YOUR OWN SUPABASE CREDENTIALS ======
const SUPABASE_URL     = 'https://cfcizvsoxrhhfbdytihe.supabase.co/rest/v1/';       // e.g. https://abc.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmY2l6dnNveHJoaGZiZHl0aWhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NjU5MjcsImV4cCI6MjEwNjQ0MTkyN30.ojR3qD9wNoZAV5lnsmoCUrHNmB1ZMybKX500FI6UXKg';         // the long eyJ... string
// ================================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- UI element references ----------
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

let currentUser = null;
let syncInProgress = false;

// ---------- Panel open/close ----------
head.addEventListener('click', () => {
  panel.classList.toggle('open');
  chev.textContent = panel.classList.contains('open') ? '▴' : '▾';
});

function setStatus(state, text) {
  dot.className = 'dot ' + state;
  label.textContent = text;
}

function showMessage(el, text, isError = false) {
  el.textContent = text;
  el.className = isError ? 'err' : '';
}

// ---------- SIGN IN (magic link) ----------
signInBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) return showMessage(msgEl, 'Enter your email', true);
  setStatus('busy', 'Sending link...');
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) {
    setStatus('err', 'Sign-in failed');
    showMessage(msgEl, error.message, true);
  } else {
    setStatus('ok', 'Check your email');
    showMessage(msgEl, 'Magic link sent! Check your inbox.');
  }
});

// ---------- SIGN OUT ----------
signOutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentUser = null;
  signedIn.hidden = true;
  signedOut.hidden = false;
  setStatus('', 'Sign in');
});

// ---------- AUTH STATE LISTENER ----------
// This fires when the user logs in (after clicking the magic link)
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session && session.user) {
    currentUser = session.user;
    userEl.textContent = currentUser.email;
    signedIn.hidden = false;
    signedOut.hidden = true;
    setStatus('busy', 'Syncing...');
    await pullAndMerge();      // pull cloud data, merge with local
    await pushData();           // push merged data back to cloud
    setStatus('ok', 'Synced');
  } else {
    currentUser = null;
    signedIn.hidden = true;
    signedOut.hidden = false;
    setStatus('', 'Sign in');
  }
});

// ---------- MERGE LOGIC ----------
// Combines local and remote data. Newer updatedAt wins.
function mergeStates(local, remote) {
  if (!remote || !remote.transactions) return local;
  const map = new Map();

  // Start with remote transactions
  remote.transactions.forEach(t => map.set(t.id, t));

  // Override with local ones that are newer
  local.transactions.forEach(lt => {
    const rt = map.get(lt.id);
    if (!rt) {
      map.set(lt.id, lt);
    } else {
      const localTime  = lt.updatedAt || 0;
      const remoteTime = rt.updatedAt || 0;
      if (localTime > remoteTime) map.set(lt.id, lt);
    }
  });

  return {
    transactions: Array.from(map.values()),
    settings: { ...remote.settings, ...local.settings }
  };
}

// ---------- PULL from Supabase ----------
async function pullAndMerge() {
  if (!currentUser) return;
  const { data, error } = await supabase
    .from('ledger_data')
    .select('data')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('Pull error', error);
    setStatus('err', 'Sync error');
    return;
  }

  const localState  = window.LedgerBridge.getState();
  const remoteState = data ? data.data : null;
  const merged      = mergeStates(localState, remoteState);

  window.LedgerBridge.setState(merged);
}

// ---------- PUSH to Supabase ----------
async function pushData() {
  if (!currentUser || syncInProgress) return;
  syncInProgress = true;
  setStatus('busy', 'Syncing...');

  const localState = window.LedgerBridge.getState();
  const { error } = await supabase
    .from('ledger_data')
    .upsert({
      user_id: currentUser.id,
      data: localState,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('Push error', error);
    setStatus('err', 'Sync error');
    showMessage(msg2El, error.message, true);
  } else {
    setStatus('ok', 'Synced');
    showMessage(msg2El, 'Last sync: ' + new Date().toLocaleTimeString());
  }
  syncInProgress = false;
}

// ---------- MANUAL SYNC BUTTON ----------
syncNowBtn.addEventListener('click', async () => {
  await pullAndMerge();
  await pushData();
});

// ---------- AUTO-PUSH when local data changes ----------
let lastStateHash = JSON.stringify(window.LedgerBridge.getState());
setInterval(() => {
  if (!currentUser) return;
  const currentHash = JSON.stringify(window.LedgerBridge.getState());
  if (currentHash !== lastStateHash) {
    lastStateHash = currentHash;
    pushData();
  }
}, 3000);   // checks every 3 seconds

// ---------- PULL when tab becomes visible ----------
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) pullAndMerge();
});

// ---------- INITIAL SESSION CHECK ----------
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session && session.user) {
    currentUser = session.user;
    userEl.textContent = currentUser.email;
    signedIn.hidden = false;
    signedOut.hidden = true;
    pullAndMerge().then(() => pushData());
  }
});
