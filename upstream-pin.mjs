import fs from 'node:fs';

export function readPinnedCommit(file) {
  const commit = fs.readFileSync(file, 'utf8').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('UPSTREAM_COMMIT.txt must contain one full 40-character Git commit SHA.');
  return commit;
}

export function requirePinnedCommit(actual, expected) {
  if (actual.trim().toLowerCase() !== expected) {
    throw new Error(`app/ is not at the pinned Meetily commit ${expected}. Existing checkout was not changed.`);
  }
}
