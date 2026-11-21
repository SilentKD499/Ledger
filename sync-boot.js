// ============================================================
//  sync-boot.js — Supabase cloud sync for Bhakta Mithai
//  Uses the shared ledger_state row (id = 'main').
//  Optimistic locking via ledger_state.version prevents
//  the two admins from silently overwriting each other.
// ============================================================

(function () {
  'use strict';

  // ====== Supabase credentials (project URL + anon key only) ======
  var SUPABASE_URL      = 'https://cfcizvsoxrhhfbdytihe.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmY2l6dnNveHJoaGZiZHl0aWhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NjU5MjcsImV4cCI6MjEwNjQ0MTkyN30.ojR3qD9wNoZAV5lnsmoCUrHNmB1ZMybKX500FI6UXKg';
  // ===============================================================

  import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(function (mod) { startSync(mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)); })
    .catch(function (err) { console.error('[sync] Failed to load Supabase:', err); });

  function startSync(supabase) {
    var panel      = document.getElementById('syncPanel');
    if (!panel) { console.warn('[sync] Sync panel not in DOM. Skipping.'); return; }

    var head       = document.getElementById('syncHead');
    var dot        = document.getElementById('syncDot');
    var label      = document.getElementById('syncLabel');
    var chev       = document.getElementById('syncChev');
    var signedOut  = document.getElementById('syncSignedOut');
    var signedIn   = document.getElementById('syncSignedIn');
    var emailInput = document.getElementById('syncEmail');
    var signInBtn  = document.getElementById('syncSignIn');
    var signOutBtn = document.getElementById('syncSignOut');
    var syncNowBtn = document.getElementById('syncNow');
    var userEl     = document.getElementById('syncUser');
    var msgEl      = document.getElementById('syncMsg');
    var msg2El     = document.getElementById('syncMsg2');

    var currentUser     = null;
    var isPushing       = false;
    var lastPushedHash  = null;
    var cloudVersion    = 0;   // ledger_state.version we last saw

    function setStatus(s, text) { dot.className = 'dot ' + s; label.textContent = text; }
    function showMsg(el, text, isError) { if (!el) return; el.textContent = text; el.className = isError ? 'err' : ''; }

    // ---- Panel open / close ----
    head.addEventListener('click', function () {
      panel.classList.toggle('open');
      chev.textContent = panel.classList.contains('open') ? '▴' : '▾';
    });

    // ---- Sign in (magic link) ----
    signInBtn.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email) { showMsg(msgEl, 'Enter your email', true); return; }
      setStatus('busy', 'Sending link...');
      supabase.auth.signInWithOtp({ email: email }).then(function (res) {
        if (res.error) { setStatus('err', 'Sign-in failed'); showMsg(msgEl, res.error.message, true); }
        else           { setStatus('ok', 'Check your email'); showMsg(msgEl, 'Magic link sent! Check your inbox.'); }
      });
    });

    // ---- Sign out ----
    signOutBtn.addEventListener('click', function () {
      supabase.auth.signOut().then(function () {
        currentUser = null; lastPushedHash = null; cloudVersion = 0;
        signedIn.hidden = true; signedOut.hidden = false;
        setStatus('', 'Sign in');
      });
    });

    // ---- Auth state ----
    supabase.auth.onAuthStateChange(function (event, session) {
      if (session && session.user) {
        currentUser = session.user;
        userEl.textContent = currentUser.email;
        signedIn.hidden = false; signedOut.hidden = true;
        setStatus('busy', 'Syncing...');
        initialSync();
      } else {
        currentUser = null;
        signedIn.hidden = true; signedOut.hidden = false;
        setStatus('', 'Sign in');
      }
    });

    // ============================================================
    //  Helpers
    // ============================================================
    function fetchCloud() {
      return supabase.from('ledger_state').select('*').eq('id', 'main').maybeSingle();
    }

    function stateHasData(state) {
      if (!state || !state.fyData) return false;
      return Object.keys(state.fyData).some(function (k) {
        var d = state.fyData[k];
        return d && ((d.sales && d.sales.length) || (d.expenses && d.expenses.length) || (d.employees && d.employees.length));
      });
    }

    // ============================================================
    //  Initial sync (after login)
    // ============================================================
    function initialSync() {
      fetchCloud().then(function (res) {
        if (res.error) {
          console.error('[sync] fetch error:', res.error);
          setStatus('err', 'Sync error');
          showMsg(msg2El, res.error.message, true);
          return;
        }

        var localState = window.LedgerBridge.getState();
        var hasLocal   = stateHasData(localState);

        // Cloud row doesn't exist yet
        if (!res.data) {
          cloudVersion = 0;
          return pushData();
        }

        cloudVersion = res.data.version || 0;
        var hasCloud = stateHasData(res.data.data);

        // Local empty, cloud has data → load
        if (!hasLocal) {
          window.LedgerBridge.setState(res.data.data);
          lastPushedHash = JSON.stringify(res.data.data);
          setStatus('ok', 'Loaded from cloud');
          return;
        }

        // Cloud empty, local has data → push
        if (!hasCloud) { return pushData(); }

        // Both have data — ask user
        var when = res.data.updated_at ? new Date(res.data.updated_at).toLocaleString() : 'unknown';
        var useCloud = window.confirm(
          'Both this device and the cloud have data.\n\n' +
          'Cloud last updated: ' + when + '\n\n' +
          'OK  = LOAD cloud data onto this device (safe, recommended on a new device)\n' +
          'Cancel = OVERWRITE the cloud with this device\'s data (destructive — other admin\'s changes lost)'
        );

        if (useCloud) {
          window.LedgerBridge.setState(res.data.data);
          lastPushedHash = JSON.stringify(res.data.data);
          setStatus('ok', 'Loaded from cloud');
        } else {
          pushData();
        }
      });
    }

    // ============================================================
    //  Push with optimistic lock (version check)
    // ============================================================
    function pushData() {
      if (!currentUser || isPushing) return;
      isPushing = true;
      setStatus('busy', 'Syncing...');

      var state = window.LedgerBridge.getState();
      var hash  = JSON.stringify(state);
      var op;

      if (cloudVersion === 0) {
        // First push — create the shared row
        op = supabase.from('ledger_state').insert({
          id: 'main',
          data: state,
          version: 1,
          updated_at: new Date().toISOString(),
          updated_by: currentUser.id
        }).select();
      } else {
        // Update only if version matches (optimistic lock)
        op = supabase.from('ledger_state').update({
          data: state,
          version: cloudVersion + 1,
          updated_at: new Date().toISOString(),
          updated_by: currentUser.id
        }).eq('id', 'main').eq('version', cloudVersion).select();
      }

      op.then(function (res) {
        isPushing = false;

        if (res.error) {
          console.error('[sync] push error:', res.error);
          setStatus('err', 'Sync error');
          showMsg(msg2El, res.error.message, true);
          return;
        }

        // Success — one row returned
        if (res.data && res.data.length > 0) {
          cloudVersion   = res.data[0].version;
          lastPushedHash = hash;
          setStatus('ok', 'Synced');
          showMsg(msg2El, 'Last sync: ' + new Date().toLocaleTimeString());
          return;
        }

        // 0 rows → version conflict (someone else pushed)
        setStatus('busy', 'Conflict — pulling latest...');
        fetchCloud().then(function (r) {
          if (r.error || !r.data) {
            setStatus('err', 'Conflict');
            showMsg(msg2El, 'Conflict could not be resolved. Try Sync now again.', true);
            return;
          }

          cloudVersion = r.data.version || 0;
          var theirs = r.data.data;
          var when   = r.data.updated_at ? new Date(r.data.updated_at).toLocaleString() : 'unknown';

          var useTheirs = window.confirm(
            'Another admin updated the cloud at ' + when + '.\n\n' +
            'OK  = LOAD their version (your recent changes on this device are discarded)\n' +
            'Cancel = OVERWRITE with your current data (their changes lost)'
          );

          if (useTheirs) {
            window.LedgerBridge.setState(theirs);
            lastPushedHash = JSON.stringify(theirs);
            setStatus('ok', 'Loaded latest');
          } else {
            // Retry push with the fresh version
            pushData();
          }
        });
      });
    }

    // ============================================================
    //  "Sync now" — pull if remote changed, otherwise push
    // ============================================================
    syncNowBtn.addEventListener('click', function () {
      if (!currentUser) return;
      setStatus('busy', 'Checking cloud...');
      fetchCloud().then(function (res) {
        if (res.error) {
          setStatus('err', 'Sync error');
          showMsg(msg2El, res.error.message, true);
          return;
        }
        // No cloud row yet → create it from local
        if (!res.data) { return pushData(); }

        // Cloud row exists and is newer → ask
        if ((res.data.version || 0) > cloudVersion) {
          var when = res.data.updated_at ? new Date(res.data.updated_at).toLocaleString() : 'unknown';
          var load = window.confirm(
            'Cloud was updated by another admin at ' + when + '.\n\n' +
            'OK  = LOAD their version\n' +
            'Cancel = OVERWRITE with your current data'
          );
          if (load) {
            cloudVersion = res.data.version;
            window.LedgerBridge.setState(res.data.data);
            lastPushedHash = JSON.stringify(res.data.data);
            setStatus('ok', 'Loaded latest');
            return;
          }
        }
        // Otherwise push local
        pushData();
      });
    });

    // ============================================================
    //  Auto-push poll — every 3 s, only if local state changed
    // ============================================================
    setInterval(function () {
      if (!currentUser || isPushing) return;
      var h = JSON.stringify(window.LedgerBridge.getState());
      if (lastPushedHash === null) { lastPushedHash = h; return; }
      if (h !== lastPushedHash) pushData();
    }, 3000);

    // ============================================================
    //  Resume existing session on load
    // ============================================================
    supabase.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (session && session.user) {
        currentUser = session.user;
        userEl.textContent = currentUser.email;
        signedIn.hidden = false; signedOut.hidden = true;
        setStatus('busy', 'Syncing...');
        initialSync();
      }
    });
  }
})();
