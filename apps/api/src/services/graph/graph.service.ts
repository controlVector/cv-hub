/**
 * Graph Service
 * FalkorDB-based knowledge graph manager for CV-Hub
 * Compatible with @cv-git/core graph schema for seamless federation
 */

import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { env } from '../../config/env';
import type {
  FileNode,
  SymbolNode,
  CommitNode,
  ModuleNode,
  ImportsEdge,
  DefinesEdge,
  CallsEdge,
  InheritsEdge,
  ModifiesEdge,
  TouchesEdge,
  GraphQuery,
  GraphQueryResult,
  GraphStats,
  CallPath,
  SymbolUsage,
} from './types';
import { GraphError } from './types';

// Graph name pattern: repo_{repositoryId}
function getGraphName(repositoryId: string): string {
  return `repo_${repositoryId}`;
}

/**
 * GraphManager - manages knowledge graph for a single repository
 */
export class GraphManager {
  private client: RedisClientType | null = null;
  private graphName: string;
  private connected: boolean = false;

  constructor(repositoryId: string) {
    this.graphName = getGraphName(repositoryId);
  }

  /**
   * Connect to FalkorDB
   */
  async connect(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    try {
      const url = new URL(env.FALKORDB_URL);
      if (env.FALKORDB_PASSWORD) {
        url.password = env.FALKORDB_PASSWORD;
      }

      const isSecure = url.protocol === 'rediss:';
      this.client = createClient({
        url: url.toString(),
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              return new Error('Max reconnection attempts reached');
            }
            return retries * 100;
          },
          tls: isSecure ? true : undefined,
          rejectUnauthorized: isSecure ? false : undefined,
        }
      });

      this.client.on('error', (err) => {
        console.error('[GraphManager] Redis error:', err);
        this.connected = false;
      });

      this.client.on('end', () => {
        this.connected = false;
      });

      this.client.on('ready', () => {
        this.connected = true;
      });

      await this.client.connect();
      this.connected = true;

      // Create indexes
      await this.createIndexes();

    } catch (error: any) {
      throw new GraphError(`Failed to connect to FalkorDB: ${error.message}`, error);
    }
  }

  /**
   * Disconnect from FalkorDB
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Create indexes for better query performance
   * Uses same indexes as cv-git for compatibility
   */
  private async createIndexes(): Promise<void> {
    const indexes = [
      // File indexes
      ['File', 'path'],
      ['File', 'name'],
      ['File', 'language'],
      ['File', 'gitHash'],

      // Symbol indexes
      ['Symbol', 'name'],
      ['Symbol', 'qualifiedName'],
      ['Symbol', 'file'],
      ['Symbol', 'kind'],

      // Specific node type indexes (FalkorDB pattern)
      ['Function', 'name'],
      ['Function', 'qualifiedName'],
      ['Class', 'name'],
      ['Class', 'qualifiedName'],

      // Module indexes
      ['Module', 'path'],
      ['Module', 'name'],

      // Commit indexes
      ['Commit', 'sha'],
      ['Commit', 'author'],
      ['Commit', 'timestamp'],
    ];

    for (const [label, property] of indexes) {
      try {
        await this.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`);
      } catch (error: any) {
        // Index might already exist
        if (!error.message.includes('already exists') && !error.message.includes('already indexed')) {
          console.warn(`[GraphManager] Index warning for ${label}.${property}:`, error.message);
        }
      }
    }
  }

  /**
   * Execute a Cypher query
   */
  async query(cypher: string, params?: Record<string, any>): Promise<GraphQueryResult[]> {
    if (!this.client || !this.connected) {
      throw new GraphError('Not connected to FalkorDB');
    }

    try {
      // Replace parameters in query
      let processedQuery = cypher;
      if (params) {
        const sortedKeys = Object.keys(params).sort((a, b) => b.length - a.length);
        for (const key of sortedKeys) {
          const value = params[key];
          const placeholder = `$${key}`;
          const escapedValue = this.escapeValue(value);
          processedQuery = processedQuery.split(placeholder).join(escapedValue);
        }
      }

      const result = await this.client.sendCommand([
        'GRAPH.QUERY',
        this.graphName,
        processedQuery,
        '--compact'
      ]);

      return this.parseQueryResult(result as any);

    } catch (error: any) {
      throw new GraphError(`Query failed: ${error.message}`, error);
    }
  }

  /**
   * Escape value for Cypher query
   */
  private escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `'${escaped}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(v => this.escapeValue(v)).join(', ')}]`;
    }
    if (typeof value === 'object') {
      const props = Object.entries(value)
        .map(([k, v]) => `${k}: ${this.escapeValue(v)}`)
        .join(', ');
      return `{${props}}`;
    }
    return String(value);
  }

  /**
   * Parse FalkorDB query result
   */
  private parseQueryResult(result: any): GraphQueryResult[] {
    if (!result || !Array.isArray(result) || result.length < 2) {
      return [];
    }

    const headerPairs = result[0];
    const rowArrays = result[1];

    if (!Array.isArray(headerPairs) || !Array.isArray(rowArrays)) {
      return [];
    }

    const headers: string[] = headerPairs.map((pair: any[]) => pair[1]);

    return rowArrays.map((row: any[]) => {
      const obj: GraphQueryResult = {};
      row.forEach((pair: any[], idx: number) => {
        if (idx < headers.length) {
          obj[headers[idx]] = pair[1];
        }
      });
      return obj;
    });
  }

  // ========== Node Operations ==========

  /**
   * Create or update a File node
   */
  async upsertFileNode(file: FileNode): Promise<void> {
    const cypher = `
      MERGE (f:File {path: $path})
      SET f.absolutePath = $absolutePath,
          f.language = $language,
          f.lastModified = $lastModified,
          f.size = $size,
          f.gitHash = $gitHash,
          f.linesOfCode = $linesOfCode,
          f.complexity = $complexity,
          f.updatedAt = $updatedAt
      RETURN f
    `;

    await this.query(cypher, {
      ...file,
      updatedAt: Date.now()
    });
  }

  /**
   * Create or update a Symbol node
   */
  async upsertSymbolNode(symbol: SymbolNode): Promise<void> {
    // Map kind to specific label (cv-git pattern)
    const labelMap: Record<string, string> = {
      'function': 'Function',
      'method': 'Function',
      'class': 'Class',
      'interface': 'Interface',
      'type': 'TypeDef',
      'struct': 'Struct',
      'enum': 'Enum',
      'constant': 'Const',
      'variable': 'Var'
    };
    const specificLabel = labelMap[symbol.kind] || 'CodeSymbol';
    const labels = `Symbol:${specificLabel}:Searchable`;

    const cypher = `
      MERGE (s:${labels} {qualifiedName: $qualifiedName})
      SET s.name = $name,
          s.kind = $kind,
          s.file = $file,
          s.startLine = $startLine,
          s.endLine = $endLine,
          s.signature = $signature,
          s.docstring = $docstring,
          s.returnType = $returnType,
          s.visibility = $visibility,
          s.isAsync = $isAsync,
          s.isStatic = $isStatic,
          s.complexity = $complexity,
          s.vectorId = $vectorId,
          s.updatedAt = $updatedAt
      RETURN s
    `;

    await this.query(cypher, {
      ...symbol,
      signature: symbol.signature || '',
      docstring: symbol.docstring || '',
      returnType: symbol.returnType || '',
      vectorId: symbol.vectorId || '',
      updatedAt: Date.now()
    });
  }

  /**
   * Create or update a Commit node
   */
  async upsertCommitNode(commit: CommitNode): Promise<void> {
    const cypher = `
      MERGE (c:Commit {sha: $sha})
      SET c.message = $message,
          c.author = $author,
          c.authorEmail = $authorEmail,
          c.committer = $committer,
          c.timestamp = $timestamp,
          c.branch = $branch,
          c.filesChanged = $filesChanged,
          c.insertions = $insertions,
          c.deletions = $deletions,
          c.vectorId = $vectorId,
          c.createdAt = $createdAt
      RETURN c
    `;

    await this.query(cypher, {
      ...commit,
      vectorId: commit.vectorId || ''
    });
  }

  /**
   * Create or update a Module node
   */
  async upsertModuleNode(module: ModuleNode): Promise<void> {
    const cypher = `
      MERGE (m:Module {path: $path})
      SET m.name = $name,
          m.type = $type,
          m.language = $language,
          m.description = $description,
          m.version = $version,
          m.fileCount = $fileCount,
          m.symbolCount = $symbolCount,
          m.updatedAt = $updatedAt
      RETURN m
    `;

    await this.query(cypher, {
      ...module,
      description: module.description || '',
      version: module.version || '',
      updatedAt: Date.now()
    });
  }

  // ========== Edge Operations ==========

  async createImportsEdge(fromPath: string, toPath: string, edge: ImportsEdge): Promise<void> {
    const cypher = `
      MATCH (from:File {path: $fromPath})
      MATCH (to:File {path: $toPath})
      MERGE (from)-[r:IMPORTS]->(to)
      SET r.line = $line,
          r.importedSymbols = $importedSymbols,
          r.alias = $alias
      RETURN r
    `;

    await this.query(cypher, {
      fromPath,
      toPath,
      line: edge.line,
      importedSymbols: edge.importedSymbols,
      alias: edge.alias || ''
    });
  }

  async createDefinesEdge(filePath: string, symbolQualifiedName: string, edge: DefinesEdge): Promise<void> {
    const cypher = `
      MATCH (f:File {path: $filePath})
      MATCH (s:Symbol {qualifiedName: $symbolQualifiedName})
      MERGE (f)-[r:DEFINES]->(s)
      SET r.line = $line
      RETURN r
    `;

    await this.query(cypher, {
      filePath,
      symbolQualifiedName,
      line: edge.line
    });
  }

  async createCallsEdge(fromSymbol: string, toSymbol: string, edge: CallsEdge): Promise<void> {
    const cypher = `
      MATCH (from:Symbol {qualifiedName: $fromSymbol})
      MATCH (to:Symbol {qualifiedName: $toSymbol})
      MERGE (from)-[r:CALLS]->(to)
      SET r.line = $line,
          r.callCount = $callCount,
          r.isConditional = $isConditional
      RETURN r
    `;

    await this.query(cypher, {
      fromSymbol,
      toSymbol,
      ...edge
    });
  }

  async createInheritsEdge(fromSymbol: string, toSymbol: string, edge: InheritsEdge): Promise<void> {
    const cypher = `
      MATCH (from:Symbol {qualifiedName: $fromSymbol})
      MATCH (to:Symbol {qualifiedName: $toSymbol})
      MERGE (from)-[r:INHERITS]->(to)
      SET r.type = $type
      RETURN r
    `;

    await this.query(cypher, {
      fromSymbol,
      toSymbol,
      type: edge.type
    });
  }

  async createModifiesEdge(commitSha: string, filePath: string, edge: ModifiesEdge): Promise<void> {
    const cypher = `
      MATCH (c:Commit {sha: $commitSha})
      MATCH (f:File {path: $filePath})
      MERGE (c)-[r:MODIFIES]->(f)
      SET r.changeType = $changeType,
          r.insertions = $insertions,
          r.deletions = $deletions
      RETURN r
    `;

    await this.query(cypher, {
      commitSha,
      filePath,
      ...edge
    });
  }

  async createTouchesEdge(commitSha: string, symbolQualifiedName: string, edge: TouchesEdge): Promise<void> {
    const cypher = `
      MATCH (c:Commit {sha: $commitSha})
      MATCH (s:Symbol {qualifiedName: $symbolQualifiedName})
      MERGE (c)-[r:TOUCHES]->(s)
      SET r.changeType = $changeType,
          r.lineDelta = $lineDelta
      RETURN r
    `;

    await this.query(cypher, {
      commitSha,
      symbolQualifiedName,
      ...edge
    });
  }

  // ========== Query Operations ==========

  /**
   * Execute a structured graph query (cv-git compatible)
   */
  async executeQuery(query: GraphQuery): Promise<GraphQueryResult[]> {
    switch (query.type) {
      case 'calls':
        return this.getCallees(query.target!);

      case 'calledBy':
        return this.getCallers(query.target!);

      case 'imports':
        return this.getFileDependencies(query.target!);

      case 'importedBy':
        return this.getFileDependents(query.target!);

      case 'defines':
        return this.getFileSymbols(query.target!);

      case 'inherits':
        return this.getInheritance(query.target!);

      case 'path':
        return this.findCallPaths(query.from!, query.to!, query.maxDepth);

      case 'custom':
        return this.query(query.cypher!, query.params);

      default:
        throw new GraphError(`Unknown query type: ${query.type}`);
    }
  }

  async getFileNode(path: string): Promise<FileNode | null> {
    const result = await this.query('MATCH (f:File {path: $path}) RETURN f', { path });
    return result.length > 0 ? result[0].f as FileNode : null;
  }

  async getSymbolNode(qualifiedName: string): Promise<SymbolNode | null> {
    const result = await this.query(
      'MATCH (s:Symbol {qualifiedName: $qualifiedName}) RETURN s',
      { qualifiedName }
    );
    return result.length > 0 ? result[0].s as SymbolNode : null;
  }

  async getFileSymbols(filePath: string): Promise<GraphQueryResult[]> {
    return this.query(
      'MATCH (f:File {path: $filePath})-[:DEFINES]->(s:Symbol) RETURN s',
      { filePath }
    );
  }

  async getCallers(symbolQualifiedName: string): Promise<GraphQueryResult[]> {
    return this.query(
      'MATCH (caller:Symbol)-[:CALLS]->(s:Symbol {qualifiedName: $symbolQualifiedName}) RETURN caller',
      { symbolQualifiedName }
    );
  }

  async getCallees(symbolQualifiedName: string): Promise<GraphQueryResult[]> {
    return this.query(
      'MATCH (s:Symbol {qualifiedName: $symbolQualifiedName})-[:CALLS]->(callee:Symbol) RETURN callee',
      { symbolQualifiedName }
    );
  }

  async getFileDependencies(filePath: string): Promise<GraphQueryResult[]> {
    return this.query(
      'MATCH (f:File {path: $filePath})-[:IMPORTS]->(dep:File) RETURN dep',
      { filePath }
    );
  }

  async getFileDependents(filePath: string): Promise<GraphQueryResult[]> {
    return this.query(
      'MATCH (dependent:File)-[:IMPORTS]->(f:File {path: $filePath}) RETURN dependent',
      { filePath }
    );
  }

  async getInheritance(symbolQualifiedName: string): Promise<GraphQueryResult[]> {
    return this.query(
      'MATCH (s:Symbol {qualifiedName: $symbolQualifiedName})-[:INHERITS]->(parent:Symbol) RETURN parent',
      { symbolQualifiedName }
    );
  }

  async findCallPaths(fromSymbol: string, toSymbol: string, maxDepth = 10): Promise<GraphQueryResult[]> {
    const cypher = `
      MATCH p = (f1:Symbol)-[:CALLS*1..${maxDepth}]->(f2:Symbol)
      WHERE (f1.name = $fromSymbol OR f1.qualifiedName = $fromSymbol)
        AND (f2.name = $toSymbol OR f2.qualifiedName = $toSymbol)
      RETURN [node in nodes(p) | node.name] as path
      LIMIT 100
    `;

    return this.query(cypher, { fromSymbol, toSymbol });
  }

  /**
   * Get symbol usage information
   */
  async getSymbolUsage(qualifiedName: string): Promise<SymbolUsage | null> {
    const symbol = await this.getSymbolNode(qualifiedName);
    if (!symbol) return null;

    const [callersResult, calleesResult] = await Promise.all([
      this.getCallers(qualifiedName),
      this.getCallees(qualifiedName)
    ]);

    return {
      symbol,
      callers: callersResult.map(r => r.caller as SymbolNode),
      callees: calleesResult.map(r => r.callee as SymbolNode),
      callerCount: callersResult.length,
      calleeCount: calleesResult.length
    };
  }

  /**
   * Find dead code (symbols with no callers)
   */
  async findDeadCode(): Promise<SymbolNode[]> {
    const result = await this.query(`
      MATCH (s:Symbol)
      WHERE s.kind IN ['function', 'method']
        AND NOT (s)<-[:CALLS]-(:Symbol)
        AND NOT s.name STARTS WITH '_'
        AND NOT s.name = 'main'
        AND NOT s.name STARTS WITH 'test'
      RETURN s
      ORDER BY s.file, s.startLine
    `);

    return result.map(r => r.s as SymbolNode);
  }

  /**
   * Find complexity hotspots
   */
  async findComplexityHotspots(threshold = 10): Promise<SymbolNode[]> {
    const result = await this.query(`
      MATCH (s:Symbol)
      WHERE s.complexity >= $threshold
      RETURN s
      ORDER BY s.complexity DESC
      LIMIT 50
    `, { threshold });

    return result.map(r => r.s as SymbolNode);
  }

  // ========== Graph Management ==========

  async getStats(): Promise<GraphStats> {
    const [
      fileCount,
      symbolCount,
      functionCount,
      classCount,
      commitCount,
      moduleCount,
      relationshipCount
    ] = await Promise.all([
      this.query('MATCH (f:File) RETURN count(f) as count'),
      this.query('MATCH (s:Symbol) RETURN count(s) as count'),
      this.query('MATCH (f:Function) RETURN count(f) as count'),
      this.query('MATCH (c:Class) RETURN count(c) as count'),
      this.query('MATCH (c:Commit) RETURN count(c) as count'),
      this.query('MATCH (m:Module) RETURN count(m) as count'),
      this.query('MATCH ()-[r]->() RETURN count(r) as count')
    ]);

    return {
      fileCount: fileCount[0]?.count || 0,
      symbolCount: symbolCount[0]?.count || 0,
      functionCount: functionCount[0]?.count || 0,
      classCount: classCount[0]?.count || 0,
      commitCount: commitCount[0]?.count || 0,
      moduleCount: moduleCount[0]?.count || 0,
      relationshipCount: relationshipCount[0]?.count || 0
    };
  }

  async clear(): Promise<void> {
    await this.query('MATCH (n) DETACH DELETE n');
  }

  async deleteFileNode(path: string): Promise<void> {
    // Delete symbols defined in this file first
    await this.query(
      'MATCH (f:File {path: $path})-[:DEFINES]->(s:Symbol) DETACH DELETE s',
      { path }
    );
    // Delete the file node
    await this.query('MATCH (f:File {path: $path}) DETACH DELETE f', { path });
  }
}

// ========== Connection Pool ==========

const graphManagers = new Map<string, GraphManager>();

/**
 * Get or create a GraphManager for a repository
 */
export async function getGraphManager(repositoryId: string): Promise<GraphManager> {
  let manager = graphManagers.get(repositoryId);

  if (!manager) {
    manager = new GraphManager(repositoryId);
    await manager.connect();
    graphManagers.set(repositoryId, manager);
  }

  return manager;
}

/**
 * Close all graph manager connections
 */
export async function closeAllGraphManagers(): Promise<void> {
  for (const manager of graphManagers.values()) {
    await manager.disconnect();
  }
  graphManagers.clear();
}
