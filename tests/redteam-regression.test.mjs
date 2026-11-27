import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GQLCAGE_POLICY_PRESETS,
  auditGraphQL,
  auditGraphQLRequest,
  lexGraphQL
} from '../src/index.mjs';
import { hasFinding } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'gqlcage.mjs');
const dangerousNames = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'];

test('unicode byte order marks are ignored between lexical tokens', () => {
  const result = lexGraphQL('\ufeff{\ufeff a \ufeff}\ufeff');
  assert.deepEqual(result.tokens.filter((token) => token.type !== 'EOF').map((token) => token.value), ['{', 'a', '}']);
  assert.equal(auditGraphQL('\ufeff{ a }').safe, true);
});

test('October 2021 fixed unicode escapes are accepted and brace escapes are rejected', () => {
  assert.equal(lexGraphQL('"\\u0041"').tokens[0].value, 'A');
  assert.throws(() => lexGraphQL('"\\u{1F600}"'), { code: 'GQLCAGE_LEX_ERROR' });
});

test('Arabic letter mark is rejected as a bidirectional control in strings and comments', () => {
  const mark = String.fromCharCode(0x061c);
  assert.throws(() => lexGraphQL('{ x(input: "' + mark + '") }'), { code: 'GQLCAGE_LEX_ERROR' });
  assert.throws(() => lexGraphQL('# ' + mark + '\n{ x }'), { code: 'GQLCAGE_LEX_ERROR' });
});

for (const name of dangerousNames) {
  test('dangerous fragment name is rejected: ' + name, () => {
    const report = auditGraphQL('fragment ' + name + ' on T { x } query Q { ...' + name + ' }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });

  test('dangerous input object field is rejected: ' + name, () => {
    const report = auditGraphQL('{ x(input: {' + name + ': 1}) }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });

  test('dangerous variables object key is rejected: ' + name, () => {
    const variables = JSON.parse('{"' + name + '":1}');
    const report = auditGraphQLRequest({ query: '{ a }', variables });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
}

test('policy preset operation arrays are deeply immutable', () => {
  for (const preset of Object.values(GQLCAGE_POLICY_PRESETS)) {
    assert.equal(Object.isFrozen(preset.allowedOperations), true);
  }
  assert.throws(() => {
    GQLCAGE_POLICY_PRESETS.strict.allowedOperations.push('mutation');
  }, TypeError);
});

test('accessor properties in variables reject without invoking the accessor', () => {
  let reads = 0;
  const variables = {};
  Object.defineProperty(variables, 'x', {
    enumerable: true,
    get() {
      reads += 1;
      return 1;
    }
  });
  const report = auditGraphQLRequest({ query: '{ a }', variables });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
  assert.equal(reads, 0);
});

test('accessor properties on the request entry reject without invoking the accessor', () => {
  let reads = 0;
  const entry = {};
  Object.defineProperty(entry, 'query', {
    enumerable: true,
    get() {
      reads += 1;
      return '{ a }';
    }
  });
  const report = auditGraphQLRequest(entry);
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
  assert.equal(reads, 0);
});

test('proxy objects reject without invoking proxy traps', () => {
  let trapCalls = 0;
  const variables = new Proxy({ x: 1 }, {
    ownKeys(target) {
      trapCalls += 1;
      return Reflect.ownKeys(target);
    },
    get(target, key, receiver) {
      trapCalls += 1;
      return Reflect.get(target, key, receiver);
    }
  });
  const report = auditGraphQLRequest({ query: '{ a }', variables });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
  assert.equal(trapCalls, 0);
});

test('sparse arrays are rejected as non-JSON variables', () => {
  const sparse = new Array(5000000);
  sparse[4999999] = 1;
  const report = auditGraphQLRequest({ query: '{ a }', variables: { sparse } });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
});


for (const name of dangerousNames) {
  test('dangerous field name is rejected: ' + name, () => {
    const report = auditGraphQL('{ ' + name + ' }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });

  test('dangerous alias is rejected: ' + name, () => {
    const report = auditGraphQL('{ ' + name + ': safe }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });

  test('dangerous variable name is rejected: ' + name, () => {
    const report = auditGraphQL('query Q($' + name + ': Int) { x }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });

  test('dangerous argument name is rejected: ' + name, () => {
    const report = auditGraphQL('{ x(' + name + ': 1) }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
}

test('array index accessors reject without invoking the accessor', () => {
  let reads = 0;
  const values = [0];
  Object.defineProperty(values, '0', {
    enumerable: true,
    get() {
      reads += 1;
      return 1;
    }
  });
  const report = auditGraphQLRequest({ query: '{ a }', variables: { values } });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
  assert.equal(reads, 0);
});

test('proxy arrays reject without invoking proxy traps', () => {
  let trapCalls = 0;
  const values = new Proxy([1], {
    get(target, key, receiver) {
      trapCalls += 1;
      return Reflect.get(target, key, receiver);
    }
  });
  const report = auditGraphQLRequest({ query: '{ a }', variables: { values } });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
  assert.equal(trapCalls, 0);
});

test('symbol-keyed object properties reject as non-JSON', () => {
  const variables = { safe: 1 };
  variables[Symbol('hidden')] = 2;
  const report = auditGraphQLRequest({ query: '{ a }', variables });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
});

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('CLI stops reading stdin after the configured byte cap', async () => {
  const child = spawn(process.execPath, [bin, 'audit', '-', '--max-bytes', '128'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.resume();
  child.stderr.resume();
  child.stdin.on('error', () => {});
  try {
    child.stdin.write(' '.repeat(2048));
    const outcome = await waitForExit(child, 3000);
    assert.notEqual(outcome, null, 'CLI waited for end of stdin instead of enforcing the byte cap');
    assert.equal(outcome.code, 1);
  } finally {
    if (child.exitCode === null && !child.killed) child.kill();
  }
});
