import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGraphQL } from '../src/index.mjs';
import { nestSelection, fragmentDag, hasFinding } from './helpers.mjs';

const DAG_POLICY = {
  maxDepth: 1000,
  maxExpandedFields: Number.MAX_SAFE_INTEGER,
  maxFragmentSpreads: Number.MAX_SAFE_INTEGER,
  maxAliases: Number.MAX_SAFE_INTEGER,
  maxDuplicateFields: Number.MAX_SAFE_INTEGER,
  maxRootFields: Number.MAX_SAFE_INTEGER,
  maxDirectives: Number.MAX_SAFE_INTEGER,
  maxDirectivesPerLocation: Number.MAX_SAFE_INTEGER,
  maxArguments: Number.MAX_SAFE_INTEGER,
  maxComplexity: Number.MAX_SAFE_INTEGER,
  maxTokens: 100000,
  maxBytes: 1024 * 1024
};

for (let depth = 1; depth <= 12; depth += 1) {
  test('default policy accepts selection depth ' + depth, () => {
    const report = auditGraphQL(nestSelection(depth));
    assert.equal(report.safe, true);
    assert.equal(report.metrics.depth, depth);
  });
}

for (let depth = 13; depth <= 24; depth += 1) {
  test('default policy rejects selection depth ' + depth, () => {
    const report = auditGraphQL(nestSelection(depth));
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_DEPTH_EXCEEDED'), true);
  });
}

for (const limit of [1, 2, 3, 5, 8, 13, 21]) {
  test('custom maxDepth ' + limit + ' is enforced exactly', () => {
    const safe = auditGraphQL(nestSelection(limit), { maxDepth: limit });
    const unsafe = auditGraphQL(nestSelection(limit + 1), { maxDepth: limit });
    assert.equal(safe.safe, true);
    assert.equal(unsafe.safe, false);
    assert.equal(hasFinding(unsafe, 'GQLCAGE_DEPTH_EXCEEDED'), true);
  });
}

test('named fragment depth counts at the spread location', () => {
  const query = 'fragment F on T { b { c } } query Q { a { ...F } }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.depth, 3);
});

test('inline fragment is transparent for depth accounting', () => {
  const query = 'query Q { a { ... on T { b { c } } } }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.depth, 3);
});

test('inline fragment without type condition is transparent', () => {
  const query = 'query Q { a { ... { b { c } } } }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.depth, 3);
});

test('fragment depth can trigger maxDepth even when static depth looks small', () => {
  const query = 'fragment F on T { b { c { d } } } query Q { a { ...F } }';
  const report = auditGraphQL(query, { maxDepth: 3 });
  assert.equal(report.safe, false);
  assert.equal(report.metrics.depth, 4);
  assert.equal(hasFinding(report, 'GQLCAGE_DEPTH_EXCEEDED'), true);
});

test('fields inside named fragments count toward expandedFields', () => {
  const query = 'fragment F on T { x y { z } } query Q { ...F }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.expandedFields, 3);
});

test('reusing one fragment multiplies expandedFields but memoizes analysis', () => {
  const query = 'fragment F on T { x y } query Q { ...F ...F ...F }';
  const report = auditGraphQL(query, { maxDuplicateFields: 10 });
  assert.equal(report.safe, true);
  assert.equal(report.metrics.expandedFields, 6);
  assert.equal(report.metrics.fragmentSpreads, 3);
});

test('unused fragment does not count toward operation expansion metrics', () => {
  const query = 'fragment F on T { x y z } fragment Unused on T { a b c d e } query Q { ...F }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.expandedFields, 3);
  assert.equal(report.metrics.fragments, 2);
});

for (let levels = 1; levels <= 20; levels += 1) {
  test('exponential fragment DAG level ' + levels + ' is memoized', () => {
    const started = Date.now();
    const report = auditGraphQL(fragmentDag(levels), DAG_POLICY);
    assert.equal(report.safe, true);
    assert.equal(report.metrics.expandedFields, 3 * (2 ** (levels - 1)) - 1);
    assert.equal(report.metrics.fragmentSpreads, (2 ** levels) - 1);
    assert.equal(Date.now() - started < 3000, true);
  });
}

test('large exponential fragment DAG saturates work rather than materializing expansion', () => {
  const started = Date.now();
  const report = auditGraphQL(fragmentDag(30), DAG_POLICY);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.fragmentSpreads, (2 ** 30) - 1);
  assert.equal(Date.now() - started < 5000, true);
});

test('expanded field cap rejects fragment DAG', () => {
  const report = auditGraphQL(fragmentDag(12), { ...DAG_POLICY, maxExpandedFields: 100 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_EXPANDED_FIELDS_EXCEEDED'), true);
});

test('fragment spread cap rejects fragment DAG', () => {
  const report = auditGraphQL(fragmentDag(8), { ...DAG_POLICY, maxFragmentSpreads: 20 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_FRAGMENT_SPREADS_EXCEEDED'), true);
});

test('complexity cap rejects fragment DAG', () => {
  const report = auditGraphQL(fragmentDag(8), { ...DAG_POLICY, maxComplexity: 20 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_COMPLEXITY_EXCEEDED'), true);
});

const cycleQueries = [
  ['self cycle', 'fragment A on T { ...A } query Q { ...A }'],
  ['two fragment cycle', 'fragment A on T { ...B } fragment B on T { ...A } query Q { ...A }'],
  ['three fragment cycle', 'fragment A on T { ...B } fragment B on T { ...C } fragment C on T { ...A } query Q { ...A }'],
  ['cycle inside nested field', 'fragment A on T { x { ...A } } query Q { ...A }'],
  ['cycle inside inline fragment', 'fragment A on T { ... on T { ...A } } query Q { ...A }'],
  ['cycle with entry and exit branches', 'fragment A on T { x ...B } fragment B on T { y ...A } query Q { ...A }'],
  ['cycle in unused fragment', 'fragment A on T { ...A } query Q { x }'],
  ['diamond plus self cycle', 'fragment A on T { ...B ...C } fragment B on T { ...D } fragment C on T { ...D } fragment D on T { ...D } query Q { ...A }'],
  ['cycle through middle fragment', 'fragment A on T { ...B } fragment B on T { ...C } fragment C on T { ...B } query Q { ...A }'],
  ['cycle with duplicate edges', 'fragment A on T { ...B ...B } fragment B on T { ...A ...A } query Q { ...A }']
];
for (const [name, query] of cycleQueries) {
  test('fragment cycle rejected: ' + name, () => {
    const report = auditGraphQL(query, DAG_POLICY);
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_FRAGMENT_CYCLE'), true);
  });
}

test('fragment cycle finding includes cycle details', () => {
  const report = auditGraphQL('fragment A on T { ...B } fragment B on T { ...A } query Q { ...A }');
  const finding = report.findings.find((item) => item.code === 'GQLCAGE_FRAGMENT_CYCLE');
  assert.equal(Array.isArray(finding.details.cycle), true);
  assert.equal(finding.details.cycle.length >= 2, true);
});

for (const query of [
  'query Q { ...Missing }',
  'fragment F on T { ...Missing } query Q { ...F }',
  'query Q { a { ...Missing } }',
  'query Q { ... on T { ...Missing } }'
]) {
  test('unknown fragment rejected: ' + query, () => {
    const report = auditGraphQL(query);
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_UNKNOWN_FRAGMENT'), true);
  });
}

test('duplicate fragment is rejected', () => {
  const report = auditGraphQL('fragment F on T { x } fragment F on T { y } query Q { ...F }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_FRAGMENT'), true);
});

test('many duplicate fragments are rejected', () => {
  const report = auditGraphQL('fragment F on T { x } fragment F on T { y } fragment F on T { z } query Q { ...F }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_FRAGMENT'), true);
});

test('direct root fields from fragments count as root response keys', () => {
  const query = 'fragment F on T { x y z } query Q { ...F }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.rootFields, 3);
});

test('fragment merge duplicate response keys are counted', () => {
  const query = 'fragment F on T { x } query Q { x ...F }';
  const report = auditGraphQL(query, { maxDuplicateFields: 1 });
  assert.equal(report.safe, false);
  assert.equal(report.metrics.duplicateFields, 2);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_FIELDS_EXCEEDED'), true);
});

test('inline fragment merge duplicate response keys are counted', () => {
  const query = 'query Q { x ... on T { x } }';
  const report = auditGraphQL(query, { maxDuplicateFields: 1 });
  assert.equal(report.safe, false);
  assert.equal(report.metrics.duplicateFields, 2);
});

test('nested duplicate fields are counted in their own selection set', () => {
  const query = 'query Q { a { x x } }';
  const report = auditGraphQL(query, { maxDuplicateFields: 1 });
  assert.equal(report.safe, false);
  assert.equal(report.metrics.duplicateFields, 2);
});

test('underlying field replicas through aliases are counted', () => {
  const query = 'query Q { one: login two: login three: login }';
  const report = auditGraphQL(query, { maxDuplicateFields: 2, maxAliases: 10 });
  assert.equal(report.safe, false);
  assert.equal(report.metrics.duplicateFields, 3);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_FIELDS_EXCEEDED'), true);
});

test('fragment analysis remains safe when unknown fragment is present', () => {
  const report = auditGraphQL('fragment F on T { ...Missing x } query Q { ...F }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_UNKNOWN_FRAGMENT'), true);
  assert.equal(report.metrics.expandedFields >= 0, true);
});

test('fragment spread directives count toward directives', () => {
  const query = 'fragment F on T { x } query Q { ...F @one @two }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.directives, 2);
});

test('fragment definition directives count when fragment is used', () => {
  const query = 'fragment F on T @frag { x } query Q { ...F }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.directives, 1);
});

test('fragment expansion preserves nested input depth', () => {
  const query = 'fragment F on T { x(input: [[[[1]]]]) } query Q { ...F }';
  const report = auditGraphQL(query);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.inputDepth, 4);
});

for (const depth of [100, 1000, 5000]) {
  test('iterative analyzer handles nested selection depth ' + depth, () => {
    const report = auditGraphQL(nestSelection(depth), { ...DAG_POLICY, maxDepth: depth });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.depth, depth);
  });
}
