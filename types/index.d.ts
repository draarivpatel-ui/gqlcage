export const GQLCAGE_VERSION: '1.0.0';

export type GqlCageErrorCode =
  | 'GQLCAGE_LEX_ERROR'
  | 'GQLCAGE_PARSE_ERROR'
  | 'GQLCAGE_SDL_NOT_ALLOWED'
  | 'GQLCAGE_INPUT_TOO_LARGE'
  | 'GQLCAGE_MAX_TOKENS'
  | 'GQLCAGE_NAME_TOO_LONG'
  | 'GQLCAGE_DEPTH_EXCEEDED'
  | 'GQLCAGE_FRAGMENT_CYCLE'
  | 'GQLCAGE_UNKNOWN_FRAGMENT'
  | 'GQLCAGE_DUPLICATE_FRAGMENT'
  | 'GQLCAGE_DUPLICATE_OPERATION'
  | 'GQLCAGE_DUPLICATE_VARIABLE'
  | 'GQLCAGE_DUPLICATE_ARGUMENT'
  | 'GQLCAGE_DUPLICATE_INPUT_FIELD'
  | 'GQLCAGE_FRAGMENT_SPREADS_EXCEEDED'
  | 'GQLCAGE_EXPANDED_FIELDS_EXCEEDED'
  | 'GQLCAGE_ALIASES_EXCEEDED'
  | 'GQLCAGE_DUPLICATE_FIELDS_EXCEEDED'
  | 'GQLCAGE_ROOT_FIELDS_EXCEEDED'
  | 'GQLCAGE_OPERATIONS_EXCEEDED'
  | 'GQLCAGE_OPERATION_NAME_REQUIRED'
  | 'GQLCAGE_OPERATION_TYPE_BLOCKED'
  | 'GQLCAGE_DIRECTIVES_EXCEEDED'
  | 'GQLCAGE_DIRECTIVES_PER_LOCATION_EXCEEDED'
  | 'GQLCAGE_ARGUMENTS_EXCEEDED'
  | 'GQLCAGE_VARIABLES_EXCEEDED'
  | 'GQLCAGE_INPUT_DEPTH_EXCEEDED'
  | 'GQLCAGE_STRING_LENGTH_EXCEEDED'
  | 'GQLCAGE_INTROSPECTION_BLOCKED'
  | 'GQLCAGE_PROTOTYPE_POLLUTION'
  | 'GQLCAGE_COMPLEXITY_EXCEEDED'
  | 'GQLCAGE_FINDINGS_CAP'
  | 'GQLCAGE_POLICY_ERROR'
  | 'GQLCAGE_REQUEST_TOO_LARGE'
  | 'GQLCAGE_REQUEST_JSON_INVALID'
  | 'GQLCAGE_REQUEST_SHAPE_INVALID'
  | 'GQLCAGE_BATCH_SIZE_EXCEEDED'
  | 'GQLCAGE_VARIABLES_TOO_DEEP'
  | 'GQLCAGE_VARIABLES_TOO_LARGE'
  | 'GQLCAGE_VARIABLES_NOT_JSON'
  | 'GQLCAGE_VARIABLES_CYCLE';

export const GQLCAGE_ERROR_CODES: Readonly<Record<string, GqlCageErrorCode>>;
export const GQLCAGE_FINDING_CODES: Readonly<Record<string, GqlCageErrorCode>>;
export const SEVERITY: Readonly<{
  ERROR: 'error';
  WARNING: 'warning';
}>;

export class GqlCageError extends Error {
  constructor(code: GqlCageErrorCode | string, message: string, options?: {
    line?: number;
    column?: number;
    index?: number;
    details?: unknown;
  });
  code: string;
  line?: number;
  column?: number;
  index?: number;
  details?: unknown;
}

export type GqlCagePresetName = 'strict' | 'public' | 'internal';
export type GqlCageOperationType = 'query' | 'mutation' | 'subscription';

export interface GqlCagePolicyOptions {
  preset?: GqlCagePresetName;
  maxBytes?: number;
  maxTokens?: number;
  maxNameLength?: number;
  maxDepth?: number;
  maxFragmentSpreads?: number;
  maxExpandedFields?: number;
  maxAliases?: number;
  maxDuplicateFields?: number;
  maxRootFields?: number;
  maxOperations?: number;
  requireOperationName?: boolean;
  maxDirectives?: number;
  maxDirectivesPerLocation?: number;
  maxArguments?: number;
  maxVariables?: number;
  maxInputDepth?: number;
  maxStringLength?: number;
  allowIntrospection?: boolean;
  allowTypename?: boolean;
  allowedOperations?: readonly GqlCageOperationType[];
  maxBatchSize?: number;
  maxVariablesBytes?: number;
  maxVariablesDepth?: number;
  maxVariablesNodes?: number;
  maxFindings?: number;
  /** Maximum static complexity estimate (expanded fields, arguments, nested input object fields and list items in argument literals, directives, and expanded fragment spreads). */
  maxComplexity?: number;
}

export interface GqlCagePolicy extends Required<Omit<GqlCagePolicyOptions, 'preset' | 'allowedOperations'>> {
  preset: GqlCagePresetName;
  allowedOperations: readonly GqlCageOperationType[];
}

export const GQLCAGE_POLICY_PRESETS: Readonly<Record<GqlCagePresetName, Readonly<Omit<GqlCagePolicy, 'preset'>>>>;
export function createGraphQLPolicy(options?: GqlCagePolicyOptions | GqlCagePresetName): Readonly<GqlCagePolicy>;

export interface GqlCageFinding {
  code: GqlCageErrorCode | string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  line?: number;
  column?: number;
  details?: unknown;
}

export interface GqlCageMetrics {
  depth: number;
  expandedFields: number;
  aliases: number;
  directives: number;
  tokens: number;
  operations: number;
  fragments: number;
  /** Static complexity estimate: 1 per expanded field, argument, nested input object field or list item in argument literals, directive, and expanded fragment spread. */
  complexity: number;
  arguments: number;
  variables: number;
  fragmentSpreads: number;
  rootFields: number;
  duplicateFields: number;
  inputDepth: number;
  maxStringLength: number;
  maxDirectivesPerLocation: number;
}

export interface GqlCageStats {
  bytes: number;
  parseMs: number;
  auditMs: number;
  findingsTotal: number;
  findingsCapped: boolean;
}

export interface GqlCageAuditReport {
  safe: boolean;
  findings: GqlCageFinding[];
  metrics: GqlCageMetrics;
  stats: GqlCageStats;
}

export function auditGraphQL(query: string, options?: GqlCagePolicyOptions | GqlCagePresetName | Readonly<GqlCagePolicy>): GqlCageAuditReport;
export function validateGraphQL(query: string, options?: GqlCagePolicyOptions | GqlCagePresetName | Readonly<GqlCagePolicy>): true;
export function isSafeGraphQL(query: string, options?: GqlCagePolicyOptions | GqlCagePresetName | Readonly<GqlCagePolicy>): boolean;
export function assertSafeGraphQL(query: string, options?: GqlCagePolicyOptions | GqlCagePresetName | Readonly<GqlCagePolicy>): true;

export interface GqlCageRequestMetrics extends Pick<GqlCageMetrics, 'depth' | 'expandedFields' | 'aliases' | 'directives' | 'tokens' | 'operations' | 'fragments' | 'complexity'> {
  batchSize: number;
  bytes: number;
  queries: number;
  variablesDepth: number;
  variablesBytes: number;
  variablesNodes: number;
}

export interface GqlCageRequestResultSummary {
  index: number;
  safe: boolean;
  depth: number;
  expandedFields: number;
  aliases: number;
  directives: number;
  complexity: number;
  operations: number;
  fragments: number;
}

export interface GqlCageRequestAuditReport {
  safe: boolean;
  findings: GqlCageFinding[];
  metrics: GqlCageRequestMetrics;
  results: GqlCageRequestResultSummary[];
  stats: {
    auditMs: number;
    findingsTotal: number;
    findingsCapped: boolean;
  };
}

export function auditGraphQLRequest(payload: unknown, options?: GqlCagePolicyOptions | GqlCagePresetName | Readonly<GqlCagePolicy>): GqlCageRequestAuditReport;

export interface GqlCageGuard {
  (req: unknown, res?: unknown, next?: unknown): boolean;
  readonly policy: Readonly<GqlCagePolicy>;
  audit(payload: unknown): GqlCageRequestAuditReport;
}

export function createGraphQLGuard(options?: GqlCagePolicyOptions | GqlCagePresetName | Readonly<GqlCagePolicy>): GqlCageGuard;

export interface GqlCageSourceLocation {
  index: number;
  line: number;
  column: number;
}

export interface GqlCageToken extends GqlCageSourceLocation {
  type: 'NAME' | 'INT' | 'FLOAT' | 'STRING' | 'PUNCT' | 'EOF';
  value: string;
  end: number;
  block?: boolean;
}

export interface GqlCageLexResult {
  tokens: GqlCageToken[];
  tokenCount: number;
  byteLength: number;
}

export function lexGraphQL(source: string, options?: {
  maxBytes?: number;
  maxTokens?: number;
  maxNameLength?: number;
}): GqlCageLexResult;

export type GqlCageValueNode =
  | { kind: 'variable'; name: string; loc: GqlCageSourceLocation }
  | { kind: 'int' | 'float'; value: string; raw: string; loc: GqlCageSourceLocation }
  | { kind: 'string'; value: string; block: boolean; loc: GqlCageSourceLocation }
  | { kind: 'boolean'; value: boolean; loc: GqlCageSourceLocation }
  | { kind: 'null'; value: null; loc: GqlCageSourceLocation }
  | { kind: 'enum'; name: string; loc: GqlCageSourceLocation }
  | { kind: 'list'; values: GqlCageValueNode[]; loc: GqlCageSourceLocation }
  | { kind: 'object'; fields: Array<{ name: string; value: GqlCageValueNode; loc: GqlCageSourceLocation }>; loc: GqlCageSourceLocation };

export interface GqlCageArgumentNode {
  name: string;
  value: GqlCageValueNode;
  loc: GqlCageSourceLocation;
}

export interface GqlCageDirectiveNode {
  name: string;
  arguments: GqlCageArgumentNode[];
  loc: GqlCageSourceLocation;
}

export interface GqlCageSelectionSetNode {
  kind: 'SelectionSet';
  selections: GqlCageSelectionNode[];
  loc: GqlCageSourceLocation;
}

export type GqlCageSelectionNode =
  | {
      kind: 'Field';
      alias: string | null;
      name: string;
      arguments: GqlCageArgumentNode[];
      directives: GqlCageDirectiveNode[];
      selectionSet: GqlCageSelectionSetNode | null;
      loc: GqlCageSourceLocation;
      nameLoc: GqlCageSourceLocation;
    }
  | {
      kind: 'FragmentSpread';
      name: string;
      directives: GqlCageDirectiveNode[];
      loc: GqlCageSourceLocation;
    }
  | {
      kind: 'InlineFragment';
      typeCondition: string | null;
      directives: GqlCageDirectiveNode[];
      selectionSet: GqlCageSelectionSetNode;
      loc: GqlCageSourceLocation;
    };

export type GqlCageTypeNode =
  | { kind: 'NamedType'; name: string; loc: GqlCageSourceLocation }
  | { kind: 'ListType'; ofType: GqlCageTypeNode; loc: GqlCageSourceLocation }
  | { kind: 'NonNullType'; ofType: GqlCageTypeNode; loc: GqlCageSourceLocation };

export interface GqlCageVariableDefinitionNode {
  name: string;
  type: GqlCageTypeNode;
  defaultValue: GqlCageValueNode | null;
  directives: GqlCageDirectiveNode[];
  loc: GqlCageSourceLocation;
}

export interface GqlCageOperationDefinitionNode {
  kind: 'OperationDefinition';
  operation: GqlCageOperationType;
  name: string | null;
  variableDefinitions: GqlCageVariableDefinitionNode[];
  directives: GqlCageDirectiveNode[];
  selectionSet: GqlCageSelectionSetNode;
  loc: GqlCageSourceLocation;
}

export interface GqlCageFragmentDefinitionNode {
  kind: 'FragmentDefinition';
  name: string;
  typeCondition: string;
  directives: GqlCageDirectiveNode[];
  selectionSet: GqlCageSelectionSetNode;
  loc: GqlCageSourceLocation;
}

export type GqlCageDefinitionNode = GqlCageOperationDefinitionNode | GqlCageFragmentDefinitionNode;

export interface GqlCageDocumentNode {
  kind: 'Document';
  definitions: GqlCageDefinitionNode[];
  tokenCount: number;
  byteLength: number;
  loc: GqlCageSourceLocation;
}

export function parseGraphQLDocument(source: string, options?: {
  maxBytes?: number;
  maxTokens?: number;
  maxNameLength?: number;
}): GqlCageDocumentNode;
