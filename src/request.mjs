import { GQLCAGE_ERROR_CODES, SEVERITY } from './errors.mjs';
import { auditGraphQL } from './analyzer.mjs';
import { createGraphQLPolicy } from './policy.mjs';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REQUEST_KEYS = new Set(['query', 'operationName', 'variables', 'extensions']);

function makeFinding(code, message, options = {}) {
  const result = {
    code,
    severity: options.severity || SEVERITY.ERROR,
    message
  };
  if (options.path) result.path = options.path;
  if (options.details !== undefined) result.details = options.details;
  return result;
}

function makeSink(maxFindings) {
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
      findings[maxFindings - 1] = makeFinding(GQLCAGE_ERROR_CODES.FINDINGS_CAP, 'finding limit reached; the request is rejected fail closed', {
        details: { maxFindings }
      });
      return false;
    }
  };
}

function isPlainJsonObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringTokenBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function inspectJsonValue(root, policy, path) {
  const result = {
    depth: 0,
    nodes: 0,
    bytes: 0,
    violations: []
  };
  const active = new Set();
  const violationSeen = new Set();
  let terminated = false;
  const addViolation = (violation) => {
    if (violationSeen.has(violation.code)) return;
    violationSeen.add(violation.code);
    result.violations.push(violation);
    terminated = true;
  };
  const noteBytes = (path) => {
    if (result.bytes > policy.maxVariablesBytes) {
      addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_TOO_LARGE, message: 'JSON value encoded size exceeds policy', path, details: { bytes: result.bytes, limit: policy.maxVariablesBytes } });
    }
  };
  const stack = [{ value: root, enclosingDepth: 0, path, entered: false, keys: null, index: 0, containerDepth: 0, isObject: false }];
  while (stack.length > 0 && !terminated) {
    const frame = stack[stack.length - 1];
    if (!frame.entered) {
      frame.entered = true;
      result.nodes += 1;
      result.bytes += 1;
      if (result.nodes > policy.maxVariablesNodes) {
        addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_TOO_LARGE, message: 'JSON value node count exceeds policy', path: frame.path, details: { nodes: result.nodes, limit: policy.maxVariablesNodes } });
        stack.pop();
        continue;
      }
      const value = frame.value;
      if (value === null) {
        result.bytes += 3;
        stack.pop();
        continue;
      }
      if (typeof value === 'string') {
        result.bytes = satishAdd(result.bytes, stringTokenBytes(value));
        noteBytes(frame.path);
        stack.pop();
        continue;
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_NOT_JSON, message: 'JSON numbers must be finite', path: frame.path });
        }
        result.bytes += String(value).length;
        noteBytes(frame.path);
        stack.pop();
        continue;
      }
      if (typeof value === 'boolean') {
        result.bytes += value ? 4 : 5;
        stack.pop();
        continue;
      }
      if (Array.isArray(value)) {
        frame.containerDepth = frame.enclosingDepth + 1;
        frame.isObject = false;
        if (frame.containerDepth > result.depth) result.depth = frame.containerDepth;
        if (frame.containerDepth > policy.maxVariablesDepth) {
          addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_TOO_DEEP, message: 'JSON value nesting depth exceeds policy', path: frame.path, details: { depth: frame.containerDepth, limit: policy.maxVariablesDepth } });
        }
        if (active.has(value)) {
          addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_CYCLE, message: 'JSON value contains a reference cycle', path: frame.path });
          stack.pop();
          continue;
        }
        active.add(value);
        frame.keys = value.map((unused, index) => String(index));
        result.bytes += 2;
        noteBytes(frame.path);
        continue;
      }
      if (isPlainJsonObject(value)) {
        frame.containerDepth = frame.enclosingDepth + 1;
        frame.isObject = true;
        if (frame.containerDepth > result.depth) result.depth = frame.containerDepth;
        if (frame.containerDepth > policy.maxVariablesDepth) {
          addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_TOO_DEEP, message: 'JSON value nesting depth exceeds policy', path: frame.path, details: { depth: frame.containerDepth, limit: policy.maxVariablesDepth } });
        }
        if (active.has(value)) {
          addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_CYCLE, message: 'JSON value contains a reference cycle', path: frame.path });
          stack.pop();
          continue;
        }
        active.add(value);
        frame.keys = Object.keys(value);
        result.bytes += 2;
        continue;
      }
      addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_NOT_JSON, message: 'value is not representable as strict JSON', path: frame.path });
      stack.pop();
      continue;
    }

    if (frame.keys && frame.index < frame.keys.length) {
      const key = frame.keys[frame.index];
      frame.index += 1;
      let child;
      let childPath;
      if (frame.isObject) {
        result.bytes += stringTokenBytes(key) + 1;
        noteBytes(frame.path);
        if (DANGEROUS_KEYS.has(key)) {
          addViolation({ code: GQLCAGE_ERROR_CODES.PROTOTYPE_POLLUTION, message: 'JSON object key is a prototype pollution primitive', path: frame.path, details: { key } });
        }
        child = frame.value[key];
        childPath = frame.path + '.' + key;
      } else {
        child = frame.value[Number(key)];
        childPath = frame.path + '[' + key + ']';
      }
      result.bytes += 1;
      noteBytes(frame.path);
      stack.push({ value: child, enclosingDepth: frame.containerDepth, path: childPath, entered: false, keys: null, index: 0, containerDepth: 0, isObject: false });
      continue;
    }

    active.delete(frame.value);
    stack.pop();
  }
  if (result.bytes > policy.maxVariablesBytes) {
    addViolation({ code: GQLCAGE_ERROR_CODES.VARIABLES_TOO_LARGE, message: 'JSON value encoded size exceeds policy', path, details: { bytes: result.bytes, limit: policy.maxVariablesBytes } });
  }
  return result;
}

function satishAdd(left, right) {
  return left + right > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : left + right;
}

function mergeJsonScan(target, scan) {
  if (scan.depth > target.variablesDepth) target.variablesDepth = scan.depth;
  target.variablesBytes = satishAdd(target.variablesBytes, scan.bytes);
  target.variablesNodes = satishAdd(target.variablesNodes, scan.nodes);
}

function copyFindingWithPath(finding, path) {
  const copy = { ...finding };
  copy.path = copy.path ? path + '.' + copy.path : path;
  return copy;
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function auditGraphQLRequest(payload, options = {}) {
  const start = nowMs();
  const policy = createGraphQLPolicy(options);
  const sink = makeSink(policy.maxFindings);
  const addedFindingKeys = new Set();
  const addUniqueFinding = (finding) => {
    const detailKey = finding.details && typeof finding.details === 'object' && 'key' in finding.details ? String(finding.details.key) : '';
    const scopeless = finding.code === 'GQLCAGE_VARIABLES_CYCLE' || finding.code === 'GQLCAGE_PROTOTYPE_POLLUTION';
    const key = finding.code + '|' + (scopeless ? '' : (finding.path || '')) + '|' + detailKey;
    if (addedFindingKeys.has(key)) return;
    addedFindingKeys.add(key);
    sink.add(finding);
  };
  const metrics = {
    batchSize: 1,
    bytes: 0,
    queries: 0,
    variablesDepth: 0,
    variablesBytes: 0,
    variablesNodes: 0,
    depth: 0,
    expandedFields: 0,
    aliases: 0,
    directives: 0,
    tokens: 0,
    operations: 0,
    fragments: 0,
    complexity: 0
  };
  const results = [];
  let data = payload;
  let byteLimitHit = false;

  if (typeof payload === 'string') {
    metrics.bytes = Buffer.byteLength(payload, 'utf8');
    if (metrics.bytes > policy.maxBytes) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_TOO_LARGE, 'GraphQL request payload exceeds the configured byte limit', {
        details: { bytes: metrics.bytes, limit: policy.maxBytes }
      }));
      byteLimitHit = true;
    } else {
      try {
        data = JSON.parse(payload);
      } catch (error) {
        sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_JSON_INVALID, 'GraphQL request payload is not valid JSON', {
          details: { message: error.message }
        }));
        data = null;
      }
    }
  }

  if (!byteLimitHit && data !== null && (typeof data === 'object' || Array.isArray(data))) {
    const payloadScanPolicy = { ...policy, maxVariablesBytes: policy.maxBytes, maxVariablesDepth: Number.MAX_SAFE_INTEGER, maxVariablesNodes: Number.MAX_SAFE_INTEGER };
    const payloadScan = inspectJsonValue(data, payloadScanPolicy, 'payload');
    metrics.bytes = Math.max(metrics.bytes, payloadScan.bytes);
    if (payloadScan.bytes > policy.maxBytes) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_TOO_LARGE, 'GraphQL request payload exceeds the configured byte limit', {
        details: { bytes: payloadScan.bytes, limit: policy.maxBytes }
      }));
    }
    for (const violation of payloadScan.violations) {
      if (violation.code === GQLCAGE_ERROR_CODES.VARIABLES_CYCLE || violation.code === GQLCAGE_ERROR_CODES.PROTOTYPE_POLLUTION) {
        addUniqueFinding(makeFinding(violation.code, violation.message, { path: violation.path, details: violation.details }));
      }
    }
  }

  if (data === null && sink.findings.length === 0) {
    sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'GraphQL request payload must be an object or a non-empty batch array', { path: 'payload' }));
  }
  if (Array.isArray(data) && data.length === 0) {
    sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'GraphQL request batch array cannot be empty', { path: 'payload' }));
  }
  const entries = Array.isArray(data) ? data : data === null ? [] : [data];
  metrics.batchSize = Array.isArray(data) ? data.length : entries.length;
  if (Array.isArray(data) && data.length > policy.maxBatchSize) {
    sink.add(makeFinding(GQLCAGE_ERROR_CODES.BATCH_SIZE_EXCEEDED, 'GraphQL request batch size exceeds policy', {
      details: { value: data.length, limit: policy.maxBatchSize }
    }));
  }

  const auditCount = Math.min(entries.length, policy.maxBatchSize);
  for (let index = 0; index < auditCount; index += 1) {
    const entry = entries[index];
    const entryPath = Array.isArray(data) ? 'entry[' + index + ']' : 'entry';
    if (!isPlainJsonObject(entry)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'GraphQL request entry must be a plain JSON object', { path: entryPath }));
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!REQUEST_KEYS.has(key)) {
        sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'GraphQL request entry contains an unknown key', {
          path: entryPath,
          details: { key }
        }));
      }
    }
    if (entry.operationName !== undefined && entry.operationName !== null && typeof entry.operationName !== 'string') {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'operationName must be a string or null', { path: entryPath + '.operationName' }));
    }
    if (typeof entry.operationName === 'string' && entry.operationName.length > policy.maxStringLength) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.STRING_LENGTH_EXCEEDED, 'operationName length exceeds policy', {
        path: entryPath + '.operationName',
        details: { value: entry.operationName.length, limit: policy.maxStringLength }
      }));
    }
    const variableBytesBefore = metrics.variablesBytes;
    const variableNodesBefore = metrics.variablesNodes;
    if (entry.variables !== undefined && entry.variables !== null && !isPlainJsonObject(entry.variables)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'variables must be a JSON object or null', { path: entryPath + '.variables' }));
    }
    if (entry.extensions !== undefined && entry.extensions !== null && !isPlainJsonObject(entry.extensions)) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'extensions must be a JSON object or null', { path: entryPath + '.extensions' }));
    }
    if (entry.variables !== undefined && entry.variables !== null) {
      const scan = inspectJsonValue(entry.variables, policy, entryPath + '.variables');
      mergeJsonScan(metrics, scan);
      for (const violation of scan.violations) {
        addUniqueFinding(makeFinding(violation.code, violation.message, { path: violation.path, details: violation.details }));
      }
    }
    if (entry.extensions !== undefined && entry.extensions !== null) {
      const scan = inspectJsonValue(entry.extensions, policy, entryPath + '.extensions');
      mergeJsonScan(metrics, scan);
      for (const violation of scan.violations) {
        addUniqueFinding(makeFinding(violation.code, violation.message, { path: violation.path, details: violation.details }));
      }
    }
    if (metrics.variablesBytes - variableBytesBefore > policy.maxVariablesBytes) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.VARIABLES_TOO_LARGE, 'combined variables and extensions encoded size exceeds policy', {
        path: entryPath,
        details: { bytes: metrics.variablesBytes - variableBytesBefore, limit: policy.maxVariablesBytes }
      }));
    }
    if (metrics.variablesNodes - variableNodesBefore > policy.maxVariablesNodes) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.VARIABLES_TOO_LARGE, 'combined variables and extensions node count exceeds policy', {
        path: entryPath,
        details: { nodes: metrics.variablesNodes - variableNodesBefore, limit: policy.maxVariablesNodes }
      }));
    }
    if (typeof entry.query !== 'string' || entry.query.length === 0) {
      sink.add(makeFinding(GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID, 'GraphQL request entry requires a non-empty query string', { path: entryPath + '.query' }));
      continue;
    }

    const report = auditGraphQL(entry.query, policy);
    metrics.queries += 1;
    if (report.metrics.depth > metrics.depth) metrics.depth = report.metrics.depth;
    if (report.metrics.expandedFields > metrics.expandedFields) metrics.expandedFields = report.metrics.expandedFields;
    if (report.metrics.aliases > metrics.aliases) metrics.aliases = report.metrics.aliases;
    if (report.metrics.directives > metrics.directives) metrics.directives = report.metrics.directives;
    if (report.metrics.complexity > metrics.complexity) metrics.complexity = report.metrics.complexity;
    metrics.tokens = satishAdd(metrics.tokens, report.metrics.tokens);
    metrics.operations = satishAdd(metrics.operations, report.metrics.operations);
    metrics.fragments = satishAdd(metrics.fragments, report.metrics.fragments);
    for (const finding of report.findings) sink.add(copyFindingWithPath(finding, entryPath + '.query'));
    results.push({
      index,
      safe: report.safe,
      depth: report.metrics.depth,
      expandedFields: report.metrics.expandedFields,
      aliases: report.metrics.aliases,
      directives: report.metrics.directives,
      complexity: report.metrics.complexity,
      operations: report.metrics.operations,
      fragments: report.metrics.fragments
    });
  }

  return {
    safe: sink.findings.length === 0,
    findings: sink.findings,
    metrics,
    results,
    stats: {
      auditMs: nowMs() - start,
      findingsTotal: sink.total(),
      findingsCapped: sink.capped()
    }
  };
}

export function createGraphQLGuard(options = {}) {
  const policy = createGraphQLPolicy(options);
  const guard = function graphQLGuard(req, res, next) {
    const body = req && typeof req === 'object' && Object.hasOwn(req, 'body') ? req.body : req;
    const report = auditGraphQLRequest(body, policy);
    if (req && typeof req === 'object') req.gqlcage = report;
    if (report.safe) {
      if (typeof next === 'function') next();
      return true;
    }
    const responseBody = JSON.stringify({
      errors: [{
        message: 'GraphQL request rejected by security policy',
        code: report.findings[0] ? report.findings[0].code : GQLCAGE_ERROR_CODES.REQUEST_SHAPE_INVALID
      }]
    });
    if (res && typeof res.status === 'function' && typeof res.json === 'function') {
      res.status(400).json(JSON.parse(responseBody));
    } else if (res && typeof res.end === 'function') {
      res.statusCode = 400;
      if (typeof res.setHeader === 'function') res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(responseBody);
    }
    return false;
  };
  guard.policy = policy;
  guard.audit = (payload) => auditGraphQLRequest(payload, policy);
  return Object.freeze(guard);
}
