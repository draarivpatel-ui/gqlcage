# Error and finding codes

All stable machine-readable codes begin with `GQLCAGE_`.

| Code | Meaning |
| --- | --- |
| `GQLCAGE_LEX_ERROR` | invalid lexical syntax |
| `GQLCAGE_PARSE_ERROR` | invalid executable document grammar |
| `GQLCAGE_SDL_NOT_ALLOWED` | SDL or type system definition in executable input |
| `GQLCAGE_INPUT_TOO_LARGE` | query byte limit exceeded |
| `GQLCAGE_MAX_TOKENS` | lexer token limit exceeded |
| `GQLCAGE_NAME_TOO_LONG` | GraphQL name length limit exceeded |
| `GQLCAGE_DEPTH_EXCEEDED` | effective depth exceeded |
| `GQLCAGE_FRAGMENT_CYCLE` | named fragment dependency cycle |
| `GQLCAGE_UNKNOWN_FRAGMENT` | spread references an undefined fragment |
| `GQLCAGE_DUPLICATE_FRAGMENT` | duplicate fragment name |
| `GQLCAGE_DUPLICATE_OPERATION` | duplicate operation name |
| `GQLCAGE_DUPLICATE_VARIABLE` | duplicate variable in one operation |
| `GQLCAGE_DUPLICATE_ARGUMENT` | duplicate argument at one call site |
| `GQLCAGE_DUPLICATE_INPUT_FIELD` | duplicate key in one input object literal |
| `GQLCAGE_FRAGMENT_SPREADS_EXCEEDED` | expanded fragment spread count exceeded |
| `GQLCAGE_EXPANDED_FIELDS_EXCEEDED` | expanded field count exceeded |
| `GQLCAGE_ALIASES_EXCEEDED` | expanded alias count exceeded |
| `GQLCAGE_DUPLICATE_FIELDS_EXCEEDED` | repeated key or field count exceeded |
| `GQLCAGE_ROOT_FIELDS_EXCEEDED` | distinct root response key count exceeded |
| `GQLCAGE_OPERATIONS_EXCEEDED` | operation count exceeded |
| `GQLCAGE_OPERATION_NAME_REQUIRED` | operation name missing |
| `GQLCAGE_OPERATION_TYPE_BLOCKED` | operation type outside allow list |
| `GQLCAGE_DIRECTIVES_EXCEEDED` | total directive count exceeded |
| `GQLCAGE_DIRECTIVES_PER_LOCATION_EXCEEDED` | directive count at one location exceeded |
| `GQLCAGE_ARGUMENTS_EXCEEDED` | argument count exceeded |
| `GQLCAGE_VARIABLES_EXCEEDED` | variable count exceeded |
| `GQLCAGE_INPUT_DEPTH_EXCEEDED` | input literal nesting exceeded |
| `GQLCAGE_STRING_LENGTH_EXCEEDED` | string or operation name length exceeded |
| `GQLCAGE_INTROSPECTION_BLOCKED` | schema metadata field blocked |
| `GQLCAGE_PROTOTYPE_POLLUTION` | prototype pollution primitive name found |
| `GQLCAGE_COMPLEXITY_EXCEEDED` | complexity estimate exceeded |
| `GQLCAGE_FINDINGS_CAP` | finding output cap reached, input remains rejected |
| `GQLCAGE_POLICY_ERROR` | invalid firewall policy |
| `GQLCAGE_REQUEST_TOO_LARGE` | HTTP payload byte limit exceeded |
| `GQLCAGE_REQUEST_JSON_INVALID` | request text is not valid JSON |
| `GQLCAGE_REQUEST_SHAPE_INVALID` | request entry shape invalid |
| `GQLCAGE_BATCH_SIZE_EXCEEDED` | array batch size exceeded |
| `GQLCAGE_VARIABLES_TOO_DEEP` | variables or extensions nesting exceeded |
| `GQLCAGE_VARIABLES_TOO_LARGE` | variables or extensions byte or node size exceeded |
| `GQLCAGE_VARIABLES_NOT_JSON` | variables or extensions contain non-JSON values |
| `GQLCAGE_VARIABLES_CYCLE` | variables or extensions contain an object cycle |
