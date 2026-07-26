/**
 * api.js — Express API Routes (v2 — with SQLite changelog)
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { exec } = require('child_process');

const { scrapeUrl, loadLatestTwoSnapshots, diffSnapshots, writeToAndroidAssets, fetchFaviconBuffer } = require('../scraper');
const { Jimp } = require('jimp');
const db = require('../db');

const ANDROID_DIR        = path.join(__dirname, '../../../android');
const ANDROID_ASSETS_DIR = path.join(ANDROID_DIR, 'app/src/main/assets/www_initial');
const APK_OUTPUT_DIR     = path.join(ANDROID_DIR, 'app/build/outputs/apk/debug');
const APK_FILENAME       = 'app-debug.apk';

// Java 17 from Gradle's auto-provisioned JDK cache (Windows)
const GRADLE_JDK17 = path.join(os.homedir(), '.gradle', 'jdks', 'eclipse_adoptium-17-amd64-windows.2');

let buildState = {
  status:      'idle',
  progress:    0,
  message:     '',
  apkReady:    false,
  apkPath:     null,
  error:       null,
  lastDiff:    null,
  lastSnapshot: null,
};

function router(engine) {
  const r = express.Router();

  /* ─── GET /api/health ─────────────────────── */
  r.get('/health', (req, res) => {
    res.json({ ok: true, version: '3.0.0', status: buildState.status });
  });

  /* ─── GET /api/status ─────────────────────── */
  r.get('/status', (req, res) => res.json(buildState));

  /* ─── POST /api/scan  body: { url } ──────────
     Scrapes the URL, stores in DB, returns diff
  ─────────────────────────────────────────────── */
  r.post('/scan', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'A valid http/https URL is required.' });
    }
    if (['scanning', 'building'].includes(buildState.status)) {
      return res.status(409).json({ error: 'A scan or build is already running.' });
    }

    buildState = { ...buildState, status: 'scanning', progress: 10, message: 'Fetching page...', error: null };
    emit(engine, 'build-progress', buildState);

    try {
      // 1. Scrape
      const snapshot = await scrapeUrl(url);

      buildState.progress = 65;
      buildState.message  = 'Saving to database...';
      emit(engine, 'build-progress', buildState);

      // 2. Insert scan into DB
      const scanId = await db.insertScan(snapshot);

      // 3. Get previous scan for this URL from DB
      const recentScans = await db.getLatestScansForUrl(url);
      // recentScans[0] = this scan, recentScans[1] = previous (if any)
      let fromScanId = null;
      let diff;

      if (recentScans.length >= 2) {
        const prevScanId = recentScans[1].id;
        fromScanId = prevScanId;
        const prevFiles = await db.getFilesForScan(prevScanId);
        const currFiles = await db.getFilesForScan(scanId);
        diff = computeDiff(prevFiles, currFiles, recentScans[1].snapshot_id, snapshot.id);
      } else {
        // First scan — everything is "added"
        diff = {
          hasChanges:  true,
          isFirstScan: true,
          added:       (snapshot.files || []).map(f => f.id),
          modified:    [],
          deleted:     [],
          summary:     `First scan — ${snapshot.fileCount} files indexed`,
          fromVersion: null,
          toVersion:   snapshot.id,
        };
      }

      // 4. Save changelog to DB
      await db.insertChangelog(fromScanId, scanId, url, diff);

      buildState = {
        ...buildState,
        status:      'scanned',
        progress:    100,
        message:     diff.summary,
        lastDiff:    diff,
        lastSnapshot: {
          id:        snapshot.id,
          dbId:      scanId,
          url:       snapshot.url,
          timestamp: snapshot.timestamp,
          fileCount: snapshot.fileCount,
        },
      };
      emit(engine, 'build-progress', buildState);

      return res.json({ ok: true, snapshot: buildState.lastSnapshot, diff });

    } catch (err) {
      console.error('[Scan] Error:', err.message);
      buildState = { ...buildState, status: 'error', message: err.message, error: err.message };
      emit(engine, 'build-progress', buildState);
      return res.status(500).json({ error: err.message });
    }
  });

  /* ─── GET /api/changelog?url=… ───────────────
     Returns stored changelog history from DB
  ─────────────────────────────────────────────── */
  r.get('/changelog', async (req, res) => {
    try {
      const { url } = req.query;
      const logs = url
        ? await db.getChangelogsForUrl(decodeURIComponent(url))
        : await db.getAllChangelogs();
      res.json({ ok: true, changelogs: logs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ─── GET /api/scans ─────────────────────────
     Returns all stored scans from DB
  ─────────────────────────────────────────────── */
  r.get('/scans', async (req, res) => {
    try {
      const scans = await db.getAllScans();
      res.json({ ok: true, scans });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ─── GET /api/diff ──────────────────────────
     Returns the last computed diff (in-memory)
  ─────────────────────────────────────────────── */
  r.get('/diff', (req, res) => {
    if (!buildState.lastDiff) {
      return res.json({ hasChanges: false, summary: 'No scan yet. Run /api/scan first.' });
    }
    res.json(buildState.lastDiff);
  });

  /* ─── POST /api/build ────────────────────────
     Writes assets → Android, runs Gradle
  ─────────────────────────────────────────────── */
  r.post('/build', async (req, res) => {
    if (buildState.status === 'building') {
      return res.status(409).json({ error: 'Build already in progress.' });
    }

    const { current } = loadLatestTwoSnapshots();
    if (!current) {
      return res.status(400).json({ error: 'No snapshot. Run a scan first.' });
    }

    buildState = { ...buildState, status: 'building', progress: 5, message: 'Writing assets to Android...', apkReady: false, error: null };
    emit(engine, 'build-progress', buildState);

    res.json({ ok: true, message: 'Build started. Poll /api/status or listen via Socket.IO.' });

    // Run build asynchronously
    (async () => {
      try {
        // Step 1: sync web assets
        writeToAndroidAssets(current, ANDROID_ASSETS_DIR);
        buildState = { ...buildState, progress: 10, message: 'Assets synced. Fetching app icon...' };
        emit(engine, 'build-progress', buildState);

        // Step 1b: Auto-generate launcher icons from website favicon
        try {
          const faviconBuf = await fetchFaviconBuffer(current.faviconUrl);
          if (faviconBuf) {
            const MIPMAP_SIZES = [
              { dir: 'mipmap-mdpi',    size: 48  },
              { dir: 'mipmap-hdpi',    size: 72  },
              { dir: 'mipmap-xhdpi',  size: 96  },
              { dir: 'mipmap-xxhdpi', size: 144 },
              { dir: 'mipmap-xxxhdpi',size: 192 },
            ];
            const RES_DIR = path.join(ANDROID_DIR, 'app/src/main/res');
            const img = await Jimp.read(faviconBuf);
            for (const { dir, size } of MIPMAP_SIZES) {
              const mipmapDir = path.join(RES_DIR, dir);
              fs.mkdirSync(mipmapDir, { recursive: true });
              const icon1 = img.clone().resize({ w: size, h: size });
              await icon1.write(path.join(mipmapDir, 'ic_launcher.png'));
              const icon2 = img.clone().resize({ w: size, h: size });
              await icon2.write(path.join(mipmapDir, 'ic_launcher_round.png'));
            }
            console.log('[Build] ✓ Launcher icons generated from favicon');
            buildState = { ...buildState, progress: 18, message: '🎨 App icon generated. Starting Gradle...' };
          } else {
            console.warn('[Build] No favicon found, using default icon.');
            buildState = { ...buildState, progress: 18, message: 'No icon found, using default. Starting Gradle...' };
          }
        } catch (iconErr) {
          console.warn('[Build] Icon generation failed (non-fatal):', iconErr.message);
          buildState = { ...buildState, progress: 18, message: 'Icon generation skipped. Starting Gradle...' };
        }
        emit(engine, 'build-progress', buildState);

        // Step 2: Determine env for Gradle
        const isWin      = process.platform === 'win32';
        const gradleCmd  = isWin ? 'gradlew.bat' : './gradlew';
        const javaHome   = fs.existsSync(GRADLE_JDK17) ? GRADLE_JDK17 : (process.env.JAVA_HOME || '');
        const androidSdk = process.env.ANDROID_HOME ||
                           path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');

        const env = {
          ...process.env,
          JAVA_HOME:        javaHome,
          ANDROID_HOME:     androidSdk,
          ANDROID_SDK_ROOT: androidSdk,
        };

        console.log(`[Build] Using JAVA_HOME=${javaHome}`);
        console.log(`[Build] Using ANDROID_HOME=${androidSdk}`);

        // Step 3: Run Gradle with real output parsing
        await new Promise((resolve, reject) => {
          // Map Gradle task names to human-readable messages and progress percentages
          const TASK_MAP = [
            { pattern: /preBuild/i,                        pct: 22, msg: '🔧 Pre-build checks...' },
            { pattern: /preDebugBuild/i,                   pct: 25, msg: '🔧 Preparing debug build...' },
            { pattern: /checkDebugDuplicateClasses/i,      pct: 28, msg: '🔍 Checking for duplicate classes...' },
            { pattern: /mergeDebugResources/i,             pct: 33, msg: '🗂️  Merging resources...' },
            { pattern: /packageDebugResources/i,           pct: 38, msg: '📦 Packaging resources...' },
            { pattern: /parseDebugLocalResources/i,        pct: 40, msg: '📄 Parsing local resources...' },
            { pattern: /generateDebugBuildConfig/i,        pct: 43, msg: '⚙️  Generating BuildConfig...' },
            { pattern: /createDebugCompatibleScreenManifests/i, pct: 45, msg: '📋 Processing manifest...' },
            { pattern: /mergeDebugShaders/i,               pct: 47, msg: '🎨 Merging shaders...' },
            { pattern: /compileDebugAidl/i,                pct: 48, msg: '🔗 Compiling AIDL interfaces...' },
            { pattern: /compileDebugRenderscript/i,        pct: 49, msg: '🎭 Compiling RenderScript...' },
            { pattern: /mergeDebugAssets/i,                pct: 52, msg: '📁 Merging web assets into APK...' },
            { pattern: /processDebugJavaRes/i,             pct: 54, msg: '☕ Processing Java resources...' },
            { pattern: /compileDebugKotlin/i,              pct: 58, msg: '🔨 Compiling Kotlin source code...' },
            { pattern: /compileDebugJavaWithJavac/i,       pct: 63, msg: '☕ Compiling Java source code...' },
            { pattern: /mergeDebugJavaResource/i,          pct: 66, msg: '🔗 Merging Java resources...' },
            { pattern: /dexBuilderDebug/i,                 pct: 70, msg: '⚡ Dexing classes (ART bytecode)...' },
            { pattern: /mergeDexDebug/i,                   pct: 74, msg: '🔀 Merging DEX files...' },
            { pattern: /mergeDebugNativeLibs/i,            pct: 77, msg: '📚 Merging native libraries...' },
            { pattern: /stripDebugDebugSymbols/i,          pct: 79, msg: '✂️  Stripping debug symbols...' },
            { pattern: /validateSigningDebug/i,            pct: 82, msg: '🔑 Validating debug signing key...' },
            { pattern: /writeDebugSigningConfigVersions/i, pct: 84, msg: '📝 Writing signing config...' },
            { pattern: /packageDebug/i,                    pct: 88, msg: '📱 Packaging APK file...' },
            { pattern: /createDebugApkListingFileRedirect/i, pct: 92, msg: '📋 Finalizing APK listing...' },
            { pattern: /assembleDebug/i,                   pct: 96, msg: '✅ Assembling final APK...' },
            { pattern: /BUILD SUCCESSFUL/i,                pct: 99, msg: '🎉 Build successful! Verifying APK...' },
          ];

          const cmd = `${gradleCmd} assembleDebug --no-daemon`;
          const proc = exec(cmd, { cwd: ANDROID_DIR, env, timeout: 360000 }, (err, stdout, stderr) => {
            if (err) {
              console.error('[Build] Gradle stderr:', stderr);
              reject(new Error(stderr || err.message));
            } else {
              console.log('[Build] Gradle success');
              resolve(stdout);
            }
          });

          // Parse stdout line-by-line for real Gradle task progress
          if (proc.stdout) {
            proc.stdout.on('data', (chunk) => {
              const lines = chunk.toString().split('\n');
              lines.forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) return;
                console.log('[Gradle]', trimmed);
                for (const entry of TASK_MAP) {
                  if (entry.pattern.test(trimmed)) {
                    buildState = { ...buildState, progress: entry.pct, message: entry.msg };
                    emit(engine, 'build-progress', buildState);
                    break;
                  }
                }
              });
            });
          }
          // Also capture stderr for warnings (non-fatal)
          if (proc.stderr) {
            proc.stderr.on('data', (chunk) => {
              const line = chunk.toString().trim();
              if (line) console.warn('[Gradle WARN]', line);
            });
          }
        });

        // Step 4: Verify
        const apkPath = path.join(APK_OUTPUT_DIR, APK_FILENAME);
        const apkExists = fs.existsSync(apkPath);

        buildState = {
          ...buildState,
          status:   apkExists ? 'done' : 'error',
          progress: 100,
          apkReady: apkExists,
          apkPath:  apkExists ? apkPath : null,
          message:  apkExists ? '✓ APK ready for download!' : 'Gradle finished but APK not found.',
          error:    apkExists ? null : 'APK file missing after build.',
        };
        emit(engine, 'build-progress', buildState);

      } catch (err) {
        console.error('[Build] Error:', err.message);
        buildState = {
          ...buildState,
          status:   'error',
          progress: 0,
          apkReady: false,
          message:  'Build failed. See server logs.',
          error:    err.message,
        };
        emit(engine, 'build-progress', buildState);
      }
    })();
  });

  /* ─── GET /api/download ──────────────────────*/
  r.get('/download', (req, res) => {
    const apkPath = path.join(APK_OUTPUT_DIR, APK_FILENAME);
    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({ error: 'APK not built yet.' });
    }

    // Use name from query param if provided by client, otherwise dynamically determine from snapshot
    let downloadName = req.query.name || 'countriesmalaysiapage.apk';
    if (!req.query.name) {
      try {
        const { current } = loadLatestTwoSnapshots();
        if (current && current.url) {
          const hostname = new URL(current.url).hostname; // e.g. "countries.malaysiapage.com"
          const cleanName = hostname.replace(/^www\./i, '').replace(/\./g, '').replace(/[^a-z0-9]/gi, '');
          if (cleanName) {
            downloadName = `${cleanName}.apk`;
          }
        }
      } catch (e) {
        console.warn('[Download] Could not determine dynamic APK filename:', e.message);
      }
    }

    res.download(apkPath, downloadName);
  });

  /* ─── GET /api/download-assets ───────────────*/
  r.get('/download-assets', (req, res) => {
    const { current } = loadLatestTwoSnapshots();
    if (!current) return res.status(404).json({ error: 'No snapshot available.' });

    try {
      const AdmZip = require('adm-zip');
      const zip    = new AdmZip();
      zip.addFile('index.html', Buffer.from(current.rawHtml || '', 'utf8'));
      if (current.assets) {
        current.assets.forEach(a => {
          const id = (a.id || '').replace(/^\//, '');
          if (id && !id.includes('..')) {
            try { zip.addFile(id, Buffer.from(a.content || '', 'utf8')); } catch {}
          }
        });
      }
      const buf = zip.toBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="web-assets.zip"`);
      res.setHeader('Content-Length', buf.length);
      res.end(buf);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ─── GET /api/download-ios ──────────────────*/
  r.get('/download-ios', (req, res) => {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();

      const { current } = loadLatestTwoSnapshots();
      const targetUrl = req.query.url || (current ? current.url : 'https://countries.malaysiapage.com/');

      let appName = 'CountriesMalaysiaPage';
      try {
        const hostname = new URL(targetUrl).hostname;
        const clean = hostname.replace(/^www\./i, '').replace(/\./g, '');
        if (clean) appName = clean.charAt(0).toUpperCase() + clean.slice(1);
      } catch {}

      // 1. ViewController.swift
      const viewControllerSwift = `import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate {
    var webView: WKWebView!

    override func loadView() {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.mediaTypesRequiringUserActionForPlayback = []
        
        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        if let url = URL(string: "${targetUrl}") {
            let request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
            webView.load(request)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[iOS App Error] Navigation failed: \\(error.localizedDescription)")
    }
}
`;

      // 2. AppDelegate.swift
      const appDelegateSwift = `import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }
}
`;

      // 3. SceneDelegate.swift
      const sceneDelegateSwift = `import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }
        window = UIWindow(windowScene: windowScene)
        let mainVC = ViewController()
        window?.rootViewController = mainVC
        window?.makeKeyAndVisible()
    }
}
`;

      // 4. Info.plist
      const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>com.app.${appName.toLowerCase()}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>${appName}</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSRequiresIPhoneOS</key>
	<true/>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<true/>
	</dict>
	<key>UIApplicationSceneManifest</key>
	<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<false/>
		<key>UISceneConfigurations</key>
		<dict>
			<key>UIWindowSceneSessionRoleApplication</key>
			<array>
				<dict>
					<key>UISceneConfigurationName</key>
					<string>Default Configuration</string>
					<key>UISceneDelegateClassName</key>
					<string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>
				</dict>
			</array>
		</dict>
	</dict>
	<key>UILaunchStoryboardName</key>
	<string>LaunchScreen</string>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
</dict>
</plist>
`;

      // 5. README.md
      const readmeMd = `# ${appName} — iOS App Project (Swift / WKWebView)

Generated for website: ${targetUrl}

## Quick Start (How to build on Mac / Xcode)

1. Unzip this package on your Mac.
2. Open **${appName}.xcodeproj** in Xcode.
3. Select an iOS Simulator or your connected iPhone at the top bar.
4. Press **⌘R** (Cmd + R) to build and run the iOS app!

## Features
- Full native iOS WKWebView integration
- Loads \`${targetUrl}\` directly
- Native swipe-back navigation enabled
- Supports portrait and landscape orientation
`;

      // Add files to ZIP
      zip.addFile(`${appName}/ViewController.swift`, Buffer.from(viewControllerSwift, 'utf8'));
      zip.addFile(`${appName}/AppDelegate.swift`, Buffer.from(appDelegateSwift, 'utf8'));
      zip.addFile(`${appName}/SceneDelegate.swift`, Buffer.from(sceneDelegateSwift, 'utf8'));
      zip.addFile(`${appName}/Info.plist`, Buffer.from(infoPlist, 'utf8'));
      zip.addFile(`README.md`, Buffer.from(readmeMd, 'utf8'));

      const downloadFilename = req.query.name || `${appName.toLowerCase()}-ios.zip`;
      const buf = zip.toBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
      res.setHeader('Content-Length', buf.length);
      res.end(buf);

    } catch (err) {
      console.error('[iOS Download Error]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /* ─── Legacy CDDUA routes ────────────────────*/
  r.get('/manifest', (req, res) => {
    if (!engine?.currentManifest) return res.status(503).json({ error: 'Engine not ready' });
    res.json(engine.currentManifest);
  });

  r.get('/updates', (req, res) => {
    if (!engine) return res.status(503).json({ error: 'Engine not ready' });
    res.json({
      hasUpdate: !!engine.lastPatchMeta,
      latestPatch: engine.lastPatchMeta || null,
      serverPublicKey: require('../security/signer').getPublicKeyHex(),
    });
  });

  r.post('/check-update', async (req, res) => {
    try {
      if (!engine) return res.status(503).json({ error: 'Engine not ready' });
      const result = await engine.checkForUpdates();
      res.json({ checked: true, updateBroadcast: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  r.get('/patch-history', (req, res) => {
    if (!engine) return res.status(503).json({ error: 'Engine not ready' });
    res.json(engine.patchHistory);
  });

  return r;
}

/* ─── Helpers ────────────────────────────────── */

function emit(engine, event, data) {
  if (engine?.io) engine.io.emit(event, data);
}

/**
 * Compute file-level diff from two arrays of file rows.
 */
function computeDiff(prevFiles, currFiles, fromVersion, toVersion) {
  const prevMap = {};
  prevFiles.forEach(f => { prevMap[f.file_path] = f; });
  const currMap = {};
  currFiles.forEach(f => { currMap[f.file_path] = f; });

  const added    = Object.keys(currMap).filter(p => !prevMap[p]);
  const deleted  = Object.keys(prevMap).filter(p => !currMap[p]);
  const modified = Object.keys(currMap).filter(p => prevMap[p] && prevMap[p].hash !== currMap[p].hash);

  const hasChanges = added.length > 0 || modified.length > 0 || deleted.length > 0;
  return {
    hasChanges,
    isFirstScan: false,
    added,
    modified,
    deleted,
    fromVersion,
    toVersion,
    summary: hasChanges
      ? `${added.length} added · ${modified.length} modified · ${deleted.length} deleted`
      : 'No changes since last scan',
  };
}

module.exports = router;
