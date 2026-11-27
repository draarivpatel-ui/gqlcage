import test from 'node:test';
import assert from 'node:assert/strict';
import { lexGraphQL, GQLCAGE_ERROR_CODES } from '../src/index.mjs';

const punctuators = ['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}'];
for (const punctuator of punctuators) {
  test('lexer accepts punctuator ' + punctuator, () => {
    const result = lexGraphQL(punctuator);
    assert.equal(result.tokens[0].type, 'PUNCT');
    assert.equal(result.tokens[0].value, punctuator);
  });
}

const names = ['a', 'Z', '_', '_abc', 'a0', 'A9_z', 'query', 'mutation', 'fragment', 'on', 'truex', 'nullish', 'x'.repeat(32), 'q_w_e_r_t_y', 'Z0', '_0', 'a_b_c_1_2_3', 'fieldName', '__typename', 'x'];
for (const name of names) {
  test('lexer accepts name ' + name.slice(0, 24), () => {
    const result = lexGraphQL(name);
    assert.equal(result.tokens[0].type, 'NAME');
    assert.equal(result.tokens[0].value, name);
  });
}

for (const badStart of ['0abc', '9z']) {
  test('lexer rejects digit-starting name ' + badStart, () => {
    assert.throws(() => lexGraphQL(badStart), (error) => error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
  });
}

const validNumbers = ['0', '-0', '1', '-1', '123456789', '0.1', '1.0', '-2.5', '1e1', '1E1', '1e+1', '1e-1', '2.5e10', '-3.25E-8', '9e+99', '10', '1000000', '42.000', '7e0', '8E-0'];
for (const number of validNumbers) {
  test('lexer accepts number ' + number, () => {
    const result = lexGraphQL(number);
    assert.equal(result.tokens[0].value, number);
    assert.equal(result.tokens[0].type, number.includes('.') || number.includes('e') || number.includes('E') ? 'FLOAT' : 'INT');
  });
}

const invalidNumbers = ['01', '-01', '1.', '1e', '1e+', '1e-', '-', '1abc', '1..2', '--1', '0x10', '1_000'];
for (const number of invalidNumbers) {
  test('lexer rejects invalid number ' + number, () => {
    assert.throws(() => lexGraphQL(number), (error) => error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
  });
}

const stringCases = [
  ['"hello"', 'hello'],
  ['""', ''],
  ['"a\\nb"', 'a\nb'],
  ['"a\\tb"', 'a\tb'],
  ['"a\\rb"', 'a\rb'],
  ['"a\\bb"', 'a\bb'],
  ['"a\\fb"', 'a\fb'],
  ['"\\u0041"', 'A'],
  ['"\\u00e9"', 'é'],
  ['"slash \\\\ quote \\""', 'slash \\ quote "'],
  ['"solidus \\/"', 'solidus /'],
  ['"unicode snowman \\u2603"', 'unicode snowman ☃']
];
for (const [source, expected] of stringCases) {
  test('lexer decodes string ' + source.slice(0, 28), () => {
    const result = lexGraphQL(source);
    assert.equal(result.tokens[0].type, 'STRING');
    assert.equal(result.tokens[0].value, expected);
    assert.equal(result.tokens[0].block, false);
  });
}

const invalidStrings = ['"', '"unterminated', '"line\nfeed"', '"bad \\q escape"', '"bad \\u123 escape"', '"carriage\rreturn"', "'single'"];
for (const source of invalidStrings) {
  test('lexer rejects invalid string ' + JSON.stringify(source), () => {
    assert.throws(() => lexGraphQL(source), (error) => error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
  });
}

const blockCases = [
  ['"""abc"""', 'abc'],
  ['""""""', ''],
  ['"""\nhello\n"""', 'hello'],
  ['"""\n  hello\n  world\n"""', 'hello\nworld'],
  ['"""\r\n  hello\r\n  world\r\n"""', 'hello\nworld'],
  ['"""a \\""" b"""', 'a """ b'],
  ['"""\n\n  x\n\n"""', 'x'],
  ['"""one\ntwo"""', 'one\ntwo'],
  ['"""  first\n  second"""', '  first\nsecond'],
  ['"""tab\n\tindent\n\tnext\n"""', 'tab\nindent\nnext']
];
for (const [source, expected] of blockCases) {
  test('lexer normalizes block string ' + JSON.stringify(source.slice(0, 24)), () => {
    const result = lexGraphQL(source);
    assert.equal(result.tokens[0].type, 'STRING');
    assert.equal(result.tokens[0].value, expected);
    assert.equal(result.tokens[0].block, true);
  });
}

for (const source of ['"""', '"""unterminated', '"""xx\\"']) {
  test('lexer rejects unterminated block string ' + JSON.stringify(source), () => {
    assert.throws(() => lexGraphQL(source), (error) => error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
  });
}

test('lexer ignores commas as insignificant whitespace', () => {
  const result = lexGraphQL('{ a, b,, c }');
  assert.deepEqual(result.tokens.filter((token) => token.type === 'NAME').map((token) => token.value), ['a', 'b', 'c']);
});

test('lexer ignores hash comments', () => {
  const result = lexGraphQL('# before\n{ a # after\n b }');
  assert.deepEqual(result.tokens.filter((token) => token.type === 'NAME').map((token) => token.value), ['a', 'b']);
});

test('lexer tracks line and column across newlines', () => {
  const result = lexGraphQL('{\n  alpha\n  beta\n}');
  const beta = result.tokens.find((token) => token.value === 'beta');
  assert.equal(beta.line, 3);
  assert.equal(beta.column, 3);
});

test('lexer tracks CRLF as one line break', () => {
  const result = lexGraphQL('{\r\n  alpha\r\n}');
  const alpha = result.tokens.find((token) => token.value === 'alpha');
  assert.equal(alpha.line, 2);
  assert.equal(alpha.column, 3);
});

test('lexer accepts tabs and spaces as whitespace', () => {
  const result = lexGraphQL(' \t { \t a \t } ');
  assert.equal(result.tokens.some((token) => token.value === 'a'), true);
});

test('lexer rejects a bare dot', () => {
  assert.throws(() => lexGraphQL('.'), (error) => error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
});

test('lexer rejects two dots', () => {
  assert.throws(() => lexGraphQL('..'), (error) => error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
});

test('lexer accepts exactly three dots as a spread token', () => {
  const result = lexGraphQL('...');
  assert.equal(result.tokens[0].value, '...');
});

const controlCodes = [0, 1, 2, 7, 8, 11, 12, 14, 27, 31, 127, 128, 159, 8206, 8207, 8234, 8238, 8294, 8297];
for (const code of controlCodes) {
  test('lexer rejects control or bidi code point ' + code, () => {
    assert.throws(() => lexGraphQL('{ a' + String.fromCodePoint(code) + ' }'), (error) => error.code === GQLCAGE_ERROR_CODES.LEX_ERROR);
  });
}

test('lexer enforces token limit', () => {
  assert.throws(() => lexGraphQL('{ a b c }', { maxTokens: 3 }), (error) => error.code === GQLCAGE_ERROR_CODES.MAX_TOKENS);
});

test('lexer reports token count excluding EOF', () => {
  const result = lexGraphQL('{ a }');
  assert.equal(result.tokenCount, 3);
  assert.equal(result.tokens.at(-1).type, 'EOF');
});

test('lexer enforces byte limit with UTF-8 width', () => {
  assert.throws(() => lexGraphQL('{ a(x:"é") }', { maxBytes: 5 }), (error) => error.code === GQLCAGE_ERROR_CODES.INPUT_TOO_LARGE);
});

test('lexer reports byte length with UTF-8 width', () => {
  const result = lexGraphQL('"é"');
  assert.equal(result.byteLength, 4);
});

test('lexer enforces name length', () => {
  assert.throws(() => lexGraphQL('x'.repeat(20), { maxNameLength: 10 }), (error) => error.code === GQLCAGE_ERROR_CODES.NAME_TOO_LONG);
});

test('lexer errors carry line and column', () => {
  try {
    lexGraphQL('{\n  a\n  .\n}');
    assert.fail('expected lexical error');
  } catch (error) {
    assert.equal(error.code, GQLCAGE_ERROR_CODES.LEX_ERROR);
    assert.equal(typeof error.line, 'number');
    assert.equal(typeof error.column, 'number');
  }
});
