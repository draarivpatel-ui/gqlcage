import test from 'node:test';
import assert from 'node:assert/strict';
import { auditGraphQL } from '../src/index.mjs';
import { aliasAmplification, repeatedField, directiveBurst, hasFinding } from './helpers.mjs';

const HIGH_DUPLICATES = { maxDuplicateFields: Number.MAX_SAFE_INTEGER, maxRootFields: Number.MAX_SAFE_INTEGER, maxExpandedFields: Number.MAX_SAFE_INTEGER, maxComplexity: Number.MAX_SAFE_INTEGER };

for (let count = 1; count <= 25; count += 1) {
  test('alias amplification count ' + count + ' is measured', () => {
    const report = auditGraphQL(aliasAmplification(count), HIGH_DUPLICATES);
    assert.equal(report.safe, true);
    assert.equal(report.metrics.aliases, count);
  });
}

for (const count of [2, 3, 5, 10, 25, 100]) {
  test('alias cap rejects count ' + count + ' when limit is one lower', () => {
    const report = auditGraphQL(aliasAmplification(count), { ...HIGH_DUPLICATES, maxAliases: count - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_ALIASES_EXCEEDED'), true);
  });
}

for (const count of [5, 6, 10, 50]) {
  test('alias amplification is also capped as underlying field replication at count ' + count, () => {
    const report = auditGraphQL(aliasAmplification(count), { maxAliases: 1000, maxDuplicateFields: 5 });
    if (count > 5) {
      assert.equal(report.safe, false);
      assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_FIELDS_EXCEEDED'), true);
    } else {
      assert.equal(report.safe, true);
    }
  });
}

for (let count = 1; count <= 20; count += 1) {
  test('duplicate field count ' + count + ' is measured', () => {
    const report = auditGraphQL(repeatedField(count), { ...HIGH_DUPLICATES });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.duplicateFields, count);
  });
}

for (const count of [2, 4, 6, 10]) {
  test('duplicate field cap rejects count ' + count, () => {
    const report = auditGraphQL(repeatedField(count), { maxDuplicateFields: count - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_FIELDS_EXCEEDED'), true);
  });
}

const duplicateCases = [
  ['same response key different fields', '{ x: a x: b }', 2],
  ['same alias same field', '{ x: a x: a }', 2],
  ['three aliases one field', '{ a: login b: login c: login }', 3],
  ['nested duplicates', '{ outer { x x x } }', 3],
  ['fragment merge duplicates', 'fragment F on T { x } query Q { x ...F }', 2],
  ['inline merge duplicates', 'query Q { x ... on T { x x } }', 3],
  ['distinct sibling fields', '{ a b c }', 1],
  ['same field at different levels', '{ a { a { a } } }', 1]
];
for (const [name, query, expected] of duplicateCases) {
  test('duplicate analysis case: ' + name, () => {
    const report = auditGraphQL(query, HIGH_DUPLICATES);
    assert.equal(report.safe, true);
    assert.equal(report.metrics.duplicateFields, expected);
  });
}

for (const count of [1, 2, 5, 10, 25]) {
  test('root field count ' + count + ' is measured', () => {
    const fields = Array.from({ length: count }, (unused, index) => 'f' + index).join(' ');
    const report = auditGraphQL('{ ' + fields + ' }');
    assert.equal(report.safe, true);
    assert.equal(report.metrics.rootFields, count);
  });
}

for (const count of [2, 5, 10, 50]) {
  test('root field cap rejects count ' + count + ' at lower limit', () => {
    const fields = Array.from({ length: count }, (unused, index) => 'f' + index).join(' ');
    const report = auditGraphQL('{ ' + fields + ' }', { maxRootFields: count - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_ROOT_FIELDS_EXCEEDED'), true);
  });
}

test('aliases create distinct root response keys', () => {
  const report = auditGraphQL('{ a: login b: login c: login }', { maxAliases: 10, maxDuplicateFields: 10 });
  assert.equal(report.safe, true);
  assert.equal(report.metrics.rootFields, 3);
});

test('root fields contributed by fragments are counted', () => {
  const report = auditGraphQL('fragment F on T { a b c } query Q { ...F d }');
  assert.equal(report.safe, true);
  assert.equal(report.metrics.rootFields, 4);
});

for (const count of [1, 2, 5, 10, 25]) {
  test('directive total count ' + count + ' is measured', () => {
    const report = auditGraphQL(directiveBurst(count), { maxDirectives: 100, maxDirectivesPerLocation: 100 });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.directives, count);
  });
}

for (const count of [2, 5, 10, 30]) {
  test('directive total cap rejects count ' + count + ' at lower limit', () => {
    const report = auditGraphQL(directiveBurst(count), { maxDirectives: count - 1, maxDirectivesPerLocation: 100 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_DIRECTIVES_EXCEEDED'), true);
  });
}

for (const count of [1, 2, 5, 10, 25]) {
  test('directive per-location count ' + count + ' is measured', () => {
    const report = auditGraphQL(directiveBurst(count, true), { maxDirectives: 100, maxDirectivesPerLocation: 100 });
    assert.equal(report.safe, true);
    assert.equal(report.metrics.maxDirectivesPerLocation, count);
  });
}

for (const count of [2, 5, 10, 30]) {
  test('directive per-location cap rejects count ' + count, () => {
    const report = auditGraphQL(directiveBurst(count, true), { maxDirectives: 100, maxDirectivesPerLocation: count - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_DIRECTIVES_PER_LOCATION_EXCEEDED'), true);
  });
}

test('directives inside fragments are multiplied by expansion', () => {
  const query = 'fragment F on T { x @d } query Q { ...F ...F ...F }';
  const report = auditGraphQL(query, { maxDuplicateFields: 10 });
  assert.equal(report.safe, true);
  assert.equal(report.metrics.directives, 3);
});

test('operation directives count toward total directives', () => {
  const report = auditGraphQL('query Q @a @b { x }');
  assert.equal(report.safe, true);
  assert.equal(report.metrics.directives, 2);
});

test('variable definition directives count toward total directives', () => {
  const report = auditGraphQL('query Q($x: Int @a @b) { x }');
  assert.equal(report.safe, true);
  assert.equal(report.metrics.directives, 2);
});

test('directive arguments count toward argument total', () => {
  const report = auditGraphQL('{ x @d(a: 1, b: 2) }');
  assert.equal(report.safe, true);
  assert.equal(report.metrics.arguments, 2);
});

for (const count of [1, 2, 5, 10, 25]) {
  test('field argument count ' + count + ' is measured', () => {
    const args = Array.from({ length: count }, (unused, index) => 'a' + index + ': 1').join(', ');
    const report = auditGraphQL('{ x(' + args + ') }');
    assert.equal(report.safe, true);
    assert.equal(report.metrics.arguments, count);
  });
}

for (const count of [2, 5, 10, 50]) {
  test('argument cap rejects count ' + count + ' at lower limit', () => {
    const args = Array.from({ length: count }, (unused, index) => 'a' + index + ': 1').join(', ');
    const report = auditGraphQL('{ x(' + args + ') }', { maxArguments: count - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_ARGUMENTS_EXCEEDED'), true);
  });
}

for (const count of [1, 2, 5, 10, 25]) {
  test('variable count ' + count + ' is measured', () => {
    const vars = Array.from({ length: count }, (unused, index) => '$v' + index + ': Int').join(', ');
    const report = auditGraphQL('query Q(' + vars + ') { x }');
    assert.equal(report.safe, true);
    assert.equal(report.metrics.variables, count);
  });
}

for (const count of [2, 5, 10, 50]) {
  test('variable cap rejects count ' + count + ' at lower limit', () => {
    const vars = Array.from({ length: count }, (unused, index) => '$v' + index + ': Int').join(', ');
    const report = auditGraphQL('query Q(' + vars + ') { x }', { maxVariables: count - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_VARIABLES_EXCEEDED'), true);
  });
}

const inputDepthCases = [
  ['list depth 1', '[1]', 1],
  ['list depth 4', '[[[[1]]]]', 4],
  ['object depth 1', '{a: 1}', 1],
  ['object depth 3', '{a: {b: {c: 1}}}', 3],
  ['mixed depth 4', '{a: [{b: [1]}]}', 4],
  ['scalar depth zero', '1', 0],
  ['empty list depth one', '[]', 1],
  ['empty object depth one', '{}', 1]
];
for (const [name, source, expected] of inputDepthCases) {
  test('input depth case: ' + name, () => {
    const report = auditGraphQL('{ x(input: ' + source + ') }');
    assert.equal(report.safe, true);
    assert.equal(report.metrics.inputDepth, expected);
  });
}

for (const depth of [2, 4, 8, 10]) {
  test('input depth cap rejects nested list depth ' + depth + ' at lower limit', () => {
    const source = '['.repeat(depth) + '1' + ']'.repeat(depth);
    const report = auditGraphQL('{ x(input: ' + source + ') }', { maxInputDepth: depth - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_INPUT_DEPTH_EXCEEDED'), true);
  });
}

test('variable default input depth counts', () => {
  const report = auditGraphQL('query Q($x: Input = {a: [[1]]}) { x }');
  assert.equal(report.safe, true);
  assert.equal(report.metrics.inputDepth, 3);
});

for (const length of [1, 10, 100, 1000]) {
  test('string length ' + length + ' is measured', () => {
    const report = auditGraphQL('{ x(input: "' + 'a'.repeat(length) + '") }');
    assert.equal(report.safe, true);
    assert.equal(report.metrics.maxStringLength, length);
  });
}

for (const length of [2, 10, 100]) {
  test('string cap rejects length ' + length + ' at lower limit', () => {
    const report = auditGraphQL('{ x(input: "' + 'a'.repeat(length) + '") }', { maxStringLength: length - 1 });
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_STRING_LENGTH_EXCEEDED'), true);
  });
}

test('block string length is measured after normalization', () => {
  const report = auditGraphQL('{ x(input: """\n  abc\n  def\n""") }');
  assert.equal(report.safe, true);
  assert.equal(report.metrics.maxStringLength, 7);
});

test('duplicate arguments are rejected', () => {
  const report = auditGraphQL('{ x(a: 1, a: 2) }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_ARGUMENT'), true);
});

test('duplicate input object fields are rejected', () => {
  const report = auditGraphQL('{ x(input: {a: 1, a: 2}) }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_INPUT_FIELD'), true);
});

const dangerousNames = ['__proto__', 'constructor', 'prototype'];
for (const name of dangerousNames) {
  test('prototype pollution field name rejected: ' + name, () => {
    const report = auditGraphQL('{ ' + name + ' }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
  test('prototype pollution alias rejected: ' + name, () => {
    const report = auditGraphQL('{ ' + name + ': safe }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
  test('prototype pollution variable rejected: ' + name, () => {
    const report = auditGraphQL('query Q($' + name + ': Int) { x }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
  test('prototype pollution argument rejected: ' + name, () => {
    const report = auditGraphQL('{ x(' + name + ': 1) }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
  test('prototype pollution input key rejected: ' + name, () => {
    const report = auditGraphQL('{ x(input: {' + name + ': 1}) }');
    assert.equal(report.safe, false);
    assert.equal(hasFinding(report, 'GQLCAGE_PROTOTYPE_POLLUTION'), true);
  });
}

test('duplicate variables are rejected', () => {
  const report = auditGraphQL('query Q($x: Int, $x: Int) { x }');
  assert.equal(report.safe, false);
  assert.equal(hasFinding(report, 'GQLCAGE_DUPLICATE_VARIABLE'), true);
});
