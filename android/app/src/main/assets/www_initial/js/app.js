/**
 * app.js — Web → APK Builder (v3)
 * 4-state machine: home → compare → changelog → done
 * Real-time progress via Socket.IO with polling fallback
 */

/* ── State ──────────────────────────────── */
let currentUrl    = '';
let diffData      = null;
let snapshotData  = null;
let socket        = null;

/* ── Socket.IO ──────────────────────────── */
try {
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('build-progress', (state) => {
    updateBuildProgress(state);
    if (state.status === 'done') setTimeout(() => showDone(state), 600);
    if (state.status === 'error') showBuildError(state.error);
  });
} catch { socket = null; }

/* ── Screen transitions ─────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  });
}

function goHome() {
  resetScanUI();
  showScreen('screen-home');
}

function goCompare() {
  showScreen('screen-compare');
}

/* ── SCAN ───────────────────────────────── */
async function startScan() {
  const input = document.getElementById('url-input');
  const url   = (input?.value || '').trim();

  if (!url.startsWith('http')) {
    showScanError('Please enter a valid URL starting with https://');
    return;
  }
  currentUrl = url;
  setScanLoading(true);
  clearScanError();

  try {
    const resp = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Scan failed');

    diffData     = data.diff;
    snapshotData = data.snapshot;
    populateCompare(url, data.snapshot, data.diff);
    showScreen('screen-compare');

  } catch (err) {
    showScanError(err.message || 'Could not connect to server.');
  } finally {
    setScanLoading(false);
  }
}

function setScanLoading(on) {
  const btn   = document.getElementById('btn-scan');
  const label = document.getElementById('scan-label');
  const prog  = document.getElementById('scan-progress');
  if (btn)   btn.disabled   = on;
  if (label) label.textContent = on ? 'Scanning...' : 'Scan';
  if (prog)  prog.classList.toggle('hidden', !on);
}

function showScanError(msg) {
  const row = document.getElementById('scan-error');
  const txt = document.getElementById('scan-error-msg');
  if (row) row.classList.remove('hidden');
  if (txt) txt.textContent = msg;
}
function clearScanError() {
  document.getElementById('scan-error')?.classList.add('hidden');
}
function resetScanUI() {
  setScanLoading(false);
  clearScanError();
  document.getElementById('build-progress-row')?.classList.add('hidden');
  document.getElementById('btn-build') && (document.getElementById('btn-build').disabled = false);
}

/* Enter key */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('url-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan();
  });
});

/* ── COMPARE screen ─────────────────────── */
function populateCompare(url, snapshot, diff) {
  setText('scanned-url',    url);
  setText('stat-added',     (diff.added    || []).length);
  setText('stat-modified',  (diff.modified || []).length);
  setText('stat-deleted',   (diff.deleted  || []).length);
  setText('stat-total',     snapshot?.fileCount ?? 0);
  setText('diff-summary-text', diff.isFirstScan
    ? `First scan — ${snapshot?.fileCount || 0} files indexed`
    : (diff.summary || 'Diff computed'));

  const list = document.getElementById('file-list');
  if (!list) return;
  list.innerHTML = '';

  const makeRows = (ids, tagClass, tagChar) => {
    ids.forEach(id => {
      const row = el('div', 'file-row');
      const tag = el('span', `file-tag ${tagClass}`);
      tag.textContent = tagChar;
      const name = el('span', 'file-name');
      name.textContent = id;
      row.appendChild(tag);
      row.appendChild(name);
      list.appendChild(row);
    });
  };

  makeRows(diff.added    || [], 'a', 'A');
  makeRows(diff.modified || [], 'm', 'M');
  makeRows(diff.deleted  || [], 'd', 'D');

  if (!list.children.length) {
    const empty = el('div', 'file-row');
    empty.style.color = 'var(--text-light)';
    empty.style.padding = '16px 10px';
    empty.textContent = 'No file changes detected.';
    list.appendChild(empty);
  }

  // Reset build UI
  document.getElementById('build-progress-row')?.classList.add('hidden');
  const buildBtn = document.getElementById('btn-build');
  if (buildBtn) buildBtn.disabled = false;
}

/* ── CHANGELOG screen ───────────────────── */
async function showChangelog() {
  setText('cl-url', currentUrl);
  showScreen('screen-changelog');

  const listEl = document.getElementById('changelog-list');
  listEl.innerHTML = '<div class="cl-empty">Loading changelog from database...</div>';

  try {
    const resp = await fetch(`/api/changelog?url=${encodeURIComponent(currentUrl)}`);
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Failed to load changelog');

    const logs = data.changelogs || [];
    renderChangelog(listEl, logs);
  } catch (err) {
    listEl.innerHTML = `<div class="cl-empty" style="color:var(--red)">${escHtml(err.message)}</div>`;
  }
}

function renderChangelog(container, logs) {
  container.innerHTML = '';

  if (!logs.length) {
    container.innerHTML = '<div class="cl-empty">No changelog entries yet.</div>';
    return;
  }

  logs.forEach((log, idx) => {
    const entry = el('div', 'cl-entry');
    const isFirst = !!log.is_first;
    const dateStr = log.created_at ? new Date(log.created_at).toLocaleString() : '—';

    const totalChanges = (log.added?.length||0) + (log.modified?.length||0) + (log.deleted?.length||0);
    const versionLabel = isFirst
      ? 'Initial Scan'
      : `Version ${logs.length - idx}`;

    // Header
    const header = el('div', 'cl-entry-header');
    header.innerHTML = `
      <div class="cl-version-block">
        <div class="cl-version-dot${isFirst ? ' first' : ''}"></div>
        <div class="cl-version-info">
          <div class="cl-version-title">${escHtml(versionLabel)}</div>
          <div class="cl-version-date">${escHtml(dateStr)}</div>
        </div>
      </div>
      <div class="cl-badges">
        ${(log.added?.length||0)    > 0 ? `<span class="cl-badge a">+${log.added.length}</span>` : ''}
        ${(log.modified?.length||0) > 0 ? `<span class="cl-badge m">~${log.modified.length}</span>` : ''}
        ${(log.deleted?.length||0)  > 0 ? `<span class="cl-badge d">-${log.deleted.length}</span>` : ''}
        ${totalChanges === 0 ? '<span style="font-size:11px;color:var(--text-light)">No changes</span>' : ''}
      </div>
      <svg class="cl-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
    `;

    // Body
    const body = el('div', 'cl-entry-body');
    body.innerHTML = buildFileSection('a', 'Added', log.added) +
                     buildFileSection('m', 'Modified', log.modified) +
                     buildFileSection('d', 'Removed', log.deleted);

    if (!body.innerHTML.trim()) {
      body.innerHTML = '<div style="color:var(--text-light);font-size:12px">No file changes in this scan.</div>';
    }

    // Toggle
    header.addEventListener('click', () => {
      entry.classList.toggle('open');
    });

    // Auto-open the first (latest) entry
    if (idx === 0) entry.classList.add('open');

    entry.appendChild(header);
    entry.appendChild(body);
    container.appendChild(entry);
  });
}

function buildFileSection(cls, title, files) {
  if (!files || !files.length) return '';
  const items = files.map(f => `<div class="cl-file-item">${escHtml(f)}</div>`).join('');
  return `
    <div class="cl-file-section">
      <div class="cl-file-section-title ${cls}">${title} (${files.length})</div>
      ${items}
    </div>`;
}

/* ── BUILD ──────────────────────────────── */
async function startBuild() {
  // Navigate to compare screen if on changelog
  if (!document.getElementById('screen-compare').classList.contains('active')) {
    showScreen('screen-compare');
    await new Promise(r => setTimeout(r, 100));
  }

  const buildBtn = document.getElementById('btn-build');
  if (buildBtn) buildBtn.disabled = true;
  document.getElementById('btn-changelog') && (document.getElementById('btn-changelog').disabled = true);
  document.getElementById('btn-assets')    && (document.getElementById('btn-assets').disabled    = true);

  const progRow = document.getElementById('build-progress-row');
  progRow?.classList.remove('hidden');
  setBuildBar(5, 'Sending build request...');

  try {
    const resp = await fetch('/api/build', { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Build failed to start');

    setBuildBar(15, 'Writing assets to Android project...');
    if (!socket) pollStatus();

  } catch (err) {
    progRow?.classList.add('hidden');
    if (buildBtn) buildBtn.disabled = false;
    alert('Build error: ' + err.message);
  }
}

async function pollStatus() {
  let tries = 0;
  const run = async () => {
    if (tries++ > 72) return; // ~6 min
    try {
      const resp  = await fetch('/api/status');
      const state = await resp.json();
      updateBuildProgress(state);
      if (state.status === 'done')  { showDone(state); return; }
      if (state.status === 'error') { showBuildError(state.error); return; }
    } catch {}
    setTimeout(run, 5000);
  };
  setTimeout(run, 3000);
}

function updateBuildProgress(state) {
  const pct = state.progress || 0;
  setBuildBar(pct, state.message || '');
}

function setBuildBar(pct, msg) {
  const bar  = document.getElementById('build-bar');
  const lbl  = document.getElementById('build-msg');
  const pctEl = document.getElementById('build-pct');
  if (bar)   bar.style.width     = pct + '%';
  if (lbl)   lbl.textContent     = msg;
  if (pctEl) pctEl.textContent   = pct + '%';
}

function showBuildError(msg) {
  setBuildBar(0, 'Build failed: ' + (msg || 'See server logs.'));
  const buildBtn = document.getElementById('btn-build');
  if (buildBtn) buildBtn.disabled = false;
}

/* ── DONE screen ────────────────────────── */
function showDone(state) {
  const apkReady  = state?.apkReady;
  const dlBtn     = document.getElementById('btn-download-apk');
  const titleEl   = document.getElementById('done-title');
  const subEl     = document.getElementById('done-subtitle');
  const metaEl    = document.getElementById('done-meta');

  if (apkReady) {
    let apkDownloadName = 'countriesmalaysiapage.apk';
    try {
      if (currentUrl) {
        const hostname = new URL(currentUrl).hostname;
        const cleanName = hostname.replace(/^www\./i, '').replace(/\./g, '').replace(/[^a-z0-9]/gi, '');
        if (cleanName) apkDownloadName = `${cleanName}.apk`;
      }
    } catch {}

    if (titleEl)  titleEl.textContent = 'APK Ready';
    if (subEl)    subEl.textContent   = 'Your Android app was built successfully.';
    if (dlBtn) {
      dlBtn.style.display = '';
      dlBtn.setAttribute('download', apkDownloadName);
      dlBtn.setAttribute('href', `/api/download?name=${encodeURIComponent(apkDownloadName)}&t=${Date.now()}`);
    }
    const iosBtn = document.getElementById('btn-download-ios');
    if (iosBtn) {
      const iosName = (apkDownloadName.replace(/\.apk$/, '') || 'countriesmalaysiapage') + '-ios.zip';
      iosBtn.setAttribute('download', iosName);
      iosBtn.setAttribute('href', `/api/download-ios?url=${encodeURIComponent(currentUrl)}&name=${encodeURIComponent(iosName)}&t=${Date.now()}`);
    }
    if (metaEl)   metaEl.innerHTML = `
      <strong>Source URL:</strong> ${escHtml(currentUrl)}<br/>
      <strong>Changes:</strong> ${diffSummaryStr()}<br/>
      <strong>Output:</strong> ${escHtml(apkDownloadName)} (debug-signed, sideload-ready)
    `;
  } else {
    if (titleEl)  titleEl.textContent = 'Assets Ready';
    if (subEl)    subEl.textContent   = 'Android SDK not detected — download the assets ZIP to build manually in Android Studio.';
    if (dlBtn)    dlBtn.style.display = 'none';
    if (metaEl)   metaEl.innerHTML = `
      <strong>Source URL:</strong> ${escHtml(currentUrl)}<br/>
      <strong>Note:</strong> ${escHtml(state?.message || 'Assets synced.')}<br/>
      <strong>Tip:</strong> Open /android in Android Studio → Run → assembleDebug
    `;
    // Auto-trigger assets download
    setTimeout(() => { window.location.href = '/api/download-assets'; }, 1500);
  }

  showScreen('screen-done');
}

function diffSummaryStr() {
  if (!diffData) return '—';
  const a = (diffData.added||[]).length;
  const m = (diffData.modified||[]).length;
  const d = (diffData.deleted||[]).length;
  return `${a} added, ${m} modified, ${d} removed`;
}

/* ── Assets & iOS fallback ─────────────── */
function downloadAssets() {
  window.location.href = '/api/download-assets';
}

function downloadIOSProject() {
  const urlParam = currentUrl ? `?url=${encodeURIComponent(currentUrl)}` : '';
  window.location.href = `/api/download-ios${urlParam}&t=${Date.now()}`;
}

/* ── Utils ──────────────────────────────── */
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function setText(id, val) {
  const e = document.getElementById(id);
  if (e) e.textContent = val;
}
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
