/**
 * Hermes skills deployer.
 *
 * Copies the hermieos skill bundle from `packages/skills/` into
 * `~/.hermes/skills/`. Idempotent. Honors a manifest so user-edited
 * skills are warned about, not silently overwritten.
 *
 * Layout in the source repo:
 *   packages/skills/
 *   ├── hermieos/                        # orchestrator
 *   │   ├── SKILL.md
 *   │   └── reference/mcp-tools.md
 *   ├── hermieos-subscription/SKILL.md
 *   ├── hermieos-feedback-review/SKILL.md
 *   └── hermieos-research/SKILL.md
 *
 * Layout in ~/.hermes/skills/ matches.
 *
 * Manifest format (written to ~/.hermes/skills/.hermieos_manifest):
 *   {
 *     "version": 1,
 *     "skills": {
 *       "hermieos": {
 *         "source_sha256": "abc...",
 *         "deployed_at": "2026-07-20T18:00:00Z",
 *         "user_modified": false
 *       }
 *     }
 *   }
 *
 * Behavior on rerun:
 * - For each skill in the source bundle, compute the SHA-256 of
 *   the canonical (recursive) file set.
 * - Look up the prior manifest entry. If the prior source_sha256
 *   matches the new one, just rewrite the files. No diff.
 * - If the prior SHA differs from the new one, AND the on-disk
 *   file set SHA does NOT match the prior source_sha256, the user
 *   has edited the skill. Warn, do not overwrite. Print the diff
 *   command. Set user_modified=true in the manifest.
 * - If the prior SHA differs and the on-disk SHA matches the prior
 *   source, the user has not edited; overwrite cleanly.
 *
 * Env:
 *   HERMES_SKILLS_SOURCE  - source dir (default: <repo>/packages/skills)
 *   HERMES_SKILLS_TARGET  - destination dir. Default is
 *     $HERMES_HOME/skills if $HERMES_HOME is set, else ~/.hermes/skills.
 *     Run this script inside the hermes container (where $HERMES_HOME
 *     is /opt/data) to update the live skills. The hermieos-init
 *     container in docker-compose.yml does this on first run.
 */
import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { homedir } from 'node:os';

const REPO_ROOT = process.env.HERMIEOS_REPO_ROOT ?? join(process.cwd(), '..', '..');
const SOURCE = process.env.HERMES_SKILLS_SOURCE ?? join(REPO_ROOT, 'packages', 'skills');
// When run inside the hermes container, $HERMES_HOME points at the live
// skills tree (default /opt/data). When run on the host, fall back to
// ~/.hermes/skills so local testing still works.
const TARGET =
  process.env.HERMES_SKILLS_TARGET
  ?? (process.env.HERMES_HOME
    ? join(process.env.HERMES_HOME, 'skills')
    : join(homedir(), '.hermes', 'skills'));
const FORCE = process.env.HERMES_FORCE === '1' || process.env.HERMES_FORCE === 'true';

const MANIFEST_VERSION = 1;
const MANIFEST_FILE = '.hermieos_manifest';

interface ManifestEntry {
  source_sha256: string;
  deployed_at: string;
  user_modified: boolean;
  /** Files we last deployed, relative to the skill dir. Used for
   *  exact removal when the skill is dropped from source. */
  files: string[];
}

interface Manifest {
  version: number;
  skills: Record<string, ManifestEntry>;
}

function readManifest(): Manifest {
  const path = join(TARGET, MANIFEST_FILE);
  if (!existsSync(path)) {
    return { version: MANIFEST_VERSION, skills: {} };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed.version !== MANIFEST_VERSION) {
      // eslint-disable-next-line no-console
      console.warn(`manifest version ${parsed.version} != expected ${MANIFEST_VERSION}; starting fresh`);
      return { version: MANIFEST_VERSION, skills: {} };
    }
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return { version: MANIFEST_VERSION, skills: {} };
  }
}

function writeManifest(m: Manifest): void {
  const path = join(TARGET, MANIFEST_FILE);
  writeFileSync(path, JSON.stringify(m, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        walk(full);
      } else if (st.isFile()) {
        out.push(relative(root, full));
      }
    }
  }
  walk(root);
  return out.sort();
}

function sha256OfFileset(root: string, files: string[]): string {
  const h = createHash('sha256');
  for (const rel of files) {
    const full = join(root, rel);
    h.update(rel.split(sep).join(posix.sep));
    h.update('\0');
    h.update(readFileSync(full));
    h.update('\0');
  }
  return h.digest('hex');
}

function copyFileset(src: string, dest: string, files: string[]): void {
  for (const rel of files) {
    const srcFull = join(src, rel);
    const destFull = join(dest, rel);
    mkdirSync(join(destFull, '..'), { recursive: true });
    const data = readFileSync(srcFull);
    writeFileSync(destFull, data);
  }
}

/**
 * Remove all files in a skill directory and the directory itself.
 * Walks the tree in reverse so empty parent directories are removed
 * last. The manifest entry is the source of truth for "what was
 * here" — we only remove files that were previously deployed.
 */
function rmFileset(dest: string, files: string[]): void {
  for (const rel of files) {
    const full = join(dest, rel);
    if (existsSync(full)) {
      try {
        unlinkSync(full);
      } catch {
        // ignore
      }
    }
  }
  // Also remove any now-empty parent directories we created. Walk
  // from deepest to shallowest.
  const parents = new Set<string>();
  for (const rel of files) {
    const full = join(dest, rel);
    let dir = join(full, '..');
    while (dir !== dest && dir.startsWith(dest)) {
      parents.add(dir);
      dir = join(dir, '..');
    }
  }
  const sorted = Array.from(parents).sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    try {
      const entries = readdirSync(dir);
      if (entries.length === 0) {
        rmdirSync(dir);
      }
    } catch {
      // ignore
    }
  }
  // Finally, remove the skill directory itself if it's empty.
  try {
    const entries = readdirSync(dest);
    if (entries.length === 0) {
      rmdirSync(dest);
    }
  } catch {
    // ignore
  }
}

function findSkillDirs(src: string): string[] {
  return readdirSync(src)
    .filter((entry) => {
      const full = join(src, entry);
      return statSync(full).isDirectory() && !entry.startsWith('.');
    })
    .sort();
}

interface DeployResult {
  installed: string[];
  unchanged: string[];
  warned: string[];
  removed: string[];
  failed: number;
}

export function deploySkills(): DeployResult {
  const result: DeployResult = {
    installed: [],
    unchanged: [],
    warned: [],
    removed: [],
    failed: 0,
  };

  if (!existsSync(SOURCE)) {
    // eslint-disable-next-line no-console
    console.error(`source skills dir not found: ${SOURCE}`);
    result.failed = 1;
    return result;
  }
  mkdirSync(TARGET, { recursive: true });

  const manifest = readManifest();
  const skillDirs = findSkillDirs(SOURCE);

  for (const skill of skillDirs) {
    const skillSrc = join(SOURCE, skill);
    const skillDest = join(TARGET, skill);
    const files = listFiles(skillSrc);
    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`skip ${skill}: no files in ${skillSrc}`);
      continue;
    }
    const newSha = sha256OfFileset(skillSrc, files);
    const onDiskFiles = existsSync(skillDest) ? listFiles(skillDest) : [];
    const onDiskSha = existsSync(skillDest) ? sha256OfFileset(skillDest, onDiskFiles) : '';
    const prior = manifest.skills[skill];

    // Decision matrix (source SHA x on-disk SHA x manifest):
    //
    //   newSha  onDiskSha  prior      action
    //   ------  ---------  ---------  ------
    //   =prior  =prior     (n/a)      skip: nothing changed
    //   =prior  !=prior    (n/a)      user has modified: mark user_modified=true, warn, keep on-disk
    //   !=prior =prior     n/a        source changed, user hasn't edited: overwrite
    //   !=prior !=prior    n/a        both changed: warn, ask (don't overwrite)
    //
    // If manifest says user_modified=true, we trust that and don't
    // overwrite unless --force is set.

    if (prior && prior.user_modified) {
      // We previously marked this as user-modified. Compare on-disk
      // to the source we last deployed.
      if (onDiskSha === prior.source_sha256) {
        // User has since reset their copy to the prior source. They
        // wanted our updates after all. Safe to overwrite.
        // eslint-disable-next-line no-console
        console.log(`updating ${skill} (user reset to prior version)`);
        copyFileset(skillSrc, skillDest, files);
        manifest.skills[skill] = {
          source_sha256: newSha,
          deployed_at: new Date().toISOString(),
          user_modified: false,
          files,
        };
        result.installed.push(skill);
        continue;
      }
      if (FORCE) {
        // eslint-disable-next-line no-console
        console.warn(`FORCE overwriting user-modified skill: ${skill}`);
        copyFileset(skillSrc, skillDest, files);
        manifest.skills[skill] = {
          source_sha256: newSha,
          deployed_at: new Date().toISOString(),
          user_modified: false,
          files,
        };
        result.installed.push(skill);
        continue;
      }
      // eslint-disable-next-line no-console
      console.warn(`SKIP ${skill}: user has modified it on disk.`);
      // eslint-disable-next-line no-console
      console.warn(`  source SHA:   ${newSha.slice(0, 12)}…`);
      // eslint-disable-next-line no-console
      console.warn(`  on-disk SHA:  ${onDiskSha.slice(0, 12)}…`);
      // eslint-disable-next-line no-console
      console.warn(`  to overwrite anyway, set HERMES_FORCE=1.`);
      result.warned.push(skill);
      continue;
    }

    if (prior && newSha === prior.source_sha256) {
      // Source didn't change since last deploy. If on-disk matches
      // the source, nothing to do. If on-disk differs, the user
      // has been editing without us knowing — flag it.
      if (onDiskSha === prior.source_sha256) {
        // eslint-disable-next-line no-console
        console.log(`unchanged: ${skill}`);
        result.unchanged.push(skill);
        continue;
      }
      // User modified. Mark and warn. Don't overwrite.
      // eslint-disable-next-line no-console
      console.warn(`user has modified ${skill}; marking as user_modified=true.`);
      // eslint-disable-next-line no-console
      console.warn(`  on-disk SHA: ${onDiskSha.slice(0, 12)}… (source: ${newSha.slice(0, 12)}…)`);
      manifest.skills[skill] = {
        source_sha256: newSha,
        deployed_at: new Date().toISOString(),
        user_modified: true,
        files,
      };
      result.warned.push(skill);
      continue;
    }

    if (prior && onDiskSha === prior.source_sha256) {
      // Source changed, user has not edited (on-disk still matches
      // the prior source). Overwrite cleanly.
      // eslint-disable-next-line no-console
      console.log(`updating: ${skill} (source changed)`);
      copyFileset(skillSrc, skillDest, files);
      manifest.skills[skill] = {
        source_sha256: newSha,
        deployed_at: new Date().toISOString(),
        user_modified: false,
        files,
      };
      result.installed.push(skill);
      continue;
    }

    if (prior) {
      // Source changed AND user has edited since last deploy. We
      // can't merge. Warn. The user resolves by either accepting
      // the new source (--force) or restoring their version.
      if (FORCE) {
        // eslint-disable-next-line no-console
        console.warn(`FORCE overwriting ${skill} (user has changes)`);
        copyFileset(skillSrc, skillDest, files);
        manifest.skills[skill] = {
          source_sha256: newSha,
          deployed_at: new Date().toISOString(),
          user_modified: false,
        };
        result.installed.push(skill);
        continue;
      }
      // eslint-disable-next-line no-console
      console.warn(`CONFLICT on ${skill}: source and your edits both changed.`);
      // eslint-disable-next-line no-console
      console.warn(`  source SHA:  ${newSha.slice(0, 12)}…`);
      // eslint-disable-next-line no-console
      console.warn(`  on-disk SHA: ${onDiskSha.slice(0, 12)}…`);
      // eslint-disable-next-line no-console
      console.warn(`  to overwrite, set HERMES_FORCE=1.`);
      // Don't mark as user_modified — we don't know whose version
      // is the right one. Leave the manifest entry pointing at the
      // last deployed source so a future rerun can still detect
      // "user has reset their copy to our prior version" via the
      // on-disk SHA check.
      result.warned.push(skill);
      continue;
    }

    // First deploy, or no prior entry.
    if (existsSync(skillDest)) {
      // eslint-disable-next-line no-console
      console.log(`installing: ${skill} (no prior manifest; overwriting existing)`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`installing: ${skill}`);
    }
    copyFileset(skillSrc, skillDest, files);
    manifest.skills[skill] = {
      source_sha256: newSha,
      deployed_at: new Date().toISOString(),
      user_modified: false,
      files,
    };
    result.installed.push(skill);
  }

  // Remove skills in the manifest that no longer exist in source.
  for (const skill of Object.keys(manifest.skills)) {
    if (!skillDirs.includes(skill)) {
      const prior = manifest.skills[skill]!;
      const skillDest = join(TARGET, skill);
      if (existsSync(skillDest)) {
        // Use the file list from the manifest, not a fresh disk
        // listing. We only remove what *we* deployed; user-added
        // files in the skill dir are left alone.
        rmFileset(skillDest, prior.files);
      }
      delete manifest.skills[skill];
      result.removed.push(skill);
      // eslint-disable-next-line no-console
      console.log(`removed: ${skill} (no longer in source)`);
    }
  }

  writeManifest(manifest);
  return result;
}

function main(): void {
  const result = deploySkills();
  // eslint-disable-next-line no-console
  console.log(
    `\n  ${result.installed.length} installed, ${result.unchanged.length} unchanged, ${result.warned.length} warned, ${result.removed.length} removed`,
  );
  // Also chown the deployed files so the hermes user inside the
  // container can read them. This is a no-op when running inside
  // the container; on the host it ensures the volume's UID 10000
  // owner can use the files.
  if (result.installed.length > 0 || result.warned.length > 0) {
    const { spawnSync } = require('node:child_process');
    spawnSync('chown', ['-R', '10000:10000', TARGET], { stdio: 'inherit' });
  }
  if (result.failed > 0) process.exit(1);
  if (result.warned.length > 0) process.exit(2);
}

main();
