import { GQLCAGE_ERROR_CODES, GqlCageError } from './errors.mjs';
import { lexGraphQL } from './lexer.mjs';

const SDL_KEYWORDS = new Set(['schema', 'scalar', 'type', 'interface', 'union', 'enum', 'input', 'directive', 'extend']);
const OPERATION_TYPES = new Set(['query', 'mutation', 'subscription']);

function tokenLocation(token) {
  return { index: token.index, line: token.line, column: token.column };
}

export function parseGraphQLDocument(source, options = {}) {
  const lexed = lexGraphQL(source, options);
  const tokens = lexed.tokens;
  let cursor = 0;

  const peek = () => tokens[cursor];
  const lookahead = (distance) => tokens[cursor + distance] || tokens[tokens.length - 1];
  const atEnd = () => peek().type === 'EOF';
  const advance = () => {
    const token = peek();
    if (token.type !== 'EOF') cursor += 1;
    return token;
  };
  const parseError = (message, token = peek(), details) => {
    throw new GqlCageError(GQLCAGE_ERROR_CODES.PARSE_ERROR, message, {
      index: token.index,
      line: token.line,
      column: token.column,
      details
    });
  };
  const isPunct = (value, token = peek()) => token.type === 'PUNCT' && token.value === value;
  const matchPunct = (value) => {
    if (!isPunct(value)) return null;
    return advance();
  };
  const expectPunct = (value, message = 'expected ' + value) => {
    const token = matchPunct(value);
    if (!token) parseError(message);
    return token;
  };
  const isName = (value, token = peek()) => token.type === 'NAME' && (value === undefined || token.value === value);
  const expectName = (message = 'expected a name') => {
    const token = peek();
    if (token.type !== 'NAME') parseError(message, token);
    return advance();
  };

  const scalarValue = (constOnly) => {
    const token = peek();
    if (isPunct('$')) {
      if (constOnly) parseError('variables are not allowed in a constant value', token);
      advance();
      const name = expectName('expected a variable name');
      return { kind: 'variable', name: name.value, loc: tokenLocation(token) };
    }
    if (token.type === 'INT') {
      advance();
      return { kind: 'int', value: token.value, raw: token.value, loc: tokenLocation(token) };
    }
    if (token.type === 'FLOAT') {
      advance();
      return { kind: 'float', value: token.value, raw: token.value, loc: tokenLocation(token) };
    }
    if (token.type === 'STRING') {
      advance();
      return { kind: 'string', value: token.value, block: token.block === true, loc: tokenLocation(token) };
    }
    if (token.type === 'NAME') {
      advance();
      if (token.value === 'true' || token.value === 'false') {
        return { kind: 'boolean', value: token.value === 'true', loc: tokenLocation(token) };
      }
      if (token.value === 'null') return { kind: 'null', value: null, loc: tokenLocation(token) };
      return { kind: 'enum', name: token.value, loc: tokenLocation(token) };
    }
    parseError('expected a value', token);
    return null;
  };

  const parseValue = (constOnly = false) => {
    let root = null;
    let done = false;
    const stack = [];
    let phase = 'value';
    const attach = (node) => {
      if (stack.length === 0) {
        root = node;
        return;
      }
      const parent = stack[stack.length - 1];
      if (parent.kind === 'list') {
        parent.node.values.push(node);
      } else {
        if (!parent.pending) parseError('object value is missing a field name');
        parent.pending.value = node;
        parent.pending = null;
      }
    };

    while (!done) {
      if (phase === 'value') {
        if (atEnd()) parseError('unexpected end of input while reading a value');
        if (isPunct('[')) {
          const open = advance();
          const node = { kind: 'list', values: [], loc: tokenLocation(open) };
          attach(node);
          stack.push({ kind: 'list', node });
          phase = 'list';
          continue;
        }
        if (isPunct('{')) {
          const open = advance();
          const node = { kind: 'object', fields: [], loc: tokenLocation(open) };
          attach(node);
          stack.push({ kind: 'object', node, pending: null });
          phase = 'object';
          continue;
        }
        const node = scalarValue(constOnly);
        attach(node);
        if (stack.length === 0) done = true;
        else phase = 'container';
        continue;
      }

      if (phase === 'list') {
        const parent = stack[stack.length - 1];
        if (matchPunct(']')) {
          stack.pop();
          if (stack.length === 0) done = true;
          else phase = 'container';
        } else if (atEnd()) {
          parseError('unterminated list value', parent.node.loc ? parent.node.loc : peek());
        } else {
          phase = 'value';
        }
        continue;
      }

      if (phase === 'object') {
        const parent = stack[stack.length - 1];
        if (matchPunct('}')) {
          stack.pop();
          if (stack.length === 0) done = true;
          else phase = 'container';
        } else if (atEnd()) {
          parseError('unterminated object value', parent.node.loc ? parent.node.loc : peek());
        } else {
          const key = expectName('expected an object field name');
          expectPunct(':', 'expected a colon after an object field name');
          const field = { name: key.value, value: null, loc: tokenLocation(key) };
          parent.node.fields.push(field);
          parent.pending = field;
          phase = 'value';
        }
        continue;
      }

      if (phase === 'container') {
        const parent = stack[stack.length - 1];
        phase = parent.kind === 'list' ? 'list' : 'object';
        continue;
      }
      parseError('internal parser state error');
    }
    return root;
  };

  const parseType = () => {
    let openLists = 0;
    while (matchPunct('[')) openLists += 1;
    const name = expectName('expected a type name');
    let type = { kind: 'NamedType', name: name.value, loc: tokenLocation(name) };
    let remainingLists = openLists;
    let bangApplied = false;
    while (remainingLists > 0) {
      if (matchPunct('!')) {
        if (bangApplied) parseError('a non-null type cannot itself be non-null');
        type = { kind: 'NonNullType', ofType: type, loc: type.loc };
        bangApplied = true;
        continue;
      }
      if (matchPunct(']')) {
        type = { kind: 'ListType', ofType: type, loc: type.loc };
        remainingLists -= 1;
        bangApplied = false;
        continue;
      }
      parseError('expected a closing bracket or non-null marker in a type');
    }
    if (matchPunct('!')) type = { kind: 'NonNullType', ofType: type, loc: type.loc };
    return type;
  };

  const parseArguments = () => {
    expectPunct('(', 'expected an opening argument list');
    const args = [];
    while (!atEnd() && !isPunct(')')) {
      const name = expectName('expected an argument name');
      expectPunct(':', 'expected a colon after an argument name');
      const value = parseValue(false);
      args.push({ name: name.value, value, loc: tokenLocation(name) });
    }
    const close = expectPunct(')', 'unterminated argument list');
    if (args.length === 0) parseError('an argument list cannot be empty', close);
    return args;
  };

  const parseDirectives = () => {
    const directives = [];
    while (isPunct('@')) {
      const at = advance();
      const name = expectName('expected a directive name');
      const args = isPunct('(') ? parseArguments() : [];
      directives.push({ name: name.value, arguments: args, loc: tokenLocation(at) });
    }
    return directives;
  };

  const parseVariableDefinitions = () => {
    expectPunct('(', 'expected an opening variable definition list');
    const definitions = [];
    while (!atEnd() && !isPunct(')')) {
      const dollar = expectPunct('$', 'expected a variable sigil');
      const name = expectName('expected a variable name');
      expectPunct(':', 'expected a colon after a variable name');
      const type = parseType();
      let defaultValue = null;
      if (matchPunct('=')) defaultValue = parseValue(true);
      const directives = parseDirectives();
      definitions.push({
        name: name.value,
        type,
        defaultValue,
        directives,
        loc: tokenLocation(dollar)
      });
    }
    const close = expectPunct(')', 'unterminated variable definition list');
    if (definitions.length === 0) parseError('a variable definition list cannot be empty', close);
    return definitions;
  };

  const parseSelectionSet = () => {
    const open = expectPunct('{', 'expected a selection set');
    const root = { kind: 'SelectionSet', selections: [], loc: tokenLocation(open) };
    const stack = [{ set: root, count: 0, open }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (matchPunct('}')) {
        if (frame.count === 0) parseError('a selection set cannot be empty', frame.open);
        stack.pop();
        continue;
      }
      if (atEnd()) parseError('unterminated selection set', frame.open);

      if (isPunct('...')) {
        const spread = advance();
        if (isName() && peek().value !== 'on') {
          const name = advance();
          const directives = parseDirectives();
          frame.set.selections.push({
            kind: 'FragmentSpread',
            name: name.value,
            directives,
            loc: tokenLocation(spread)
          });
          frame.count += 1;
          continue;
        }

        let typeCondition = null;
        if (isName('on')) {
          advance();
          const typeName = expectName('expected a type condition name');
          typeCondition = typeName.value;
        }
        const directives = parseDirectives();
        if (!isPunct('{')) parseError('expected a selection set after an inline fragment');
        const childOpen = advance();
        const childSet = { kind: 'SelectionSet', selections: [], loc: tokenLocation(childOpen) };
        frame.set.selections.push({
          kind: 'InlineFragment',
          typeCondition,
          directives,
          selectionSet: childSet,
          loc: tokenLocation(spread)
        });
        frame.count += 1;
        stack.push({ set: childSet, count: 0, open: childOpen });
        continue;
      }

      if (peek().type !== 'NAME') parseError('expected a field, fragment spread, or closing brace');
      const firstName = advance();
      let alias = null;
      let fieldNameToken = firstName;
      if (matchPunct(':')) {
        alias = firstName.value;
        fieldNameToken = expectName('expected a field name after an alias');
      }
      const args = isPunct('(') ? parseArguments() : [];
      const directives = parseDirectives();
      const field = {
        kind: 'Field',
        alias,
        name: fieldNameToken.value,
        arguments: args,
        directives,
        selectionSet: null,
        loc: tokenLocation(firstName),
        nameLoc: tokenLocation(fieldNameToken)
      };
      frame.set.selections.push(field);
      frame.count += 1;
      if (isPunct('{')) {
        const childOpen = advance();
        const childSet = { kind: 'SelectionSet', selections: [], loc: tokenLocation(childOpen) };
        field.selectionSet = childSet;
        stack.push({ set: childSet, count: 0, open: childOpen });
      }
    }
    return root;
  };

  const parseOperationDefinition = () => {
    const operationToken = advance();
    const operation = operationToken.value;
    let name = null;
    if (peek().type === 'NAME') name = advance().value;
    const variableDefinitions = isPunct('(') ? parseVariableDefinitions() : [];
    const directives = parseDirectives();
    if (!isPunct('{')) parseError('expected a selection set for operation ' + operation);
    const selectionSet = parseSelectionSet();
    return {
      kind: 'OperationDefinition',
      operation,
      name,
      variableDefinitions,
      directives,
      selectionSet,
      loc: tokenLocation(operationToken)
    };
  };

  const parseFragmentDefinition = () => {
    const fragmentToken = advance();
    const name = expectName('expected a fragment name');
    if (name.value === 'on') parseError('fragment name cannot be on', name);
    const onToken = expectName('expected the fragment type condition keyword');
    if (onToken.value !== 'on') parseError('expected the fragment type condition keyword', onToken);
    const typeName = expectName('expected a fragment type condition');
    const directives = parseDirectives();
    if (!isPunct('{')) parseError('expected a selection set for fragment ' + name.value);
    const selectionSet = parseSelectionSet();
    return {
      kind: 'FragmentDefinition',
      name: name.value,
      typeCondition: typeName.value,
      directives,
      selectionSet,
      loc: tokenLocation(fragmentToken)
    };
  };

  const definitions = [];
  while (!atEnd()) {
    const token = peek();
    if (isPunct('{')) {
      definitions.push({
        kind: 'OperationDefinition',
        operation: 'query',
        name: null,
        variableDefinitions: [],
        directives: [],
        selectionSet: parseSelectionSet(),
        loc: tokenLocation(token)
      });
      continue;
    }
    if (token.type !== 'NAME') parseError('expected an operation or fragment definition', token);
    if (OPERATION_TYPES.has(token.value)) {
      definitions.push(parseOperationDefinition());
      continue;
    }
    if (token.value === 'fragment') {
      definitions.push(parseFragmentDefinition());
      continue;
    }
    if (SDL_KEYWORDS.has(token.value)) {
      throw new GqlCageError(GQLCAGE_ERROR_CODES.SDL_NOT_ALLOWED, 'schema definition language is not allowed in an executable GraphQL document', {
        index: token.index,
        line: token.line,
        column: token.column,
        details: { keyword: token.value }
      });
    }
    parseError('unknown document definition keyword', token, { keyword: token.value });
  }
  if (definitions.length === 0) parseError('a GraphQL document must contain at least one definition', tokens[tokens.length - 1]);

  return {
    kind: 'Document',
    definitions,
    tokenCount: lexed.tokenCount,
    byteLength: lexed.byteLength,
    loc: { index: 0, line: 1, column: 1 }
  };
}
