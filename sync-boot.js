        .catch(function (err) {
          isPushing = false;   // without this, one offline push froze syncing until reload
          console.error('[sync] push failed:', err);
          setStatus('err', 'Offline — will retry');
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
        if (syncedForUser !== currentUser.id) { syncedForUser = currentUser.id; initialSync(); }
      }
    });
  }
})();
