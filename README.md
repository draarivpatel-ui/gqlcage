# gqlcage

Zero-dependency GraphQL query security firewall, iterative parser, and denial of service and introspection auditor for Node.js.

`gqlcage` inspects executable GraphQL documents before they reach a schema executor. It is designed for public endpoints, multi-tenant APIs, edge middleware, CI policy checks, and maintenance tooling that needs a small auditable parser rather than a dependency chain.

## Properties

- Zero runtime and development npm dependencies.
- Iterative lexer and parser for GraphQL executable documents. Deeply nested selection sets and input values are handled with explicit work stacks rather than recursive descent.
- Memoized fragment DAG analysis. Shared fragment expansions are computed algebraically, so exponential fan-out does not cause exponential CPU or memory use.
- Circular, unknown, and duplicate fragment detection.
- Effective depth, expanded field, alias, duplicate field, directive, argument, variable, input nesting, string length, root field, operation count, and complexity limits.
- Introspection is blocked by default. `__typename` has a separate policy switch.
- Operation type allow lists and executable-document-only parsing. SDL such as `type`, `schema`, and `extend` is rejected.
- HTTP JSON request auditing with batch blocking, byte limits, variables depth and size limits, strict JSON data checks, prototype pollution key detection, and an Express-style middleware helper.
- Dual ESM and CommonJS entry points, TypeScript declarations, and a CLI.
- Node.js 18 or newer.

## Install

```sh
npm install gqlcage
```

## Quick start

```js
import { auditGraphQL, validateGraphQL, isSafeGraphQL } from 'gqlcage';

const report = auditGraphQL(`
  query Viewer {
    viewer {
      id
      name
    }
  }
`);

console.log(report.safe);
console.log(report.metrics);

if (!report.safe) {
  console.log(report.findings);
}

validateGraphQL('{ viewer { id } }');
console.log(isSafeGraphQL('{ __schema { types { name } } }'));
```

CommonJS is supported:

```js
const { auditGraphQL } = require('gqlcage');
console.log(auditGraphQL('{ viewer { id } }').safe);
```

## HTTP request auditing

```js
import { auditGraphQLRequest, createGraphQLGuard } from 'gqlcage';

const report = auditGraphQLRequest({
  query: 'query Viewer { viewer { id } }',
  operationName: 'Viewer',
  variables: { includeDetails: false }
});

const guard = createGraphQLGuard({ preset: 'public' });

// Express-style use:
// app.use('/graphql', guard);
```

`createGraphQLGuard` expects a parsed JSON body on `req.body`. It writes a 400 JSON response for unsafe requests and attaches the full report to `req.gqlcage`.

Array batching is blocked by default because `maxBatchSize` is `1` in the public preset. Raise it only when batching is intentionally supported.

Variables and extensions must be strict JSON data when passed as JavaScript objects. Proxy objects, accessors, sparse arrays, symbol keys, non-finite numbers, and reference cycles are rejected fail closed. Keys named `__proto__`, `constructor`, `prototype`, `toString`, or `valueOf` are rejected in executable input objects and JSON data because they are common object injection and prototype pollution primitives.

## CLI

```sh
gqlcage audit query.graphql
gqlcage validate query.graphql --preset strict
gqlcage metrics query.graphql --json
cat query.graphql | gqlcage audit - --max-depth 8 --max-aliases 20
```

Exit codes:

- `0`: the document is safe under the selected policy.
- `1`: the document is unsafe or invalid.
- `2`: CLI usage, input reading, or policy construction failed.

stderr output neutralizes C0, C1, and bidirectional control characters.

## Policy presets

### strict

Small public form or read-only endpoint defaults. Only queries are allowed, operation names are required, introspection is blocked, batching is blocked, and depth and expansion limits are low.

### public

The default preset. Queries, mutations, and subscriptions are allowed unless narrowed, introspection is blocked, batching is blocked, and endpoint-sized token, expansion, alias, directive, and complexity limits apply.

### internal

A looser preset for trusted first-party tooling. Introspection and `__typename` are allowed and batch, depth, and expansion limits are higher. Do not use this preset on untrusted input without reviewing every limit.

Policies are immutable:

```js
import { createGraphQLPolicy } from 'gqlcage';

const policy = createGraphQLPolicy({
  preset: 'public',
  maxDepth: 8,
  maxAliases: 25,
  allowedOperations: ['query'],
  allowIntrospection: false,
  allowTypename: true
});
```

Unknown policy keys are rejected so a spelling mistake cannot silently weaken a boundary.

## Limits

| Option | Meaning |
| --- | --- |
| `maxBytes` | UTF-8 input byte limit |
| `maxTokens` | lexer token limit |
| `maxNameLength` | GraphQL name length limit |
| `maxDepth` | effective selection nesting depth after fragment expansion |
| `maxFragmentSpreads` | expanded fragment spread count |
| `maxExpandedFields` | expanded field count |
| `maxAliases` | expanded alias count |
| `maxDuplicateFields` | maximum repeated response key or repeated underlying field in one selection set |
| `maxRootFields` | distinct root response keys in one operation |
| `maxOperations` | executable operation definitions per document |
| `requireOperationName` | require every operation to be named |
| `maxDirectives` | total expanded directive count |
| `maxDirectivesPerLocation` | directives at one executable location |
| `maxArguments` | expanded argument count |
| `maxVariables` | variable definitions per operation |
| `maxInputDepth` | nested list and object input literal depth |
| `maxStringLength` | string literal and operation name length limit |
| `allowIntrospection` | allow `__schema` and `__type` |
| `allowTypename` | allow `__typename` |
| `allowedOperations` | allow list containing `query`, `mutation`, or `subscription` |
| `maxBatchSize` | HTTP JSON array batch size |
| `maxVariablesBytes` | estimated encoded variables and extensions byte bound |
| `maxVariablesDepth` | variables and extensions object nesting bound |
| `maxVariablesNodes` | variables and extensions JSON node count bound |
| `maxFindings` | maximum findings retained before fail-closed capping |
| `maxComplexity` | static complexity estimate |

Execution shaping metrics are reported as the worst single operation in the document because a GraphQL request executes at most one selected operation. Operation, fragment, token, and byte counts describe the document.

## Complexity model

Without schema knowledge, no static analyzer can know list cardinality or resolver cost. `gqlcage` therefore uses a deterministic conservative shape heuristic:

- one point per expanded field,
- one point per argument,
- one point per directive,
- one point per expanded fragment spread.

This is not a replacement for schema-aware cost analysis. It is a bounded pre-filter that stops shape amplification before more expensive validation or execution.

## Fragment bombs

A shared fragment DAG such as `F1` spreading `F2` twice, `F2` spreading `F3` twice, and so on describes exponential expansion in a linear-size input. `gqlcage` does not materialize that expansion. It topologically orders the fragment DAG, memoizes each fragment summary, saturates large counts, and compares those counts with policy limits.

Circular fragments are rejected with `GQLCAGE_FRAGMENT_CYCLE`. Unknown fragments are rejected with `GQLCAGE_UNKNOWN_FRAGMENT`. Duplicate fragments are rejected with `GQLCAGE_DUPLICATE_FRAGMENT`.

## Scope and non-goals

`gqlcage` is a pre-execution security filter. It does not replace a GraphQL schema validator and does not know whether fields, arguments, directives, or type conditions exist in a particular schema. Run it before schema validation and execution, not instead of them.

The parser accepts executable documents only. Type system definitions and extensions are rejected with `GQLCAGE_SDL_NOT_ALLOWED`.

## API summary

```ts
auditGraphQL(query, options): GqlCageAuditReport
validateGraphQL(query, options): true
isSafeGraphQL(query, options): boolean
assertSafeGraphQL(query, options): true
auditGraphQLRequest(payload, options): GqlCageRequestAuditReport
createGraphQLPolicy(options): Readonly<GqlCagePolicy>
createGraphQLGuard(options): GqlCageGuard
lexGraphQL(source, options): GqlCageLexResult
parseGraphQLDocument(source, options): GqlCageDocumentNode
```

`validateGraphQL` and `assertSafeGraphQL` throw `GqlCageError` when a document is unsafe. `auditGraphQL` returns findings instead and is the preferred API when request context needs complete diagnostics.

## Error handling

Every machine-readable finding has a `GQLCAGE_*` code, severity, message, optional line and column, optional path, and optional structured details. If more findings are produced than `maxFindings`, the final retained finding is replaced by `GQLCAGE_FINDINGS_CAP` and the input remains rejected.

## Development

```sh
npm test
node scripts/build-cjs.mjs --check
node scripts/cli-smoke.mjs
npm pack --dry-run
```

The repository has no dependency installation step. Tests use the Node.js built-in test runner.
