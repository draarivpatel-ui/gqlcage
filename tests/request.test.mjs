import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGraphQLRequest, createGraphQLGuard } from '../src/index.mjs';
import { hasFinding } from './helpers.mjs';

function nestedObject(depth) {
  const root = {};
  let current = root;
  for (let index = 1; index < depth; index += 1) {
    current.x = {};
    current = current.x;
  }
  return root;
}

function nestedArray(depth) {
  let value = [];
  for (let index = 1; index < depth; index += 1) value = [value];
  return value;
}

const validPayloads = [
  ['object minimal', { query: '{ a }' }],
  ['object operation name', { query: 'query Q { a }', operationName: 'Q' }],
  ['object null operation name', { query: '{ a }', operationName: null }],
  ['object variables', { query: 'query Q($x: Int) { a(x: $x) }', variables: { x: 1 } }],
  ['object null variables', { query: '{ a }', variables: null }],
  ['object extensions', { query: '{ a }', extensions: { trace: true } }],
  ['json string', JSON.stringify({ query: '{ a }' })],
  ['json string variables', JSON.stringify({ query: '{ a }', variables: { x: [1, 2] } })],
  ['batch allowed', [{ query: '{ a }' }, { query: '{ b }' }], { maxBatchSize: 2 }],
  ['batch one default', [{ query: '{ a }' }]],
  ['deep variables within limit', { query: '{ a }', variables: nestedObject(5) }],
  ['array variable values within limit', { query: '{ a }', variables: { values: nestedArray(4) } }]
];
for (const [name, payload, options] of validPayloads) {
  test('valid request payload: ' + name, () => {
    const report = auditGraphQLRequest(payload, options);
    assert.equal(report.safe, true);
    assert.equal(report.findings.length, 0);
  });
}

for (const size of [2, 3, 5, 10, 50]) {
  test('batch size ' + size + ' blocked by default', () => {
    const payload = Array.from({ length: size }, () => ({ query: '{ a }' }));
    const report = auditGraphQLRequest(payload);
    assert.equal(report.safe, false);
    assert.equal(report.metrics.batchSize, size);
    assert.equal(hasFinding(report, 'GQLCAGE_BATCH_SIZE_EXCEEDED'), true);
  });
}

for (const size of [2, 3, 5, 10]) {
  test('batch size ' + size + ' allowed when configured', () => {
    const payload = Array.from({ length: size }, () => ({ query: '{ a }' }));
    const report = auditGraphQLRequest(payload, { maxBatchSize: size });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.batchSize, size);
    assert.equal(report.metrics.queries, size);
  });
}

for (const size of [3, 5, 8]) {
  test('batch size ' + size + ' rejected when configured limit is lower', () => {
    const payload = Array.from({ length: size }, () => ({ query: '{ a }' }));
    const report = auditGraphQLRequest(payload, { maxBatchSize: size - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_BATCH_SIZE_EXCEEDED'), true);
  });
}

test('empty batch is invalid', () => {
  const report = auditGraphQLRequest([], { maxBatchSize: 10 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_REQUEST_SHAPE_INVALID'), true);
});

test('null payload is invalid', () => {
  const report = auditGraphQLRequest(null);
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_REQUEST_SHAPE_INVALID'), true);
});

test('JSON null payload is invalid', () => {
  const report = auditGraphQLRequest('null');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_REQUEST_SHAPE_INVALID'), true);
});

for (const depth of [1, 2, 5, 10, 12]) {
  test('variables object depth ' + depth + ' allowed within default', () => {
    const report = auditGraphQLRequest({ query: '{ a }', variables: nestedObject(depth) });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.variablesDepth >= depth, true);
  });
}

for (const depth of [13, 15, 20, 30]) {
  test('variables object depth ' + depth + ' rejected by default', () => {
    const report = auditGraphQLRequest({ query: '{ a }', variables: nestedObject(depth) });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_TOO_DEEP'), true);
  });
}

for (const depth of [2, 4, 8, 12]) {
  test('variables array depth ' + depth + ' measured', () => {
    const report = auditGraphQLRequest({ query: '{ a }', variables: { values: nestedArray(depth) } }, { maxVariablesDepth: depth + 1 });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.variablesDepth, depth + 1);
  });
}

for (const depth of [3, 5, 8]) {
  test('variables depth cap rejects array depth ' + depth + ' at lower limit', () => {
    const report = auditGraphQLRequest({ query: '{ a }', variables: { values: nestedArray(depth) } }, { maxVariablesDepth: depth });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_TOO_DEEP'), true);
  });
}

test('variables byte cap is enforced', () => {
  const report = auditGraphQLRequest({ query: '{ a }', variables: { x: 'a'.repeat(1000) } }, { maxVariablesBytes: 100 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_TOO_LARGE'), true);
});

test('variables node cap is enforced', () => {
  const variables = {};
  for (let index = 0; index < 100; index += 1) variables['k' + index] = index;
  const report = auditGraphQLRequest({ query: '{ a }', variables }, { maxVariablesNodes: 20 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_TOO_LARGE'), true);
});

test('variables byte metrics are populated', () => {
  const report = auditGraphQLRequest({ query: '{ a }', variables: { x: 'abc' } });
  assert.equal(report.metrics.variablesBytes > 0, true);
  assert.equal(report.metrics.variablesNodes > 0, true);
});

test('extensions byte cap is enforced', () => {
  const report = auditGraphQLRequest({ query: '{ a }', extensions: { x: 'a'.repeat(1000) } }, { maxVariablesBytes: 100 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_TOO_LARGE'), true);
});

const nonJsonValues = [
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['negative Infinity', Number.NEGATIVE_INFINITY],
  ['undefined', undefined],
  ['function', () => 1],
  ['symbol', Symbol('x')],
  ['bigint', 10n],
  ['date', new Date(0)]
];
for (const [name, value] of nonJsonValues) {
  test('variables reject non-JSON value: ' + name, () => {
    const report = auditGraphQLRequest({ query: '{ a }', variables: { bad: value } });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_NOT_JSON'), true);
  });
}

test('variables reject reference cycle', () => {
  const variables = { a: {} };
  variables.self = variables;
  const report = auditGraphQLRequest({ query: '{ a }', variables });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_CYCLE'), true);
});

test('extensions reject reference cycle', () => {
  const extensions = { a: {} };
  extensions.self = extensions;
  const report = auditGraphQLRequest({ query: '{ a }', extensions });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_CYCLE'), true);
});

for (const key of ['__proto__', 'constructor', 'prototype']) {
  test('variables reject prototype pollution key ' + key, () => {
    const variables = JSON.parse('{"' + key + '": {"x": 1}}');
    const report = auditGraphQLRequest({ query: '{ a }', variables });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
}

const invalidShapes = [
  ['number', 5],
  ['boolean', true],
  ['undefined', undefined],
  ['string object missing query', '{}'],
  ['entry missing query', {}],
  ['entry empty query', { query: '' }],
  ['entry numeric query', { query: 5 }],
  ['entry null query', { query: null }],
  ['entry numeric operationName', { query: '{ a }', operationName: 5 }],
  ['entry unknown key', { query: '{ a }', extra: true }],
  ['array variables root', { query: '{ a }', variables: [] }],
  ['string variables root', { query: '{ a }', variables: 'x' }],
  ['array extensions root', { query: '{ a }', extensions: [] }],
  ['batch primitive entry', [5]],
  ['batch null entry', [null]],
  ['batch missing query entry', [{ query: '{ a }' }, {}], { maxBatchSize: 2 }]
];
for (const [name, payload, options] of invalidShapes) {
  test('invalid request shape: ' + name, () => {
    const report = auditGraphQLRequest(payload, options);
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_REQUEST_SHAPE_INVALID'), true);
  });
}

test('invalid JSON string is rejected', () => {
  const report = auditGraphQLRequest('{not json');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_REQUEST_JSON_INVALID'), true);
});

test('oversized JSON string is rejected before parse', () => {
  const payload = JSON.stringify({ query: '{ a }', variables: { x: 'a'.repeat(1000) } });
  const report = auditGraphQLRequest(payload, { maxBytes: 100 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_REQUEST_TOO_LARGE'), true);
});

test('oversized object payload is rejected', () => {
  const report = auditGraphQLRequest({ query: '{ a }', variables: { x: 'a'.repeat(1000) } }, { maxBytes: 100 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_REQUEST_TOO_LARGE'), true);
});

test('unsafe query inside request is rejected', () => {
  const report = auditGraphQLRequest({ query: '{ __schema { types { name } } }' });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_INTROSPECTION_BLOCKED'), true);
});

test('unsafe query inside batch is rejected', () => {
  const report = auditGraphQLRequest([{ query: '{ a }' }, { query: '{ __schema { types { name } } }' }], { maxBatchSize: 2 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_INTROSPECTION_BLOCKED'), true);
});

test('request findings are namespaced with entry path', () => {
  const report = auditGraphQLRequest({ query: '{ __schema { types { name } } }' });
  assert.equal(report.findings[0].path.startsWith('entry'), true);
});

test('request metrics reflect worst query depth', () => {
  const report = auditGraphQLRequest([{ query: '{ a }' }, { query: '{ a { b { c } } }' }], { maxBatchSize: 2 });
  assert.equal(report.safe, true);
  assert.equal(report.metrics.depth, 3);
});

test('operationName length is capped', () => {
  const report = auditGraphQLRequest({ query: 'query Q { a }', operationName: 'x'.repeat(100) }, { maxStringLength: 10 });
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_STRING_LENGTH_EXCEEDED'), true);
});

test('guard allows safe request and calls next', () => {
  const guard = createGraphQLGuard();
  const req = { body: { query: '{ a }' } };
  let called = false;
  const result = guard(req, null, () => {
    called = true;
  });
  assert.equal(result, true);
  assert.equal(called, true);
  assert.equal(req.gqlcage.safe, true);
});

test('guard rejects unsafe request and writes express response', () => {
  const guard = createGraphQLGuard();
  const req = { body: { query: '{ __schema { types { name } } }' } };
  let statusCode = 0;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
    }
  };
  const result = guard(req, res, () => assert.fail('next must not be called'));
  assert.equal(result, false);
  assert.equal(statusCode, 400);
  assert.equal(Array.isArray(body.errors), true);
});

test('guard rejects unsafe request with node response', () => {
  const guard = createGraphQLGuard();
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      chunks.push(value);
    }
  };
  const result = guard({ body: { query: '{ __schema { types { name } } }' } }, res);
  assert.equal(result, false);
  assert.equal(res.statusCode, 400);
  assert.equal(chunks.length, 1);
});

test('guard policy is frozen', () => {
  const guard = createGraphQLGuard({ maxDepth: 3 });
  assert.equal(Object.isFrozen(guard), true);
  assert.equal(Object.isFrozen(guard.policy), true);
  assert.equal(guard.policy.maxDepth, 3);
});

test('guard audit helper works without middleware objects', () => {
  const guard = createGraphQLGuard();
  const report = guard.audit({ query: '{ a }' });
  assert.equal(report.safe, true);
});
