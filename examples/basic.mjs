import { auditGraphQL, validateGraphQL, isSafeGraphQL } from '../src/index.mjs';

const query = `
  query Viewer {
    viewer {
      id
      name
    }
  }
`;

const report = auditGraphQL(query, { preset: 'public' });
console.log('safe:', report.safe);
console.log('depth:', report.metrics.depth);
console.log('expanded fields:', report.metrics.expandedFields);

validateGraphQL(query);
console.log('introspection safe:', isSafeGraphQL('{ __schema { types { name } } }'));
