/**
 * CDDUA Admin & Simulation Console Logic
 */
let currentSelectedPath = null;
let currentManifest = null;
let socket = null;
let activeClientsMap = new Map();

document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  refreshManifest();
  refreshStatus();
});

function initSocket() {
  socket = io();

  socket.on('connect', () => {
    addLog('system', 'Connected to CDDUA WebSocket Telemetry Stream.');
  });

  socket.on('admin-log', (data) => {
    if (data.type === 'file_event') {
      addLog('file', `[Chokidar Watcher] File ${data.event.toUpperCase()}: ${data.path}`);
    } else if (data.type === 'patch_broadcast') {
      const p = data.payload;
      addLog('patch', `⚡ [DELTA BROADCAST] ${p.oldVersion || 'init'} -> ${p.version} | Hash: ${p.hash.substring(0,16)}... | Size: ${(p.patchSize/1024).toFixed(2)} KB`);
      refreshManifest();
      refreshStatus();
    }
  });

  socket.on('admin-client-update', (data) => {
    activeClientsMap.set(data.socketId, data);
    renderClients();
    addLog('client', `[Client Telemetry] ${data.platform} (${data.socketId}) reported in.`);
  });

  socket.on('admin-client-disconnected', (data) => {
    activeClientsMap.delete(data.socketId);
    renderClients();
    addLog('client', `[Client Disconnected] ${data.socketId}`);
  });

  socket.on('update-available', (data) => {
    addLog('patch', `⚡ [Update Ping Received] New Merkle Root: ${data.merkleRoot.substring(0, 16)}...`);
  });
}

function addLog(type, msg) {
  const logsDiv = document.getElementById('event-logs');
  if (!logsDiv) return;

  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  const timeStr = new Date().toLocaleTimeString();
  item.innerHTML = `<span class="log-time">[${timeStr}]</span> ${msg}`;
  
  logsDiv.insertBefore(item, logsDiv.firstChild);
}

function refreshManifest() {
  fetch('/api/manifest')
    .then(r => r.json())
    .then(data => {
      currentManifest = data;
      renderMerkleTree(data);
      document.getElementById('stat-ver').textContent = data.version;
    })
    .catch(err => addLog('system', `Error fetching manifest: ${err.message}`));
}

function refreshStatus() {
  fetch('/api/status')
    .then(r => r.json())
    .then(data => {
      document.getElementById('stat-ver').textContent = data.version || 'N/A';
      document.getElementById('stat-clients').textContent = data.activeClients || 0;
    })
    .catch(err => console.error(err));
}

function renderMerkleTree(manifest) {
  const container = document.getElementById('merkle-tree-list');
  if (!container || !manifest || !manifest.files) return;

  container.innerHTML = '';
  const files = manifest.files;
  const sortedPaths = Object.keys(files).sort();

  sortedPaths.forEach(relPath => {
    const fileData = files[relPath];
    const item = document.createElement('div');
    item.className = 'file-item';
    if (relPath === currentSelectedPath) item.classList.add('active');

    item.innerHTML = `
      <div class="file-path">
        <span><i data-lucide="file-code"></i> ${relPath}</span>
        <span class="hash-tag">${fileData.hash.substring(0, 8)}...</span>
      </div>
      <div class="file-meta">
        <span>Size: ${(fileData.size / 1024).toFixed(2)} KB</span>
        <span>SHA-256 Verified</span>
      </div>
    `;

    item.onclick = () => selectFile(relPath);
    container.appendChild(item);
  });

  if (window.lucide) lucide.createIcons();
}

function selectFile(relPath) {
  currentSelectedPath = relPath;
  document.getElementById('editing-file-badge').textContent = relPath;
  document.getElementById('save-btn').disabled = false;

  // Highlight in list
  document.querySelectorAll('.file-item').forEach(el => {
    el.classList.remove('active');
    if (el.textContent.includes(relPath)) el.classList.add('active');
  });

  addLog('file', `Reading file from disk: ${relPath}...`);
  fetch(`/api/admin/read-file?path=${encodeURIComponent(relPath)}`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('file-editor').value = data.content || '';
    })
    .catch(err => addLog('system', `Error reading file: ${err.message}`));
}

function saveFileChanges() {
  if (!currentSelectedPath) return;
  const content = document.getElementById('file-editor').value;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader"></i> Saving & Diffing...`;

  addLog('file', `Saving edits to ${currentSelectedPath} and triggering delta diff...`);

  fetch('/api/admin/update-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath: currentSelectedPath, content: content })
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        addLog('patch', `✓ File written to /webapp. Chokidar watcher is generating Merkle delta...`);
      } else {
        addLog('system', `Error saving file: ${data.error}`);
      }
    })
    .catch(err => addLog('system', `Network error: ${err.message}`))
    .finally(() => {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="zap"></i> Save & Broadcast Delta Patch to Clients`;
        if (window.lucide) lucide.createIcons();
      }, 1000);
    });
}

function applyPreset(presetType) {
  if (!currentSelectedPath && presetType !== 'add-announcement') {
    // Automatically select appropriate file
    if (presetType === 'css-color') selectFile('css/style.css');
    if (presetType === 'hero-text') selectFile('index.html');
  }

  setTimeout(() => {
    const editor = document.getElementById('file-editor');
    let content = editor.value;

    if (presetType === 'css-color') {
      if (!currentSelectedPath.endsWith('.css')) {
        alert('Please select css/style.css first!');
        return;
      }
      // Switch cyber cyan/purple accent colors to Neon Emerald & Gold
      if (content.includes('--accent-cyan: #00F2FE;')) {
        content = content.replace('--accent-cyan: #00F2FE;', '--accent-cyan: #00FF88;');
        content = content.replace('--accent-purple: #6366F1;', '--accent-purple: #FF9F00;');
        addLog('file', 'Applied Preset: Cyber Cyan -> Neon Emerald & Gold.');
      } else {
        content = content.replace(/--accent-cyan: #[0-9A-Fa-f]+;/g, '--accent-cyan: #00F2FE;');
        content = content.replace(/--accent-purple: #[0-9A-Fa-f]+;/g, '--accent-purple: #6366F1;');
        addLog('file', 'Applied Preset: Reset to Original Cyber Colors.');
      }
      editor.value = content;
    } else if (presetType === 'hero-text') {
      if (!currentSelectedPath.endsWith('.html')) {
        alert('Please select index.html first!');
        return;
      }
      const newTitle = `Instant Sideload Updates (Hot-Reloaded at ${new Date().toLocaleTimeString()})`;
      content = content.replace(/<h2>.*?<\/h2>/, `<h2>${newTitle}<\/h2>`);
      editor.value = content;
      addLog('file', 'Applied Preset: Updated Hero Title with Timestamp.');
    } else if (presetType === 'add-announcement') {
      if (!currentSelectedPath || !currentSelectedPath.endsWith('.html')) {
        selectFile('index.html');
        setTimeout(() => applyPreset('add-announcement'), 300);
        return;
      }
      const newCard = `
            <!-- Live Broadcast Post -->
            <div class="glass-card feed-post" style="border-color: var(--accent-cyan);">
              <div class="post-header">
                <div class="logo-icon" style="width:36px;height:36px;"><i data-lucide="zap"></i></div>
                <div>
                  <h4 class="author-name" style="color: var(--accent-cyan);">CDDUA Automated System <span class="badge badge-sec">LIVE BROADCAST</span></h4>
                  <span class="post-time">Just now • Algorithmic Diffing Engine</span>
                </div>
              </div>
              <p class="post-body">
                ⚡ A new delta patch was just broadcasted from the R&D Console! Notice how this DOM element was injected into your running app without restarting or downloading an APK!
              </p>
            </div>`;
      content = content.replace(/<div class="main-feed">/, `<div class="main-feed">\n${newCard}`);
      editor.value = content;
      addLog('file', 'Applied Preset: Injected Live Broadcast Card into Community Feed.');
    }
  }, 200);
}

function renderClients() {
  const container = document.getElementById('clients-list');
  const numSpan = document.getElementById('client-count-num');
  if (!container) return;

  numSpan.textContent = activeClientsMap.size;
  if (activeClientsMap.size === 0) {
    container.innerHTML = `<div class="empty-state">No clients connected yet. Open /webapp in a tab or launch Android APK!</div>`;
    return;
  }

  container.innerHTML = '';
  activeClientsMap.forEach((data, socketId) => {
    const div = document.createElement('div');
    div.className = 'client-box';
    div.innerHTML = `
      <div>
        <strong>${data.platform || 'Web Container'}</strong><br>
        <span style="font-size:0.7rem; color:var(--text-sub);">${socketId}</span>
      </div>
      <span class="badge badge-sec">Online</span>
    `;
    container.appendChild(div);
  });
}

function clearLogs() {
  const logsDiv = document.getElementById('event-logs');
  if (logsDiv) logsDiv.innerHTML = '';
}
