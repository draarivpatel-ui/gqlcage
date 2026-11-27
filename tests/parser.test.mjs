import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGraphQLDocument, GQLCAGE_ERROR_CODES } from '../src/index.mjs';
import { nestSelection } from './helpers.mjs';

function parseErrorCode(code = GQLCAGE_ERROR_CODES.PARSE_ERROR) {
  return { code };
}

for (let depth = 1; depth <= 25; depth += 1) {
  test('parser handles nested selection depth ' + depth, () => {
    const document = parseGraphQLDocument(nestSelection(depth));
    assert.equal(document.kind, 'Document');
    assert.equal(document.definitions.length, 1);
    let set = document.definitions[0].selectionSet;
    for (let level = 1; level <= depth; level += 1) {
      assert.equal(set.selections.length, 1);
      const field = set.selections[0];
      assert.equal(field.kind, 'Field');
      if (level < depth) set = field.selectionSet;
    }
  });
}

test('parser reads anonymous query shorthand', () => {
  const document = parseGraphQLDocument('{ viewer { id } }');
  assert.equal(document.definitions[0].operation, 'query');
  assert.equal(document.definitions[0].name, null);
});

for (const operation of ['query', 'mutation', 'subscription']) {
  test('parser reads operation type ' + operation, () => {
    const document = parseGraphQLDocument(operation + ' DoWork { x }');
    assert.equal(document.definitions[0].operation, operation);
    assert.equal(document.definitions[0].name, 'DoWork');
  });
}

test('parser reads multiple operations and fragments', () => {
  const document = parseGraphQLDocument('query A { x } mutation B { y } fragment F on T { z }');
  assert.equal(document.definitions.length, 3);
  assert.equal(document.definitions[2].kind, 'FragmentDefinition');
});

const typeCases = [
  'String',
  'String!',
  '[String]',
  '[String]!',
  '[String!]',
  '[String!]!',
  '[[String]]',
  '[[String]!]',
  '[[String!]!]!',
  '[[[Int!]!]!]!',
  'ID',
  '[ID!]!',
  'Boolean',
  '[Float]',
  'Custom_Type99'
];
for (const type of typeCases) {
  test('parser reads variable type ' + type, () => {
    const document = parseGraphQLDocument('query Q($x: ' + type + ') { a }');
    assert.equal(document.definitions[0].variableDefinitions.length, 1);
    assert.equal(document.definitions[0].variableDefinitions[0].name, 'x');
  });
}

for (const type of ['String!!', '[String', '[String!', '[[String]', '[String!!]', '[[String]!', '[String]!!']) {
  test('parser rejects malformed variable type ' + type, () => {
    assert.throws(() => parseGraphQLDocument('query Q($x: ' + type + ') { a }'), parseErrorCode());
  });
}

const scalarValues = [
  ['1', 'int'],
  ['-1', 'int'],
  ['1.5', 'float'],
  ['1e4', 'float'],
  ['"text"', 'string'],
  ['"""block"""', 'string'],
  ['true', 'boolean'],
  ['false', 'boolean'],
  ['null', 'null'],
  ['ENUM_VALUE', 'enum'],
  ['$var', 'variable']
];
for (const [source, kind] of scalarValues) {
  test('parser reads scalar value kind ' + kind + ' from ' + source, () => {
    const document = parseGraphQLDocument('{ a(x: ' + source + ') }');
    assert.equal(document.definitions[0].selectionSet.selections[0].arguments[0].value.kind, kind);
  });
}

const compositeValues = [
  '[]',
  '[1]',
  '[1, 2, 3]',
  '[[1], [2]]',
  '{}',
  '{a: 1}',
  '{a: {b: [true, null]}}',
  '[{a: 1}, {b: "x"}]',
  '{a: [1, {b: ENUM}]}',
  '[[[]]]'
];
for (const source of compositeValues) {
  test('parser reads composite input value ' + source, () => {
    const document = parseGraphQLDocument('{ a(x: ' + source + ') }');
    assert.equal(document.definitions[0].selectionSet.selections[0].arguments.length, 1);
  });
}

for (let depth = 2; depth <= 12; depth += 1) {
  test('parser iteratively reads nested list input depth ' + depth, () => {
    const source = '['.repeat(depth) + '1' + ']'.repeat(depth);
    const document = parseGraphQLDocument('{ a(x: ' + source + ') }');
    let value = document.definitions[0].selectionSet.selections[0].arguments[0].value;
    for (let level = 0; level < depth; level += 1) {
      assert.equal(value.kind, 'list');
      value = value.values[0];
    }
    assert.equal(value.kind, 'int');
  });
}

for (let depth = 2; depth <= 12; depth += 1) {
  test('parser iteratively reads nested object input depth ' + depth, () => {
    const source = '{a: '.repeat(depth) + '1' + '}'.repeat(depth);
    const document = parseGraphQLDocument('{ x(input: ' + source + ') }');
    let value = document.definitions[0].selectionSet.selections[0].arguments[0].value;
    for (let level = 0; level < depth; level += 1) {
      assert.equal(value.kind, 'object');
      value = value.fields[0].value;
    }
    assert.equal(value.kind, 'int');
  });
}

test('parser rejects variables in default values', () => {
  assert.throws(() => parseGraphQLDocument('query Q($x: Int = $y) { a }'), parseErrorCode());
});

test('parser reads variable default object value', () => {
  const document = parseGraphQLDocument('query Q($x: Input = {a: [1, true]}) { a }');
  assert.equal(document.definitions[0].variableDefinitions[0].defaultValue.kind, 'object');
});

test('parser reads directives on operations fields fragments and variables', () => {
  const document = parseGraphQLDocument('query Q($x: Int @vd) @op { a @field ...F @spread ... on T @inline { b } } fragment F on T @frag { c }');
  assert.equal(document.definitions[0].directives[0].name, 'op');
  assert.equal(document.definitions[0].variableDefinitions[0].directives[0].name, 'vd');
  assert.equal(document.definitions[1].directives[0].name, 'frag');
});

test('parser reads directive arguments', () => {
  const document = parseGraphQLDocument('{ a @include(if: true, other: {x: [1]}) }');
  assert.equal(document.definitions[0].selectionSet.selections[0].directives[0].arguments.length, 2);
});

test('parser reads field alias', () => {
  const document = parseGraphQLDocument('{ renamed: original }');
  const field = document.definitions[0].selectionSet.selections[0];
  assert.equal(field.alias, 'renamed');
  assert.equal(field.name, 'original');
});

test('parser reads fragment spread and inline fragment', () => {
  const document = parseGraphQLDocument('fragment F on T { x } query Q { ...F ... on T { y } ... { z } }');
  const selections = document.definitions[1].selectionSet.selections;
  assert.equal(selections[0].kind, 'FragmentSpread');
  assert.equal(selections[1].kind, 'InlineFragment');
  assert.equal(selections[1].typeCondition, 'T');
  assert.equal(selections[2].typeCondition, null);
});

test('parser preserves token count on document', () => {
  const document = parseGraphQLDocument('{ a }');
  assert.equal(document.tokenCount, 3);
  assert.equal(document.byteLength, 5);
});

const sdlKeywords = ['schema', 'scalar', 'type', 'interface', 'union', 'enum', 'input', 'directive', 'extend'];
for (const keyword of sdlKeywords) {
  test('parser rejects SDL keyword ' + keyword, () => {
    assert.throws(() => parseGraphQLDocument(keyword + ' Example'), parseErrorCode(GQLCAGE_ERROR_CODES.SDL_NOT_ALLOWED));
  });
}

const invalidDocuments = [
  '',
  '{ }',
  '{ a { } }',
  '{ a(',
  '{ a(x: ) }',
  '{ a(x: [1) }',
  '{ a(x: {a: 1) }',
  '{ a(x: {a 1}) }',
  '{ ... }',
  '{ ... on }',
  '{ ... on T }',
  '{ a: }',
  '{ a: 1 }',
  'query',
  'query Q',
  'fragment',
  'fragment F',
  'fragment F on',
  'fragment F on T',
  'query Q() { a }',
  'query Q($x) { a }',
  'query Q($x:) { a }',
  'query Q($x: Int =) { a }',
  'query Q($x: Int = $y) { a }',
  'query Q($x: Int @) { a }',
  'query Q($x: Int) @ { a }',
  'wat Q { a }',
  '{ a @ }',
  '{ a @d() }',
  '{ a(x:) }',
  '{ a(x: })'
];
for (const source of invalidDocuments) {
  test('parser rejects invalid document ' + JSON.stringify(source), () => {
    assert.throws(() => parseGraphQLDocument(source), (error) => error.code === GQLCAGE_ERROR_CODES.PARSE_ERROR || error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
  });
}

test('parser rejects fragment named on', () => {
  assert.throws(() => parseGraphQLDocument('fragment on on T { x }'), parseErrorCode());
});

test('parser rejects unterminated selection set at EOF', () => {
  assert.throws(() => parseGraphQLDocument('{ a { b '), parseErrorCode());
});

test('parser rejects unexpected eof in value', () => {
  assert.throws(() => parseGraphQLDocument('{ a(x: [1,'), parseErrorCode());
});

test('parser accepts a fragment spread named nearly on', () => {
  const document = parseGraphQLDocument('fragment once on T { x } query Q { ...once }');
  assert.equal(document.definitions[1].selectionSet.selections[0].name, 'once');
});

test('parser accepts field named on', () => {
  const document = parseGraphQLDocument('{ on }');
  assert.equal(document.definitions[0].selectionSet.selections[0].name, 'on');
});

test('parser accepts operation named on', () => {
  const document = parseGraphQLDocument('query on { x }');
  assert.equal(document.definitions[0].name, 'on');
});
