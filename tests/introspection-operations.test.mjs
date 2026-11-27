import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGraphQL, isSafeGraphQL, validateGraphQL, GqlCageError } from '../src/index.mjs';
import { hasFinding } from './helpers.mjs';

const introspectionBypasses = [
  ['direct schema', '{ __schema { types { name } } }'],
  ['direct type', '{ __type(name: "Query") { name } }'],
  ['aliased schema', '{ harmless: __schema { types { name } } }'],
  ['aliased type', '{ harmless: __type(name: "Query") { name } }'],
  ['schema in fragment', 'fragment F on T { __schema { types { name } } } query Q { ...F }'],
  ['type in fragment', 'fragment F on T { __type(name: "Query") { name } } query Q { ...F }'],
  ['schema in inline fragment', 'query Q { ... on T { __schema { types { name } } } }'],
  ['type in inline fragment', 'query Q { ... on T { __type(name: "Query") { name } } }'],
  ['schema nested under harmless field', '{ harmless { __schema { types { name } } } }'],
  ['schema in unused fragment', 'fragment F on T { __schema { types { name } } } query Q { safe }'],
  ['schema behind two fragment hops', 'fragment A on T { ...B } fragment B on T { __schema { types { name } } } query Q { ...A }'],
  ['schema with directive', '{ __schema @skip(if: false) { types { name } } }'],
  ['schema with arguments on child', '{ __schema { types(first: 10) { name } } }'],
  ['schema in mutation', 'mutation M { __schema { types { name } } }'],
  ['schema in subscription', 'subscription S { __schema { types { name } } }']
];
for (const [name, query] of introspectionBypasses) {
  test('introspection blocked through bypass: ' + name, () => {
    const report = auditGraphQL(query);
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_INTROSPECTION_BLOCKED'), true);
  });
}

test('allowIntrospection permits schema field', () => {
  const report = auditGraphQL('{ __schema { types { name } } }', { allowIntrospection: true });
  assert.equal(report.safe, true);
});

test('allowIntrospection permits type field', () => {
  const report = auditGraphQL('{ __type(name: "Query") { name } }', { allowIntrospection: true });
  assert.equal(report.safe, true);
});

test('internal preset permits introspection', () => {
  const report = auditGraphQL('{ __schema { types { name } } }', { preset: 'internal' });
  assert.equal(report.safe, true);
});

test('typename is blocked by default', () => {
  const report = auditGraphQL('{ __typename }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_INTROSPECTION_BLOCKED'), true);
});

test('typename remains blocked when only introspection is allowed', () => {
  const report = auditGraphQL('{ __typename }', { allowIntrospection: true });
  assert.equal(report.safe, false);
});

test('typename is allowed by allowTypename', () => {
  const report = auditGraphQL('{ __typename }', { allowTypename: true });
  assert.equal(report.safe, true);
});

test('typename inside fragment obeys allowTypename', () => {
  const query = 'fragment F on T { __typename } query Q { ...F }';
  assert.equal(auditGraphQL(query).safe, false);
  assert.equal(auditGraphQL(query, { allowTypename: true }).safe, true);
});

const operationCases = [
  ['query', 'query Q { x }'],
  ['mutation', 'mutation M { x }'],
  ['subscription', 'subscription S { x }']
];
for (const [operation, query] of operationCases) {
  test('default policy allows operation ' + operation, () => {
    assert.equal(auditGraphQL(query).safe, true);
  });
  test('operation allowlist can block ' + operation, () => {
    const allowed = ['query', 'mutation', 'subscription'].filter((item) => item !== operation);
    const report = auditGraphQL(query, { allowedOperations: allowed });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_OPERATION_TYPE_BLOCKED'), true);
  });
}

test('strict preset blocks mutation', () => {
  const report = auditGraphQL('mutation M { x }', { preset: 'strict' });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_OPERATION_TYPE_BLOCKED'), true);
});

test('strict preset allows named query', () => {
  assert.equal(auditGraphQL('query Q { x }', { preset: 'strict' }).safe, true);
});

test('strict preset rejects anonymous query through requireOperationName', () => {
  const report = auditGraphQL('{ x }', { preset: 'strict' });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_OPERATION_NAME_REQUIRED'), true);
});

test('public preset allows anonymous single operation', () => {
  assert.equal(auditGraphQL('{ x }').safe, true);
});

test('multiple anonymous operations require names', () => {
  const report = auditGraphQL('{ x } { y }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_OPERATION_NAME_REQUIRED'), true);
});

test('single anonymous operation requires name when configured', () => {
  const report = auditGraphQL('{ x }', { requireOperationName: true });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_OPERATION_NAME_REQUIRED'), true);
});

test('duplicate operation names are rejected', () => {
  const report = auditGraphQL('query A { x } query A { y }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_OPERATION'), true);
});

for (const count of [1, 2, 5]) {
  test('operation count ' + count + ' is measured', () => {
    const query = Array.from({ length: count }, (unused, index) => 'query Q' + index + ' { x }').join(' ');
    const report = auditGraphQL(query, { maxOperations: Math.max(5, count) });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.operations, count);
  });
}

for (const count of [2, 5, 10]) {
  test('operation cap rejects count ' + count + ' at lower limit', () => {
    const query = Array.from({ length: count }, (unused, index) => 'query Q' + index + ' { x }').join(' ');
    const report = auditGraphQL(query, { maxOperations: count - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_OPERATIONS_EXCEEDED'), true);
  });
}

const sdlDocuments = [
  'type Query { x: String }',
  'schema { query: Query }',
  'scalar Date',
  'interface Node { id: ID }',
  'union Result = A | B',
  'enum Color { RED BLUE }',
  'input Filter { x: String }',
  'directive @tag on FIELD',
  'extend type Query { x: String }'
];
for (const source of sdlDocuments) {
  test('SDL rejected in audit: ' + source.split(' ')[0], () => {
    const report = auditGraphQL(source);
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_SDL_NOT_ALLOWED'), true);
  });
}

test('SDL validate throws typed error', () => {
  assert.throws(() => validateGraphQL('type Query { x: String }'), (error) => error instanceof GqlCageError && error.code === 'GQLCAGE_SDL_NOT_ALLOWED');
});

test('parse error is returned as finding by audit', () => {
  const report = auditGraphQL('{ a { ');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_PARSE_ERROR'), true);
});

test('lex error is returned as finding by audit', () => {
  const report = auditGraphQL('{ a . }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_LEX_ERROR'), true);
});

test('byte limit is enforced before parsing', () => {
  const report = auditGraphQL('{ a }', { maxBytes: 2 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_INPUT_TOO_LARGE'), true);
});

test('token limit is enforced', () => {
  const report = auditGraphQL('{ a b c }', { maxTokens: 3 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_MAX_TOKENS'), true);
});

test('name length limit is enforced', () => {
  const report = auditGraphQL('{ ' + 'x'.repeat(30) + ' }', { maxNameLength: 10 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_NAME_TOO_LONG'), true);
});

test('isSafeGraphQL agrees with auditGraphQL for safe input', () => {
  assert.equal(isSafeGraphQL('{ x }'), auditGraphQL('{ x }').safe);
});

test('isSafeGraphQL agrees with auditGraphQL for unsafe input', () => {
  assert.equal(isSafeGraphQL('{ __schema { types { name } } }'), auditGraphQL('{ __schema { types { name } } }').safe);
});

test('metrics tokens operations and fragments are populated', () => {
  const report = auditGraphQL('fragment F on T { x } query Q { ...F } mutation M { y }');
  assert.equal(report.metrics.operations, 2);
  assert.equal(report.metrics.fragments, 1);
  assert.equal(report.metrics.tokens > 0, true);
});

test('operation metrics are worst single operation rather than sum', () => {
  const report = auditGraphQL('query A { x y } query B { z }');
  assert.equal(report.metrics.expandedFields, 2);
  assert.equal(report.metrics.complexity, 2);
});
