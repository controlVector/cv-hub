/**
 * Code Parser Service
 *
 * Tree-sitter based AST parsing for symbol extraction.
 * Simplified implementation based on @cv-git/core parser architecture.
 *
 * Supports: TypeScript, JavaScript, Python, Go, Rust, Java
 */

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Java from 'tree-sitter-java';
import crypto from 'crypto';

import type {
  ParseResult,
  SymbolInfo,
  ImportInfo,
  ExportInfo,
  CodeChunk,
  CallInfo,
  Parameter,
  SymbolKind,
  Visibility,
  SupportedLanguage,
} from './types.js';
import { getLanguageFromPath } from './types.js';

/**
 * Tree-sitter node abstraction
 */
interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TSNode[];
  namedChildren: TSNode[];
  childForFieldName(name: string): TSNode | null;
  parent: TSNode | null;
}

/**
 * Initialization result from CodeParser.initialize()
 */
export interface InitResult {
  success: boolean;
  languages: SupportedLanguage[];
  errors: string[];
}

/**
 * Code Parser - handles multiple languages
 */
export class CodeParser {
  private parsers: Map<SupportedLanguage, Parser> = new Map();
  private _initialized = false;
  private initErrors: string[] = [];

  constructor() {
    // Don't auto-initialize - let caller call initialize()
  }

  /**
   * Initialize tree-sitter parsers for each language
   */
  async initialize(): Promise<InitResult> {
    if (this._initialized) {
      return {
        success: true,
        languages: Array.from(this.parsers.keys()),
        errors: this.initErrors,
      };
    }

    const errors: string[] = [];

    // TypeScript/TSX
    try {
      const tsParser = new Parser();
      tsParser.setLanguage(TypeScript.typescript);
      this.parsers.set('typescript', tsParser);
    } catch (error) {
      errors.push(`typescript: ${(error as Error).message}`);
    }

    // JavaScript
    try {
      const jsParser = new Parser();
      jsParser.setLanguage(JavaScript);
      this.parsers.set('javascript', jsParser);
    } catch (error) {
      errors.push(`javascript: ${(error as Error).message}`);
    }

    // Python
    try {
      const pyParser = new Parser();
      pyParser.setLanguage(Python);
      this.parsers.set('python', pyParser);
    } catch (error) {
      errors.push(`python: ${(error as Error).message}`);
    }

    // Go
    try {
      const goParser = new Parser();
      goParser.setLanguage(Go);
      this.parsers.set('go', goParser);
    } catch (error) {
      errors.push(`go: ${(error as Error).message}`);
    }

    // Rust
    try {
      const rustParser = new Parser();
      rustParser.setLanguage(Rust);
      this.parsers.set('rust', rustParser);
    } catch (error) {
      errors.push(`rust: ${(error as Error).message}`);
    }

    // Java
    try {
      const javaParser = new Parser();
      javaParser.setLanguage(Java);
      this.parsers.set('java', javaParser);
    } catch (error) {
      errors.push(`java: ${(error as Error).message}`);
    }

    this._initialized = true;
    this.initErrors = errors;

    console.log('[CodeParser] Initialized with languages:', Array.from(this.parsers.keys()));
    if (errors.length > 0) {
      console.warn('[CodeParser] Initialization errors:', errors);
    }

    return {
      success: this.parsers.size > 0,
      languages: Array.from(this.parsers.keys()),
      errors,
    };
  }

  /**
   * Check if parser is initialized
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Parse a file and extract symbols, imports, etc.
   */
  async parse(filePath: string, content: string): Promise<ParseResult> {
    const language = getLanguageFromPath(filePath);

    if (!language) {
      return this.emptyResult(filePath, 'unknown');
    }

    const parser = this.parsers.get(language);
    if (!parser) {
      return this.emptyResult(filePath, language);
    }

    try {
      const tree = parser.parse(content);
      const rootNode = tree.rootNode as unknown as TSNode;

      // Extract based on language
      let symbols: SymbolInfo[] = [];
      let imports: ImportInfo[] = [];
      let exports: ExportInfo[] = [];

      switch (language) {
        case 'typescript':
        case 'javascript':
          symbols = this.extractTypeScriptSymbols(rootNode, filePath, content);
          imports = this.extractTypeScriptImports(rootNode, content);
          exports = this.extractTypeScriptExports(rootNode);
          break;
        case 'python':
          symbols = this.extractPythonSymbols(rootNode, filePath, content);
          imports = this.extractPythonImports(rootNode, content);
          break;
        case 'go':
          symbols = this.extractGoSymbols(rootNode, filePath, content);
          imports = this.extractGoImports(rootNode, content);
          break;
        case 'rust':
          symbols = this.extractRustSymbols(rootNode, filePath, content);
          imports = this.extractRustImports(rootNode, content);
          break;
        case 'java':
          symbols = this.extractJavaSymbols(rootNode, filePath, content);
          imports = this.extractJavaImports(rootNode, content);
          break;
      }

      // Create code chunks for embedding
      const chunks = this.createChunks(filePath, language, content, symbols);

      return {
        path: filePath,
        language,
        symbols,
        imports,
        exports,
        chunks,
        linesOfCode: content.split('\n').length,
        errors: [],
      };
    } catch (error) {
      console.warn(`[CodeParser] Failed to parse ${filePath}:`, String(error));
      return {
        ...this.emptyResult(filePath, language),
        errors: [String(error)],
      };
    }
  }

  /**
   * Alias for parse() - Parse a file and extract symbols, imports, etc.
   */
  async parseFile(filePath: string, content: string): Promise<ParseResult> {
    return this.parse(filePath, content);
  }

  /**
   * Empty result for unsupported/failed files
   */
  private emptyResult(filePath: string, language: string): ParseResult {
    return {
      path: filePath,
      language,
      symbols: [],
      imports: [],
      exports: [],
      chunks: [],
      linesOfCode: 0,
      errors: [],
    };
  }

  // ============================================================================
  // TypeScript/JavaScript Extraction
  // ============================================================================

  private extractTypeScriptSymbols(node: TSNode, filePath: string, content: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    // Find all function declarations
    this.findNodes(node, [
      'function_declaration',
      'arrow_function',
      'function',
      'method_definition',
    ]).forEach((funcNode) => {
      const symbol = this.extractTSFunction(funcNode, filePath, content);
      if (symbol) symbols.push(symbol);
    });

    // Find all class declarations
    this.findNodes(node, ['class_declaration', 'class']).forEach((classNode) => {
      const symbol = this.extractTSClass(classNode, filePath, content);
      if (symbol) symbols.push(symbol);
    });

    // Find all interface declarations
    this.findNodes(node, ['interface_declaration']).forEach((ifaceNode) => {
      const symbol = this.extractTSInterface(ifaceNode, filePath, content);
      if (symbol) symbols.push(symbol);
    });

    return symbols;
  }

  private extractTSFunction(node: TSNode, filePath: string, content: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const qualifiedName = `${filePath}:${name}`;

    return {
      name,
      qualifiedName,
      kind: 'function',
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: this.getNodeText(node, content, 100),
      docstring: this.findDocstring(node, content),
      visibility: this.getTSVisibility(node),
      isAsync: this.hasModifier(node, 'async'),
      isStatic: false,
      isExported: this.hasModifier(node, 'export'),
      complexity: this.calculateComplexity(node),
      calls: this.extractCalls(node),
    };
  }

  private extractTSClass(node: TSNode, filePath: string, content: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const qualifiedName = `${filePath}:${name}`;

    return {
      name,
      qualifiedName,
      kind: 'class',
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      docstring: this.findDocstring(node, content),
      visibility: 'public',
      isAsync: false,
      isStatic: false,
      isExported: this.hasModifier(node, 'export'),
      complexity: this.calculateComplexity(node),
      calls: [],
    };
  }

  private extractTSInterface(node: TSNode, filePath: string, content: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const qualifiedName = `${filePath}:${name}`;

    return {
      name,
      qualifiedName,
      kind: 'interface',
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      docstring: this.findDocstring(node, content),
      visibility: 'public',
      isAsync: false,
      isStatic: false,
      isExported: this.hasModifier(node, 'export'),
      complexity: 0,
      calls: [],
    };
  }

  private extractTypeScriptImports(node: TSNode, content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    this.findNodes(node, ['import_statement']).forEach((importNode) => {
      const sourceNode = importNode.childForFieldName('source');
      if (!sourceNode) return;

      const source = sourceNode.text.replace(/['"]/g, '');
      const isExternal = !source.startsWith('.') && !source.startsWith('/');

      const importedSymbols: string[] = [];
      let defaultImport: string | undefined;
      let namespaceImport: string | undefined;

      // Find import clause
      const clauseNode = importNode.namedChildren.find(c => c.type === 'import_clause');
      if (clauseNode) {
        // Default import
        const defaultNode = clauseNode.namedChildren.find(c =>
          c.type === 'identifier' && !c.parent?.type.includes('named')
        );
        if (defaultNode) defaultImport = defaultNode.text;

        // Named imports
        this.findNodes(clauseNode, ['import_specifier']).forEach((spec) => {
          const name = spec.childForFieldName('name') || spec.namedChildren[0];
          if (name) importedSymbols.push(name.text);
        });

        // Namespace import
        const nsNode = clauseNode.namedChildren.find(c => c.type === 'namespace_import');
        if (nsNode) {
          const nsName = nsNode.namedChildren.find(c => c.type === 'identifier');
          if (nsName) namespaceImport = nsName.text;
        }
      }

      imports.push({
        source,
        importedSymbols,
        defaultImport,
        namespaceImport,
        isExternal,
        line: importNode.startPosition.row + 1,
      });
    });

    return imports;
  }

  private extractTypeScriptExports(node: TSNode): ExportInfo[] {
    const exports: ExportInfo[] = [];

    // Named exports
    this.findNodes(node, ['export_statement']).forEach((exportNode) => {
      const isDefault = exportNode.text.includes('export default');

      // Find exported name
      const declNode = exportNode.namedChildren.find(c =>
        ['function_declaration', 'class_declaration', 'variable_declaration'].includes(c.type)
      );

      if (declNode) {
        const nameNode = declNode.childForFieldName('name');
        if (nameNode) {
          exports.push({
            name: nameNode.text,
            isDefault,
            isReExport: false,
            line: exportNode.startPosition.row + 1,
          });
        }
      }
    });

    return exports;
  }

  private getTSVisibility(node: TSNode): Visibility {
    const modifiers = node.namedChildren.filter(c => c.type.includes('modifier'));
    for (const mod of modifiers) {
      if (mod.text === 'private') return 'private';
      if (mod.text === 'protected') return 'protected';
    }
    return 'public';
  }

  private hasModifier(node: TSNode, modifier: string): boolean {
    return node.text.includes(modifier);
  }

  // ============================================================================
  // Python Extraction
  // ============================================================================

  private extractPythonSymbols(node: TSNode, filePath: string, content: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    // Functions
    this.findNodes(node, ['function_definition']).forEach((funcNode) => {
      const nameNode = funcNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'function',
        file: filePath,
        startLine: funcNode.startPosition.row + 1,
        endLine: funcNode.endPosition.row + 1,
        docstring: this.findPythonDocstring(funcNode, content),
        visibility: nameNode.text.startsWith('_') ? 'private' : 'public',
        isAsync: this.hasModifier(funcNode, 'async'),
        isStatic: false,
        complexity: this.calculateComplexity(funcNode),
        calls: this.extractCalls(funcNode),
      });
    });

    // Classes
    this.findNodes(node, ['class_definition']).forEach((classNode) => {
      const nameNode = classNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'class',
        file: filePath,
        startLine: classNode.startPosition.row + 1,
        endLine: classNode.endPosition.row + 1,
        docstring: this.findPythonDocstring(classNode, content),
        visibility: 'public',
        isAsync: false,
        isStatic: false,
        complexity: this.calculateComplexity(classNode),
        calls: [],
      });
    });

    return symbols;
  }

  private extractPythonImports(node: TSNode, content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    // import statements
    this.findNodes(node, ['import_statement']).forEach((importNode) => {
      const names: string[] = [];
      this.findNodes(importNode, ['dotted_name', 'aliased_import']).forEach((n) => {
        names.push(n.text.split(' ')[0]); // Handle "import x as y"
      });

      if (names.length > 0) {
        imports.push({
          source: names[0],
          importedSymbols: [],
          isExternal: true, // Simplified
          line: importNode.startPosition.row + 1,
        });
      }
    });

    // from ... import statements
    this.findNodes(node, ['import_from_statement']).forEach((importNode) => {
      const moduleNode = importNode.childForFieldName('module_name');
      if (!moduleNode) return;

      const source = moduleNode.text;
      const importedSymbols: string[] = [];

      this.findNodes(importNode, ['dotted_name', 'aliased_import']).forEach((n) => {
        if (n !== moduleNode) {
          importedSymbols.push(n.text.split(' ')[0]);
        }
      });

      imports.push({
        source,
        importedSymbols,
        isExternal: !source.startsWith('.'),
        line: importNode.startPosition.row + 1,
      });
    });

    return imports;
  }

  private findPythonDocstring(node: TSNode, content: string): string | undefined {
    const body = node.childForFieldName('body');
    if (!body) return undefined;

    const firstChild = body.namedChildren[0];
    if (firstChild?.type === 'expression_statement') {
      const stringNode = firstChild.namedChildren[0];
      if (stringNode?.type === 'string') {
        return stringNode.text.replace(/^['"`]{1,3}|['"`]{1,3}$/g, '').trim();
      }
    }
    return undefined;
  }

  // ============================================================================
  // Go Extraction
  // ============================================================================

  private extractGoSymbols(node: TSNode, filePath: string, content: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    // Functions
    this.findNodes(node, ['function_declaration']).forEach((funcNode) => {
      const nameNode = funcNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'function',
        file: filePath,
        startLine: funcNode.startPosition.row + 1,
        endLine: funcNode.endPosition.row + 1,
        visibility: nameNode.text[0] === nameNode.text[0].toUpperCase() ? 'public' : 'private',
        isAsync: false,
        isStatic: false,
        complexity: this.calculateComplexity(funcNode),
        calls: this.extractCalls(funcNode),
      });
    });

    // Methods
    this.findNodes(node, ['method_declaration']).forEach((methodNode) => {
      const nameNode = methodNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'method',
        file: filePath,
        startLine: methodNode.startPosition.row + 1,
        endLine: methodNode.endPosition.row + 1,
        visibility: nameNode.text[0] === nameNode.text[0].toUpperCase() ? 'public' : 'private',
        isAsync: false,
        isStatic: false,
        complexity: this.calculateComplexity(methodNode),
        calls: this.extractCalls(methodNode),
      });
    });

    // Structs and interfaces
    this.findNodes(node, ['type_declaration']).forEach((typeNode) => {
      const specNode = typeNode.namedChildren.find(c =>
        c.type === 'type_spec'
      );
      if (!specNode) return;

      const nameNode = specNode.childForFieldName('name');
      const typeValueNode = specNode.childForFieldName('type');

      if (nameNode) {
        const kind: SymbolKind = typeValueNode?.type === 'interface_type' ? 'interface' : 'class';
        symbols.push({
          name: nameNode.text,
          qualifiedName: `${filePath}:${nameNode.text}`,
          kind,
          file: filePath,
          startLine: typeNode.startPosition.row + 1,
          endLine: typeNode.endPosition.row + 1,
          visibility: nameNode.text[0] === nameNode.text[0].toUpperCase() ? 'public' : 'private',
          isAsync: false,
          isStatic: false,
          complexity: 0,
          calls: [],
        });
      }
    });

    return symbols;
  }

  private extractGoImports(node: TSNode, content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    this.findNodes(node, ['import_declaration']).forEach((importNode) => {
      this.findNodes(importNode, ['import_spec']).forEach((spec) => {
        const pathNode = spec.childForFieldName('path');
        if (!pathNode) return;

        const source = pathNode.text.replace(/"/g, '');
        imports.push({
          source,
          importedSymbols: [],
          isExternal: true,
          line: spec.startPosition.row + 1,
        });
      });
    });

    return imports;
  }

  // ============================================================================
  // Rust Extraction
  // ============================================================================

  private extractRustSymbols(node: TSNode, filePath: string, content: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    // Functions
    this.findNodes(node, ['function_item']).forEach((funcNode) => {
      const nameNode = funcNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'function',
        file: filePath,
        startLine: funcNode.startPosition.row + 1,
        endLine: funcNode.endPosition.row + 1,
        visibility: this.hasModifier(funcNode, 'pub') ? 'public' : 'private',
        isAsync: this.hasModifier(funcNode, 'async'),
        isStatic: false,
        complexity: this.calculateComplexity(funcNode),
        calls: this.extractCalls(funcNode),
      });
    });

    // Structs
    this.findNodes(node, ['struct_item']).forEach((structNode) => {
      const nameNode = structNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'class', // Treat structs as classes
        file: filePath,
        startLine: structNode.startPosition.row + 1,
        endLine: structNode.endPosition.row + 1,
        visibility: this.hasModifier(structNode, 'pub') ? 'public' : 'private',
        isAsync: false,
        isStatic: false,
        complexity: 0,
        calls: [],
      });
    });

    // Traits (interfaces)
    this.findNodes(node, ['trait_item']).forEach((traitNode) => {
      const nameNode = traitNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'interface',
        file: filePath,
        startLine: traitNode.startPosition.row + 1,
        endLine: traitNode.endPosition.row + 1,
        visibility: this.hasModifier(traitNode, 'pub') ? 'public' : 'private',
        isAsync: false,
        isStatic: false,
        complexity: 0,
        calls: [],
      });
    });

    return symbols;
  }

  private extractRustImports(node: TSNode, content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    this.findNodes(node, ['use_declaration']).forEach((useNode) => {
      const pathText = useNode.text.replace(/^use\s+/, '').replace(/;$/, '');
      imports.push({
        source: pathText.split('::')[0],
        importedSymbols: [],
        isExternal: !pathText.startsWith('crate') && !pathText.startsWith('self') && !pathText.startsWith('super'),
        line: useNode.startPosition.row + 1,
      });
    });

    return imports;
  }

  // ============================================================================
  // Java Extraction
  // ============================================================================

  private extractJavaSymbols(node: TSNode, filePath: string, content: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    // Methods
    this.findNodes(node, ['method_declaration']).forEach((methodNode) => {
      const nameNode = methodNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'method',
        file: filePath,
        startLine: methodNode.startPosition.row + 1,
        endLine: methodNode.endPosition.row + 1,
        visibility: this.getJavaVisibility(methodNode),
        isAsync: false,
        isStatic: this.hasModifier(methodNode, 'static'),
        complexity: this.calculateComplexity(methodNode),
        calls: this.extractCalls(methodNode),
      });
    });

    // Classes
    this.findNodes(node, ['class_declaration']).forEach((classNode) => {
      const nameNode = classNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'class',
        file: filePath,
        startLine: classNode.startPosition.row + 1,
        endLine: classNode.endPosition.row + 1,
        visibility: this.getJavaVisibility(classNode),
        isAsync: false,
        isStatic: false,
        complexity: this.calculateComplexity(classNode),
        calls: [],
      });
    });

    // Interfaces
    this.findNodes(node, ['interface_declaration']).forEach((ifaceNode) => {
      const nameNode = ifaceNode.childForFieldName('name');
      if (!nameNode) return;

      symbols.push({
        name: nameNode.text,
        qualifiedName: `${filePath}:${nameNode.text}`,
        kind: 'interface',
        file: filePath,
        startLine: ifaceNode.startPosition.row + 1,
        endLine: ifaceNode.endPosition.row + 1,
        visibility: this.getJavaVisibility(ifaceNode),
        isAsync: false,
        isStatic: false,
        complexity: 0,
        calls: [],
      });
    });

    return symbols;
  }

  private extractJavaImports(node: TSNode, content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    this.findNodes(node, ['import_declaration']).forEach((importNode) => {
      const pathText = importNode.text.replace(/^import\s+/, '').replace(/;$/, '').trim();
      imports.push({
        source: pathText,
        importedSymbols: [],
        isExternal: true,
        line: importNode.startPosition.row + 1,
      });
    });

    return imports;
  }

  private getJavaVisibility(node: TSNode): Visibility {
    const text = node.text;
    if (text.includes('private')) return 'private';
    if (text.includes('protected')) return 'protected';
    if (text.includes('public')) return 'public';
    return 'internal'; // package-private
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Find all nodes of given types in the AST
   */
  private findNodes(node: TSNode, types: string[]): TSNode[] {
    const results: TSNode[] = [];

    const traverse = (n: TSNode) => {
      if (types.includes(n.type)) {
        results.push(n);
      }
      for (const child of n.namedChildren) {
        traverse(child);
      }
    };

    traverse(node);
    return results;
  }

  /**
   * Get truncated text from a node
   */
  private getNodeText(node: TSNode, content: string, maxLength: number): string {
    const lines = content.split('\n');
    const startLine = node.startPosition.row;
    const line = lines[startLine] || '';
    return line.slice(0, maxLength).trim();
  }

  /**
   * Find docstring comment before a node
   */
  private findDocstring(node: TSNode, content: string): string | undefined {
    const lines = content.split('\n');
    const startLine = node.startPosition.row;

    // Look at previous lines for comments
    for (let i = startLine - 1; i >= 0 && i >= startLine - 10; i--) {
      const line = lines[i]?.trim() || '';
      if (line.startsWith('/**') || line.startsWith('///') || line.startsWith('*')) {
        // Found JSDoc/doc comment
        const docLines: string[] = [];
        for (let j = i; j < startLine; j++) {
          docLines.push(lines[j]?.trim() || '');
        }
        return docLines.join('\n').replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').trim();
      }
      if (line && !line.startsWith('//') && !line.startsWith('#')) {
        break; // Non-comment line, stop looking
      }
    }

    return undefined;
  }

  /**
   * Calculate cyclomatic complexity
   */
  private calculateComplexity(node: TSNode): number {
    let complexity = 1; // Base complexity

    const complexityNodes = [
      'if_statement', 'else_clause', 'elif_clause',
      'for_statement', 'for_in_statement', 'while_statement',
      'switch_statement', 'case_clause',
      'catch_clause', 'conditional_expression',
      'and_expression', 'or_expression', '&&', '||',
      'match_arm', // Rust
    ];

    const countComplexity = (n: TSNode) => {
      if (complexityNodes.some(t => n.type.includes(t))) {
        complexity++;
      }
      for (const child of n.namedChildren) {
        countComplexity(child);
      }
    };

    countComplexity(node);
    return complexity;
  }

  /**
   * Extract function calls from a node
   */
  private extractCalls(node: TSNode): CallInfo[] {
    const calls: CallInfo[] = [];
    const seen = new Set<string>();

    const findCalls = (n: TSNode, inConditional: boolean) => {
      const isConditionalNode = ['if_statement', 'conditional_expression', 'ternary_expression'].includes(n.type);

      if (n.type === 'call_expression' || n.type === 'call') {
        const funcNode = n.childForFieldName('function') || n.namedChildren[0];
        if (funcNode) {
          const callee = funcNode.text.split('.').pop() || funcNode.text;
          const key = `${callee}:${n.startPosition.row}`;

          if (!seen.has(key)) {
            seen.add(key);
            calls.push({
              callee,
              line: n.startPosition.row + 1,
              isConditional: inConditional || isConditionalNode,
            });
          }
        }
      }

      for (const child of n.namedChildren) {
        findCalls(child, inConditional || isConditionalNode);
      }
    };

    findCalls(node, false);
    return calls;
  }

  /**
   * Create code chunks for embedding
   */
  private createChunks(
    filePath: string,
    language: string,
    content: string,
    symbols: SymbolInfo[]
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    for (const symbol of symbols) {
      const text = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n');
      const id = crypto.createHash('sha256')
        .update(`${filePath}:${symbol.name}:${symbol.startLine}`)
        .digest('hex')
        .slice(0, 16);

      chunks.push({
        id,
        file: filePath,
        language,
        symbolName: symbol.name,
        symbolKind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        text,
        docstring: symbol.docstring,
        imports: [], // Could extract from context
        complexity: symbol.complexity,
      });
    }

    return chunks;
  }
}

// Singleton instance
let parserInstance: CodeParser | null = null;

/**
 * Get the code parser instance
 */
export function getCodeParser(): CodeParser {
  if (!parserInstance) {
    parserInstance = new CodeParser();
  }
  return parserInstance;
}

// Re-export types
export * from './types.js';
