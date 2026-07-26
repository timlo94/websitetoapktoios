package com.cddua.app.cddua

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipFile

/**
 * Manages atomic filesystem staging, patching, and rollback for CDDUA in sandboxed storage.
 */
class PatchManager(private val context: Context) {
    companion object {
        private const val TAG = "CDDUA-PatchManager"
        private const val DIR_WWW = "www"
        private const val DIR_WWW_OLD = "www_old"
        private const val DIR_WWW_STAGING = "www_staging"
        private const val DIR_TEMP = "temp"
    }

    private val filesDir: File = context.filesDir
    val wwwDir: File = File(filesDir, DIR_WWW)
    private val wwwOldDir: File = File(filesDir, DIR_WWW_OLD)
    private val wwwStagingDir: File = File(filesDir, DIR_WWW_STAGING)
    private val tempDir: File = File(filesDir, DIR_TEMP)

    init {
        ensureDirectories()
    }

    private fun ensureDirectories() {
        if (!wwwDir.exists()) wwwDir.mkdirs()
        if (!tempDir.exists()) tempDir.mkdirs()
    }

    /**
     * Initializes the sandboxed www/ directory from APK assets if empty or if APK was updated/re-installed.
     */
    fun initFromAssetsIfEmpty(assetFolderName: String = "www_initial"): Boolean {
        val prefs = context.getSharedPreferences("cddua_prefs", Context.MODE_PRIVATE)
        val lastUpdateTime = try {
            context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
        } catch (e: Exception) {
            0L
        }
        val storedUpdateTime = prefs.getLong("apk_last_update_time", -1L)
        val isApkUpdated = (lastUpdateTime != storedUpdateTime) && (lastUpdateTime > 0L)

        if (File(wwwDir, "index.html").exists() && !isApkUpdated) {
            Log.i(TAG, "Sandboxed www/ directory already initialized and APK not updated.")
            return false
        }
        if (isApkUpdated) {
            Log.i(TAG, "New APK build detected (lastUpdateTime=$lastUpdateTime)! Overwriting sandboxed www/ from APK assets...")
        } else {
            Log.i(TAG, "Initializing sandboxed www/ from APK assets: $assetFolderName")
        }
        try {
            copyAssetFolder(assetFolderName, wwwDir)
            prefs.edit().putLong("apk_last_update_time", lastUpdateTime).apply()
            Log.i(TAG, "✓ Sandboxed www/ directory initialized successfully.")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize from assets: ${e.message}", e)
            return false
        }
    }

    private fun copyAssetFolder(assetPath: String, targetDir: File) {
        val assetManager = context.assets
        val assets = assetManager.list(assetPath) ?: return

        if (assets.isEmpty()) {
            // It's a file
            assetManager.open(assetPath).use { input ->
                FileOutputStream(targetDir).use { output ->
                    input.copyTo(output)
                }
            }
        } else {
            // It's a directory
            if (!targetDir.exists()) targetDir.mkdirs()
            for (asset in assets) {
                val subAssetPath = if (assetPath.isEmpty()) asset else "$assetPath/$asset"
                val subTargetFile = File(targetDir, asset)
                copyAssetFolder(subAssetPath, subTargetFile)
            }
        }
    }

    /**
     * Applies a downloaded delta patch zip atomically with rollback protection.
     *
     * @param zipFile The downloaded temporary zip patch in temp/
     * @param signatureHex Ed25519 hex signature from server
     * @param expectedHash SHA-256 hash expected by manifest
     * @param deletedFilesJson JSONArray of relative file paths to delete
     * @return true if atomic update succeeded and active www/ was promoted
     */
    fun applyDeltaPatchAtomic(
        zipFile: File,
        signatureHex: String,
        expectedHash: String,
        deletedFilesJson: JSONArray?
    ): Boolean {
        Log.i(TAG, "Starting Atomic Update Flow for patch: ${zipFile.name}")

        // Step 1: Verify SHA-256 Hash
        val actualHash = SecurityManager.computeSha256(zipFile)
        if (!actualHash.equals(expectedHash, ignoreCase = true)) {
            Log.e(TAG, "✗ SHA-256 Hash Mismatch! Expected: $expectedHash, Got: $actualHash. Wiping temp payload.")
            zipFile.delete()
            return false
        }

        // Step 2: Verify Ed25519 Cryptographic Signature
        val payloadBytes = zipFile.readBytes()
        if (!SecurityManager.verifyEd25519Signature(payloadBytes, signatureHex)) {
            Log.e(TAG, "✗ Security Violation: Ed25519 signature check failed! Update rejected and deleted.")
            zipFile.delete()
            return false
        }

        // Step 3: Prepare Staging Directory (www_staging)
        try {
            if (wwwStagingDir.exists()) wwwStagingDir.deleteRecursively()
            wwwStagingDir.mkdirs()

            // Copy current active www/ to www_staging/ as the base for merging
            Log.i(TAG, "Cloning active www/ to www_staging/...")
            wwwDir.copyRecursively(wwwStagingDir, overwrite = true)

            // Step 4: Extract and merge delta zip files into www_staging/
            Log.i(TAG, "Extracting delta zip into www_staging/...")
            ZipFile(zipFile).use { zip ->
                val entries = zip.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.isDirectory || entry.name == "patch.json") continue

                    val targetFile = File(wwwStagingDir, entry.name)
                    // Prevent zip slip security attack
                    if (!targetFile.canonicalPath.startsWith(wwwStagingDir.canonicalPath)) {
                        throw SecurityException("Zip Slip attack detected in entry: ${entry.name}")
                    }

                    targetFile.parentFile?.mkdirs()
                    zip.getInputStream(entry).use { input ->
                        FileOutputStream(targetFile).use { output ->
                            input.copyTo(output)
                        }
                    }
                }
            }

            // Step 5: Prune deleted files
            if (deletedFilesJson != null) {
                for (i in 0 until deletedFilesJson.length()) {
                    val relPath = deletedFilesJson.getString(i)
                    val fileToDelete = File(wwwStagingDir, relPath)
                    if (fileToDelete.exists()) {
                        fileToDelete.delete()
                        Log.i(TAG, "Pruned deleted file: $relPath")
                    }
                }
            }

            // Step 6: Atomic Commit & Rollback Protection
            Log.i(TAG, "Executing Atomic Filesystem Swap...")
            if (wwwOldDir.exists()) wwwOldDir.deleteRecursively()

            // Rename active www -> www_old
            val backupSuccess = wwwDir.renameTo(wwwOldDir)
            if (!backupSuccess && wwwDir.exists()) {
                throw IllegalStateException("Failed to backup active www/ directory.")
            }

            // Promote staging www_staging -> www
            val promoteSuccess = wwwStagingDir.renameTo(wwwDir)
            if (!promoteSuccess) {
                Log.e(TAG, "CRITICAL: Failed to promote www_staging/ to www/! Executing automatic rollback...")
                // Rollback: Restore www_old -> www
                wwwOldDir.renameTo(wwwDir)
                throw IllegalStateException("Atomic promotion failed. Rolled back to previous version.")
            }

            // Success! Clean up old backup and temp zip
            Log.i(TAG, "✓ ATOMIC UPDATE SUCCESSFUL! New web application live in sandboxed storage.")
            wwwOldDir.deleteRecursively()
            zipFile.delete()
            return true

        } catch (e: Exception) {
            Log.e(TAG, "✗ Atomic Update Exception: ${e.message}. Ensuring rollback state.", e)
            if (!wwwDir.exists() && wwwOldDir.exists()) {
                Log.w(TAG, "Restoring www_old -> www...")
                wwwOldDir.renameTo(wwwDir)
            }
            if (wwwStagingDir.exists()) wwwStagingDir.deleteRecursively()
            zipFile.delete()
            return false
        }
    }

    fun getTempDir(): File = tempDir
}
