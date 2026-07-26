/**
 * scraper.js — URL Asset Scraper
 * Fetches HTML, CSS, JS (and linked sub-assets) from a given URL.
 * Stores snapshots as JSON for Merkle-based diffing.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');

const SNAPSHOTS_DIR = path.join(__dirname, '../../server/snapshots');
const SCRAPED_DIR   = path.join(__dirname, '../../server/scraped_assets');

function ensureDirs() {
  [SNAPSHOTS_DIR, SCRAPED_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

/**
 * Safely resolve a relative or absolute asset href against the base URL.
 */
function resolveUrl(base, href) {
  if (!href || href.startsWith('data:') || href.startsWith('blob:')) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Download a single URL, returning { url, content, contentType, hash }.
 * Returns null on error.
 */
async function fetchOne(url, timeout = 10000) {
  try {
    const resp = await axios.get(url, {
      timeout,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 WebToAPK-Scraper/1.0' },
      maxRedirects: 5,
    });
    const buffer = Buffer.from(resp.data);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const contentType = (resp.headers['content-type'] || '').split(';')[0].trim();
    return { url, content: buffer.toString('utf-8'), contentType, hash, size: buffer.length };
  } catch (err) {
    console.warn(`[Scraper] Could not fetch ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Main entry point.
 * @param {string} targetUrl  The website URL to scrape
 * @returns {object} snapshot meta + file list
 */
async function scrapeUrl(targetUrl) {
  ensureDirs();

  console.log(`[Scraper] Starting scrape: ${targetUrl}`);

  // 1. Fetch main HTML
  const mainPage = await fetchOne(targetUrl);
  if (!mainPage) throw new Error(`Could not reach ${targetUrl}`);

  const $ = cheerio.load(mainPage.content);
  const baseUrl = targetUrl;

  // 2. Detect site icon / favicon
  let faviconUrl = null;
  // Try apple-touch-icon first (highest quality)
  const touchIcon = $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').first().attr('href');
  if (touchIcon) faviconUrl = resolveUrl(baseUrl, touchIcon);
  // Then largest declared icon
  if (!faviconUrl) {
    let bestSize = 0;
    $('link[rel~="icon"]').each((_, el) => {
      const href = $(el).attr('href');
      const sizes = $(el).attr('sizes') || '';
      const sizeNum = parseInt(sizes.split('x')[0]) || 0;
      if (href && sizeNum >= bestSize) {
        const resolved = resolveUrl(baseUrl, href);
        if (resolved) { faviconUrl = resolved; bestSize = sizeNum; }
      }
    });
  }
  // Last resort: /favicon.ico
  if (!faviconUrl) {
    const defaultFavicon = new URL('/favicon.ico', baseUrl).toString();
    const test = await fetchOne(defaultFavicon, 5000);
    if (test) faviconUrl = defaultFavicon;
  }
  console.log(`[Scraper] Favicon URL: ${faviconUrl || 'none found'}`);

  // 3. Collect linked asset URLs
  const assetUrls = new Set();

  // CSS <link>
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    const resolved = resolveUrl(baseUrl, href);
    if (resolved) assetUrls.add(resolved);
  });

  // JS <script src>
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    const resolved = resolveUrl(baseUrl, src);
    if (resolved) assetUrls.add(resolved);
  });

  // Images
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    const resolved = resolveUrl(baseUrl, src);
    if (resolved) assetUrls.add(resolved);
  });

  // Inline <style> — treat as a single virtual file
  const inlineStyles = [];
  $('style').each((i, el) => {
    inlineStyles.push({ id: `inline_style_${i}`, content: $(el).html() });
  });

  // Inline <script> (no src) — treat as virtual file
  const inlineScripts = [];
  $('script:not([src])').each((i, el) => {
    const src = $(el).html() || '';
    if (src.trim()) inlineScripts.push({ id: `inline_script_${i}`, content: src });
  });

  // 3. Fetch all linked assets in parallel (max 20 at once)
  const assetList = [...assetUrls];
  const concurrency = 20;
  const fetchedAssets = [];
  for (let i = 0; i < assetList.length; i += concurrency) {
    const batch = assetList.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(u => fetchOne(u)));
    fetchedAssets.push(...results.filter(Boolean));
  }

  // 4. Build snapshot file list
  const snapshotFiles = [];

  // Main HTML
  const htmlHash = crypto.createHash('sha256').update(mainPage.content).digest('hex');
  snapshotFiles.push({
    id: 'index.html',
    url: targetUrl,
    type: 'html',
    hash: htmlHash,
    size: Buffer.byteLength(mainPage.content, 'utf8'),
  });

  // Linked assets
  fetchedAssets.forEach(asset => {
    const urlPath = new URL(asset.url).pathname;
    const ext = path.extname(urlPath).toLowerCase();
    let type = 'other';
    if (['.css'].includes(ext)) type = 'css';
    else if (['.js', '.mjs'].includes(ext)) type = 'js';
    else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) type = 'image';
    snapshotFiles.push({
      id: urlPath || asset.url,
      url: asset.url,
      type,
      hash: asset.hash,
      size: asset.size,
    });
  });

  // Inline styles / scripts
  inlineStyles.forEach(s => {
    const h = crypto.createHash('sha256').update(s.content).digest('hex');
    snapshotFiles.push({ id: s.id, url: null, type: 'inline-css', hash: h, size: Buffer.byteLength(s.content) });
  });
  inlineScripts.forEach(s => {
    const h = crypto.createHash('sha256').update(s.content).digest('hex');
    snapshotFiles.push({ id: s.id, url: null, type: 'inline-js', hash: h, size: Buffer.byteLength(s.content) });
  });

  // 6. Persist snapshot JSON
  const timestamp = Date.now();
  const snapshotId = `snap_${timestamp}`;
  const snapshot = {
    id: snapshotId,
    url: targetUrl,
    timestamp,
    fileCount: snapshotFiles.length,
    files: snapshotFiles,
    faviconUrl,   // Website icon URL for APK launcher icon generation
    // Store raw HTML + assets for the APK build
    rawHtml: mainPage.content,
    assets: fetchedAssets.map(a => ({ id: new URL(a.url).pathname || a.url, url: a.url, content: a.content, type: a.contentType })),
  };

  const snapshotPath = path.join(SNAPSHOTS_DIR, `${snapshotId}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`[Scraper] Snapshot saved: ${snapshotPath} (${snapshotFiles.length} files)`);

  return snapshot;
}

/**
 * Fetch a favicon URL and return its raw buffer.
 * Returns null on failure.
 */
async function fetchFaviconBuffer(url) {
  if (!url) return null;
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 WebToAPK-Scraper/1.0' },
      maxRedirects: 5,
    });
    return Buffer.from(resp.data);
  } catch (err) {
    console.warn(`[Scraper] Could not fetch favicon ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Load the two most recent snapshots for diffing.
 * Returns { previous, current } — previous may be null on first scan.
 */
function loadLatestTwoSnapshots() {
  ensureDirs();
  const files = fs.readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(SNAPSHOTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const load = (name) => JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, name), 'utf8'));

  if (files.length === 0) return { previous: null, current: null };
  if (files.length === 1) return { previous: null, current: load(files[0].name) };
  return { previous: load(files[1].name), current: load(files[0].name) };
}

/**
 * Compute diff between two snapshots (file-level).
 */
function diffSnapshots(previous, current) {
  if (!previous) {
    return {
      hasChanges: true,
      isFirstScan: true,
      added: current.files.map(f => f.id),
      modified: [],
      deleted: [],
      summary: `First scan — ${current.files.length} files indexed`,
    };
  }

  const prevMap = {};
  previous.files.forEach(f => { prevMap[f.id] = f; });
  const currMap = {};
  current.files.forEach(f => { currMap[f.id] = f; });

  const added    = Object.keys(currMap).filter(id => !prevMap[id]);
  const deleted  = Object.keys(prevMap).filter(id => !currMap[id]);
  const modified = Object.keys(currMap).filter(id => prevMap[id] && prevMap[id].hash !== currMap[id].hash);

  const hasChanges = added.length > 0 || modified.length > 0 || deleted.length > 0;

  return {
    hasChanges,
    isFirstScan: false,
    added,
    modified,
    deleted,
    fromVersion: previous.id,
    toVersion: current.id,
    fromUrl: previous.url,
    toUrl: current.url,
    summary: hasChanges
      ? `${added.length} added · ${modified.length} modified · ${deleted.length} deleted`
      : 'No changes detected',
  };
}

/**
 * Write the latest scraped assets into the Android www_initial assets folder.
 */
function writeToAndroidAssets(snapshot, androidAssetsDir) {
  if (fs.existsSync(androidAssetsDir)) {
    try {
      fs.rmSync(androidAssetsDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[Scraper] Could not clean assets dir: ${e.message}`);
    }
  }
  fs.mkdirSync(androidAssetsDir, { recursive: true });

  // Write index.html
  const indexPath = path.join(androidAssetsDir, 'index.html');
  fs.writeFileSync(indexPath, snapshot.rawHtml, 'utf8');

  // Write linked assets preserving directory structure
  if (snapshot.assets) {
    snapshot.assets.forEach(asset => {
      try {
        // Sanitize the path
        const assetId = asset.id.startsWith('/') ? asset.id.slice(1) : asset.id;
        if (!assetId || assetId.includes('..')) return;
        const destPath = path.join(androidAssetsDir, assetId);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(destPath, asset.content, 'utf8');
      } catch (e) {
        console.warn(`[Scraper] Could not write asset ${asset.id}: ${e.message}`);
      }
    });
  }

  console.log(`[Scraper] ✓ Assets written to Android: ${androidAssetsDir}`);
}

module.exports = {
  scrapeUrl,
  loadLatestTwoSnapshots,
  diffSnapshots,
  writeToAndroidAssets,
  fetchFaviconBuffer,
};
