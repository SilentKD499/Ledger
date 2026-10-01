// ============================================================
//  sync-boot.js - Supabase cloud sync for Bhakta Mithai
//  Loaded as a REGULAR script tag (no type="module").
//  Uses dynamic import() so it works in any browser.
// ============================================================

(function () {
  'use strict';

  // ====== PASTE YOUR SUPABASE CREDENTIALS HERE ======
  // Project URL only - NO trailing slash, NO /rest/v1
  var SUPABASE_URL = 'https://cfcizvsoxrhhfbdytihe.supabase.co';
  // anon public key from Supabase dashboard → Settings → API
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmY2l6dnNveHJoaGZiZHl0aWhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NjU5MjcsImV4cCI6MjEwNjQ0MTkyN30.ojR3qD9wNoZAV5lnsmoCUrHNmB1ZMybKX500FI6UXKg';
  // ==================================================

  // Load the Supabase library dynamically (avoids top-level import issues)
  import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(function (mod) {
      startSync(mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
    })
    .catch(function (err) {
      console.error('[sync] Failed to load Supabase library:', err);
    });

  function startSync(supabase) {
    var panel      = document.getElementById('syncPanel');
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

    if (!panel) {
      console.warn('[sync] Sync panel not in DOM. Skipping.');
      return;
    }

    var currentUser = null;
    var isPushing = false;
    var lastPushedHash = null;

    function setStatus(s, text) {
      dot.className = 'dot ' + s;
      label.textContent = text;
    }

    function showMessage(el, text, isError) {
      if (!el) return;
      el.textContent = text;
      el.className = isError ? 'err' : '';
    }

    // Panel open/close
    head.addEventListener('click', function () {
      panel.classList.toggle('open');
      chev.textContent = panel.classList.contains('open') ? '▴' : '▾';
    });

    // ----- Sign in (magic link) -----
    signInBtn.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email) { showMessage(msgEl, 'Enter your email', true); return; }
      setStatus('busy', 'Sending link...');
      supabase.auth.signInWithOtp({ email: email }).then(function (res) {
        if (res.error) {
          setStatus('err', 'Sign-in failed');
          showMessage(msgEl, res.error.message, true);
        } else {
          setStatus('ok', 'Check your email');
          showMessage(msgEl, 'Magic link sent! Check your inbox.');
        }
      });
    });

    // ----- Sign out -----
    signOutBtn.addEventListener('click', function () {
      supabase.auth.signOut().then(function () {
        currentUser = null;
        lastPushedHash = null;
        signedIn.hidden = true;
        signedOut.hidden = false;
        setStatus('', 'Sign in');
      });
    });

    // ----- Auth state change -----
    supabase.auth.onAuthStateChange(function (event, session) {
      if (session && session.user) {
        currentUser = session.user;
        userEl.textContent = currentUser.email;
        signedIn.hidden = false;
        signedOut.hidden = true;
        setStatus('busy', 'Syncing...');
        initialSync();
      } else {
        currentUser = null;
        signedIn.hidden = true;
        signedOut.hidden = false;
        setStatus('', 'Sign in');
      }
    });

    // ----- Initial sync after login -----
    function initialSync() {
      supabase
        .from('ledger_data')
        .select('data, updated_at')
        .eq('user_id', currentUser.id)
        .maybeSingle()
        .then(function (res) {
          if (res.error) {
            console.error('[sync] fetch error:', res.error);
            setStatus('err', 'Sync error');
            showMessage(msg2El, res.error.message, true);
            return;
          }
          var localState = window.LedgerBridge.getState();
          var hasLocal = Object.keys(localState.fyData || {}).length > 0 &&
            Object.keys(localState.fyData).some(function (k) {
              var d = localState.fyData[k];
              return d && ((d.sales && d.sales.length) ||
                           (d.expenses && d.expenses.length) ||
                           (d.employees && d.employees.length));
            });

          // No cloud row → push local up
          if (!res.data) {
            return pushData();
          }
          // Cloud has data, local empty → pull cloud down
          if (!hasLocal) {
            window.LedgerBridge.setState(res.data.data);
            lastPushedHash = JSON.stringify(res.data.data);
            setStatus('ok', 'Loaded from cloud');
            return;
          }
          // Both have data → ask user
          var useCloud = window.confirm(
            'Cloud backup found for ' + currentUser.email + '.\n\n' +
            'Click OK to LOAD the cloud data (recommended on a new device).\n' +
            'Click Cancel to OVERWRITE the cloud with THIS device\'s data.'
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

    // ----- Push to Supabase -----
    function pushData() {
      if (!currentUser || isPushing) return;
      isPushing = true;
      setStatus('busy', 'Syncing...');
      var state = window.LedgerBridge.getState();
      supabase
        .from('ledger_data')
        .upsert({
          user_id: currentUser.id,
          data: state,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
        .then(function (res) {
          isPushing = false;
          if (res.error) {
            console.error('[sync] push error:', res.error);
            setStatus('err', 'Sync error');
            showMessage(msg2El, res.error.message, true);
          } else {
            lastPushedHash = JSON.stringify(state);
            setStatus('ok', 'Synced');
            showMessage(msg2El, 'Last sync: ' + new Date().toLocaleTimeString());
          }
        });
    }

    // ----- Pull from Supabase -----
    function pullData() {
      if (!currentUser) return Promise.resolve();
      return supabase
        .from('ledger_data')
        .select('data')
        .eq('user_id', currentUser.id)
        .maybeSingle()
        .then(function (res) {
          if (res.error) {
            console.error('[sync] pull error:', res.error);
            setStatus('err', 'Sync error');
            return;
          }
          if (res.data && res.data.data) {
            window.LedgerBridge.setState(res.data.data);
            lastPushedHash = JSON.stringify(res.data.data);
            setStatus('ok', 'Loaded from cloud');
          }
        });
    }

    syncNowBtn.addEventListener('click', function () {
      pullData().then(function () { pushData(); });
    });

    // ----- Auto-push poll every 3 seconds -----
    setInterval(function () {
      if (!currentUser) return;
      var h = JSON.stringify(window.LedgerBridge.getState());
      if (lastPushedHash === null) { lastPushedHash = h; return; }
      if (h !== lastPushedHash) pushData();
    }, 3000);

    // ----- Resume existing session on load -----
    supabase.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (session && session.user) {
        currentUser = session.user;
        userEl.textContent = currentUser.email;
        signedIn.hidden = false;
        signedOut.hidden = true;
        setStatus('busy', 'Syncing...');
        initialSync();
      }
    });
  }
})();
