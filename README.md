https://timlo94.github.io/websitetoapktoios
https://timlo94.github.io/websitetoapktoios
https://timlo94.github.io/websitetoapktoios
https://timlo94.github.io/websitetoapktoios
https://timlo94.github.io/websitetoapktoios
# Web → APK & iOS Builder (`websitetoapktoios`)

> **100% Free & Open Source for Everyone!**  
> Turn any website or Web Application into native **Android APKs** and **iOS Xcode Projects** instantly.

---

## 🌟 Overview

**`websitetoapktoios`** is an end-to-end web-to-mobile transformation platform. Enter any website URL (such as `https://countries.malaysiapage.com/`) and automatically build:

1. 📱 **Native Android App (APK & AAB)** ready to sideload or upload to Google Play Store.
2. 🍏 **iOS Swift Xcode Project** ready to open, build, and run in Xcode on macOS.

---

## ✨ Features

- 🌐 **1-Click Website Conversion**: Simply paste a URL to generate native wrapper apps.
- 📱 **Native Android Container**:
  - Built-in WebView wrapper configured for JavaScript, DOM storage, media playback, and hardware acceleration.
  - Native back-button navigation support.
- 📊 **Real-Time Gradle Progress Status**:
  - Live progress bar with real-time feedback for every compilation phase:
    - 🔧 Pre-build checks & resource merging
    - 🔨 Kotlin/Java source compilation
    - ⚡ DEX bytecode optimization
    - 📱 APK packaging & verification
- 🎨 **Automated App Icon Generator**:
  - Automatically fetches the website's favicon (`apple-touch-icon`, PNG, ICO).
  - Generates crisp launcher icons for all 5 Android density levels (`mipmap-mdpi`, `hdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`).
- 🍏 **iOS Project Exporter**:
  - 1-Click download of complete iOS Swift WKWebView Xcode projects.
  - Includes `ViewController.swift`, `Info.plist`, `SceneDelegate.swift`, and `.xcodeproj` project structure.
- ⚡ **Delta Update & Hot-Reload Engine**:
  - Real-time WebSocket telemetry for instant content syncing and differential patch updates without requiring full APK updates.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18.0 or newer
- **Java JDK**: JDK 17 (recommended for Gradle build compatibility)
- **Android SDK / Android Studio** (Optional, required for building Android binaries on your machine)

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/timlo94/websitetoapktoios.git
cd websitetoapktoios

# Install backend dependencies
cd server
npm install
```

### 3. Launch the Application

```bash
# Start the server
npm start
```

Open your browser and navigate to:
- 🌐 **Web → APK & iOS Builder UI**: [http://localhost:3000/](http://localhost:3000/)
- ⚙️ **Admin Console & Telemetry**: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 📱 How to Use

1. Enter your website URL (e.g. `https://countries.malaysiapage.com/`) and click **Scan**.
2. **For Android**:
   - Click **Build APK** to generate a signed Android APK with real-time status feedback.
   - Click **Download APK** once ready to install on any Android device or emulator.
3. **For iOS**:
   - Click **Download iOS Project**.
   - Unzip the downloaded file on a Mac, open the `.xcodeproj` file in **Xcode**, and press **⌘R** to run on an iPhone or Simulator.

---

## 🛠️ Project Architecture

```
websitetoapktoios/
├── server/                     # Backend Server & Build Orchestrator
│   ├── src/
│   │   ├── index.js            # Express & Socket.io server entry point
│   │   ├── scraper.js          # URL Asset Scraper & Favicon Extractor
│   │   └── routes/
│   │       └── api.js          # REST API (Build, Scan, Download APK & iOS)
├── webapp/                     # Web to APK & iOS Builder Frontend Interface
│   ├── index.html              # Main multi-step application UI
│   ├── css/style.css           # Modern glassmorphism UI styles
│   └── js/app.js               # Frontend state machine & progress handler
├── admin-console/              # Live Telemetry & Simulation Console
└── android/                    # Native Android Kotlin App Wrapper
    ├── build.gradle.kts
    └── app/src/main/
        ├── AndroidManifest.xml
        └── java/com/cddua/app/
            └── MainActivity.kt # Native WebView Wrapper
```

---

## 📄 License

This project is open-source and free for all under the [MIT License](LICENSE).
