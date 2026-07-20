import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('hermes-skills-deploy', () => {
  let workDir: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'hermieos-skills-'));
    sourceDir = join(workDir, 'source');
    targetDir = join(workDir, 'target');
    // Create two source skills
    mkdirSync(join(sourceDir, 'hermieos'), { recursive: true });
    writeFileSync(join(sourceDir, 'hermieos', 'SKILL.md'), '---\nname: hermieos\n---\n# orchestrator\n');
    mkdirSync(join(sourceDir, 'hermieos', 'reference'), { recursive: true });
    writeFileSync(join(sourceDir, 'hermieos', 'reference', 'mcp-tools.md'), '# mcp tools\n');
    mkdirSync(join(sourceDir, 'hermieos-subscription'), { recursive: true });
    writeFileSync(join(sourceDir, 'hermieos-subscription', 'SKILL.md'), '---\nname: hermieos-subscription\n---\n# sub\n');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function runDeploy(): { code: number; stdout: string; stderr: string } {
    process.env.HERMES_SKILLS_SOURCE = sourceDir;
    process.env.HERMES_SKILLS_TARGET = targetDir;
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const result = spawnSync('node', [
      '--import', 'tsx',
      join(import.meta.dirname, 'hermes-skills-deploy.ts'),
    ], {
      env: { ...process.env, HERMES_SKILLS_SOURCE: sourceDir, HERMES_SKILLS_TARGET: targetDir },
      encoding: 'utf8',
      // Capture both: we mix console.log (stdout) and console.warn
      // (stderr) in the deployer.
    });
    return { code: result.status ?? -1, stdout: result.stdout + result.stderr, stderr: result.stderr };
  }

  it('installs skills on a fresh target', () => {
    const r = runDeploy();
    expect(r.code).toBe(0);
    expect(existsSync(join(targetDir, 'hermieos', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'hermieos', 'reference', 'mcp-tools.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'hermieos-subscription', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, '.hermieos_manifest'))).toBe(true);
  });

  it('is idempotent when source is unchanged', () => {
    runDeploy();
    const r = runDeploy();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/unchanged: hermieos/);
    expect(r.stdout).toMatch(/0 installed/);
    expect(r.stdout).toMatch(/unchanged/);
  });

  it('detects user edits and marks user_modified=true (no overwrite)', () => {
    runDeploy();
    // User edits a skill on disk
    appendFileSync(join(targetDir, 'hermieos', 'SKILL.md'), '\n<!-- user note -->\n');
    const r = runDeploy();
    // Exit code 2 = "warnings, see result.warned"
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/user has modified hermieos/);
    // Manifest records the change
    const m = JSON.parse(readFileSync(join(targetDir, '.hermieos_manifest'), 'utf8'));
    expect(m.skills.hermieos.user_modified).toBe(true);
    // On-disk file still has the user note
    const onDisk = readFileSync(join(targetDir, 'hermieos', 'SKILL.md'), 'utf8');
    expect(onDisk).toContain('user note');
  });

  it('overwrites cleanly when source changes but user has not edited', () => {
    runDeploy();
    // Source gets a new commit (we rewrite a file)
    writeFileSync(join(sourceDir, 'hermieos', 'SKILL.md'), '---\nname: hermieos\n---\n# orchestrator v2\n');
    const r = runDeploy();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/updating: hermieos/);
    const onDisk = readFileSync(join(targetDir, 'hermieos', 'SKILL.md'), 'utf8');
    expect(onDisk).toContain('v2');
  });

  it('warns on conflict when both source and on-disk changed', () => {
    runDeploy();
    // User edits
    appendFileSync(join(targetDir, 'hermieos', 'SKILL.md'), '\n<!-- user note -->\n');
    // Source also changes
    writeFileSync(join(sourceDir, 'hermieos', 'SKILL.md'), '---\nname: hermieos\n---\n# orchestrator v2\n');
    const r = runDeploy();
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/CONFLICT on hermieos/);
  });

  it('--force overwrites a user-edited skill', () => {
    runDeploy();
    appendFileSync(join(targetDir, 'hermieos', 'SKILL.md'), '\n<!-- user note -->\n');
    writeFileSync(join(sourceDir, 'hermieos', 'SKILL.md'), '---\nname: hermieos\n---\n# v2\n');
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const result = spawnSync('node', [
      '--import', 'tsx',
      join(import.meta.dirname, 'hermes-skills-deploy.ts'),
    ], {
      env: {
        ...process.env,
        HERMES_SKILLS_SOURCE: sourceDir,
        HERMES_SKILLS_TARGET: targetDir,
        HERMES_FORCE: '1',
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const onDisk = readFileSync(join(targetDir, 'hermieos', 'SKILL.md'), 'utf8');
    expect(onDisk).toContain('v2');
    expect(onDisk).not.toContain('user note');
  });

  it('removes a skill that is in the manifest but no longer in source', () => {
    runDeploy();
    expect(existsSync(join(targetDir, 'hermieos-subscription', 'SKILL.md'))).toBe(true);
    // Remove from source
    rmSync(join(sourceDir, 'hermieos-subscription'), { recursive: true, force: true });
    const r = runDeploy();
    expect(r.code).toBe(0);
    expect(existsSync(join(targetDir, 'hermieos-subscription', 'SKILL.md'))).toBe(false);
    const m = JSON.parse(readFileSync(join(targetDir, '.hermieos_manifest'), 'utf8'));
    expect(m.skills['hermieos-subscription']).toBeUndefined();
  });
});
