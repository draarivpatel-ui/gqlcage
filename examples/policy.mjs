import { createGraphQLPolicy } from '../src/index.mjs';

export const readOnlyPublicPolicy = createGraphQLPolicy({
  preset: 'public',
  allowedOperations: ['query'],
  requireOperationName: true,
  allowIntrospection: false,
  allowTypename: true,
  maxDepth: 8,
  maxAliases: 20,
  maxExpandedFields: 500,
  maxComplexity: 1000
});
