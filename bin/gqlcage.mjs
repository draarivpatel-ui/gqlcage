#!/usr/bin/env node
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { GQLCAGE_ERROR_CODES, auditGraphQL, createGraphQLPolicy } from '../src/index.mjs';

function isNeutralizedCode(code) {
  return code < 32
    || (code >= 127 && code <= 159)
    || code === 1564
    || code === 8206
    || code === 8207
    || (code >= 8234 && code <= 8238)
    || (code >= 8294 && code <= 8297);
}

function neutralize(text) {
  let output = '';
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    if (!isNeutralizedCode(code)) {
      output += character;
    } else {
      output += String.fromCharCode(92) + 'u' + code.toString(16).padStart(4, '0');
    }
  }
  return output;
}

function usage() {
  return [
    'usage: gqlcage <audit|validate|metrics> <file|-> [options]',
    '',
    'options:',
    '  --json                    emit machine readable JSON',
    '  --preset <name>           strict, public, or internal',
    '  --max-depth <n>           override maximum effective selection depth',
    '  --max-aliases <n>         override maximum alias count',
    '  --max-tokens <n>          override maximum lexer token count',
    '  --max-bytes <n>           override maximum input byte count',
    '  --max-complexity <n>      override maximum estimated complexity',
    '  --allow-introspection     allow __schema and __type fields',
    '  --allow-typename          allow __typename fields',
    '  --help                    show this help'
  ].join('\n');
}

function failUsage(message) {
  process.stderr.write(neutralize(message + '\n' + usage() + '\n'));
  process.exit(2);
}

function parseInteger(value, flag) {
  if (!/^[0-9]+$/.test(value)) failUsage(flag + ' requires a non-negative integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) failUsage(flag + ' is too large');
  return parsed;
}

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  process.stdout.write(usage() + '\n');
  process.exit(0);
}
const command = argv[0];
if (!['audit', 'validate', 'metrics'].includes(command)) failUsage('missing or unknown command');
let inputPath = null;
const policyOptions = {};
let json = false;

for (let index = 1; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--json') {
    json = true;
    continue;
  }
  if (arg === '--allow-introspection') {
    policyOptions.allowIntrospection = true;
    continue;
  }
  if (arg === '--allow-typename') {
    policyOptions.allowTypename = true;
    continue;
  }
  if (arg === '--preset' || arg === '--max-depth' || arg === '--max-aliases' || arg === '--max-tokens' || arg === '--max-bytes' || arg === '--max-complexity') {
    if (index + 1 >= argv.length) failUsage(arg + ' requires a value');
    const value = argv[index + 1];
    index += 1;
    if (arg === '--preset') {
      if (!['strict', 'public', 'internal'].includes(value)) failUsage('unknown preset ' + value);
      policyOptions.preset = value;
    } else {
      const key = {
        '--max-depth': 'maxDepth',
        '--max-aliases': 'maxAliases',
        '--max-tokens': 'maxTokens',
        '--max-bytes': 'maxBytes',
        '--max-complexity': 'maxComplexity'
      }[arg];
      policyOptions[key] = parseInteger(value, arg);
    }
    continue;
  }
  if (arg.startsWith('--')) failUsage('unknown option ' + arg);
  if (inputPath !== null) failUsage('only one input file may be supplied');
  inputPath = arg;
}

if (inputPath === null) failUsage('missing input file or - for stdin');

let policy;
try {
  policy = createGraphQLPolicy(policyOptions);
} catch (error) {
  failUsage('invalid policy: ' + error.message);
}

function readBoundedDescriptor(fd, limit) {
  const chunkLength = Math.max(1, Math.min(64 * 1024, limit + 1));
  const buffer = Buffer.allocUnsafe(chunkLength);
  const chunks = [];
  let total = 0;
  while (total <= limit) {
    const wanted = Math.min(chunkLength, limit + 1 - total);
    if (wanted <= 0) break;
    const count = readSync(fd, buffer, 0, wanted, null);
    if (count === 0) break;
    total += count;
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return {
    text: Buffer.concat(chunks).toString('utf8'),
    bytes: total,
    overLimit: total > limit
  };
}

async function readStdinBounded(limit) {
  const chunks = [];
  let total = 0;
  let overLimit = false;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = limit + 1 - total;
    const selected = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
    chunks.push(selected);
    total += selected.length;
    if (total > limit) {
      overLimit = true;
      break;
    }
  }
  if (overLimit) process.stdin.destroy();
  return {
    text: Buffer.concat(chunks).toString('utf8'),
    bytes: total,
    overLimit
  };
}

function readInputBounded(filePath, limit) {
  if (filePath === '-') return readStdinBounded(limit);
  let fd = null;
  try {
    fd = openSync(filePath, 'r');
    const stats = fstatSync(fd);
    if (stats.isFile() && stats.size > limit) {
      return { text: '', bytes: stats.size, overLimit: true };
    }
    return readBoundedDescriptor(fd, limit);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function oversizedInputReport(observedBytes, selectedPolicy) {
  return {
    safe: false,
    findings: [{
      code: GQLCAGE_ERROR_CODES.INPUT_TOO_LARGE,
      severity: 'error',
      message: 'GraphQL input exceeds the configured byte limit',
      line: 1,
      column: 1,
      details: { bytes: observedBytes, maxBytes: selectedPolicy.maxBytes }
    }],
    metrics: {
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
    },
    stats: {
      bytes: observedBytes,
      parseMs: 0,
      auditMs: 0,
      findingsTotal: 1,
      findingsCapped: false
    }
  };
}

let input;
try {
  input = await readInputBounded(inputPath, policy.maxBytes);
} catch (error) {
  process.stderr.write(neutralize('unable to read input: ' + error.message + '\n'));
  process.exit(2);
}

let report;
try {
  report = input.overLimit ? oversizedInputReport(input.bytes, policy) : auditGraphQL(input.text, policy);
} catch (error) {
  process.stderr.write(neutralize('gqlcage error: ' + error.message + '\n'));
  process.exit(2);
}

if (json) {
  const output = command === 'metrics' ? { safe: report.safe, metrics: report.metrics, stats: report.stats } : report;
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} else if (command === 'metrics') {
  for (const [key, value] of Object.entries(report.metrics)) process.stdout.write(key + ': ' + String(value) + '\n');
} else if (report.safe) {
  process.stdout.write(command === 'validate' ? 'safe\n' : 'safe: no findings\n');
} else {
  process.stdout.write('unsafe: ' + report.findings.length + ' finding(s)\n');
  for (const finding of report.findings) {
    const position = typeof finding.line === 'number' ? ' at ' + finding.line + ':' + finding.column : '';
    process.stdout.write(finding.code + position + ' - ' + neutralize(finding.message) + '\n');
  }
}

process.exit(report.safe ? 0 : 1);
