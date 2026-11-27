import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GQLCAGE_VERSION,
  GQLCAGE_ERROR_CODES,
  GQLCAGE_FINDING_CODES,
  GQLCAGE_POLICY_PRESETS,
  SEVERITY,
  GqlCageError,
  auditGraphQL,
  validateGraphQL,
  assertSafeGraphQL,
  isSafeGraphQL,
  createGraphQLPolicy
} from '../src/index.mjs';
import { hasFinding } from './helpers.mjs';

test('version is 1.0.0', () => {
  assert.equal(GQLCAGE_VERSION, '1.0.0');
});

test('error codes object is frozen', () => {
  assert.equal(Object.isFrozen(GQLCAGE_ERROR_CODES), true);
});

test('finding codes object is frozen', () => {
  assert.equal(Object.isFrozen(GQLCAGE_FINDING_CODES), true);
});

test('severity object is frozen', () => {
  assert.equal(Object.isFrozen(SEVERITY), true);
});

test('every error code value starts with GQLCAGE', () => {
  for (const value of Object.values(GQLCAGE_ERROR_CODES)) assert.equal(value.startsWith('GQLCAGE_'), true);
});

for (const preset of ['strict', 'public', 'internal']) {
  test('preset ' + preset + ' creates frozen policy', () => {
    const policy = createGraphQLPolicy(preset);
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.allowedOperations), true);
    assert.equal(policy.preset, preset);
  });
  test('preset object form ' + preset + ' creates same base limits', () => {
    const policy = createGraphQLPolicy({ preset });
    assert.equal(policy.maxDepth, GQLCAGE_POLICY_PRESETS[preset].maxDepth);
  });
}

test('default policy is public', () => {
  const policy = createGraphQLPolicy();
  assert.equal(policy.preset, 'public');
});

test('policy override wins over preset', () => {
  const policy = createGraphQLPolicy({ preset: 'strict', maxDepth: 33, allowTypename: true });
  assert.equal(policy.maxDepth, 33);
  assert.equal(policy.allowTypename, true);
});

test('policy cannot be mutated', () => {
  const policy = createGraphQLPolicy();
  assert.throws(() => {
    policy.maxDepth = 1;
  }, TypeError);
});

test('allowed operations array cannot be mutated', () => {
  const policy = createGraphQLPolicy();
  assert.throws(() => {
    policy.allowedOperations.push('query');
  }, TypeError);
});

test('unknown policy key is rejected', () => {
  assert.throws(() => createGraphQLPolicy({ maxdepth: 1 }), { code: 'GQLCAGE_POLICY_ERROR' });
});

test('unknown preset is rejected', () => {
  assert.throws(() => createGraphQLPolicy('missing'), { code: 'GQLCAGE_POLICY_ERROR' });
});

const integerKeys = [
  'maxBytes',
  'maxTokens',
  'maxNameLength',
  'maxDepth',
  'maxFragmentSpreads',
  'maxExpandedFields',
  'maxAliases',
  'maxDuplicateFields',
  'maxRootFields',
  'maxOperations',
  'maxDirectives',
  'maxDirectivesPerLocation',
  'maxArguments',
  'maxVariables',
  'maxInputDepth',
  'maxStringLength',
  'maxBatchSize',
  'maxVariablesBytes',
  'maxVariablesDepth',
  'maxVariablesNodes',
  'maxFindings',
  'maxComplexity'
];
for (const key of integerKeys) {
  test('policy rejects fractional value for ' + key, () => {
    assert.throws(() => createGraphQLPolicy({ [key]: 1.5 }), { code: 'GQLCAGE_POLICY_ERROR' });
  });
}

for (const key of ['maxDepth', 'maxAliases', 'maxBytes']) {
  test('policy rejects negative value for ' + key, () => {
    assert.throws(() => createGraphQLPolicy({ [key]: -1 }), { code: 'GQLCAGE_POLICY_ERROR' });
  });
}

for (const key of ['requireOperationName', 'allowIntrospection', 'allowTypename']) {
  test('policy rejects nonboolean value for ' + key, () => {
    assert.throws(() => createGraphQLPolicy({ [key]: 1 }), { code: 'GQLCAGE_POLICY_ERROR' });
  });
}

for (const value of [[], ['query', 'query'], ['query', 'other'], 'query', null]) {
  test('policy rejects invalid allowedOperations ' + JSON.stringify(value), () => {
    assert.throws(() => createGraphQLPolicy({ allowedOperations: value }), { code: 'GQLCAGE_POLICY_ERROR' });
  });
}

test('auditGraphQL returns safe report shape', () => {
  const report = auditGraphQL('{ a }');
  assert.equal(typeof report.safe, 'boolean');
  assert.equal(Array.isArray(report.findings), true);
  assert.equal(typeof report.metrics, 'object');
  assert.equal(typeof report.stats, 'object');
});

test('auditGraphQL does not throw for parse failure', () => {
  assert.doesNotThrow(() => auditGraphQL('{ a { '));
});

test('auditGraphQL throws TypeError for nonstring query', () => {
  assert.throws(() => auditGraphQL(null), TypeError);
});

test('validateGraphQL returns true for safe query', () => {
  assert.equal(validateGraphQL('{ a }'), true);
});

test('assertSafeGraphQL returns true for safe query', () => {
  assert.equal(assertSafeGraphQL('{ a }'), true);
});

test('validateGraphQL throws GqlCageError for unsafe query', () => {
  assert.throws(() => validateGraphQL('{ __schema { types { name } } }'), (error) => error instanceof GqlCageError && error.code === 'GQLCAGE_INTROSPECTION_BLOCKED');
});

test('validateGraphQL error details include findings and metrics', () => {
  try {
    validateGraphQL('{ __schema { types { name } } }');
    assert.fail('expected validation failure');
  } catch (error) {
    assert.equal(Array.isArray(error.details.findings), true);
    assert.equal(typeof error.details.metrics.depth, 'number');
  }
});

test('isSafeGraphQL true for safe query', () => {
  assert.equal(isSafeGraphQL('{ a }'), true);
});

test('isSafeGraphQL false for unsafe query', () => {
  assert.equal(isSafeGraphQL('{ __schema { types { name } } }'), false);
});

test('findings cap replaces retained tail with cap finding', () => {
  const report = auditGraphQL('{ x(a: 1, a: 2, a: 3, a: 4) }', { maxFindings: 2 });
  assert.equal(report.safe, false);
  assert.equal(report.findings.length, 2);
  assert.equal(report.findings.at(-1).code, 'GQLCAGE_FINDINGS_CAP');
  assert.equal(report.stats.findingsCapped, true);
});

test('findings total counts suppressed findings', () => {
  const report = auditGraphQL('{ x(a: 1, a: 2, a: 3, a: 4) }', { maxFindings: 2 });
  assert.equal(report.stats.findingsTotal > report.findings.length, true);
});

test('large finding count remains fail closed', () => {
  const args = Array.from({ length: 100 }, (unused, index) => 'a:' + index).join(' ');
  const report = auditGraphQL('{ x(' + args + ') }', { maxFindings: 5 });
  assert.equal(report.safe, false);
  assert.equal(report.stats.findingsCapped, true);
});

test('safe report stats include byte count and timings', () => {
  const report = auditGraphQL('{ a }');
  assert.equal(report.stats.bytes, 5);
  assert.equal(report.stats.parseMs >= 0, true);
  assert.equal(report.stats.auditMs >= 0, true);
});

test('metrics exact for simple query', () => {
  const report = auditGraphQL('{ a { b c } d }');
  assert.equal(report.metrics.depth, 2);
  assert.equal(report.metrics.expandedFields, 4);
  assert.equal(report.metrics.aliases, 0);
  assert.equal(report.metrics.directives, 0);
  assert.equal(report.metrics.complexity, 4);
  assert.equal(report.metrics.operations, 1);
  assert.equal(report.metrics.fragments, 0);
});

test('metrics exact for aliases and arguments', () => {
  const report = auditGraphQL('{ x: a(v: 1) y: b }');
  assert.equal(report.metrics.aliases, 2);
  assert.equal(report.metrics.arguments, 1);
  assert.equal(report.metrics.complexity, 3);
});

test('frozen policy object can be reused as audit options', () => {
  const policy = createGraphQLPolicy({ maxDepth: 2 });
  const report = auditGraphQL('{ a { b } }', policy);
  assert.equal(report.safe, true);
});

test('maxComplexity exact boundary is accepted', () => {
  const report = auditGraphQL('{ a b }', { maxComplexity: 2 });
  assert.equal(report.safe, true);
});

test('maxComplexity exact boundary plus one is rejected', () => {
  const report = auditGraphQL('{ a b c }', { maxComplexity: 2 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_COMPLEXITY_EXCEEDED'), true);
});

test('policy presets object is frozen', () => {
  assert.equal(Object.isFrozen(GQLCAGE_POLICY_PRESETS), true);
  assert.equal(Object.isFrozen(GQLCAGE_POLICY_PRESETS.public), true);
});
