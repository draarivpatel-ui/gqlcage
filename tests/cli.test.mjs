import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'gqlcage.mjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'gqlcage-cli-test-'));
const safeFile = path.join(scratch, 'safe.graphql');
const unsafeFile = path.join(scratch, 'unsafe.graphql');
const deepFile = path.join(scratch, 'deep.graphql');
const aliasFile = path.join(scratch, 'alias.graphql');
writeFileSync(safeFile, '{ viewer { id } }\n', 'utf8');
writeFileSync(unsafeFile, '{ __schema { types { name } } }\n', 'utf8');
writeFileSync(deepFile, '{ a { b { c } } }\n', 'utf8');
writeFileSync(aliasFile, '{ a: login b: login }\n', 'utf8');

function cleanup() {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Best effort cleanup for Windows file timing.
  }
}
process.on('exit', cleanup);

function runCli(args, input) {
  return spawnSync(process.execPath, [bin, ...args], {
    input,
    encoding: 'utf8',
    cwd: root
  });
}

test('CLI audit safe file exits zero', () => {
  const result = runCli(['audit', safeFile]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /safe/);
});

test('CLI audit unsafe file exits one', () => {
  const result = runCli(['audit', unsafeFile]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GQLCAGE_INTROSPECTION_BLOCKED/);
});

test('CLI validate safe file exits zero', () => {
  const result = runCli(['validate', safeFile]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^safe/);
});

test('CLI validate unsafe file exits one', () => {
  const result = runCli(['validate', unsafeFile]);
  assert.equal(result.status, 1);
});

test('CLI metrics safe file exits zero', () => {
  const result = runCli(['metrics', safeFile]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /depth: 2/);
});

test('CLI audit json emits parseable report', () => {
  const result = runCli(['audit', safeFile, '--json']);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.depth, 2);
});

test('CLI validate json emits parseable report', () => {
  const result = runCli(['validate', unsafeFile, '--json']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.safe, false);
});

test('CLI metrics json emits metrics object', () => {
  const result = runCli(['metrics', safeFile, '--json']);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.metrics.expandedFields, 2);
});

test('CLI reads query from stdin', () => {
  const result = runCli(['audit', '-', '--json'], '{ a }\n');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).safe, true);
});

test('CLI stdin unsafe exits one', () => {
  const result = runCli(['audit', '-'], '{ __schema { types { name } } }');
  assert.equal(result.status, 1);
});

test('CLI max-depth allows exact depth', () => {
  const result = runCli(['audit', deepFile, '--max-depth', '3']);
  assert.equal(result.status, 0);
});

test('CLI max-depth rejects over depth', () => {
  const result = runCli(['audit', deepFile, '--max-depth', '2']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GQLCAGE_DEPTH_EXCEEDED/);
});

test('CLI max-aliases allows exact count', () => {
  const result = runCli(['audit', aliasFile, '--max-aliases', '2', '--json']);
  assert.equal(result.status, 0);
});

test('CLI max-aliases rejects over count', () => {
  const result = runCli(['audit', aliasFile, '--max-aliases', '1']);
  assert.equal(result.status, 1);
});

test('CLI allow-introspection permits schema', () => {
  const result = runCli(['audit', unsafeFile, '--allow-introspection']);
  assert.equal(result.status, 0);
});

test('CLI allow-typename permits typename', () => {
  const file = path.join(scratch, 'typename.graphql');
  writeFileSync(file, '{ __typename }', 'utf8');
  const result = runCli(['audit', file, '--allow-typename']);
  assert.equal(result.status, 0);
});

test('CLI strict preset rejects mutation', () => {
  const file = path.join(scratch, 'mutation.graphql');
  writeFileSync(file, 'mutation M { x }', 'utf8');
  const result = runCli(['audit', file, '--preset', 'strict']);
  assert.equal(result.status, 1);
});

test('CLI strict preset accepts named query', () => {
  const file = path.join(scratch, 'named.graphql');
  writeFileSync(file, 'query Q { x }', 'utf8');
  const result = runCli(['audit', file, '--preset', 'strict']);
  assert.equal(result.status, 0);
});

test('CLI internal preset permits introspection', () => {
  const result = runCli(['audit', unsafeFile, '--preset', 'internal']);
  assert.equal(result.status, 0);
});

test('CLI max-tokens rejects small token budget', () => {
  const result = runCli(['audit', safeFile, '--max-tokens', '2']);
  assert.equal(result.status, 1);
});

test('CLI max-bytes rejects small byte budget', () => {
  const result = runCli(['audit', safeFile, '--max-bytes', '2']);
  assert.equal(result.status, 1);
});

test('CLI max-complexity rejects small complexity budget', () => {
  const result = runCli(['audit', safeFile, '--max-complexity', '1']);
  assert.equal(result.status, 1);
});

test('CLI missing command exits two', () => {
  const result = runCli([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: gqlcage/);
});

test('CLI unknown command exits two', () => {
  const result = runCli(['check', safeFile]);
  assert.equal(result.status, 2);
});

test('CLI missing input exits two', () => {
  const result = runCli(['audit']);
  assert.equal(result.status, 2);
});

test('CLI unknown option exits two', () => {
  const result = runCli(['audit', safeFile, '--wat']);
  assert.equal(result.status, 2);
});

test('CLI missing option value exits two', () => {
  const result = runCli(['audit', safeFile, '--max-depth']);
  assert.equal(result.status, 2);
});

test('CLI invalid integer option exits two', () => {
  const result = runCli(['audit', safeFile, '--max-depth', 'x']);
  assert.equal(result.status, 2);
});

test('CLI unknown preset exits two', () => {
  const result = runCli(['audit', safeFile, '--preset', 'missing']);
  assert.equal(result.status, 2);
});

test('CLI duplicate input file exits two', () => {
  const result = runCli(['audit', safeFile, safeFile]);
  assert.equal(result.status, 2);
});

test('CLI unreadable input exits two', () => {
  const result = runCli(['audit', path.join(scratch, 'missing.graphql')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unable to read input/);
});

test('CLI help exits zero', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: gqlcage/);
});

test('CLI invalid GraphQL exits one not two', () => {
  const result = runCli(['audit', '-'], '{ a { ');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GQLCAGE_PARSE_ERROR/);
});

test('CLI json report does not echo the query text', () => {
  const marker = 'xyzzy_secretish_field';
  const result = runCli(['audit', '-', '--json'], '{ ' + marker + ' ');
  assert.equal(result.stdout.includes(marker), false);
});

if (process.platform !== 'win32') {
  test('CLI bin has executable mode on POSIX', () => {
    assert.equal((statSync(bin).mode & 0o111) !== 0, true);
  });

  test('CLI stderr neutralizes control characters', () => {
    const controlPath = path.join(scratch, 'missing-' + String.fromCharCode(27) + '.graphql');
    const result = runCli(['audit', controlPath]);
    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes(String.fromCharCode(27)), false);
    assert.match(result.stderr, /u001b/);
  });
} else {
  test('CLI executable mode assertion skipped on Windows', (t) => {
    t.skip('POSIX executable bits do not apply on Windows');
  });
}
