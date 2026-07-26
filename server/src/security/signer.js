const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '../../keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');
const PUBLIC_KEY_HEX_PATH = path.join(KEYS_DIR, 'public_hex.txt');

/**
 * Manages Ed25519 cryptographic keypairs and signing for CDDUA delta patches.
 */
class SecuritySigner {
  constructor() {
    this.privateKey = null;
    this.publicKey = null;
    this.publicKeyHex = null;
    this.initKeys();
  }

  /**
   * Initializes or loads the Ed25519 keypair.
   */
  initKeys() {
    if (!fs.existsSync(KEYS_DIR)) {
      fs.mkdirSync(KEYS_DIR, { recursive: true });
    }

    if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
      console.log('[SecuritySigner] Loading existing Ed25519 keypair from /keys...');
      this.privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH));
      this.publicKey = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_PATH));
      if (fs.existsSync(PUBLIC_KEY_HEX_PATH)) {
        this.publicKeyHex = fs.readFileSync(PUBLIC_KEY_HEX_PATH, 'utf8').trim();
      } else {
        this.publicKeyHex = this.exportPublicKeyToHex(this.publicKey);
        fs.writeFileSync(PUBLIC_KEY_HEX_PATH, this.publicKeyHex);
      }
    } else {
      console.log('[SecuritySigner] Generating new Ed25519 keypair...');
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      this.privateKey = privateKey;
      this.publicKey = publicKey;

      // Save PEM files
      fs.writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }));
      fs.writeFileSync(PUBLIC_KEY_PATH, publicKey.export({ type: 'spki', format: 'pem' }));

      // Extract raw 32-byte public key in Hex for easy Kotlin integration
      this.publicKeyHex = this.exportPublicKeyToHex(publicKey);
      fs.writeFileSync(PUBLIC_KEY_HEX_PATH, this.publicKeyHex);

      console.log('[SecuritySigner] New Ed25519 keypair generated and saved to /keys.');
      console.log('[SecuritySigner] Public Key (Hex):', this.publicKeyHex);
    }
  }

  /**
   * Extracts raw 32-byte Ed25519 public key in hex format from a Node PublicKey object.
   * In SPKI DER format for Ed25519, the last 32 bytes are the raw public key.
   */
  exportPublicKeyToHex(publicKeyObj) {
    const der = publicKeyObj.export({ type: 'spki', format: 'der' });
    // Ed25519 SPKI header is 12 bytes: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes of key>
    const rawKey = der.subarray(der.length - 32);
    return rawKey.toString('hex');
  }

  /**
   * Signs a data buffer using the Ed25519 private key.
   * @param {Buffer} buffer - Data buffer to sign (usually the SHA-256 hash or zip payload)
   * @returns {string} Hex-encoded signature (64 bytes / 128 hex characters)
   */
  sign(buffer) {
    if (!this.privateKey) {
      throw new Error('Private key not initialized.');
    }
    // For Ed25519 in Node crypto, passing null as algorithm signs the data directly using Ed25519
    const signature = crypto.sign(null, buffer, this.privateKey);
    return signature.toString('hex');
  }

  /**
   * Verifies an Ed25519 signature against a data buffer.
   * @param {Buffer} buffer - The signed data buffer
   * @param {string} signatureHex - Hex-encoded signature
   * @param {string} [pubKeyHex] - Optional hex public key to verify against (defaults to server pubKey)
   * @returns {boolean} True if signature is valid
   */
  verify(buffer, signatureHex, pubKeyHex = null) {
    try {
      const sigBuffer = Buffer.from(signatureHex, 'hex');
      let verifyKey = this.publicKey;

      if (pubKeyHex) {
        // Construct SPKI DER from raw 32-byte hex key
        const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
        const rawKey = Buffer.from(pubKeyHex, 'hex');
        const der = Buffer.concat([spkiHeader, rawKey]);
        verifyKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      }

      return crypto.verify(null, buffer, verifyKey, sigBuffer);
    } catch (err) {
      console.error('[SecuritySigner] Verification error:', err.message);
      return false;
    }
  }

  getPublicKeyHex() {
    return this.publicKeyHex;
  }

  getPublicKeyPem() {
    return this.publicKey.export({ type: 'spki', format: 'pem' });
  }
}

module.exports = new SecuritySigner();
