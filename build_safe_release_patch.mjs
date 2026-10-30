// build_safe_release_patch.mjs
// Guardian v3.9 Non-Destructive Release Patch Builder & Disposable Worktree Verifier.
// Safety guarantees:
// 1. Aborts if any tracked file has uncommitted changes.
// 2. Aborts if the output patch file already exists (never overwrites existing patch artifacts).
// 3. NEVER modifies ./worker/index.js in the current checkout unless `--apply-working-tree` is explicitly passed.
// 4. Builds and verifies applying the complete patch (`worker/proof.mjs` + `worker/index.js`) inside isolated temporary git worktrees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const applyWorkingTreeOptIn = args.includes('--apply-working-tree');
const outArg = args.find((a) => a.startsWith('--out='));
const outFilename = outArg ? outArg.slice('--out='.length).trim() : 'guardian_v39_complete.patch';

const repoRoot = process.cwd();
const indexPath = path.join(repoRoot, 'worker', 'index.js');
const proofPath = path.join(repoRoot, 'worker', 'proof.mjs');
const patchOutPath = path.resolve(repoRoot, outFilename);

if (!fs.existsSync(indexPath) || !fs.existsSync(proofPath)) {
  console.error('ERROR: Both ./worker/index.js and ./worker/proof.mjs must exist before building patch.');
  process.exit(1);
}

// 1. Refuse to overwrite an existing patch artifact
if (fs.existsSync(patchOutPath)) {
  console.error(
    `ABORTING (PATCH SAFETY): Output patch file already exists at "${patchOutPath}". Refusing to overwrite existing artifact. Specify a new path with --out=<filename>.`
  );
  process.exit(1);
}

// 2. Strict cleanliness check on tracked files
const trackedStatus = execSync('git status --porcelain --untracked-files=no', {
  cwd: repoRoot,
})
  .toString()
  .trim();

if (trackedStatus.length > 0) {
  console.error(
    'ABORTING (SAFEGUARD): Tracked files have uncommitted changes. Refusing to build patch from a dirty working tree:\n' +
      trackedStatus
  );
  process.exit(1);
}

const headSha = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
const proofContent = fs.readFileSync(proofPath, 'utf8');
const originalIndexContent = fs.readFileSync(indexPath, 'utf8');

const importStatement = `import {\n  assertNoSpoofedEvaluationFields,\n  buildDecisionProofFromRunResult,\n} from './proof.mjs';\n`;

const targetPattern =
  /const\s+result\s*=\s*await\s+runCultureShift\(\s*env\s*,\s*\{\s*candidates:\s*CANDIDATES\s*,\s*audienceSignals:\s*\[\s*audienceSignal\s*\]\s*,\s*preserveTags:\s*requestedPreserveTags\s*,?\s*\}\s*\)\s*;\s*return\s+json\(\s*result\s*\)\s*;/m;

if (!targetPattern.test(originalIndexContent)) {
  console.error('ERROR: Could not locate exact runCultureShift call pattern in worker/index.js.');
  process.exit(1);
}

const replacementBlock = `const spoofCheck = assertNoSpoofedEvaluationFields(body);
      if (!spoofCheck.ok) {
        return json({ error: spoofCheck.error }, 400);
      }
      const result = await runCultureShift(env, {
        candidates: CANDIDATES,
        audienceSignals: [audienceSignal],
        preserveTags: requestedPreserveTags,
      });
      const decision_proof = await buildDecisionProofFromRunResult(result, {
        requestedPreserveTags,
        audienceSignals: [audienceSignal],
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
        knownCandidatePool: CANDIDATES,
      });
      return json({ ...result, decision_proof });`;

const patchedIndexContent =
  (originalIndexContent.includes('./proof.mjs') ? '' : importStatement) +
  originalIndexContent.replace(targetPattern, replacementBlock);

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-guardian-v39-'));
const buildWorktree = path.join(tmpBase, 'build-wt');
const verifyWorktree = path.join(tmpBase, 'verify-wt');

try {
  // 3. Create disposable build worktree at HEAD
  execSync(`git worktree add --detach "${buildWorktree}" ${headSha}`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  fs.writeFileSync(path.join(buildWorktree, 'worker', 'proof.mjs'), proofContent, 'utf8');
  fs.writeFileSync(path.join(buildWorktree, 'worker', 'index.js'), patchedIndexContent, 'utf8');
  execSync('git add -N worker/proof.mjs', { cwd: buildWorktree, stdio: 'pipe' });

  const completeDiff = execSync('git diff HEAD -- worker/proof.mjs worker/index.js', {
    cwd: buildWorktree,
  }).toString();

  fs.writeFileSync(patchOutPath, completeDiff, 'utf8');

  // 4. Verify applying the complete patch to a second fresh disposable worktree at HEAD
  execSync(`git worktree add --detach "${verifyWorktree}" ${headSha}`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  execSync(`git apply --check "${patchOutPath}"`, { cwd: verifyWorktree, stdio: 'pipe' });
  execSync(`git apply "${patchOutPath}"`, { cwd: verifyWorktree, stdio: 'pipe' });

  const verifyProofExists = fs.existsSync(path.join(verifyWorktree, 'worker', 'proof.mjs'));
  if (!verifyProofExists) {
    throw new Error('Disposable checkout verification failed: worker/proof.mjs missing after git apply.');
  }

  // 5. Only modify local ./worker/index.js if explicit `--apply-working-tree` flag was provided
  if (applyWorkingTreeOptIn) {
    fs.writeFileSync(indexPath, patchedIndexContent, 'utf8');
    console.log(
      `[PASS] Complete patch "${path.basename(patchOutPath)}" (anchored to commit ${headSha}) verified in disposable checkout, and applied to local worker/index.js via explicit --apply-working-tree opt-in.`
    );
  } else {
    console.log(
      `[PASS] Complete patch "${path.basename(patchOutPath)}" (anchored to commit ${headSha}) verified in disposable checkout. Local worker/index.js preserved unmodified (pass --apply-working-tree to opt in).`
    );
  }
} finally {
  try {
    execSync(`git worktree remove --force "${buildWorktree}"`, { cwd: repoRoot, stdio: 'pipe' });
  } catch {}
  try {
    execSync(`git worktree remove --force "${verifyWorktree}"`, { cwd: repoRoot, stdio: 'pipe' });
  } catch {}
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {}
}
