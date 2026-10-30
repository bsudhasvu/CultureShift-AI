// verify_patch_safety.mjs
// Exercises build_safe_release_patch.mjs across clean checkout, existing patch preservation,
// dirty checkout abort, and explicit --apply-working-tree opt-in.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runPatchSafetySuite() {
  const sourceBuilderPath = path.resolve('./build_safe_release_patch.mjs');
  const sourceProofPath = path.resolve('./worker/proof.mjs');
  assert.ok(fs.existsSync(sourceBuilderPath), 'build_safe_release_patch.mjs must exist');
  assert.ok(fs.existsSync(sourceProofPath), 'worker/proof.mjs must exist');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-v39-patch-safety-'));

  try {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test Runner"', { cwd: tmpDir, stdio: 'pipe' });

    fs.mkdirSync(path.join(tmpDir, 'worker'), { recursive: true });
    const sampleWorkerIndex = `const CANDIDATES = [{ id: 'c1', scope: 1 }];\nexport default {\n  async fetch(request, env) {\n    const body = {};\n    const audienceSignal = 'bts';\n    const requestedPreserveTags = ['sitar'];\n    const result = await runCultureShift(env, {\n      candidates: CANDIDATES,\n      audienceSignals: [audienceSignal],\n      preserveTags: requestedPreserveTags,\n    });\n    return json(result);\n  }\n};\n`;
    const workerIndexFile = path.join(tmpDir, 'worker', 'index.js');
    fs.writeFileSync(workerIndexFile, sampleWorkerIndex, 'utf8');

    execSync('git add worker/index.js', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "base commit"', { cwd: tmpDir, stdio: 'pipe' });

    const originalWorkerIndexHash = sha256File(workerIndexFile);

    // Copy proof.mjs and build_safe_release_patch.mjs into disposable repo
    fs.copyFileSync(sourceProofPath, path.join(tmpDir, 'worker', 'proof.mjs'));
    fs.copyFileSync(sourceBuilderPath, path.join(tmpDir, 'build_safe_release_patch.mjs'));

    // TEST 1: Clean checkout default run builds patch AND leaves worker/index.js unmodified
    {
      const res = spawnSync('node', ['build_safe_release_patch.mjs'], {
        cwd: tmpDir,
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, `Expected exit 0 on clean checkout, got: ${res.stderr}`);
      assert.equal(
        sha256File(workerIndexFile),
        originalWorkerIndexHash,
        'Default patch builder run must NOT modify worker/index.js without --apply-working-tree'
      );
      const patchPath = path.join(tmpDir, 'guardian_v39_complete.patch');
      assert.ok(fs.existsSync(patchPath), 'guardian_v39_complete.patch must be created');
      const patchText = fs.readFileSync(patchPath, 'utf8');
      assert.match(patchText, /a\/worker\/proof\.mjs/);
      assert.match(patchText, /a\/worker\/index\.js/);
      console.log('[PASS 1/4] Clean checkout builds complete patch and leaves worker/index.js unmodified by default.');
    }

    // TEST 2: Existing patch file is preserved (aborts with exit 1 instead of overwriting)
    {
      const patchPath = path.join(tmpDir, 'guardian_v39_complete.patch');
      fs.appendFileSync(patchPath, '\n# SENTINEL_DO_NOT_OVERWRITE\n', 'utf8');
      const sentinelHash = sha256File(patchPath);

      const res = spawnSync('node', ['build_safe_release_patch.mjs'], {
        cwd: tmpDir,
        encoding: 'utf8',
      });
      assert.notEqual(res.status, 0, 'Must abort with non-zero status when patch file already exists');
      assert.match(res.stderr, /already exists/);
      assert.equal(
        sha256File(patchPath),
        sentinelHash,
        'Existing patch file must be preserved byte-for-byte'
      );
      console.log('[PASS 2/4] Existing patch artifact preserved byte-for-byte; builder aborted safely.');
    }

    // TEST 3: Dirty tracked file aborts with exit 1 and preserves user's uncommitted edit
    {
      fs.appendFileSync(workerIndexFile, '// user uncommitted edit\n', 'utf8');
      const dirtyHash = sha256File(workerIndexFile);

      const res = spawnSync('node', ['build_safe_release_patch.mjs', '--out=dirty_attempt.patch'], {
        cwd: tmpDir,
        encoding: 'utf8',
      });
      assert.notEqual(res.status, 0, 'Must abort with non-zero status when tracked files are dirty');
      assert.match(res.stderr, /uncommitted changes/);
      assert.ok(
        !fs.existsSync(path.join(tmpDir, 'dirty_attempt.patch')),
        'Must not emit patch file from dirty checkout'
      );
      assert.equal(
        sha256File(workerIndexFile),
        dirtyHash,
        'User uncommitted edit in worker/index.js must remain untouched'
      );

      // Restore clean state for Test 4
      fs.writeFileSync(workerIndexFile, sampleWorkerIndex, 'utf8');
      console.log('[PASS 3/4] Dirty checkout aborted safely; user uncommitted edits preserved untouched.');
    }

    // TEST 4: Explicit `--apply-working-tree` opt-in modifies worker/index.js when requested
    {
      const res = spawnSync(
        'node',
        ['build_safe_release_patch.mjs', '--out=optin.patch', '--apply-working-tree'],
        { cwd: tmpDir, encoding: 'utf8' }
      );
      assert.equal(res.status, 0, `Expected exit 0 with --apply-working-tree, got: ${res.stderr}`);
      assert.notEqual(
        sha256File(workerIndexFile),
        originalWorkerIndexHash,
        'worker/index.js must be updated when --apply-working-tree is explicitly passed'
      );
      console.log('[PASS 4/4] Explicit --apply-working-tree opt-in flag applies changes only when requested.');
    }

    console.log('\nALL 4 PATCH SAFETY TESTS PASSED.');
  } finally {
    fs.rmSync(tmpBaseOrDir(tmpDir), { recursive: true, force: true });
  }
}

function tmpBaseOrDir(d) {
  return d;
}

runPatchSafetySuite();
