# Threat model

## Assets

The protected assets are API availability, resolver CPU time, memory, schema confidentiality, and integrity of request processing. `gqlcage` runs before schema validation and execution, so its own parser must remain bounded even when the input is invalid or malicious.

## Attacker capabilities

The attacker controls GraphQL document text, operation selection, variables JSON, extensions JSON, batch shape, and request timing. The attacker does not control server policy or local files.

## Defenses

### Parser memory and stack safety

GraphQL nesting is parsed with explicit iteration. Selection sets, input lists, input objects, variable type lists, and document definitions do not use recursive descent for attacker-controlled nesting.

### Fragment expansion bombs

Named fragments form a directed graph. Cycles are rejected. Acyclic graphs are topologically ordered and summarized once per fragment. Counts saturate rather than allocating expanded query trees.

### Shape amplification

Aliases, repeated response keys, repeated underlying fields, root fields, operation count, arguments, directives, variables, input nesting, string length, token count, and byte count are capped.

### Introspection policy

`__schema` and `__type` are blocked unless `allowIntrospection` is true. `__typename` is controlled separately by `allowTypename`. Aliases, inline fragments, and named fragments do not bypass these checks because every parsed field is statically scanned before expansion policy is applied.

### HTTP batching and variables bombs

JSON values are treated as strict data rather than arbitrary JavaScript objects. Proxy objects and accessor properties are rejected without invoking user-controlled traps or getters. Sparse arrays, symbol-keyed properties, and non-finite numbers are also rejected.


JSON array batching is denied by default. Variables and extensions are inspected iteratively for depth, node count, estimated encoded bytes, non-JSON values, reference cycles, Proxy objects, accessor properties, sparse arrays, symbol keys, and prototype pollution or object injection keys.

## Residual risk

Static analysis cannot know schema-specific list sizes, resolver cost, object authorization, or type existence. Use schema-aware validation, authorization at field resolution, query execution timeouts, and rate limits in addition to `gqlcage`.
