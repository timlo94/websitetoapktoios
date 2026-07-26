const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const { Server } = require('socket.io');
const chokidar = require('chokidar');
const fs = require('fs');

const merkle = require('./diffing/merkle');
const patcher = require('./diffing/patcher');
const signer = require('./security/signer');
const apiRoutes = require('./routes/api');

const PORT = process.env.PORT || 3000;
const WEBAPP_DIR = path.join(__dirname, '../../webapp');
const ADMIN_DIR = path.join(__dirname, '../../admin-console');

/**
 * CDDUA Core Engine & Server Orchestrator
 */
class CDDUAEngine {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    });

    this.webappDir = WEBAPP_DIR;
    this.currentManifest = null;
    this.initialBundle = null;
    this.lastPatchMeta = null;
    this.patchHistory = [];
    this.isChecking = false;
    this.checkTimeout = null;

    this.init();
  }

  init() {
    // Ensure webapp and admin directories exist
    if (!fs.existsSync(this.webappDir)) {
      fs.mkdirSync(this.webappDir, { recursive: true });
    }
    if (!fs.existsSync(ADMIN_DIR)) {
      fs.mkdirSync(ADMIN_DIR, { recursive: true });
    }

    // Generate initial Merkle manifest and initial bundle
    console.log('[CDDUAEngine] Scanning /webapp and generating initial Merkle Tree...');
    this.currentManifest = merkle.generateManifest(this.webappDir, 'v_1.0.0');
    this.initialBundle = patcher.createInitialBundle(this.webappDir, this.currentManifest, 'bundle_initial.zip');
    console.log(`[CDDUAEngine] Initialized at version: ${this.currentManifest.version} (Root Hash: ${this.currentManifest.merkleRoot.substring(0, 16)}...)`);

    // Sync initial webapp to Android APK assets folder for native container bundling
    this.syncToAndroidAssets(this.webappDir, path.join(__dirname, '../../android/app/src/main/assets/www_initial'));

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSockets();
    this.setupFileWatcher();
  }

  syncToAndroidAssets(src, dest) {
    try {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          this.syncToAndroidAssets(srcPath, destPath);
        } else if (entry.isFile() && !entry.name.startsWith('.')) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
      console.log('[CDDUAEngine] ✓ Synced /webapp to Android APK assets/www_initial');
    } catch (err) {
      console.warn('[CDDUAEngine] Note: Could not sync to Android assets:', err.message);
    }
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(morgan('dev'));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Custom static serving for /patches with cryptographic headers
    this.app.use('/patches', (req, res, next) => {
      const fileName = path.basename(req.url);
      const filePath = path.join(patcher.getPatchesDir(), fileName);
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        const hash = require('crypto').createHash('sha256').update(fileBuffer).digest('hex');
        const signature = signer.sign(fileBuffer);
        res.setHeader('X-CDDUA-Signature', signature);
        res.setHeader('X-CDDUA-Hash', hash);
        res.setHeader('X-CDDUA-PublicKey', signer.getPublicKeyHex());
      }
      next();
    }, express.static(patcher.getPatchesDir()));

    // Serve Web->APK Builder as default app at / and /webapp
    this.app.use('/webapp', express.static(this.webappDir));
    this.app.use('/admin', express.static(ADMIN_DIR));
    this.app.use('/', express.static(this.webappDir)); // Default root serves the Web->APK Builder
  }

  setupRoutes() {
    this.app.use('/api', apiRoutes(this));
  }

  setupSockets() {
    this.io.on('connection', (socket) => {
      console.log(`[Socket.io] Client connected: ${socket.id} (Total: ${this.io.engine.clientsCount})`);

      // Send immediate welcome status to newly connected client
      socket.emit('connection-established', {
        clientId: socket.id,
        version: this.currentManifest ? this.currentManifest.version : null,
        merkleRoot: this.currentManifest ? this.currentManifest.merkleRoot : null,
        publicKeyHex: signer.getPublicKeyHex(),
        timestamp: Date.now()
      });

      socket.on('client-status-report', (data) => {
        console.log(`[Socket.io] Client ${socket.id} reported status:`, data);
        // Broadcast to admin dashboard
        this.io.emit('admin-client-update', { socketId: socket.id, ...data });
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.io] Client disconnected: ${socket.id}`);
        this.io.emit('admin-client-disconnected', { socketId: socket.id });
      });
    });
  }

  setupFileWatcher() {
    console.log(`[CDDUAEngine] Starting file watcher on ${this.webappDir}...`);
    const watcher = chokidar.watch(this.webappDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    const triggerDebouncedCheck = (event, filePath) => {
      const relPath = path.relative(this.webappDir, filePath).replace(/\\/g, '/');
      console.log(`[Chokidar] File event (${event}): ${relPath}`);
      this.io.emit('admin-log', { type: 'file_event', event, path: relPath, timestamp: Date.now() });

      if (this.checkTimeout) clearTimeout(this.checkTimeout);
      this.checkTimeout = setTimeout(() => {
        this.checkForUpdates();
      }, 500); // 500ms debounce
    };

    watcher
      .on('add', (path) => triggerDebouncedCheck('add', path))
      .on('change', (path) => triggerDebouncedCheck('change', path))
      .on('unlink', (path) => triggerDebouncedCheck('delete', path));
  }

  async checkForUpdates() {
    if (this.isChecking) return null;
    this.isChecking = true;

    try {
      console.log('[CDDUAEngine] Checking for webapp file changes...');
      // Generate version string based on semantic version or timestamp
      const nextVerNumber = (this.patchHistory.length + 1);
      const targetVersion = `v_1.0.${nextVerNumber}`;

      const newManifest = merkle.generateManifest(this.webappDir, targetVersion);
      const diff = merkle.compareManifests(this.currentManifest, newManifest);

      if (!diff.hasChanges) {
        console.log('[CDDUAEngine] Scan complete: No changes detected.');
        this.isChecking = false;
        return null;
      }

      console.log(`[CDDUAEngine] Changes detected! Added: ${diff.added.length}, Modified: ${diff.modified.length}, Deleted: ${diff.deleted.length}`);
      
      // Create signed delta zip patch
      const patch = patcher.createDeltaPatch(this.webappDir, diff, newManifest);
      if (!patch) {
        this.isChecking = false;
        return null;
      }

      // Update state
      this.currentManifest = newManifest;
      this.lastPatchMeta = patch;
      this.patchHistory.push(patch);

      // Re-create initial bundle so new clients get the latest full state
      this.initialBundle = patcher.createInitialBundle(this.webappDir, this.currentManifest, 'bundle_initial.zip');

      // Prepare WebSocket broadcast payload
      const broadcastPayload = {
        event: 'update-available',
        version: patch.version,
        oldVersion: patch.oldVersion,
        timestamp: patch.timestamp,
        merkleRoot: patch.merkleRoot,
        downloadUrl: `/patches/${patch.fileName}`,
        patchSize: patch.size,
        hash: patch.hash,
        signature: patch.signature,
        publicKeyHex: signer.getPublicKeyHex(),
        changelog: patch.changelog,
        fileCount: patch.patchMeta.fileCount,
        deletedFiles: patch.patchMeta.deletedFiles
      };

      console.log(`[CDDUAEngine] Broadcasting 'update-available' to ${this.io.engine.clientsCount} connected clients...`);
      this.io.emit('update-available', broadcastPayload);
      this.io.emit('admin-log', { type: 'patch_broadcast', payload: broadcastPayload, timestamp: Date.now() });

      this.isChecking = false;
      return broadcastPayload;
    } catch (err) {
      console.error('[CDDUAEngine] Error during update check:', err);
      this.isChecking = false;
      throw err;
    }
  }

  start() {
    this.server.listen(PORT, () => {
      console.log('================================================================');
      console.log(`[CDDUA Server] Running on http://localhost:${PORT}`);
      console.log(`[CDDUA Server] Admin Console: http://localhost:${PORT}/admin`);
      console.log(`[CDDUA Server] Source Webapp: http://localhost:${PORT}/webapp`);
      console.log(`[CDDUA Server] Public Key (Hex): ${signer.getPublicKeyHex()}`);
      console.log('================================================================');
    });
  }
}

const engine = new CDDUAEngine();
if (require.main === module) {
  engine.start();
}

module.exports = engine;
