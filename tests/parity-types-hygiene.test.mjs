import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esm from '../src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cjs = require('../cjs/index.cjs');

const exportedNames = [
  'GQLCAGE_VERSION',
  'GQLCAGE_ERROR_CODES',
  'GQLCAGE_FINDING_CODES',
  'SEVERITY',
  'GqlCageError',
  'lexGraphQL',
  'parseGraphQLDocument',
  'GQLCAGE_POLICY_PRESETS',
  'createGraphQLPolicy',
  'auditGraphQL',
  'validateGraphQL',
  'isSafeGraphQL',
  'assertSafeGraphQL',
  'auditGraphQLRequest',
  'createGraphQLGuard'
];

for (const name of exportedNames) {
  test('ESM export exists: ' + name, () => {
    assert.notEqual(esm[name], undefined);
  });
  test('CJS export exists: ' + name, () => {
    assert.notEqual(cjs[name], undefined);
  });
}

const parityQueries = [
  '{ a }',
  '{ a { b c } d }',
  'query Q($x: Int = 1) { a(x: $x) }',
  'fragment F on T { x y } query Q { ...F }',
  'query Q { ... on T { x } }',
  '{ x: a(v: [1, {b: true}]) @d }',
  '{ __schema { types { name } } }',
  'mutation M { update(x: "hello") { ok } }',
  'subscription S { event { id } }',
  'fragment A on T { ...B } fragment B on T { x } query Q { ...A }'
];
for (const query of parityQueries) {
  test('CJS and ESM audit parity for ' + query.slice(0, 32), () => {
    const left = esm.auditGraphQL(query);
    const right = cjs.auditGraphQL(query);
    assert.deepEqual({ safe: right.safe, findings: right.findings, metrics: right.metrics }, { safe: left.safe, findings: left.findings, metrics: left.metrics });
  });
}

test('CJS validate throws typed error like ESM', () => {
  assert.throws(() => cjs.validateGraphQL('type Query { x: String }'), { code: 'GQLCAGE_SDL_NOT_ALLOWED' });
  assert.throws(() => esm.validateGraphQL('type Query { x: String }'), { code: 'GQLCAGE_SDL_NOT_ALLOWED' });
});

test('CJS request audit parity', () => {
  const payload = { query: '{ a }', variables: { x: [1, 2] } };
  assert.deepEqual(cjs.auditGraphQLRequest(payload).metrics, esm.auditGraphQLRequest(payload).metrics);
});

test('generated CJS bundle is current', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-cjs.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('package dependencies and devDependencies are empty', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.dependencies, {});
  assert.deepEqual(packageJson.devDependencies, {});
});

test('package metadata has correct name version license and engines', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'gqlcage');
  assert.equal(packageJson.version, '1.0.0');
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.engines.node, '>=18.0.0');
});

test('package exports ESM CJS and types', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.exports['.'].import, './src/index.mjs');
  assert.equal(packageJson.exports['.'].require, './cjs/index.cjs');
  assert.equal(packageJson.exports['.'].types, './types/index.d.ts');
});

test('package bin points to gqlcage CLI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.bin.gqlcage, 'bin/gqlcage.mjs');
});

test('package file list excludes tests and scripts', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.files.includes('tests'), false);
  assert.equal(packageJson.files.includes('scripts'), false);
  assert.equal(packageJson.files.includes('src'), true);
  assert.equal(packageJson.files.includes('cjs'), true);
});

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(full, output);
    else output.push(full);
  }
  return output;
}

test('repository files contain no em dash or en dash characters', () => {
  const forbidden = [String.fromCharCode(8212), String.fromCharCode(8211)];
  const offenders = [];
  for (const file of walkFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    if (forbidden.some((character) => text.includes(character))) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('repository files contain no local absolute user paths or private identifiers', () => {
  const forbidden = [['/', 'Users', '/'].join(''), ['draarivpatel', '@gmail'].join(''), ['proroblox286', '@gmail'].join(''), ['Tanyard', ' Manor'].join('')];
  const offenders = [];
  for (const file of walkFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    if (forbidden.some((value) => text.includes(value))) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('.gitattributes enforces LF for required file classes', () => {
  const text = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  for (const pattern of ['.gitattributes', '.gitignore', 'LICENSE', '*.mjs', '*.cjs', '*.js', '*.ts', '*.d.ts', '*.json', '*.md', '*.yml', '*.yaml']) {
    assert.equal(text.includes(pattern + ' text eol=lf'), true, pattern);
  }
});

test('CI matrix covers two operating systems and four Node versions', () => {
  const text = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(text, /os: \[ubuntu-24\.04, windows-latest\]/);
  assert.match(text, /node: \[18, 20, 22, 24\]/);
});

test('test runner enumerates tests with readdirSync', () => {
  const text = fs.readFileSync(path.join(root, 'scripts', 'run-tests.mjs'), 'utf8');
  assert.match(text, /readdirSync/);
  assert.equal(text.includes('*.test.mjs'), false);
});

test('TypeScript declarations contain no any or suppression comments', () => {
  const text = fs.readFileSync(path.join(root, 'types', 'index.d.ts'), 'utf8');
  assert.equal(/\bany\b/.test(text), false);
  assert.equal(text.includes('@ts-ignore'), false);
  assert.equal(text.includes('@ts-expect-error'), false);
});

test('TypeScript declarations compile in strict mode when tsc is available', (t) => {
  const probe = spawnSync('tsc', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('tsc is not installed in this environment');
    return;
  }
  const scratch = fs.mkdtempSync(path.join(process.platform === 'win32' ? process.env.TEMP : '/tmp', 'gqlcage-types-'));
  try {
    fs.copyFileSync(path.join(root, 'types', 'index.d.ts'), path.join(scratch, 'index.d.ts'));
    fs.writeFileSync(path.join(scratch, 'check.ts'), [
      'import { auditGraphQL, auditGraphQLRequest, createGraphQLGuard, createGraphQLPolicy, isSafeGraphQL, parseGraphQLDocument, validateGraphQL, type GqlCageAuditReport, type GqlCagePolicyOptions } from "./index";',
      'const options: GqlCagePolicyOptions = { preset: "public", maxDepth: 4 };',
      'const report: GqlCageAuditReport = auditGraphQL("{ a }", options);',
      'const safe: boolean = report.safe;',
      'validateGraphQL("{ a }");',
      'const yes: boolean = isSafeGraphQL("{ a }");',
      'const policy = createGraphQLPolicy(options);',
      'const guard = createGraphQLGuard(policy);',
      'auditGraphQLRequest({ query: "{ a }" }, policy);',
      'parseGraphQLDocument("{ a }");',
      'console.log(safe, yes, guard.policy.maxDepth);'
    ].join('\n'), 'utf8');
    const result = spawnSync('tsc', ['--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', 'check.ts'], { cwd: scratch, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
