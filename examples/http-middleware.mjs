import { createGraphQLGuard } from '../src/index.mjs';

export const graphqlGuard = createGraphQLGuard({
  preset: 'public',
  allowedOperations: ['query', 'mutation'],
  maxBatchSize: 1,
  maxDepth: 10
});

// With a body-parsed Express application:
// app.use('/graphql', graphqlGuard);
