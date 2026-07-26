package com.cddua.app.cddua

import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * JavaScript Bridge connecting the Sandboxed WebView DOM with Native Kotlin CDDUA engine.
 */
class JSBridge(private val client: CDDUAClient) {
    companion object {
        private const val TAG = "CDDUA-JSBridge"
        const val INTERFACE_NAME = "AndroidCDDUABridge"
    }

    /**
     * Called by webapp JS when an update-available Socket.io ping is received in DOM.
     */
    @JavascriptInterface
    fun onUpdateAvailable(jsonStr: String) {
        Log.i(TAG, "Bridge received update-available from DOM JS: $jsonStr")
        try {
            val json = JSONObject(jsonStr)
            client.handleUpdateAvailable(json)
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing bridge update JSON: ${e.message}", e)
        }
    }

    /**
     * Returns container telemetry and verification status to the web application.
     */
    @JavascriptInterface
    fun getContainerInfo(): String {
        return JSONObject().apply {
            put("platform", "Android Kotlin Native Container")
            put("apiLevel", android.os.Build.VERSION.SDK_INT)
            put("secureOrigin", "https://app.local")
            put("ed25519Verification", "Hardcoded Public Key Enabled")
            put("atomicRollback", "Supported (www_old/ & www_staging/)")
        }.toString()
    }
}
