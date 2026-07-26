const fs = require('fs');
const path = require('path');
const assert = require('assert');
const merkle = require('./src/diffing/merkle');
const patcher = require('./src/diffing/patcher');
const signer = require('./src/security/signer');
const engine = require('./src/index');

console.log('================================================================');
console.log('STARTING CDDUA END-TO-END VERIFICATION SUITE');
console.log('================================================================');

async function runTests() {
  try {
    // 1. Verify Ed25519 Keypair Generation
    console.log('\n[Test 1] Verifying Ed25519 Cryptographic Signer...');
    const pubKeyHex = signer.getPublicKeyHex();
    const pubKeyPem = signer.getPublicKeyPem();
    assert.strictEqual(pubKeyHex.length, 64, 'Public key hex should be exactly 64 characters (32 bytes)');
    assert.ok(pubKeyPem.includes('BEGIN PUBLIC KEY'), 'PEM format should be valid');
    
    const testData = Buffer.from('CDDUA Cryptographic Verification Test Payload');
    const signature = signer.sign(testData);
    assert.strictEqual(signature.length, 128, 'Ed25519 signature should be exactly 128 hex characters (64 bytes)');
    const isValid = signer.verify(testData, signature);
    assert.strictEqual(isValid, true, 'Signature verification against self must succeed');
    console.log('✓ Ed25519 Cryptographic Keypair & Signing Verified Successfully!');

    // 2. Verify Merkle Tree Manifest Generation
    console.log('\n[Test 2] Verifying SHA-256 Merkle Manifest & Initial Bundle...');
    const webappDir = path.join(__dirname, '../webapp');
    const manifest = merkle.generateManifest(webappDir, 'v_test_1');
    assert.ok(manifest.merkleRoot, 'Merkle root must be generated');
    assert.ok(manifest.fileCount > 0, 'Must detect webapp files');
    assert.ok(manifest.files['index.html'], 'index.html must be present in manifest');
    console.log(`✓ Merkle Manifest generated. Root Hash: ${manifest.merkleRoot}`);

    // 3. Verify Initial Bundle Zip Creation & Android Asset Sync
    const bundle = patcher.createInitialBundle(webappDir, manifest, 'test_bundle.zip');
    assert.ok(fs.existsSync(bundle.filePath), 'Initial bundle zip must exist on disk');
    assert.strictEqual(signer.verify(fs.readFileSync(bundle.filePath), bundle.signature), true, 'Bundle signature must be valid');
    
    const androidAssetsDir = path.join(__dirname, '../android/app/src/main/assets/www_initial');
    assert.ok(fs.existsSync(path.join(androidAssetsDir, 'index.html')), 'Android assets must be synced');
    console.log('✓ Initial Bundle Zip created & Android APK assets synced!');

    // 4. Verify Delta Patch Generation & Algorithmic Diffing
    console.log('\n[Test 3] Simulating Webapp File Modification & Delta Patch Generation...');
    const testFilePath = path.join(webappDir, 'test_dynamic.txt');
    fs.writeFileSync(testFilePath, 'Initial dynamic content for CDDUA test.', 'utf8');
    
    const manifestV2 = merkle.generateManifest(webappDir, 'v_test_2');
    const diffBeforeChange = merkle.compareManifests(manifestV2, manifestV2);
    assert.strictEqual(diffBeforeChange.hasChanges, false, 'Identical manifests must have no changes');

    // Modify file
    fs.writeFileSync(testFilePath, 'UPDATED content! This represents a developer tweaking the web app.', 'utf8');
    const manifestV3 = merkle.generateManifest(webappDir, 'v_test_3');
    const diffAfterChange = merkle.compareManifests(manifestV2, manifestV3);
    
    assert.strictEqual(diffAfterChange.hasChanges, true, 'Must detect changes');
    assert.ok(diffAfterChange.modified.includes('test_dynamic.txt'), 'Must identify test_dynamic.txt as modified');
    assert.strictEqual(diffAfterChange.added.length, 0, 'No files added');
    assert.notStrictEqual(diffAfterChange.oldMerkleRoot, diffAfterChange.newMerkleRoot, 'Merkle root must change when content changes');

    const deltaPatch = patcher.createDeltaPatch(webappDir, diffAfterChange, manifestV3);
    assert.ok(fs.existsSync(deltaPatch.filePath), 'Delta zip must exist on disk');
    assert.ok(deltaPatch.size < bundle.size, 'Delta patch size must be significantly smaller than full initial bundle!');
    assert.strictEqual(signer.verify(fs.readFileSync(deltaPatch.filePath), deltaPatch.signature), true, 'Delta patch Ed25519 signature must be valid');
    console.log(`✓ Delta Patch generated successfully! Size: ${deltaPatch.size} bytes (vs Full Bundle: ${bundle.size} bytes).`);
    console.log(`✓ Delta Patch Changelog:`, deltaPatch.changelog);

    // Clean up test file
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    console.log('\n================================================================');
    console.log('ALL 4 CDDUA ARCHITECTURAL R&D TESTS PASSED SUCCESSFULLY! 🚀');
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ TEST FAILED WITH ERROR:', err);
    process.exit(1);
  }
}

runTests();
