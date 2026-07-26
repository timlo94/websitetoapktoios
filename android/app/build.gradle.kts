plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.cddua.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cddua.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0-CDDUA"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    
    // AndroidX WebKit for WebViewAssetLoader & Secure Origin Mapping (https://app.local)
    implementation("androidx.webkit:webkit:1.10.0")
    
    // Socket.io for Real-Time CDDUA Update Broadcasts
    implementation("io.socket:socket.io-client:2.1.0")
    
    // OkHttp for Downloading Delta Patch Zip Payloads
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    
    // BouncyCastle for Ed25519 Cryptographic Verification on all Android API levels
    implementation("org.bouncycastle:bcprov-jdk18on:1.77")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
