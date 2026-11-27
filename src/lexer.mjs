import { GQLCAGE_ERROR_CODES, GqlCageError } from './errors.mjs';

const NAME_START = /[A-Za-z_]/;
const NAME_CONTINUE = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9A-Fa-f]/;
const PUNCTUATORS = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}']);

function isDisallowedControl(code) {
  return (code >= 0x0000 && code <= 0x0008)
    || code === 0x000b
    || code === 0x000c
    || (code >= 0x000e && code <= 0x001f)
    || (code >= 0x007f && code <= 0x009f)
    || code === 0x061c
    || code === 0x200e
    || code === 0x200f
    || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069);
}

function isLineTerminator(code) {
  return code === 0x000a || code === 0x000d;
}

function normalizeBlockString(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let commonIndent = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[ \t]*$/.test(line)) continue;
    let indent = 0;
    while (indent < line.length && (line[indent] === ' ' || line[indent] === '\t')) indent += 1;
    if (commonIndent === -1 || indent < commonIndent) commonIndent = indent;
  }
  if (commonIndent > 0) {
    for (let index = 1; index < lines.length; index += 1) {
      lines[index] = lines[index].slice(commonIndent);
    }
  }
  while (lines.length > 0 && /^[ \t]*$/.test(lines[0])) lines.shift();
  while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop();
  return lines.join('\n');
}

export function lexGraphQL(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('GraphQL source must be a string');
  const maxTokens = Number.isSafeInteger(options.maxTokens) ? options.maxTokens : Infinity;
  const maxBytes = Number.isSafeInteger(options.maxBytes) ? options.maxBytes : Infinity;
  const maxNameLength = Number.isSafeInteger(options.maxNameLength) ? options.maxNameLength : 512;
  const byteLength = Buffer.byteLength(source, 'utf8');
  if (byteLength > maxBytes) {
    throw new GqlCageError(GQLCAGE_ERROR_CODES.INPUT_TOO_LARGE, 'GraphQL input exceeds the configured byte limit', {
      index: 0,
      line: 1,
      column: 1,
      details: { bytes: byteLength, maxBytes }
    });
  }

  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;
  let tokenCount = 0;

  const location = () => ({ index, line, column });
  const fail = (message, details) => {
    throw new GqlCageError(GQLCAGE_ERROR_CODES.LEX_ERROR, message, { index, line, column, details });
  };
  const advanceOne = () => {
    const ch = source[index];
    index += 1;
    if (ch === '\r') {
      const pair = source[index] === '\n';
      if (pair) index += 1;
      line += 1;
      column = 1;
      return pair ? '\r\n' : ch;
    } else if (ch === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return ch;
  };
  const pushToken = (type, value, start, extra = {}) => {
    tokenCount += 1;
    if (tokenCount > maxTokens) {
      throw new GqlCageError(GQLCAGE_ERROR_CODES.MAX_TOKENS, 'GraphQL input exceeds the configured token limit', {
        index: start.index,
        line: start.line,
        column: start.column,
        details: { tokens: tokenCount, maxTokens }
      });
    }
    tokens.push({
      type,
      value,
      index: start.index,
      line: start.line,
      column: start.column,
      end: index,
      ...extra
    });
  };
  const skipWhitespaceAndComments = () => {
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 0x0020 || code === 0x0009 || code === 0x000a || code === 0x000d || code === 0x002c || code === 0xfeff) {
        advanceOne();
        continue;
      }
      if (source[index] === '#') {
        while (index < source.length && !isLineTerminator(source.charCodeAt(index))) {
          if (isDisallowedControl(source.charCodeAt(index))) fail('comment contains a disallowed control character');
          advanceOne();
        }
        continue;
      }
      break;
    }
  };
  const readName = () => {
    const start = location();
    let value = '';
    while (index < source.length && NAME_CONTINUE.test(source[index])) {
      value += advanceOne();
    }
    if (value.length > maxNameLength) {
      throw new GqlCageError(GQLCAGE_ERROR_CODES.NAME_TOO_LONG, 'GraphQL name exceeds the configured length limit', {
        index: start.index,
        line: start.line,
        column: start.column,
        details: { length: value.length, maxNameLength }
      });
    }
    pushToken('NAME', value, start);
  };
  const readNumber = () => {
    const start = location();
    let raw = '';
    if (source[index] === '-') raw += advanceOne();
    if (source[index] === '0') {
      raw += advanceOne();
      if (DIGIT.test(source[index] || '')) fail('number has a leading zero');
    } else if (DIGIT.test(source[index] || '')) {
      while (DIGIT.test(source[index] || '')) raw += advanceOne();
    } else {
      fail('expected a digit');
    }
    let floating = false;
    if (source[index] === '.') {
      floating = true;
      raw += advanceOne();
      if (!DIGIT.test(source[index] || '')) fail('fractional part requires a digit');
      while (DIGIT.test(source[index] || '')) raw += advanceOne();
    }
    if (source[index] === 'e' || source[index] === 'E') {
      floating = true;
      raw += advanceOne();
      if (source[index] === '+' || source[index] === '-') raw += advanceOne();
      if (!DIGIT.test(source[index] || '')) fail('exponent requires a digit');
      while (DIGIT.test(source[index] || '')) raw += advanceOne();
    }
    if (NAME_START.test(source[index] || '')) fail('number cannot be immediately followed by a name character');
    pushToken(floating ? 'FLOAT' : 'INT', raw, start);
  };
  const readEscape = () => {
    const escaped = source[index];
    if (escaped === '"' || escaped === '\\' || escaped === '/') {
      advanceOne();
      return escaped;
    }
    if (escaped === 'b') {
      advanceOne();
      return '\b';
    }
    if (escaped === 'f') {
      advanceOne();
      return '\f';
    }
    if (escaped === 'n') {
      advanceOne();
      return '\n';
    }
    if (escaped === 'r') {
      advanceOne();
      return '\r';
    }
    if (escaped === 't') {
      advanceOne();
      return '\t';
    }
    if (escaped === 'u') {
      advanceOne();
      let hex = '';
      for (let count = 0; count < 4; count += 1) {
        if (!HEX.test(source[index] || '')) fail('unicode escape requires four hexadecimal digits');
        hex += advanceOne();
      }
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    fail('unsupported string escape');
    return '';
  };
  const readString = () => {
    const start = location();
    advanceOne();
    let value = '';
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (source[index] === '"') {
        advanceOne();
        pushToken('STRING', value, start, { block: false });
        return;
      }
      if (isLineTerminator(code)) fail('line terminator is not allowed in a string literal');
      if (isDisallowedControl(code)) fail('string literal contains a disallowed control character');
      if (source[index] === '\\') {
        advanceOne();
        value += readEscape();
      } else {
        value += advanceOne();
      }
    }
    throw new GqlCageError(GQLCAGE_ERROR_CODES.LEX_ERROR, 'unterminated string literal', {
      index: start.index,
      line: start.line,
      column: start.column
    });
  };
  const readBlockString = () => {
    const start = location();
    advanceOne();
    advanceOne();
    advanceOne();
    let raw = '';
    while (index < source.length) {
      if (source.startsWith('"""', index)) {
        advanceOne();
        advanceOne();
        advanceOne();
        pushToken('STRING', normalizeBlockString(raw), start, { block: true });
        return;
      }
      if (source.startsWith('\\"""', index)) {
        advanceOne();
        advanceOne();
        advanceOne();
        advanceOne();
        raw += '"""';
        continue;
      }
      const code = source.charCodeAt(index);
      if (isDisallowedControl(code)) fail('block string contains a disallowed control character');
      raw += advanceOne();
    }
    throw new GqlCageError(GQLCAGE_ERROR_CODES.LEX_ERROR, 'unterminated block string literal', {
      index: start.index,
      line: start.line,
      column: start.column
    });
  };

  while (index < source.length) {
    skipWhitespaceAndComments();
    if (index >= source.length) break;
    const start = location();
    const ch = source[index];
    const code = source.charCodeAt(index);
    if (isDisallowedControl(code)) fail('source contains a disallowed control character');
    if (NAME_START.test(ch)) {
      readName();
      continue;
    }
    if (DIGIT.test(ch) || ch === '-') {
      readNumber();
      continue;
    }
    if (ch === '"') {
      if (source.startsWith('"""', index)) readBlockString();
      else readString();
      continue;
    }
    if (ch === '.') {
      if (!source.startsWith('...', index)) fail('a dot is only valid as part of a fragment spread');
      advanceOne();
      advanceOne();
      advanceOne();
      pushToken('PUNCT', '...', start);
      continue;
    }
    if (PUNCTUATORS.has(ch)) {
      advanceOne();
      pushToken('PUNCT', ch, start);
      continue;
    }
    fail('unexpected character', { character: ch });
  }

  tokens.push({ type: 'EOF', value: '', index, line, column, end: index });
  return { tokens, tokenCount, byteLength };
}
