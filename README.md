# Community-Distributed Dynamic Update Architecture (CDDUA)

An end-to-end algorithmic framework that detects changes to a web application (HTML, CSS, JS) and automatically propagates delta updates directly to a community-distributed Android application (APK) in real time, bypassing App Store update mechanisms while maintaining strict cryptographic security and atomic filesystem stability.

## Repository Structure

```
mobileappwebsitechange/
├── server/                     # Module A & B: Backend Diffing, Signing & Transport Server
│   ├── package.json
│   ├── src/
│   │   ├── index.js            # Main Express & Socket.io server
│   │   ├── diffing/
│   │   │   ├── merkle.js       # SHA-256 Merkle tree & manifest generator
│   │   │   └── patcher.js      # Delta diffing & Zip compression engine
│   │   ├── security/
│   │   │   └── signer.js       # Ed25519 asymmetric cryptographic signing
│   │   └── routes/
│   │       └── api.js          # REST API endpoints & admin simulation controls
│   ├── keys/                   # Auto-generated Ed25519 keypair storage
│   └── patches/                # Compressed delta zip archives
├── webapp/                     # Source Web Application (Community Portal)
│   ├── index.html
│   ├── css/style.css           # Premium dark-mode glassmorphism design system
│   └── js/
│       ├── app.js              # Core UI logic & interactivity
│       └── cddua-client.js     # WebSocket listener & hot-reload bridge
├── admin-console/              # CDDUA Command Center (Live Simulation Console)
│   ├── index.html
│   ├── css/console.css
│   └── js/console.js
└── android/                    # Module C: Native Kotlin Android Client Container
    ├── build.gradle.kts
    ├── settings.gradle.kts
    └── app/
        ├── build.gradle.kts
        └── src/main/
            ├── AndroidManifest.xml
            ├── assets/
            │   └── www_initial/ # Bundled web application for initial offline setup
            └── java/com/cddua/app/
                ├── MainActivity.kt        # WebViewAssetLoader & virtual origin setup (https://app.local)
                ├── cddua/
                │   ├── CDDUAClient.kt     # Socket.io real-time update orchestrator
                │   ├── SecurityManager.kt # Ed25519 signature verification (Hardcoded Server PubKey)
                ├── PatchManager.kt    # Sandboxed storage & Atomic filesystem swap/rollback
                └── JSBridge.kt        # JavaScript evaluation & hot-reload bridge
```

## Quick Start & Verification

### 1. Start the Backend & Admin Console
```bash
cd server
npm install
npm start
```

Once running, open your browser to:
- **CDDUA Command Center (Admin Dashboard)**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Community Portal (Simulator)**: [http://localhost:3000/webapp](http://localhost:3000/webapp)

### 2. Run Automated Verification Suite
To verify Ed25519 cryptographic signing, Merkle tree SHA-256 diffing, and delta zip compression savings:
```bash
cd server
node test_cddua.js
```

### 3. Build the Android APK Container
1. Open the `/android` directory in **Android Studio**.
2. Sync Gradle (installs `androidx.webkit`, `socket.io-client`, `okhttp`, and `bouncycastle`).
3. Build the APK (`Build -> Build APK(s)`) and install on any Android 7.0+ device or emulator!
4. On launch, the APK unpacks assets into sandboxed internal storage (`Context.getFilesDir() / "www"`), maps them to `https://app.local/`, and connects to the WebSocket server for instant zero-downtime hot-reloads!
