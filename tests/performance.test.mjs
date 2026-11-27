import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGraphQL, auditGraphQLRequest, parseGraphQLDocument } from '../src/index.mjs';
import { nestSelection, fragmentDag } from './helpers.mjs';

const HIGH = {
  maxBytes: 10 * 1024 * 1024,
  maxTokens: 1000000,
  maxDepth: 100000,
  maxExpandedFields: Number.MAX_SAFE_INTEGER,
  maxAliases: Number.MAX_SAFE_INTEGER,
  maxDuplicateFields: Number.MAX_SAFE_INTEGER,
  maxRootFields: Number.MAX_SAFE_INTEGER,
  maxFragmentSpreads: Number.MAX_SAFE_INTEGER,
  maxDirectives: Number.MAX_SAFE_INTEGER,
  maxDirectivesPerLocation: Number.MAX_SAFE_INTEGER,
  maxArguments: Number.MAX_SAFE_INTEGER,
  maxVariables: Number.MAX_SAFE_INTEGER,
  maxInputDepth: 100000,
  maxStringLength: 1000000,
  maxComplexity: Number.MAX_SAFE_INTEGER,
  maxVariablesDepth: 100000,
  maxVariablesBytes: 10 * 1024 * 1024,
  maxVariablesNodes: 1000000
};

function timed(fn) {
  const started = Date.now();
  const value = fn();
  return { value, elapsed: Date.now() - started };
}

for (const depth of [100, 1000, 10000]) {
  test('nested selection depth ' + depth + ' parses and audits iteratively', () => {
    const result = timed(() => auditGraphQL(nestSelection(depth), HIGH));
    assert.equal(result.value.safe, true);
    assert.equal(result.value.metrics.depth, depth);
    assert.equal(result.elapsed < 10000, true);
  });
}

test('50k nested selection sets do not overflow the call stack', () => {
  const result = timed(() => auditGraphQL(nestSelection(50000), HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.value.metrics.depth, 50000);
  assert.equal(result.elapsed < 15000, true);
});

test('50k nested selection document shape is exact', () => {
  const document = parseGraphQLDocument(nestSelection(5000), { maxTokens: 20000 });
  let set = document.definitions[0].selectionSet;
  let count = 0;
  while (set.selections[0].selectionSet) {
    count += 1;
    set = set.selections[0].selectionSet;
  }
  assert.equal(count, 4999);
});

for (const depth of [100, 1000, 10000]) {
  test('nested list input depth ' + depth + ' is iterative', () => {
    const source = '['.repeat(depth) + '1' + ']'.repeat(depth);
    const result = timed(() => auditGraphQL('{ x(input: ' + source + ') }', HIGH));
    assert.equal(result.value.safe, true);
    assert.equal(result.value.metrics.inputDepth, depth);
    assert.equal(result.elapsed < 10000, true);
  });
}

test('25k nested list input does not overflow the call stack', () => {
  const depth = 25000;
  const source = '['.repeat(depth) + '1' + ']'.repeat(depth);
  const report = auditGraphQL('{ x(input: ' + source + ') }', HIGH);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.inputDepth, depth);
});

test('10k nested object input does not overflow the call stack', () => {
  const depth = 10000;
  const source = '{a: '.repeat(depth) + '1' + '}'.repeat(depth);
  const report = auditGraphQL('{ x(input: ' + source + ') }', HIGH);
  assert.equal(report.safe, true);
  assert.equal(report.metrics.inputDepth, depth);
});

for (const depth of [100, 1000, 5000]) {
  test('nested list type depth ' + depth + ' parses iteratively', () => {
    const type = '['.repeat(depth) + 'String' + ']'.repeat(depth);
    const report = auditGraphQL('query Q($x: ' + type + ') { a }', HIGH);
    assert.equal(report.safe, true);
  });
}

for (const levels of [10, 20, 30, 40]) {
  test('fragment DAG level ' + levels + ' completes in bounded time', () => {
    const result = timed(() => auditGraphQL(fragmentDag(levels), HIGH));
    assert.equal(result.value.safe, true);
    assert.equal(result.elapsed < 10000, true);
  });
}

test('fragment DAG level 60 saturates numeric metrics without expansion', () => {
  const result = timed(() => auditGraphQL(fragmentDag(60), HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.value.metrics.expandedFields <= Number.MAX_SAFE_INTEGER, true);
  assert.equal(result.elapsed < 10000, true);
});

test('10k aliases are counted linearly when policy allows them', () => {
  const fields = [];
  for (let index = 0; index < 10000; index += 1) fields.push('a' + index + ': login');
  const result = timed(() => auditGraphQL('{ ' + fields.join(' ') + ' }', HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.value.metrics.aliases, 10000);
  assert.equal(result.elapsed < 10000, true);
});

test('5k directives are counted linearly when policy allows them', () => {
  const fields = [];
  for (let index = 0; index < 5000; index += 1) fields.push('f' + index + ' @d');
  const result = timed(() => auditGraphQL('{ ' + fields.join(' ') + ' }', HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.value.metrics.directives, 5000);
  assert.equal(result.elapsed < 10000, true);
});

test('large block string is scanned linearly', () => {
  const body = 'x'.repeat(200000);
  const result = timed(() => auditGraphQL('{ x(input: """' + body + '""") }', HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.value.metrics.maxStringLength, 200000);
  assert.equal(result.elapsed < 10000, true);
});

test('large token stream is lexed linearly', () => {
  const fields = [];
  for (let index = 0; index < 10000; index += 1) fields.push('f' + index);
  const result = timed(() => auditGraphQL('{ ' + fields.join(' ') + ' }', HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.value.metrics.expandedFields, 10000);
  assert.equal(result.elapsed < 10000, true);
});

test('deep JSON variables object is scanned iteratively', () => {
  const root = {};
  let current = root;
  for (let index = 1; index < 5000; index += 1) {
    current.x = {};
    current = current.x;
  }
  const result = timed(() => auditGraphQLRequest({ query: '{ a }', variables: root }, HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.value.metrics.variablesDepth, 5000);
  assert.equal(result.elapsed < 10000, true);
});

test('wide JSON variables object is scanned linearly', () => {
  const variables = {};
  for (let index = 0; index < 20000; index += 1) variables['k' + index] = index;
  const result = timed(() => auditGraphQLRequest({ query: '{ a }', variables }, HIGH));
  assert.equal(result.value.safe, true);
  assert.equal(result.elapsed < 10000, true);
});

test('batch audit work is bounded by maxBatchSize', () => {
  const payload = Array.from({ length: 1000 }, () => ({ query: '{ a }' }));
  const report = auditGraphQLRequest(payload, { ...HIGH, maxBatchSize: 3 });
  assert.equal(report.safe, false);
  assert.equal(report.metrics.queries <= 3, true);
});
