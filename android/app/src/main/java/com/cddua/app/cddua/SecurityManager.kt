package com.cddua.app.cddua

import android.util.Log
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.util.encoders.Hex
import java.io.File
import java.security.MessageDigest

/**
 * Handles cryptographic Ed25519 verification for CDDUA delta patches.
 * Ensures community members only receive authentic updates signed by the authorized server.
 */
object SecurityManager {
    private const val TAG = "CDDUA-Security"

    // Hardcoded Server Ed25519 Public Key (32 bytes in Hex).
    // In production, this is embedded at compile time.
    // For R&D testing, if this matches the server's generated public key, verification succeeds.
    // We default to a standard 64-character hex string; PatchManager can also load the matching test key from assets/config if needed.
    var HARDCODED_SERVER_PUBLIC_KEY_HEX: String = "0000000000000000000000000000000000000000000000000000000000000000"

    /**
     * Initializes the public key from local storage or server sync for testing demonstration.
     */
    fun initPublicKey(keyHex: String) {
        if (keyHex.length == 64) {
            HARDCODED_SERVER_PUBLIC_KEY_HEX = keyHex
            Log.i(TAG, "Initialized Ed25519 Public Key: ${keyHex.substring(0, 16)}...")
        }
    }

    /**
     * Mathematically verifies an Ed25519 digital signature against a payload buffer.
     *
     * @param data The raw byte array of the downloaded .zip delta patch
     * @param signatureHex The 128-character hex signature string provided by the server
     * @param pubKeyHex Optional hex public key override (defaults to hardcoded server key)
     * @return true if the signature is mathematically valid and signed by the server's private key
     */
    fun verifyEd25519Signature(data: ByteArray, signatureHex: String, pubKeyHex: String = HARDCODED_SERVER_PUBLIC_KEY_HEX): Boolean {
        try {
            if (signatureHex.length != 128 || pubKeyHex.length != 64) {
                Log.e(TAG, "Invalid hex lengths: sig=${signatureHex.length}, pubKey=${pubKeyHex.length}")
                return false
            }

            val sigBytes = Hex.decode(signatureHex)
            val pubKeyBytes = Hex.decode(pubKeyHex)

            // Initialize BouncyCastle Ed25519 verifier
            val pubKeyParams = Ed25519PublicKeyParameters(pubKeyBytes, 0)
            val verifier = Ed25519Signer()
            verifier.init(false, pubKeyParams)
            verifier.update(data, 0, data.size)

            val isValid = verifier.verifySignature(sigBytes)
            if (isValid) {
                Log.i(TAG, "✓ Ed25519 Cryptographic Signature VERIFIED Successfully!")
            } else {
                Log.e(TAG, "✗ Ed25519 Signature Verification FAILED! Possible spoofing attempt.")
            }
            return isValid
        } catch (e: Exception) {
            Log.e(TAG, "Error during Ed25519 verification: ${e.message}", e)
            return false
        }
    }

    /**
     * Computes SHA-256 hash of a file for manifest integrity checking.
     */
    fun computeSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { fis ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (fis.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }
        return Hex.toHexString(digest.digest())
    }
}
