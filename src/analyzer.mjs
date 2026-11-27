import { GQLCAGE_ERROR_CODES, GQLCAGE_FINDING_CODES, GqlCageError, SEVERITY } from './errors.mjs';
import { parseGraphQLDocument } from './parser.mjs';
import { createGraphQLPolicy } from './policy.mjs';

const LIMIT = Number.MAX_SAFE_INTEGER;
const DANGEROUS_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

function satAdd(left, right) {
  if (left >= LIMIT || right >= LIMIT) return LIMIT;
  return left + right > LIMIT ? LIMIT : left + right;
}

function satMul(left, right) {
  if (left === 0 || right === 0) return 0;
  if (left >= LIMIT || right >= LIMIT) return LIMIT;
  if (left > LIMIT / right) return LIMIT;
  return left * right;
}

function makeFinding(code, message, options = {}) {
  const result = {
    code,
    severity: options.severity || SEVERITY.ERROR,
    message
  };
  if (options.path) result.path = options.path;
  if (typeof options.line === 'number') result.line = options.line;
  if (typeof options.column === 'number') result.column = options.column;
  if (options.details !== undefined) result.details = options.details;
  return result;
}

function makeFindingSink(maxFindings) {
  const findings = [];
  let total = 0;
  let capped = false;
  return {
    findings,
    total() {
      return total;
    },
    capped() {
      return capped;
    },
    add(finding) {
      total += 1;
      if (capped) return false;
      if (findings.length < maxFindings) {
        findings.push(finding);
        return true;
      }
      capped = true;
      findings[maxFindings - 1] = makeFinding(GQLCAGE_FINDING_CODES.FINDINGS_CAP, 'finding limit reached; the document is rejected fail closed', {
        details: { maxFindings }
      });
      return false;
    }
  };
}

function locationOf(node) {
  return node && node.loc ? node.loc : {};
}

function inspectValue(root) {
  const result = {
    inputDepth: 0,
    maxStringLength: 0,
    nestedNodes: 0,
    violations: []
  };
  if (!root) return result;
  const stack = [{ node: root, containerDepth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    const node = item.node;
    if (!node) continue;
    if (node.kind === 'string' && node.value.length > result.maxStringLength) {
      result.maxStringLength = node.value.length;
    }
    if (node.kind === 'list') {
      const depth = item.containerDepth + 1;
      if (depth > result.inputDepth) result.inputDepth = depth;
      result.nestedNodes = satAdd(result.nestedNodes, node.values.length);
      for (let index = node.values.length - 1; index >= 0; index -= 1) {
        stack.push({ node: node.values[index], containerDepth: depth });
      }
      continue;
    }
    if (node.kind === 'object') {
      const depth = item.containerDepth + 1;
      if (depth > result.inputDepth) result.inputDepth = depth;
      result.nestedNodes = satAdd(result.nestedNodes, node.fields.length);
      const seen = new Set();
      for (const field of node.fields) {
        if (DANGEROUS_NAMES.has(field.name)) {
          result.violations.push({ code: GQLCAGE_ERROR_CODES.PROTOTYPE_POLLUTION, field, message: 'input object field name is a prototype pollution primitive' });
        }
        if (seen.has(field.name)) {
          result.violations.push({ code: GQLCAGE_ERROR_CODES.DUPLICATE_INPUT_FIELD, field, message: 'input object field is duplicated' });
        }
        seen.add(field.name);
      }
      for (let index = node.fields.length - 1; index >= 0; index -= 1) {
        stack.push({ node: node.fields[index].value, containerDepth: depth });
      }
    }
  }
  return result;
}

function measureArguments(args) {
  const result = {
    count: args.length,
    complexity: args.length,
    inputDepth: 0,
    maxStringLength: 0
  };
  for (const arg of args) {
    const value = inspectValue(arg.value);
    result.complexity = satAdd(result.complexity, value.nestedNodes);
    if (value.inputDepth > result.inputDepth) result.inputDepth = value.inputDepth;
    if (value.maxStringLength > result.maxStringLength) result.maxStringLength = value.maxStringLength;
  }
  return result;
}

function measureDirectives(directives) {
  const result = {
    count: directives.length,
    arguments: 0,
    complexity: directives.length,
    inputDepth: 0,
    maxStringLength: 0
  };
  for (const directive of directives) {
    const args = measureArguments(directive.arguments);
    result.arguments = satAdd(result.arguments, args.count);
    result.complexity = satAdd(result.complexity, args.complexity);
    if (args.inputDepth > result.inputDepth) result.inputDepth = args.inputDepth;
    if (args.maxStringLength > result.maxStringLength) result.maxStringLength = args.maxStringLength;
  }
  return result;
}

function emptySummary() {
  return {
    depth: 0,
    fields: 0,
    aliases: 0,
    arguments: 0,
    directives: 0,
    spreads: 0,
    inputDepth: 0,
    maxStringLength: 0,
    complexity: 0,
    maxKeyRepeat: 0,
    maxNameRepeat: 0,
    maxDirectivesPerLocation: 0,
    directKeys: new Map(),
    directNames: new Map()
  };
}

function cappedIncrement(limit) {
  return limit >= LIMIT ? LIMIT : limit + 1;
}

function addToMap(map, key, amount, limits) {
  if (!map.has(key) && map.size >= limits.keyLimit) return;
  const countLimit = limits.countLimit;
  const current = map.get(key) || 0;
  const added = satAdd(current, amount);
  map.set(key, added > countLimit ? countLimit : added);
}

function mergeDirectMap(target, source, limits) {
  for (const [key, value] of source.entries()) {
    addToMap(target, key, value, limits);
    if (target.size >= limits.keyLimit && !target.has(key)) break;
  }
}

function mergeTotals(target, source) {
  target.fields = satAdd(target.fields, source.fields);
  target.aliases = satAdd(target.aliases, source.aliases);
  target.arguments = satAdd(target.arguments, source.arguments);
  target.directives = satAdd(target.directives, source.directives);
  target.spreads = satAdd(target.spreads, source.spreads);
  target.complexity = satAdd(target.complexity, source.complexity);
  if (source.inputDepth > target.inputDepth) target.inputDepth = source.inputDepth;
  if (source.maxStringLength > target.maxStringLength) target.maxStringLength = source.maxStringLength;
  if (source.maxKeyRepeat > target.maxKeyRepeat) target.maxKeyRepeat = source.maxKeyRepeat;
  if (source.maxNameRepeat > target.maxNameRepeat) target.maxNameRepeat = source.maxNameRepeat;
  if (source.maxDirectivesPerLocation > target.maxDirectivesPerLocation) target.maxDirectivesPerLocation = source.maxDirectivesPerLocation;
}

function applyValueMetrics(target, metrics) {
  if (metrics.inputDepth > target.inputDepth) target.inputDepth = metrics.inputDepth;
  if (metrics.maxStringLength > target.maxStringLength) target.maxStringLength = metrics.maxStringLength;
}

function applyDirectiveMetrics(target, directives) {
  const measured = measureDirectives(directives);
  target.directives = satAdd(target.directives, measured.count);
  target.arguments = satAdd(target.arguments, measured.arguments);
  target.complexity = satAdd(target.complexity, measured.complexity);
  if (directives.length > target.maxDirectivesPerLocation) target.maxDirectivesPerLocation = directives.length;
  if (measured.inputDepth > target.inputDepth) target.inputDepth = measured.inputDepth;
  if (measured.maxStringLength > target.maxStringLength) target.maxStringLength = measured.maxStringLength;
}

function finishRepeats(summary) {
  for (const count of summary.directKeys.values()) {
    if (count > summary.maxKeyRepeat) summary.maxKeyRepeat = count;
  }
  for (const count of summary.directNames.values()) {
    if (count > summary.maxNameRepeat) summary.maxNameRepeat = count;
  }
}

function summarizeSelectionSet(rootSet, fragmentSummaries, limits) {
  const summaries = new Map();
  const stack = [{ set: rootSet, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index < frame.set.selections.length) {
      const selection = frame.set.selections[frame.index];
      frame.index += 1;
      const childSet = (selection.kind === 'Field' || selection.kind === 'InlineFragment') ? selection.selectionSet : null;
      if (childSet && !summaries.has(childSet)) stack.push({ set: childSet, index: 0 });
      continue;
    }

    const summary = emptySummary();
    for (const selection of frame.set.selections) {
      if (selection.kind === 'Field') {
        const responseKey = selection.alias || selection.name;
        addToMap(summary.directKeys, responseKey, 1, limits);
        addToMap(summary.directNames, selection.name, 1, limits);
        summary.fields = satAdd(summary.fields, 1);
        if (selection.alias) summary.aliases = satAdd(summary.aliases, 1);
        const argMetrics = measureArguments(selection.arguments);
        summary.arguments = satAdd(summary.arguments, argMetrics.count);
        applyValueMetrics(summary, argMetrics);
        applyDirectiveMetrics(summary, selection.directives);
        summary.complexity = satAdd(summary.complexity, satAdd(1, argMetrics.complexity));
        summary.depth = Math.max(summary.depth, 1);
        if (selection.selectionSet) {
          const child = summaries.get(selection.selectionSet);
          if (child) {
            mergeTotals(summary, child);
            summary.depth = Math.max(summary.depth, satAdd(1, child.depth));
          }
        }
        continue;
      }

      if (selection.kind === 'InlineFragment') {
        applyDirectiveMetrics(summary, selection.directives);
        const child = summaries.get(selection.selectionSet);
        if (child) {
          mergeTotals(summary, child);
          mergeDirectMap(summary.directKeys, child.directKeys, limits);
          mergeDirectMap(summary.directNames, child.directNames, limits);
          summary.depth = Math.max(summary.depth, child.depth);
        }
        continue;
      }

      if (selection.kind === 'FragmentSpread') {
        summary.spreads = satAdd(summary.spreads, 1);
        applyDirectiveMetrics(summary, selection.directives);
        summary.complexity = satAdd(summary.complexity, 1);
        const fragment = fragmentSummaries.get(selection.name);
        if (fragment) {
          mergeTotals(summary, fragment);
          mergeDirectMap(summary.directKeys, fragment.directKeys, limits);
          mergeDirectMap(summary.directNames, fragment.directNames, limits);
          summary.depth = Math.max(summary.depth, fragment.depth);
        }
      }
    }
    finishRepeats(summary);
    summaries.set(frame.set, summary);
    stack.pop();
  }
  return summaries.get(rootSet) || emptySummary();
}

function walkSelectionSet(rootSet, callback) {
  const stack = [rootSet];
  while (stack.length > 0) {
    const set = stack.pop();
    for (const selection of set.selections) {
      callback(selection, set);
      if ((selection.kind === 'Field' || selection.kind === 'InlineFragment') && selection.selectionSet) {
        stack.push(selection.selectionSet);
      }
    }
  }
}

function collectSpreads(rootSet) {
  const spreads = [];
  walkSelectionSet(rootSet, (selection) => {
    if (selection.kind === 'FragmentSpread') spreads.push(selection);
  });
  return spreads;
}

function detectFragmentCycle(graph) {
  const state = new Map();
  for (const start of graph.keys()) {
    if (state.has(start)) continue;
    state.set(start, 1);
    const stack = [{ name: start, index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const dependencies = graph.get(frame.name) || [];
      if (frame.index < dependencies.length) {
        const dependency = dependencies[frame.index];
        frame.index += 1;
        if (!graph.has(dependency)) continue;
        const dependencyState = state.get(dependency) || 0;
        if (dependencyState === 1) {
          const cycle = stack.map((item) => item.name);
          cycle.push(dependency);
          return cycle;
        }
        if (dependencyState === 0) {
          state.set(dependency, 1);
          stack.push({ name: dependency, index: 0 });
        }
        continue;
      }
      state.set(frame.name, 2);
      stack.pop();
    }
  }
  return null;
}

function topologicalFragmentOrder(graph) {
  const state = new Map();
  const order = [];
  for (const start of graph.keys()) {
    if ((state.get(start) || 0) === 2) continue;
    state.set(start, 1);
    const stack = [{ name: start, index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const dependencies = graph.get(frame.name) || [];
      if (frame.index < dependencies.length) {
        const dependency = dependencies[frame.index];
        frame.index += 1;
        if (!graph.has(dependency)) continue;
        const dependencyState = state.get(dependency) || 0;
        if (dependencyState === 0) {
          state.set(dependency, 1);
          stack.push({ name: dependency, index: 0 });
        }
        continue;
      }
      state.set(frame.name, 2);
      order.push(frame.name);
      stack.pop();
    }
  }
  return order;
}

function scanArgumentsStatic(args, sink, path, limits) {
  const seen = new Set();
  for (const arg of args) {
    const loc = locationOf(arg);
    if (DANGEROUS_NAMES.has(arg.name)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.PROTOTYPE_POLLUTION, 'argument name is a prototype pollution primitive', {
        path,
        line: loc.line,
        column: loc.column,
        details: { name: arg.name }
      }));
    }
    if (seen.has(arg.name)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.DUPLICATE_ARGUMENT, 'argument is duplicated at one call site', {
        path,
        line: loc.line,
        column: loc.column,
        details: { name: arg.name }
      }));
    }
    seen.add(arg.name);
    const value = inspectValue(arg.value);
    if (value.inputDepth > limits.inputDepth) limits.inputDepth = value.inputDepth;
    if (value.maxStringLength > limits.maxStringLength) limits.maxStringLength = value.maxStringLength;
    for (const violation of value.violations) {
      const violationLoc = locationOf(violation.field);
      sink.add(makeFinding(violation.code, violation.message, {
        path,
        line: violationLoc.line,
        column: violationLoc.column,
        details: { name: violation.field.name }
      }));
    }
  }
}

function scanDirectivesStatic(directives, sink, path, limits) {
  for (const directive of directives) scanArgumentsStatic(directive.arguments, sink, path + '.@' + directive.name, limits);
}

function scanStaticDocument(document, policy, sink) {
  const limits = { inputDepth: 0, maxStringLength: 0 };
  const operationNames = new Set();
  const fragmentNames = new Set();
  const operations = [];
  const fragments = [];

  for (const definition of document.definitions) {
    if (definition.kind === 'OperationDefinition') operations.push(definition);
    if (definition.kind === 'FragmentDefinition') fragments.push(definition);
  }

  for (const operation of operations) {
    if (operation.name) {
      if (operationNames.has(operation.name)) {
        sink.add(makeFinding(GQLCAGE_ERROR_CODES.DUPLICATE_OPERATION, 'operation names must be unique', {
          path: 'operation.' + operation.name,
          line: operation.loc.line,
          column: operation.loc.column,
          details: { name: operation.name }
        }));
      }
      operationNames.add(operation.name);
    }
    if (!policy.allowedOperations.includes(operation.operation)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.OPERATION_TYPE_BLOCKED, 'operation type is blocked by policy', {
        path: operation.name ? 'operation.' + operation.name : 'operation.anonymous',
        line: operation.loc.line,
        column: operation.loc.column,
        details: { operation: operation.operation }
      }));
    }
    if (!operation.name && (policy.requireOperationName || operations.length > 1)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.OPERATION_NAME_REQUIRED, 'operation name is required', {
        path: 'operation.anonymous',
        line: operation.loc.line,
        column: operation.loc.column
      }));
    }

    const variableNames = new Set();
    for (const variable of operation.variableDefinitions) {
      const loc = locationOf(variable);
      const path = (operation.name ? 'operation.' + operation.name : 'operation.anonymous') + '.$' + variable.name;
      if (DANGEROUS_NAMES.has(variable.name)) {
        sink.add(makeFinding(GQLCAGE_ERROR_CODES.PROTOTYPE_POLLUTION, 'variable name is a prototype pollution primitive', {
          path,
          line: loc.line,
          column: loc.column,
          details: { name: variable.name }
        }));
      }
      if (variableNames.has(variable.name)) {
        sink.add(makeFinding(GQLCAGE_ERROR_CODES.DUPLICATE_VARIABLE, 'variable names must be unique within an operation', {
          path,
          line: loc.line,
          column: loc.column,
          details: { name: variable.name }
        }));
      }
      variableNames.add(variable.name);
      if (variable.defaultValue) {
        const value = inspectValue(variable.defaultValue);
        if (value.inputDepth > limits.inputDepth) limits.inputDepth = value.inputDepth;
        if (value.maxStringLength > limits.maxStringLength) limits.maxStringLength = value.maxStringLength;
        for (const violation of value.violations) {
          const violationLoc = locationOf(violation.field);
          sink.add(makeFinding(violation.code, violation.message, {
            path,
            line: violationLoc.line,
            column: violationLoc.column,
            details: { name: violation.field.name }
          }));
        }
      }
      scanDirectivesStatic(variable.directives, sink, path, limits);
    }
    scanDirectivesStatic(operation.directives, sink, operation.name ? 'operation.' + operation.name : 'operation.anonymous', limits);
  }

  for (const fragment of fragments) {
    if (DANGEROUS_NAMES.has(fragment.name)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.PROTOTYPE_POLLUTION, 'fragment name is a prototype pollution primitive', {
        path: 'fragment.' + fragment.name,
        line: fragment.loc.line,
        column: fragment.loc.column,
        details: { name: fragment.name }
      }));
    }
    if (fragmentNames.has(fragment.name)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.DUPLICATE_FRAGMENT, 'fragment names must be unique', {
        path: 'fragment.' + fragment.name,
        line: fragment.loc.line,
        column: fragment.loc.column,
        details: { name: fragment.name }
      }));
    }
    fragmentNames.add(fragment.name);
    scanDirectivesStatic(fragment.directives, sink, 'fragment.' + fragment.name, limits);
  }

  for (const definition of document.definitions) {
    const ownerPath = definition.kind === 'FragmentDefinition'
      ? 'fragment.' + definition.name
      : definition.name
        ? 'operation.' + definition.name
        : 'operation.anonymous';
    walkSelectionSet(definition.selectionSet, (selection) => {
      if (selection.kind === 'Field') {
        const loc = selection.nameLoc || selection.loc;
        const responseKey = selection.alias || selection.name;
        if (DANGEROUS_NAMES.has(selection.name) || (selection.alias && DANGEROUS_NAMES.has(selection.alias))) {
          sink.add(makeFinding(GQLCAGE_ERROR_CODES.PROTOTYPE_POLLUTION, 'field or alias name is a prototype pollution primitive', {
            path: ownerPath + '.' + responseKey,
            line: loc.line,
            column: loc.column,
            details: { name: DANGEROUS_NAMES.has(selection.name) ? selection.name : selection.alias }
          }));
        }
        const blocksTypename = selection.name === '__typename' && !policy.allowTypename;
        const blocksIntrospection = (selection.name === '__schema' || selection.name === '__type') && !policy.allowIntrospection;
        if (blocksTypename || blocksIntrospection) {
          sink.add(makeFinding(GQLCAGE_ERROR_CODES.INTROSPECTION_BLOCKED, 'introspection or schema metadata field is blocked by policy', {
            path: ownerPath + '.' + responseKey,
            line: loc.line,
            column: loc.column,
            details: { field: selection.name }
          }));
        }
        scanArgumentsStatic(selection.arguments, sink, ownerPath + '.' + responseKey, limits);
        scanDirectivesStatic(selection.directives, sink, ownerPath + '.' + responseKey, limits);
      } else if (selection.kind === 'FragmentSpread') {
        scanDirectivesStatic(selection.directives, sink, ownerPath + '...' + selection.name, limits);
      } else if (selection.kind === 'InlineFragment') {
        scanDirectivesStatic(selection.directives, sink, ownerPath + '...inline', limits);
      }
    });
  }
  return limits;
}

function emptyMetrics() {
  return {
    depth: 0,
    expandedFields: 0,
    aliases: 0,
    directives: 0,
    tokens: 0,
    operations: 0,
    fragments: 0,
    complexity: 0,
    arguments: 0,
    variables: 0,
    fragmentSpreads: 0,
    rootFields: 0,
    duplicateFields: 0,
    inputDepth: 0,
    maxStringLength: 0,
    maxDirectivesPerLocation: 0
  };
}

function mergeOperationMetrics(metrics, summary) {
  if (summary.depth > metrics.depth) metrics.depth = summary.depth;
  if (summary.fields > metrics.expandedFields) metrics.expandedFields = summary.fields;
  if (summary.aliases > metrics.aliases) metrics.aliases = summary.aliases;
  if (summary.directives > metrics.directives) metrics.directives = summary.directives;
  if (summary.complexity > metrics.complexity) metrics.complexity = summary.complexity;
  if (summary.arguments > metrics.arguments) metrics.arguments = summary.arguments;
  if (summary.spreads > metrics.fragmentSpreads) metrics.fragmentSpreads = summary.spreads;
  if (summary.inputDepth > metrics.inputDepth) metrics.inputDepth = summary.inputDepth;
  if (summary.maxStringLength > metrics.maxStringLength) metrics.maxStringLength = summary.maxStringLength;
  if (summary.directKeys.size > metrics.rootFields) metrics.rootFields = summary.directKeys.size;
  const duplicateFields = Math.max(summary.maxKeyRepeat, summary.maxNameRepeat);
  if (duplicateFields > metrics.duplicateFields) metrics.duplicateFields = duplicateFields;
  if (summary.maxDirectivesPerLocation > metrics.maxDirectivesPerLocation) metrics.maxDirectivesPerLocation = summary.maxDirectivesPerLocation;
}

function enforceMetricCaps(metrics, policy, sink) {
  const checks = [
    ['depth', 'maxDepth', GQLCAGE_ERROR_CODES.DEPTH_EXCEEDED, 'effective selection depth exceeds policy'],
    ['expandedFields', 'maxExpandedFields', GQLCAGE_ERROR_CODES.EXPANDED_FIELDS_EXCEEDED, 'expanded field count exceeds policy'],
    ['aliases', 'maxAliases', GQLCAGE_ERROR_CODES.ALIASES_EXCEEDED, 'alias count exceeds policy'],
    ['duplicateFields', 'maxDuplicateFields', GQLCAGE_ERROR_CODES.DUPLICATE_FIELDS_EXCEEDED, 'duplicate or replicated field count exceeds policy'],
    ['rootFields', 'maxRootFields', GQLCAGE_ERROR_CODES.ROOT_FIELDS_EXCEEDED, 'root field count exceeds policy'],
    ['directives', 'maxDirectives', GQLCAGE_ERROR_CODES.DIRECTIVES_EXCEEDED, 'directive count exceeds policy'],
    ['maxDirectivesPerLocation', 'maxDirectivesPerLocation', GQLCAGE_ERROR_CODES.DIRECTIVES_PER_LOCATION_EXCEEDED, 'directive count at one location exceeds policy'],
    ['arguments', 'maxArguments', GQLCAGE_ERROR_CODES.ARGUMENTS_EXCEEDED, 'argument count exceeds policy'],
    ['variables', 'maxVariables', GQLCAGE_ERROR_CODES.VARIABLES_EXCEEDED, 'variable count exceeds policy'],
    ['inputDepth', 'maxInputDepth', GQLCAGE_ERROR_CODES.INPUT_DEPTH_EXCEEDED, 'input value nesting depth exceeds policy'],
    ['maxStringLength', 'maxStringLength', GQLCAGE_ERROR_CODES.STRING_LENGTH_EXCEEDED, 'string literal length exceeds policy'],
    ['fragmentSpreads', 'maxFragmentSpreads', GQLCAGE_ERROR_CODES.FRAGMENT_SPREADS_EXCEEDED, 'fragment spread count exceeds policy'],
    ['complexity', 'maxComplexity', GQLCAGE_ERROR_CODES.COMPLEXITY_EXCEEDED, 'estimated query complexity exceeds policy']
  ];
  for (const [metricKey, policyKey, code, message] of checks) {
    if (metrics[metricKey] > policy[policyKey]) {
      sink.add(makeFinding(code, message, {
        details: { value: metrics[metricKey], limit: policy[policyKey] }
      }));
    }
  }
}

function analyzeDocument(document, policy, sink) {
  const metrics = emptyMetrics();
  metrics.tokens = document.tokenCount;
  const operations = [];
  const fragments = [];
  const fragmentDefinitions = new Map();
  for (const definition of document.definitions) {
    if (definition.kind === 'OperationDefinition') operations.push(definition);
    if (definition.kind === 'FragmentDefinition') {
      fragments.push(definition);
      if (!fragmentDefinitions.has(definition.name)) fragmentDefinitions.set(definition.name, definition);
    }
  }
  metrics.operations = operations.length;
  metrics.fragments = fragments.length;
  if (operations.length > policy.maxOperations) {
    sink.add(makeFinding(GQLCAGE_ERROR_CODES.OPERATIONS_EXCEEDED, 'operation count exceeds policy', {
      details: { value: operations.length, limit: policy.maxOperations }
    }));
  }

  const graph = new Map();
  for (const fragment of fragments) {
    if (!graph.has(fragment.name)) graph.set(fragment.name, []);
    for (const spread of collectSpreads(fragment.selectionSet)) graph.get(fragment.name).push(spread.name);
  }
  for (const definition of document.definitions) {
    for (const spread of collectSpreads(definition.selectionSet)) {
      if (!fragmentDefinitions.has(spread.name)) {
        sink.add(makeFinding(GQLCAGE_ERROR_CODES.UNKNOWN_FRAGMENT, 'fragment spread references an unknown fragment', {
          line: spread.loc.line,
          column: spread.loc.column,
          details: { fragment: spread.name }
        }));
      }
    }
  }
  const cycle = detectFragmentCycle(graph);
  if (cycle) {
    sink.add(makeFinding(GQLCAGE_ERROR_CODES.FRAGMENT_CYCLE, 'fragment definitions contain a cycle', {
      details: { cycle }
    }));
  }

  const expansionLimits = {
    keyLimit: cappedIncrement(policy.maxRootFields),
    countLimit: cappedIncrement(policy.maxDuplicateFields)
  };
  const fragmentSummaries = new Map();
  if (!cycle) {
    const order = topologicalFragmentOrder(graph);
    for (const name of order) {
      const fragment = fragmentDefinitions.get(name);
      if (!fragment) continue;
      const summary = summarizeSelectionSet(fragment.selectionSet, fragmentSummaries, expansionLimits);
      applyDirectiveMetrics(summary, fragment.directives);
      finishRepeats(summary);
      fragmentSummaries.set(name, summary);
    }
  }

  const staticLimits = scanStaticDocument(document, policy, sink);
  metrics.inputDepth = staticLimits.inputDepth;
  metrics.maxStringLength = staticLimits.maxStringLength;
  metrics.maxDirectivesPerLocation = 0;

  for (const operation of operations) {
    const summary = summarizeSelectionSet(operation.selectionSet, fragmentSummaries, expansionLimits);
    applyDirectiveMetrics(summary, operation.directives);
    for (const variable of operation.variableDefinitions) {
      if (variable.defaultValue) {
        const valueMetrics = inspectValue(variable.defaultValue);
        applyValueMetrics(summary, valueMetrics);
      }
      applyDirectiveMetrics(summary, variable.directives);
    }
    summary.variables = operation.variableDefinitions.length;
    finishRepeats(summary);
    if (summary.variables > metrics.variables) metrics.variables = summary.variables;
    mergeOperationMetrics(metrics, summary);
  }
  enforceMetricCaps(metrics, policy, sink);
  return metrics;
}

function errorToFinding(error) {
  return makeFinding(error.code || GQLCAGE_ERROR_CODES.PARSE_ERROR, error.message, {
    line: error.line,
    column: error.column,
    details: error.details
  });
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function auditGraphQL(query, options = {}) {
  if (typeof query !== 'string') throw new TypeError('query must be a string');
  const start = nowMs();
  const policy = createGraphQLPolicy(options);
  const sink = makeFindingSink(policy.maxFindings);
  const metrics = emptyMetrics();
  const stats = {
    bytes: Buffer.byteLength(query, 'utf8'),
    parseMs: 0,
    auditMs: 0,
    findingsTotal: 0,
    findingsCapped: false
  };

  let document = null;
  const parseStart = nowMs();
  try {
    document = parseGraphQLDocument(query, {
      maxBytes: policy.maxBytes,
      maxTokens: policy.maxTokens,
      maxNameLength: policy.maxNameLength
    });
  } catch (error) {
    if (error instanceof GqlCageError) sink.add(errorToFinding(error));
    else throw error;
  }
  stats.parseMs = nowMs() - parseStart;

  let analyzed = emptyMetrics();
  if (document) {
    analyzed = analyzeDocument(document, policy, sink);
  }
  for (const key of Object.keys(analyzed)) metrics[key] = analyzed[key];
  metrics.tokens = document ? document.tokenCount : 0;
  if (!document) metrics.operations = 0;

  stats.auditMs = nowMs() - start;
  stats.findingsTotal = sink.total();
  stats.findingsCapped = sink.capped();
  const findings = sink.findings;
  return {
    safe: findings.length === 0,
    findings,
    metrics,
    stats
  };
}

export function validateGraphQL(query, options = {}) {
  const report = auditGraphQL(query, options);
  if (!report.safe) {
    const first = report.findings[0];
    throw new GqlCageError(first.code, first.message, {
      line: first.line,
      column: first.column,
      details: { findings: report.findings, metrics: report.metrics }
    });
  }
  return true;
}

export function isSafeGraphQL(query, options = {}) {
  return auditGraphQL(query, options).safe;
}

export function assertSafeGraphQL(query, options = {}) {
  return validateGraphQL(query, options);
}
