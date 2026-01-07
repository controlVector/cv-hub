/**
 * Parser Types for Code Analysis
 * Based on @cv-git/core parser architecture
 */

/**
 * Symbol kinds supported by the parser
 */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'constant'
  | 'property'
  | 'module';

/**
 * Visibility levels for symbols
 */
export type Visibility = 'public' | 'private' | 'protected' | 'internal';

/**
 * Function/method parameter
 */
export interface Parameter {
  name: string;
  type?: string;
  defaultValue?: string;
  isOptional?: boolean;
  isRest?: boolean;
}

/**
 * Function call information
 */
export interface CallInfo {
  callee: string;       // Name of called function
  line: number;         // Line number of call
  isConditional: boolean; // Is inside an if/ternary?
}

/**
 * Import statement information
 */
export interface ImportInfo {
  source: string;           // Module path
  importedSymbols: string[]; // Named imports
  defaultImport?: string;    // Default import name
  namespaceImport?: string;  // Namespace import name (import * as X)
  isTypeOnly?: boolean;      // TypeScript type-only import
  isExternal: boolean;       // Is from node_modules?
  line: number;
}

/**
 * Export statement information
 */
export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  source?: string;     // For re-exports
  line: number;
}

/**
 * Parsed symbol (function, class, etc.)
 */
export interface SymbolInfo {
  name: string;
  qualifiedName: string;  // file:ClassName.methodName
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
  returnType?: string;
  parameters?: Parameter[];
  visibility: Visibility;
  isAsync: boolean;
  isStatic: boolean;
  isAbstract?: boolean;
  isExported?: boolean;
  complexity: number;
  calls: CallInfo[];
  parentSymbol?: string;  // For methods: class name
}

/**
 * Code chunk for embedding
 */
export interface CodeChunk {
  id: string;
  file: string;
  language: string;
  symbolName?: string;
  symbolKind?: SymbolKind;
  startLine: number;
  endLine: number;
  text: string;
  summary?: string;
  docstring?: string;
  imports: string[];
  complexity: number;
}

/**
 * Result of parsing a file
 */
export interface ParseResult {
  path: string;
  language: string;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  chunks: CodeChunk[];
  linesOfCode: number;
  errors: string[];
}

/**
 * Supported languages
 */
export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
] as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

/**
 * File extension to language mapping
 */
export const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
};

/**
 * Get language from file path
 */
export function getLanguageFromPath(filePath: string): SupportedLanguage | null {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

/**
 * Check if file is a code file we can parse
 */
export function isCodeFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return ext in EXTENSION_TO_LANGUAGE;
}
