const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Merkle Tree and Manifest Generator for CDDUA web assets.
 */
class MerkleGenerator {
  /**
   * Recursively scans a directory and generates a SHA-256 hash for each file.
   * @param {string} dirPath - Absolute path to directory to scan
   * @param {string} [baseDir] - Base directory for computing relative paths
   * @returns {Object} Mapping of relative paths to { hash, size, lastModified }
   */
  scanDirectory(dirPath, baseDir = dirPath) {
    const results = {};
    if (!fs.existsSync(dirPath)) {
      return results;
    }

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      // Normalize to forward slashes for cross-platform compatibility (Android uses /)
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

      if (item.isDirectory()) {
        Object.assign(results, this.scanDirectory(fullPath, baseDir));
      } else if (item.isFile()) {
        // Ignore OS junk or hidden files if needed, or git files
        if (item.name.startsWith('.') || item.name === 'manifest.json' || item.name === 'patch.json') {
          continue;
        }

        const fileBuffer = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const stats = fs.statSync(fullPath);

        results[relPath] = {
          hash: hash,
          size: stats.size,
          lastModified: stats.mtimeMs
        };
      }
    }
    return results;
  }

  /**
   * Computes the Merkle Root (overall SHA-256 hash) from a file mapping object.
   * @param {Object} files - Mapping of relPath -> { hash }
   * @returns {string} Hex Merkle root hash
   */
  computeMerkleRoot(files) {
    const sortedPaths = Object.keys(files).sort();
    if (sortedPaths.length === 0) {
      return crypto.createHash('sha256').update('empty').digest('hex');
    }

    const hashInput = sortedPaths.map(p => `${p}:${files[p].hash}`).join('|');
    return crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generates a complete manifest for a given directory.
   * @param {string} targetDir - Absolute path to the webapp directory
   * @param {string} [version] - Version identifier string
   * @returns {Object} Complete manifest object
   */
  generateManifest(targetDir, version = null) {
    const files = this.scanDirectory(targetDir);
    const merkleRoot = this.computeMerkleRoot(files);
    const timestamp = Date.now();

    return {
      version: version || `v_${timestamp}`,
      timestamp: timestamp,
      merkleRoot: merkleRoot,
      fileCount: Object.keys(files).length,
      files: files
    };
  }

  /**
   * Compares an old manifest with a new manifest to determine delta changes.
   * @param {Object|null} oldManifest - Previous manifest (or null if initial)
   * @param {Object} newManifest - Newly generated manifest
   * @returns {Object} Diff summary: { added: [], modified: [], deleted: [], hasChanges: boolean }
   */
  compareManifests(oldManifest, newManifest) {
    const diff = {
      oldVersion: oldManifest ? oldManifest.version : null,
      newVersion: newManifest.version,
      oldMerkleRoot: oldManifest ? oldManifest.merkleRoot : null,
      newMerkleRoot: newManifest.merkleRoot,
      added: [],
      modified: [],
      deleted: [],
      hasChanges: false
    };

    const oldFiles = oldManifest ? oldManifest.files : {};
    const newFiles = newManifest.files || {};

    // Check for added and modified files
    for (const [relPath, fileData] of Object.entries(newFiles)) {
      if (!oldFiles[relPath]) {
        diff.added.push(relPath);
      } else if (oldFiles[relPath].hash !== fileData.hash) {
        diff.modified.push(relPath);
      }
    }

    // Check for deleted files
    for (const relPath of Object.keys(oldFiles)) {
      if (!newFiles[relPath]) {
        diff.deleted.push(relPath);
      }
    }

    diff.hasChanges = diff.added.length > 0 || diff.modified.length > 0 || diff.deleted.length > 0;
    return diff;
  }
}

module.exports = new MerkleGenerator();
