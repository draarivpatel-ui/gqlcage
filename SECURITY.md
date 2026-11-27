# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | yes |

## Reporting a vulnerability

Please do not open a public issue for a vulnerability report. Open a private GitHub Security Advisory for this repository at:

https://github.com/draarivpatel-ui/gqlcage/security/advisories/new

Include a minimal executable GraphQL document or HTTP payload, the policy used, the expected result, the observed result, and the Node.js version. Do not include secrets, production tokens, or private user data.

## Scope

This package is a pre-execution GraphQL security firewall. Reports are especially relevant for:

- parser crashes or unbounded memory use,
- recursion or stack overflow behavior,
- exponential fragment expansion that is not memoized,
- bypassing depth, alias, directive, introspection, batch, or input-size policy,
- prototype pollution through parsed executable documents or JSON request variables,
- output that enables terminal control injection.

`gqlcage` is not a schema-aware validator. A report that a field does not exist in a particular schema belongs in schema validation, not in this package.

## Response expectations

Security reports are triaged as time permits. Confirmed vulnerabilities are fixed before public disclosure when practical.
