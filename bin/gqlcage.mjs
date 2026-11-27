#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { auditGraphQL } from '../src/index.mjs';

function isNeutralizedCode(code) {
  return code < 32
    || (code >= 127 && code <= 159)
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
const policy = {};
let json = false;

for (let index = 1; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--json') {
    json = true;
    continue;
  }
  if (arg === '--allow-introspection') {
    policy.allowIntrospection = true;
    continue;
  }
  if (arg === '--allow-typename') {
    policy.allowTypename = true;
    continue;
  }
  if (arg === '--preset' || arg === '--max-depth' || arg === '--max-aliases' || arg === '--max-tokens' || arg === '--max-bytes' || arg === '--max-complexity') {
    if (index + 1 >= argv.length) failUsage(arg + ' requires a value');
    const value = argv[index + 1];
    index += 1;
    if (arg === '--preset') {
      if (!['strict', 'public', 'internal'].includes(value)) failUsage('unknown preset ' + value);
      policy.preset = value;
    } else {
      const key = {
        '--max-depth': 'maxDepth',
        '--max-aliases': 'maxAliases',
        '--max-tokens': 'maxTokens',
        '--max-bytes': 'maxBytes',
        '--max-complexity': 'maxComplexity'
      }[arg];
      policy[key] = parseInteger(value, arg);
    }
    continue;
  }
  if (arg.startsWith('--')) failUsage('unknown option ' + arg);
  if (inputPath !== null) failUsage('only one input file may be supplied');
  inputPath = arg;
}

if (inputPath === null) failUsage('missing input file or - for stdin');

let query;
try {
  query = inputPath === '-' ? readFileSync(0, 'utf8') : readFileSync(inputPath, 'utf8');
} catch (error) {
  process.stderr.write(neutralize('unable to read input: ' + error.message + '\n'));
  process.exit(2);
}

let report;
try {
  report = auditGraphQL(query, policy);
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
