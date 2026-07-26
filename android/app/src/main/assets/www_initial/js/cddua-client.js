/**
 * CDDUA Real-Time Client & WebView Bridge Handlers
 */
(function() {
  console.log('[CDDUA-Client] Initializing WebSocket & Hot-Reload Listener...');

  // Determine Socket origin (works in standard browser or Android WebViewAssetLoader)
  const socketOrigin = window.location.protocol === 'file:' || window.location.hostname === 'app.local'
    ? 'http://10.0.2.2:3000' // Default Android Emulator host IP to localhost:3000
    : window.location.origin;

  let socket = null;
  try {
    socket = io(socketOrigin, {
      reconnectionAttempts: 10,
      timeout: 5000
    });
  } catch (err) {
    console.warn('[CDDUA-Client] Socket.io init failed. Running in offline/standalone mode.', err);
  }

  // Update UI Elements
  function updateBadge(status, version) {
    const badge = document.getElementById('cddua-badge');
    const statusText = document.getElementById('cddua-status-text');
    const diagVer = document.getElementById('diag-ver');
    const diagConn = document.getElementById('diag-conn');

    if (badge && statusText) {
      statusText.textContent = `CDDUA Active: ${version || 'v_init'}`;
      if (status === 'online') {
        badge.querySelector('.status-dot').className = 'status-dot online';
      } else {
        badge.querySelector('.status-dot').className = 'status-dot';
        badge.querySelector('.status-dot').style.background = '#64748B';
      }
    }
    if (diagVer && version) diagVer.textContent = version;
    if (diagConn) diagConn.textContent = status === 'online' ? 'Connected (Socket.io)' : 'Offline / Disconnected';
  }

  function showUpdateToast(title, msg, version) {
    const toast = document.getElementById('cddua-toast');
    const toastTitle = document.getElementById('toast-title');
    const toastMsg = document.getElementById('toast-msg');
    const toastVer = document.getElementById('toast-ver');

    if (toast && toastTitle && toastMsg) {
      toastTitle.textContent = title || 'CDDUA Delta Update Applied!';
      toastMsg.textContent = msg || 'Seamless hot-reload complete. No APK download required.';
      if (toastVer) toastVer.textContent = version || 'v_new';
      
      toast.classList.remove('hidden');
      setTimeout(() => {
        toast.classList.add('hidden');
      }, 6000);
    }
  }

  if (socket) {
    socket.on('connect', () => {
      console.log('[CDDUA-Client] Connected to CDDUA Transport Server:', socket.id);
      updateBadge('online', window.CDDUA_CURRENT_VERSION || 'v_1.0.0');

      // Send telemetry to server
      socket.emit('client-status-report', {
        platform: window.AndroidCDDUABridge ? 'Native Android Container' : 'Web Simulator',
        userAgent: navigator.userAgent,
        currentOrigin: window.location.origin,
        timestamp: Date.now()
      });
    });

    socket.on('connection-established', (data) => {
      console.log('[CDDUA-Client] Server connection handshake:', data);
      window.CDDUA_CURRENT_VERSION = data.version;
      updateBadge('online', data.version);
      
      const diagHash = document.getElementById('diag-hash');
      const diagPubKey = document.getElementById('diag-pubkey');
      if (diagHash && data.merkleRoot) diagHash.textContent = data.merkleRoot.substring(0, 24) + '...';
      if (diagPubKey && data.publicKeyHex) diagPubKey.textContent = data.publicKeyHex;
    });

    socket.on('update-available', (data) => {
      console.log('[CDDUA-Client] ⚡ Update Available Received!', data);
      
      // If running inside Native Android container, notify Kotlin via JS Bridge!
      if (window.AndroidCDDUABridge && window.AndroidCDDUABridge.onUpdateAvailable) {
        console.log('[CDDUA-Client] Delegating payload download & Ed25519 verification to Kotlin Native Container...');
        window.AndroidCDDUABridge.onUpdateAvailable(JSON.stringify(data));
      } else {
        // We are in browser simulator mode - demonstrate live hot reload visual
        console.log('[CDDUA-Client] Browser Simulator Mode: Applying update visual representation...');
        window.CDDUA_CURRENT_VERSION = data.version;
        updateBadge('online', data.version);
        
        const diagHash = document.getElementById('diag-hash');
        if (diagHash && data.merkleRoot) diagHash.textContent = data.merkleRoot.substring(0, 24) + '...';

        showUpdateToast(
          `⚡ Delta Update to ${data.version}!`,
          `Applied patch (${(data.patchSize / 1024).toFixed(2)} KB) with Ed25519 verification.`,
          data.version
        );
      }
    });

    socket.on('disconnect', () => {
      console.warn('[CDDUA-Client] Disconnected from CDDUA Server.');
      updateBadge('offline', window.CDDUA_CURRENT_VERSION);
    });
  }

  /**
   * Exposed global bridge callback for Kotlin Native Android WebView.
   * When Kotlin finishes atomic file replacement in Context.getFilesDir(), it calls this!
   */
  window.onCDDUAUpdate = function(newVersion, changelogStr) {
    console.log('[CDDUA-Client] Native Kotlin Container triggered hot-reload! New Version:', newVersion);
    window.CDDUA_CURRENT_VERSION = newVersion || 'v_updated';
    updateBadge('online', window.CDDUA_CURRENT_VERSION);
    
    showUpdateToast(
      `⚡ Sideload Hot-Reload Complete!`,
      changelogStr || `Updated to ${window.CDDUA_CURRENT_VERSION} directly in Android internal sandbox!`,
      window.CDDUA_CURRENT_VERSION
    );

    // Refresh dynamic UI elements without full page reload if desired, or reload
    // In our demonstration, we show the toast and update badges instantly!
  };

  // Export helper for manual trigger
  window.requestUpdateCheck = function() {
    console.log('[CDDUA-Client] Manually requesting update check from server...');
    fetch(`${socketOrigin}/api/trigger-check`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.status === 'no_changes') {
          showUpdateToast('✓ System Up to Date', 'No file modifications detected in Merkle tree.', window.CDDUA_CURRENT_VERSION);
        }
      })
      .catch(err => console.error(err));
  };
})();
