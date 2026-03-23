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
  SessionKnowledgeNode,
  AboutEdge,
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
  VizNode,
  VizEdge,
  VizData,
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

      // SessionKnowledge indexes
      ['SessionKnowledge', 'sessionId'],
      ['SessionKnowledge', 'timestamp'],
      ['SessionKnowledge', 'repoId'],
      ['SessionKnowledge', 'orgId'],
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
          f.summary = $summary,
          f.updatedAt = $updatedAt
      RETURN f
    `;

    await this.query(cypher, {
      ...file,
      summary: file.summary || null,
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
          s.summary = $summary,
          s.updatedAt = $updatedAt
      RETURN s
    `;

    await this.query(cypher, {
      ...symbol,
      signature: symbol.signature || '',
      docstring: symbol.docstring || '',
      returnType: symbol.returnType || '',
      vectorId: symbol.vectorId || '',
      summary: symbol.summary || '',
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

  // ========== SessionKnowledge Operations ==========

  async upsertSessionKnowledgeNode(sk: SessionKnowledgeNode): Promise<void> {
    const cypher = `
      MERGE (sk:SessionKnowledge {sessionId: $sessionId, turnNumber: $turnNumber})
      SET sk.timestamp = $timestamp,
          sk.summary = $summary,
          sk.concern = $concern,
          sk.source = $source,
          sk.filesTouched = $filesTouched,
          sk.symbolsReferenced = $symbolsReferenced,
          sk.repoId = $repoId,
          sk.orgId = $orgId,
          sk.updatedAt = $updatedAt
      RETURN sk
    `;

    await this.query(cypher, {
      ...sk,
      repoId: sk.repoId || null,
      orgId: sk.orgId || null,
      updatedAt: Date.now(),
    });
  }

  async createAboutFileEdge(
    sessionId: string,
    turnNumber: number,
    filePath: string,
    edge: AboutEdge,
  ): Promise<void> {
    const cypher = `
      MATCH (sk:SessionKnowledge {sessionId: $sessionId, turnNumber: $turnNumber})
      MATCH (f:File {path: $filePath})
      MERGE (sk)-[r:ABOUT]->(f)
      SET r.role = $role
      RETURN r
    `;

    await this.query(cypher, { sessionId, turnNumber, filePath, role: edge.role });
  }

  async createAboutSymbolEdge(
    sessionId: string,
    turnNumber: number,
    qualifiedName: string,
    edge: AboutEdge,
  ): Promise<void> {
    const cypher = `
      MATCH (sk:SessionKnowledge {sessionId: $sessionId, turnNumber: $turnNumber})
      MATCH (s:Symbol {qualifiedName: $qualifiedName})
      MERGE (sk)-[r:ABOUT]->(s)
      SET r.role = $role
      RETURN r
    `;

    await this.query(cypher, { sessionId, turnNumber, qualifiedName, role: edge.role });
  }

  async createFollowsEdge(
    sessionId: string,
    currentTurn: number,
    previousTurn: number,
  ): Promise<void> {
    const cypher = `
      MATCH (curr:SessionKnowledge {sessionId: $sessionId, turnNumber: $currentTurn})
      MATCH (prev:SessionKnowledge {sessionId: $sessionId, turnNumber: $previousTurn})
      MERGE (curr)-[r:FOLLOWS]->(prev)
      RETURN r
    `;

    await this.query(cypher, { sessionId, currentTurn, previousTurn });
  }

  async getSessionKnowledgeNode(
    sessionId: string,
    turnNumber: number,
  ): Promise<SessionKnowledgeNode | null> {
    const result = await this.query(
      `MATCH (sk:SessionKnowledge {sessionId: $sessionId, turnNumber: $turnNumber})
       RETURN sk.sessionId AS sessionId, sk.turnNumber AS turnNumber,
              sk.timestamp AS timestamp, sk.summary AS summary,
              sk.concern AS concern, sk.source AS source,
              sk.filesTouched AS filesTouched, sk.symbolsReferenced AS symbolsReferenced,
              sk.repoId AS repoId, sk.orgId AS orgId`,
      { sessionId, turnNumber },
    );
    if (result.length === 0) return null;
    const r = result[0] as any;
    return {
      sessionId: r.sessionId,
      turnNumber: r.turnNumber,
      timestamp: r.timestamp,
      summary: r.summary || '',
      concern: r.concern || '',
      source: r.source || '',
      filesTouched: r.filesTouched || [],
      symbolsReferenced: r.symbolsReferenced || [],
      repoId: r.repoId || undefined,
      orgId: r.orgId || undefined,
    };
  }

  /**
   * Find SessionKnowledge nodes whose filesTouched overlap with given paths
   */
  async getSessionKnowledgeByFiles(
    filePaths: string[],
    excludeSessionId?: string | null,
    limit = 10,
  ): Promise<SessionKnowledgeNode[]> {
    if (filePaths.length === 0) return [];

    const excludeClause = excludeSessionId
      ? 'AND sk.sessionId <> $excludeSessionId'
      : '';

    const results = await this.query(
      `MATCH (sk:SessionKnowledge)
       WHERE ANY(f IN sk.filesTouched WHERE f IN $filePaths)
         ${excludeClause}
       RETURN sk.sessionId AS sessionId, sk.turnNumber AS turnNumber,
              sk.timestamp AS timestamp, sk.summary AS summary,
              sk.concern AS concern, sk.source AS source,
              sk.filesTouched AS filesTouched, sk.symbolsReferenced AS symbolsReferenced,
              sk.repoId AS repoId, sk.orgId AS orgId
       ORDER BY sk.timestamp DESC
       LIMIT $limit`,
      { filePaths, excludeSessionId: excludeSessionId || '', limit },
    );

    return results.map((r: any) => ({
      sessionId: r.sessionId || '',
      turnNumber: r.turnNumber || 0,
      timestamp: r.timestamp || 0,
      summary: r.summary || '',
      concern: r.concern || '',
      source: r.source || '',
      filesTouched: r.filesTouched || [],
      symbolsReferenced: r.symbolsReferenced || [],
      repoId: r.repoId || undefined,
      orgId: r.orgId || undefined,
    }));
  }

  /**
   * Find SessionKnowledge nodes whose symbolsReferenced overlap with given names
   */
  async getSessionKnowledgeBySymbols(
    qualifiedNames: string[],
    excludeSessionId?: string | null,
    limit = 10,
  ): Promise<SessionKnowledgeNode[]> {
    if (qualifiedNames.length === 0) return [];

    const excludeClause = excludeSessionId
      ? 'AND sk.sessionId <> $excludeSessionId'
      : '';

    const results = await this.query(
      `MATCH (sk:SessionKnowledge)
       WHERE ANY(s IN sk.symbolsReferenced WHERE s IN $qualifiedNames)
         ${excludeClause}
       RETURN sk.sessionId AS sessionId, sk.turnNumber AS turnNumber,
              sk.timestamp AS timestamp, sk.summary AS summary,
              sk.concern AS concern, sk.source AS source,
              sk.filesTouched AS filesTouched, sk.symbolsReferenced AS symbolsReferenced,
              sk.repoId AS repoId, sk.orgId AS orgId
       ORDER BY sk.timestamp DESC
       LIMIT $limit`,
      { qualifiedNames, excludeSessionId: excludeSessionId || '', limit },
    );

    return results.map((r: any) => ({
      sessionId: r.sessionId || '',
      turnNumber: r.turnNumber || 0,
      timestamp: r.timestamp || 0,
      summary: r.summary || '',
      concern: r.concern || '',
      source: r.source || '',
      filesTouched: r.filesTouched || [],
      symbolsReferenced: r.symbolsReferenced || [],
      repoId: r.repoId || undefined,
      orgId: r.orgId || undefined,
    }));
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

  // ========== Visualization Queries ==========

  /**
   * Get file dependency graph (File -[IMPORTS]-> File)
   */
  async getFileDependencyGraph(limit = 300): Promise<VizData> {
    const nodeResults = await this.query(`
      MATCH (a:File)-[:IMPORTS]->(b:File)
      WITH collect(DISTINCT a) + collect(DISTINCT b) AS allNodes
      UNWIND allNodes AS f
      WITH DISTINCT f
      RETURN f.path AS path, f.language AS language, f.complexity AS complexity,
             f.linesOfCode AS linesOfCode, f.summary AS summary
      LIMIT $limit
    `, { limit });

    const edgeResults = await this.query(`
      MATCH (a:File)-[r:IMPORTS]->(b:File)
      RETURN a.path AS source, b.path AS target
      LIMIT $limit
    `, { limit: limit * 2 });

    const nodes: VizNode[] = nodeResults.map((r: any) => ({
      id: r.path,
      label: r.path?.split('/').pop() || r.path,
      type: 'file' as const,
      path: r.path,
      complexity: r.complexity || 0,
      linesOfCode: r.linesOfCode || 0,
      language: r.language,
      summary: r.summary,
    }));

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges: VizEdge[] = edgeResults
      .filter((r: any) => nodeIds.has(r.source) && nodeIds.has(r.target))
      .map((r: any) => ({
        source: r.source,
        target: r.target,
        type: 'IMPORTS' as const,
      }));

    return {
      nodes,
      edges,
      meta: {
        viewType: 'dependencies',
        nodeCount: nodes.length,
        edgeCount: edges.length,
        truncated: nodeResults.length >= limit,
      },
    };
  }

  /**
   * Get call graph (Symbol -[CALLS]-> Symbol)
   */
  async getCallGraph(symbol?: string, depth = 2): Promise<VizData> {
    let nodeResults: GraphQueryResult[];
    let edgeResults: GraphQueryResult[];

    if (symbol) {
      // Focused call graph from a specific symbol
      nodeResults = await this.query(`
        MATCH p=(s:Symbol)-[:CALLS*0..${Math.min(depth, 5)}]->(t:Symbol)
        WHERE s.qualifiedName = $symbol OR s.name = $symbol
        UNWIND nodes(p) AS n
        WITH DISTINCT n
        RETURN n.qualifiedName AS id, n.name AS name, n.kind AS kind,
               n.file AS file, n.complexity AS complexity, n.summary AS summary
        LIMIT 200
      `, { symbol });

      edgeResults = await this.query(`
        MATCH p=(s:Symbol)-[:CALLS*1..${Math.min(depth, 5)}]->(t:Symbol)
        WHERE s.qualifiedName = $symbol OR s.name = $symbol
        UNWIND relationships(p) AS r
        WITH DISTINCT startNode(r) AS a, endNode(r) AS b, r
        RETURN a.qualifiedName AS source, b.qualifiedName AS target, r.callCount AS weight
        LIMIT 500
      `, { symbol });
    } else {
      // General call graph
      nodeResults = await this.query(`
        MATCH (s:Symbol)-[:CALLS]->(t:Symbol)
        WITH collect(DISTINCT s) + collect(DISTINCT t) AS allNodes
        UNWIND allNodes AS n
        WITH DISTINCT n
        RETURN n.qualifiedName AS id, n.name AS name, n.kind AS kind,
               n.file AS file, n.complexity AS complexity, n.summary AS summary
        LIMIT 200
      `);

      edgeResults = await this.query(`
        MATCH (a:Symbol)-[r:CALLS]->(b:Symbol)
        RETURN a.qualifiedName AS source, b.qualifiedName AS target, r.callCount AS weight
        LIMIT 500
      `);
    }

    const nodes: VizNode[] = nodeResults.map((r: any) => ({
      id: r.id,
      label: r.name || r.id?.split(':').pop() || 'unknown',
      type: 'symbol' as const,
      kind: r.kind,
      path: r.file,
      complexity: r.complexity || 0,
      summary: r.summary,
    }));

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges: VizEdge[] = edgeResults
      .filter((r: any) => nodeIds.has(r.source) && nodeIds.has(r.target))
      .map((r: any) => ({
        source: r.source,
        target: r.target,
        type: 'CALLS' as const,
        weight: r.weight || 1,
      }));

    return {
      nodes,
      edges,
      meta: {
        viewType: 'calls',
        nodeCount: nodes.length,
        edgeCount: edges.length,
        truncated: nodeResults.length >= 200,
      },
    };
  }

  /**
   * Get module hierarchy (Module -[CONTAINS]-> File)
   */
  async getModuleHierarchy(): Promise<VizData> {
    const moduleResults = await this.query(`
      MATCH (m:Module)
      RETURN m.path AS path, m.name AS name, m.fileCount AS fileCount,
             m.symbolCount AS symbolCount, m.language AS language
      LIMIT 200
    `);

    const fileResults = await this.query(`
      MATCH (m:Module)-[:CONTAINS]->(f:File)
      RETURN m.path AS modulePath, f.path AS filePath, f.language AS language,
             f.complexity AS complexity, f.linesOfCode AS linesOfCode
      LIMIT 500
    `);

    const nodes: VizNode[] = [];
    const nodeIds = new Set<string>();

    // Add module nodes
    for (const r of moduleResults) {
      const id = `module:${r.path}`;
      nodes.push({
        id,
        label: r.name || r.path,
        type: 'module',
        path: r.path as string,
        language: r.language as string,
      });
      nodeIds.add(id);
    }

    // Add file nodes from relationships
    for (const r of fileResults) {
      const id = `file:${r.filePath}`;
      if (!nodeIds.has(id)) {
        nodes.push({
          id,
          label: (r.filePath as string)?.split('/').pop() || r.filePath as string,
          type: 'file',
          path: r.filePath as string,
          language: r.language as string,
          complexity: (r.complexity as number) || 0,
          linesOfCode: (r.linesOfCode as number) || 0,
        });
        nodeIds.add(id);
      }
    }

    const edges: VizEdge[] = fileResults
      .filter((r: any) => nodeIds.has(`module:${r.modulePath}`) && nodeIds.has(`file:${r.filePath}`))
      .map((r: any) => ({
        source: `module:${r.modulePath}`,
        target: `file:${r.filePath}`,
        type: 'CONTAINS' as const,
      }));

    return {
      nodes,
      edges,
      meta: {
        viewType: 'modules',
        nodeCount: nodes.length,
        edgeCount: edges.length,
        truncated: moduleResults.length >= 200,
      },
    };
  }

  /**
   * Get complexity heatmap data
   */
  async getComplexityHeatmap(type: 'file' | 'symbol' = 'file', threshold = 0): Promise<VizData> {
    let results: GraphQueryResult[];

    if (type === 'file') {
      results = await this.query(`
        MATCH (f:File)
        WHERE f.complexity >= $threshold
        RETURN f.path AS path, f.language AS language, f.complexity AS complexity,
               f.linesOfCode AS linesOfCode, f.summary AS summary,
               f.lastModifiedCommit AS lastModifiedCommit,
               f.lastModifiedTimestamp AS lastModifiedTimestamp,
               f.modificationCount AS modificationCount
        ORDER BY f.complexity DESC
        LIMIT 200
      `, { threshold });
    } else {
      results = await this.query(`
        MATCH (s:Symbol)
        WHERE s.complexity >= $threshold
        RETURN s.qualifiedName AS id, s.name AS name, s.kind AS kind,
               s.file AS path, s.complexity AS complexity, s.summary AS summary,
               s.lastModifiedCommit AS lastModifiedCommit,
               s.lastModifiedTimestamp AS lastModifiedTimestamp,
               s.modificationCount AS modificationCount
        ORDER BY s.complexity DESC
        LIMIT 200
      `, { threshold });
    }

    const nodes: VizNode[] = results.map((r: any) => ({
      id: type === 'file' ? r.path : r.id,
      label: type === 'file'
        ? (r.path?.split('/').pop() || r.path)
        : (r.name || r.id),
      type: type === 'file' ? 'file' as const : 'symbol' as const,
      kind: r.kind,
      path: r.path,
      complexity: r.complexity || 0,
      linesOfCode: r.linesOfCode || 0,
      language: r.language,
      summary: r.summary,
      lastModifiedCommit: r.lastModifiedCommit,
      lastModifiedTimestamp: r.lastModifiedTimestamp,
      modificationCount: r.modificationCount,
    }));

    return {
      nodes,
      edges: [],
      meta: {
        viewType: 'complexity',
        nodeCount: nodes.length,
        edgeCount: 0,
        truncated: results.length >= 200,
      },
    };
  }

  /**
   * Get heatmap data by metric (recency, frequency, churn)
   */
  async getHeatmapByMetric(metric: 'recency' | 'frequency' | 'churn'): Promise<VizData> {
    let orderField: string;
    switch (metric) {
      case 'recency':
        orderField = 'f.lastModifiedTimestamp DESC';
        break;
      case 'frequency':
        orderField = 'f.modificationCount DESC';
        break;
      case 'churn':
        orderField = 'f.modificationCount DESC';
        break;
      default:
        throw new GraphError(`Unknown heatmap metric: ${metric}`);
    }

    const results = await this.query(`
      MATCH (f:File)
      WHERE f.modificationCount IS NOT NULL AND f.modificationCount > 0
      RETURN f.path AS path, f.language AS language, f.complexity AS complexity,
             f.linesOfCode AS linesOfCode,
             f.lastModifiedCommit AS lastModifiedCommit,
             f.lastModifiedTimestamp AS lastModifiedTimestamp,
             f.modificationCount AS modificationCount
      ORDER BY ${orderField}
      LIMIT 200
    `);

    const nodes: VizNode[] = results.map((r: any) => ({
      id: r.path,
      label: r.path?.split('/').pop() || r.path,
      type: 'file' as const,
      path: r.path,
      complexity: r.complexity || 0,
      linesOfCode: r.linesOfCode || 0,
      language: r.language,
      lastModifiedCommit: r.lastModifiedCommit,
      lastModifiedTimestamp: r.lastModifiedTimestamp,
      modificationCount: r.modificationCount,
    }));

    return {
      nodes,
      edges: [],
      meta: {
        viewType: 'heatmap',
        nodeCount: nodes.length,
        edgeCount: 0,
        truncated: results.length >= 200,
      },
    };
  }

  /**
   * Get file timeline (commits that modified a file via MODIFIES edges)
   */
  async getFileTimeline(filePath: string, limit = 20): Promise<GraphQueryResult[]> {
    return this.query(`
      MATCH (c:Commit)-[r:MODIFIES]->(f:File {path: $filePath})
      RETURN c.sha AS sha, c.message AS message, c.author AS author,
             c.timestamp AS timestamp, r.changeType AS changeType,
             r.insertions AS insertions, r.deletions AS deletions
      ORDER BY c.timestamp DESC
      LIMIT $limit
    `, { filePath, limit });
  }

  /**
   * Get symbol timeline (commits that touched a symbol via TOUCHES edges)
   */
  async getSymbolTimeline(qualifiedName: string, limit = 20): Promise<GraphQueryResult[]> {
    return this.query(`
      MATCH (c:Commit)-[r:TOUCHES]->(s:Symbol {qualifiedName: $qualifiedName})
      RETURN c.sha AS sha, c.message AS message, c.author AS author,
             c.timestamp AS timestamp, r.changeType AS changeType,
             r.lineDelta AS lineDelta
      ORDER BY c.timestamp DESC
      LIMIT $limit
    `, { qualifiedName, limit });
  }

  /**
   * Get impact analysis for a symbol (callers + co-change history)
   */
  async getImpactAnalysis(qualifiedName: string, depth = 2): Promise<{
    callers: GraphQueryResult[];
    coChanged: GraphQueryResult[];
  }> {
    // Who calls this symbol
    const callers = await this.query(`
      MATCH p=(caller:Symbol)-[:CALLS*1..${Math.min(depth, 3)}]->(s:Symbol {qualifiedName: $qualifiedName})
      UNWIND nodes(p) AS n
      WITH DISTINCT n
      WHERE n.qualifiedName <> $qualifiedName
      RETURN n.qualifiedName AS qualifiedName, n.name AS name, n.kind AS kind,
             n.file AS file, n.complexity AS complexity
      LIMIT 50
    `, { qualifiedName });

    // What usually changes together (co-change via shared commits)
    const coChanged = await this.query(`
      MATCH (c:Commit)-[:TOUCHES]->(s:Symbol {qualifiedName: $qualifiedName})
      MATCH (c)-[:TOUCHES]->(other:Symbol)
      WHERE other.qualifiedName <> $qualifiedName
      WITH other, count(c) AS coChangeCount
      WHERE coChangeCount >= 2
      RETURN other.qualifiedName AS qualifiedName, other.name AS name,
             other.kind AS kind, other.file AS file, coChangeCount
      ORDER BY coChangeCount DESC
      LIMIT 20
    `, { qualifiedName });

    return { callers, coChanged };
  }

  // ========== Bandit State Persistence ==========

  /**
   * Save bandit state to the graph for cross-session learning.
   */
  async saveBanditState(state: { arms: Record<string, any>; alpha: number; dimension: number }): Promise<void> {
    const json = JSON.stringify(state);
    await this.query(`
      MERGE (b:BanditState {id: 'contextual-bandit'})
      SET b.data = $data, b.updatedAt = $ts
    `, { data: json, ts: new Date().toISOString() });
  }

  /**
   * Load bandit state from the graph. Returns null if no saved state.
   */
  async loadBanditState(): Promise<{ arms: Record<string, any>; alpha: number; dimension: number } | null> {
    const results = await this.query(`
      MATCH (b:BanditState {id: 'contextual-bandit'})
      RETURN b.data as data
    `);

    if (results.length === 0 || !results[0].data) return null;
    return JSON.parse(results[0].data as string);
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
      sessionKnowledgeCount,
      relationshipCount
    ] = await Promise.all([
      this.query('MATCH (f:File) RETURN count(f) as count'),
      this.query('MATCH (s:Symbol) RETURN count(s) as count'),
      this.query('MATCH (f:Function) RETURN count(f) as count'),
      this.query('MATCH (c:Class) RETURN count(c) as count'),
      this.query('MATCH (c:Commit) RETURN count(c) as count'),
      this.query('MATCH (m:Module) RETURN count(m) as count'),
      this.query('MATCH (sk:SessionKnowledge) RETURN count(sk) as count'),
      this.query('MATCH ()-[r]->() RETURN count(r) as count')
    ]);

    return {
      fileCount: fileCount[0]?.count || 0,
      symbolCount: symbolCount[0]?.count || 0,
      functionCount: functionCount[0]?.count || 0,
      classCount: classCount[0]?.count || 0,
      commitCount: commitCount[0]?.count || 0,
      moduleCount: moduleCount[0]?.count || 0,
      sessionKnowledgeCount: sessionKnowledgeCount[0]?.count || 0,
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
