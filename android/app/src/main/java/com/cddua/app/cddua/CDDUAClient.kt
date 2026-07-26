package com.cddua.app.cddua

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URISyntaxException
import java.util.concurrent.TimeUnit

/**
 * Socket.io Real-Time Client and Patch Download Orchestrator for Android Container.
 */
class CDDUAClient(
    private val context: Context,
    private val patchManager: PatchManager,
    private val onHotReloadTriggered: (String, String) -> Unit
) {
    companion object {
        private const val TAG = "CDDUA-SocketClient"
        // Default Android Emulator IP mapping to host machine localhost:3000
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:3000"
    }

    private var socket: Socket? = null
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var serverUrl = DEFAULT_SERVER_URL

    fun connect(customUrl: String = DEFAULT_SERVER_URL) {
        serverUrl = customUrl
        try {
            val opts = IO.Options().apply {
                reconnection = true
                reconnectionAttempts = Int.MAX_VALUE
                reconnectionDelay = 2000
                timeout = 10000
            }
            socket = IO.socket(serverUrl, opts).apply {
                on(Socket.EVENT_CONNECT) {
                    Log.i(TAG, "✓ Connected to CDDUA Server at $serverUrl")
                    reportStatus("connected")
                }
                on(Socket.EVENT_DISCONNECT) {
                    Log.w(TAG, "Disconnected from CDDUA Server.")
                }
                on("connection-established") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val pubKeyHex = data.optString("publicKeyHex", "")
                        if (pubKeyHex.isNotEmpty()) {
                            SecurityManager.initPublicKey(pubKeyHex)
                        }
                        Log.i(TAG, "Handshake complete. Server Version: ${data.optString("version")}")
                    }
                }
                on("update-available") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        Log.i(TAG, "⚡ Real-Time Update Ping Received! Processing payload...")
                        handleUpdateAvailable(data)
                    }
                }
            }
            socket?.connect()
        } catch (e: URISyntaxException) {
            Log.e(TAG, "Invalid server URL: $serverUrl", e)
        }
    }

    /**
     * Handles the update available event: downloads zip, verifies signature, and applies atomically.
     */
    fun handleUpdateAvailable(data: JSONObject) {
        val version = data.optString("version", "v_updated")
        val downloadUrl = data.optString("downloadUrl")
        val signatureHex = data.optString("signature")
        val expectedHash = data.optString("hash")
        val deletedFilesJson = data.optJSONArray("deletedFiles")
        val changelogArray = data.optJSONArray("changelog")
        val changelogStr = if (changelogArray != null && changelogArray.length() > 0) {
            changelogArray.getString(0)
        } else {
            "Updated to $version via CDDUA Atomic Hot-Reload!"
        }

        if (downloadUrl.isEmpty() || signatureHex.isEmpty() || expectedHash.isEmpty()) {
            Log.e(TAG, "Invalid update metadata received. Aborting.")
            return
        }

        val fullUrl = if (downloadUrl.startsWith("http")) downloadUrl else "$serverUrl$downloadUrl"
        Log.i(TAG, "Downloading delta patch from: $fullUrl")

        val request = Request.Builder().url(fullUrl).build()
        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "Failed to download delta patch: ${e.message}", e)
            }

            override fun onResponse(call: Call, response: Response) {
                if (!response.isSuccessful || response.body == null) {
                    Log.e(TAG, "HTTP Download Error: ${response.code}")
                    return
                }

                val tempFile = File(patchManager.getTempDir(), "patch_${System.currentTimeMillis()}.tmp")
                try {
                    response.body!!.byteStream().use { input ->
                        FileOutputStream(tempFile).use { output ->
                            input.copyTo(output)
                        }
                    }
                    Log.i(TAG, "Patch downloaded to temp (${tempFile.length()} bytes). Applying atomically...")

                    val success = patchManager.applyDeltaPatchAtomic(
                        tempFile,
                        signatureHex,
                        expectedHash,
                        deletedFilesJson
                    )

                    if (success) {
                        mainHandler.post {
                            Log.i(TAG, "Triggering UI Hot-Reload on Main Thread...")
                            onHotReloadTriggered(version, changelogStr)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error processing downloaded patch: ${e.message}", e)
                    if (tempFile.exists()) tempFile.delete()
                }
            }
        })
    }

    fun reportStatus(status: String) {
        val payload = JSONObject().apply {
            put("platform", "Native Android Kotlin Container")
            put("status", status)
            put("timestamp", System.currentTimeMillis())
        }
        socket?.emit("client-status-report", payload)
    }

    fun disconnect() {
        socket?.disconnect()
    }
}
