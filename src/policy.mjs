import { GQLCAGE_ERROR_CODES, GqlCageError } from './errors.mjs';

const OPERATION_NAMES = new Set(['query', 'mutation', 'subscription']);

export const GQLCAGE_POLICY_PRESETS = Object.freeze({
  strict: Object.freeze({
    maxBytes: 64 * 1024,
    maxTokens: 4000,
    maxNameLength: 256,
    maxDepth: 8,
    maxFragmentSpreads: 40,
    maxExpandedFields: 800,
    maxAliases: 30,
    maxDuplicateFields: 2,
    maxRootFields: 20,
    maxOperations: 2,
    requireOperationName: true,
    maxDirectives: 40,
    maxDirectivesPerLocation: 2,
    maxArguments: 80,
    maxVariables: 20,
    maxInputDepth: 5,
    maxStringLength: 2000,
    allowIntrospection: false,
    allowTypename: false,
    allowedOperations: ['query'],
    maxBatchSize: 1,
    maxVariablesBytes: 16 * 1024,
    maxVariablesDepth: 6,
    maxVariablesNodes: 1000,
    maxFindings: 50,
    maxComplexity: 2000
  }),
  public: Object.freeze({
    maxBytes: 256 * 1024,
    maxTokens: 10000,
    maxNameLength: 512,
    maxDepth: 12,
    maxFragmentSpreads: 100,
    maxExpandedFields: 2500,
    maxAliases: 100,
    maxDuplicateFields: 5,
    maxRootFields: 50,
    maxOperations: 5,
    requireOperationName: false,
    maxDirectives: 100,
    maxDirectivesPerLocation: 5,
    maxArguments: 200,
    maxVariables: 50,
    maxInputDepth: 10,
    maxStringLength: 10000,
    allowIntrospection: false,
    allowTypename: false,
    allowedOperations: ['query', 'mutation', 'subscription'],
    maxBatchSize: 1,
    maxVariablesBytes: 64 * 1024,
    maxVariablesDepth: 12,
    maxVariablesNodes: 5000,
    maxFindings: 100,
    maxComplexity: 10000
  }),
  internal: Object.freeze({
    maxBytes: 1024 * 1024,
    maxTokens: 30000,
    maxNameLength: 1024,
    maxDepth: 24,
    maxFragmentSpreads: 500,
    maxExpandedFields: 15000,
    maxAliases: 500,
    maxDuplicateFields: 20,
    maxRootFields: 200,
    maxOperations: 20,
    requireOperationName: false,
    maxDirectives: 500,
    maxDirectivesPerLocation: 20,
    maxArguments: 1000,
    maxVariables: 200,
    maxInputDepth: 20,
    maxStringLength: 50000,
    allowIntrospection: true,
    allowTypename: true,
    allowedOperations: ['query', 'mutation', 'subscription'],
    maxBatchSize: 8,
    maxVariablesBytes: 256 * 1024,
    maxVariablesDepth: 24,
    maxVariablesNodes: 20000,
    maxFindings: 200,
    maxComplexity: 50000
  })
});

const INTEGER_KEYS = new Set([
  'maxBytes',
  'maxTokens',
  'maxNameLength',
  'maxDepth',
  'maxFragmentSpreads',
  'maxExpandedFields',
  'maxAliases',
  'maxDuplicateFields',
  'maxRootFields',
  'maxOperations',
  'maxDirectives',
  'maxDirectivesPerLocation',
  'maxArguments',
  'maxVariables',
  'maxInputDepth',
  'maxStringLength',
  'maxBatchSize',
  'maxVariablesBytes',
  'maxVariablesDepth',
  'maxVariablesNodes',
  'maxFindings',
  'maxComplexity'
]);
const BOOLEAN_KEYS = new Set([
  'requireOperationName',
  'allowIntrospection',
  'allowTypename'
]);
const KNOWN_KEYS = new Set([
  ...INTEGER_KEYS,
  ...BOOLEAN_KEYS,
  'allowedOperations',
  'preset'
]);

function policyError(message, details) {
  return new GqlCageError(GQLCAGE_ERROR_CODES.POLICY_ERROR, message, { details });
}

function copyPolicy(policy) {
  return { ...policy, allowedOperations: [...policy.allowedOperations] };
}

export function createGraphQLPolicy(options = {}) {
  let presetName = 'public';
  let overrides = {};
  if (typeof options === 'string') {
    presetName = options;
  } else if (options && typeof options === 'object') {
    overrides = { ...options };
    if (typeof overrides.preset === 'string') presetName = overrides.preset;
  } else {
    throw policyError('policy options must be an object or a preset name');
  }
  if (!Object.hasOwn(GQLCAGE_POLICY_PRESETS, presetName)) {
    throw policyError('unknown GraphQL policy preset', { preset: presetName });
  }
  for (const key of Object.keys(overrides)) {
    if (!KNOWN_KEYS.has(key)) throw policyError('unknown GraphQL policy option', { option: key });
  }

  const merged = { ...copyPolicy(GQLCAGE_POLICY_PRESETS[presetName]) };
  for (const [key, value] of Object.entries(overrides)) {
    if (key !== 'preset') merged[key] = value;
  }
  merged.preset = presetName;

  for (const key of INTEGER_KEYS) {
    const value = merged[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw policyError('policy option must be a non-negative safe integer', { option: key, value });
    }
  }
  if (merged.maxBytes === 0) throw policyError('maxBytes must be greater than zero');
  if (merged.maxOperations === 0) throw policyError('maxOperations must be greater than zero');
  if (merged.maxFindings === 0) throw policyError('maxFindings must be greater than zero');
  if (merged.maxBatchSize === 0) throw policyError('maxBatchSize must be greater than zero');
  for (const key of BOOLEAN_KEYS) {
    if (typeof merged[key] !== 'boolean') throw policyError('policy option must be a boolean', { option: key });
  }
  if (!Array.isArray(merged.allowedOperations) || merged.allowedOperations.length === 0) {
    throw policyError('allowedOperations must be a non-empty array');
  }
  const seenOperations = new Set();
  for (const operation of merged.allowedOperations) {
    if (!OPERATION_NAMES.has(operation)) throw policyError('allowedOperations contains an unknown operation type', { operation });
    if (seenOperations.has(operation)) throw policyError('allowedOperations contains a duplicate operation type', { operation });
    seenOperations.add(operation);
  }
  merged.allowedOperations = Object.freeze([...merged.allowedOperations]);
  return Object.freeze(merged);
}
