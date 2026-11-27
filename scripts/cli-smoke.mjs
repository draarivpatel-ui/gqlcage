import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'gqlcage.mjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'gqlcage-smoke-'));
try {
  const safeFile = path.join(scratch, 'safe.graphql');
  const unsafeFile = path.join(scratch, 'unsafe.graphql');
  writeFileSync(safeFile, '{ viewer { id } }\n', 'utf8');
  writeFileSync(unsafeFile, '{ __schema { types { name } } }\n', 'utf8');

  const safe = spawnSync(process.execPath, [bin, 'audit', safeFile, '--json'], { encoding: 'utf8' });
  if (safe.status !== 0) throw new Error('safe CLI audit did not exit 0');
  if (!JSON.parse(safe.stdout).safe) throw new Error('safe CLI audit reported unsafe');

  const unsafe = spawnSync(process.execPath, [bin, 'validate', unsafeFile], { encoding: 'utf8' });
  if (unsafe.status !== 1) throw new Error('unsafe CLI validate did not exit 1');

  const metrics = spawnSync(process.execPath, [bin, 'metrics', safeFile, '--json'], { encoding: 'utf8' });
  if (metrics.status !== 0) throw new Error('metrics CLI did not exit 0');
  if (JSON.parse(metrics.stdout).metrics.depth !== 2) throw new Error('metrics CLI returned wrong depth');

  const usage = spawnSync(process.execPath, [bin], { encoding: 'utf8' });
  if (usage.status !== 2) throw new Error('usage failure did not exit 2');
  process.stdout.write('cli smoke ok\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
