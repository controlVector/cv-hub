/**
 * AI Assistant Service
 * RAG-powered code assistant using OpenRouter LLMs
 *
 * Retrieves relevant context from:
 * - Qdrant (semantic search when available)
 * - FalkorDB (graph queries for structure)
 *
 * Then generates responses using an LLM.
 */

import { env } from '../config/env';
import { brand } from '../config/brand';
import {
  isEmbeddingServiceAvailable,
  generateEmbedding,
} from './embedding.service';
import {
  isVectorServiceAvailable,
  searchVectors,
} from './vector.service';
import { getGraphManager } from './graph';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AssistantContext {
  type: 'semantic' | 'graph' | 'combined';
  snippets: {
    filePath: string;
    content: string;
    language: string;
    startLine?: number;
    endLine?: number;
    score?: number;
    symbolName?: string;
    symbolKind?: string;
  }[];
  graphData?: {
    symbols: any[];
    relationships: any[];
  };
}

export interface AssistantResponse {
  message: string;
  context: AssistantContext;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Default model for assistant
const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

/**
 * Check if assistant service is available
 */
export function isAssistantServiceAvailable(): boolean {
  return !!env.OPENROUTER_API_KEY;
}

/**
 * Retrieve relevant context for a query
 */
export async function retrieveContext(
  repositoryId: string,
  query: string,
  options: {
    limit?: number;
    includeGraph?: boolean;
  } = {}
): Promise<AssistantContext> {
  const { limit = 5, includeGraph = true } = options;
  const snippets: AssistantContext['snippets'] = [];
  let contextType: AssistantContext['type'] = 'graph';
  let graphData: AssistantContext['graphData'] | undefined;

  // Try semantic search first
  const embeddingAvailable = isEmbeddingServiceAvailable();
  const vectorAvailable = await isVectorServiceAvailable();

  if (embeddingAvailable && vectorAvailable) {
    try {
      const { embedding } = await generateEmbedding(query);
      const results = await searchVectors(repositoryId, embedding, {
        limit,
        scoreThreshold: 0.3,
      });

      for (const result of results) {
        snippets.push({
          filePath: result.payload.filePath,
          content: result.payload.content,
          language: result.payload.language,
          startLine: result.payload.startLine,
          endLine: result.payload.endLine,
          score: result.score,
          symbolName: result.payload.symbolName,
          symbolKind: result.payload.symbolKind,
        });
      }

      contextType = 'semantic';
    } catch (error) {
      console.warn('[Assistant] Semantic search failed:', error);
    }
  }

  // Add graph context if requested
  if (includeGraph) {
    try {
      const graph = await getGraphManager(repositoryId);

      // Search for relevant symbols
      const symbolResults = await graph.query(`
        MATCH (s:Symbol)
        WHERE s.name CONTAINS $query OR s.qualifiedName CONTAINS $query
        RETURN s
        LIMIT 10
      `, { query });

      const symbols = symbolResults.map((r: any) => r.s);

      // Get relationships for found symbols
      const relationships: any[] = [];
      if (symbols.length > 0) {
        const symbolNames = symbols.map((s: any) => s.qualifiedName || s.name);
        const relResults = await graph.query(`
          MATCH (a:Symbol)-[r]->(b:Symbol)
          WHERE a.qualifiedName IN $names OR b.qualifiedName IN $names
          RETURN a.name AS from, type(r) AS rel, b.name AS to
          LIMIT 20
        `, { names: symbolNames });

        for (const r of relResults) {
          relationships.push({
            from: r.from,
            type: r.rel,
            to: r.to,
          });
        }
      }

      graphData = { symbols, relationships };

      // If no semantic snippets, try to add file content from graph
      if (snippets.length === 0 && symbols.length > 0) {
        for (const symbol of symbols.slice(0, limit)) {
          if (symbol.file) {
            snippets.push({
              filePath: symbol.file,
              content: symbol.signature || `${symbol.kind} ${symbol.name}`,
              language: symbol.language || 'unknown',
              startLine: symbol.startLine,
              endLine: symbol.endLine,
              symbolName: symbol.name,
              symbolKind: symbol.kind,
            });
          }
        }
      }

      if (contextType === 'semantic') {
        contextType = 'combined';
      }
    } catch (error) {
      console.warn('[Assistant] Graph search failed:', error);
    }
  }

  return {
    type: contextType,
    snippets,
    graphData,
  };
}

/**
 * Build the system prompt with context
 */
function buildSystemPrompt(context: AssistantContext, commandType?: string): string {
  let prompt = `You are an intelligent code assistant for ${brand.appName}. You help developers understand, navigate, and work with their codebase.

You have access to the following context from the repository's knowledge graph and code search:
`;

  // Add context snippets
  if (context.snippets.length > 0) {
    prompt += '\n## Relevant Code Snippets\n\n';
    for (const snippet of context.snippets) {
      const location = snippet.startLine
        ? `${snippet.filePath}:${snippet.startLine}-${snippet.endLine || snippet.startLine}`
        : snippet.filePath;

      prompt += `### ${location}`;
      if (snippet.symbolName) {
        prompt += ` (${snippet.symbolKind}: ${snippet.symbolName})`;
      }
      if (snippet.score) {
        prompt += ` [relevance: ${Math.round(snippet.score * 100)}%]`;
      }
      prompt += '\n```' + (snippet.language || '') + '\n';
      prompt += snippet.content;
      prompt += '\n```\n\n';
    }
  }

  // Add graph context
  if (context.graphData?.symbols.length) {
    prompt += '\n## Code Structure (from Knowledge Graph)\n\n';
    prompt += 'Symbols found:\n';
    for (const symbol of context.graphData.symbols.slice(0, 10)) {
      prompt += `- ${symbol.kind}: ${symbol.qualifiedName || symbol.name}`;
      if (symbol.file) prompt += ` (${symbol.file})`;
      prompt += '\n';
    }

    if (context.graphData.relationships.length > 0) {
      prompt += '\nRelationships:\n';
      for (const rel of context.graphData.relationships.slice(0, 10)) {
        prompt += `- ${rel.from} --[${rel.type}]--> ${rel.to}\n`;
      }
    }
  }

  // Add command-specific instructions
  if (commandType) {
    prompt += '\n## Your Task\n\n';
    switch (commandType) {
      case 'explain':
        prompt += 'Explain the code thoroughly. Cover what it does, how it works, and any important patterns or considerations. Use the context provided to give accurate, specific answers.';
        break;
      case 'find':
        prompt += 'Help find relevant code based on the query. Present the search results clearly with file paths, line numbers, and brief explanations of what each result contains.';
        break;
      case 'review':
        prompt += 'Provide a code review focusing on: potential bugs, security issues, performance concerns, code quality, and best practices. Be constructive and specific.';
        break;
      case 'do':
        prompt += 'Create a detailed implementation plan. Break down the task into steps, identify files to create/modify, and provide code examples where helpful.';
        break;
      case 'graph':
        prompt += 'Answer questions about code structure using the knowledge graph. Explain relationships between components, call hierarchies, and dependencies.';
        break;
    }
  }

  prompt += `

## Guidelines
- Be concise but thorough
- Reference specific files and line numbers when relevant
- Use code examples when helpful
- If the context doesn't contain enough information to answer, say so clearly
- Format responses in markdown for readability`;

  return prompt;
}

/**
 * Chat with the AI assistant
 */
export async function chat(
  repositoryId: string,
  messages: ChatMessage[],
  options: {
    commandType?: string;
    model?: string;
    maxTokens?: number;
  } = {}
): Promise<AssistantResponse> {
  const { commandType, model = DEFAULT_MODEL, maxTokens = 2000 } = options;

  if (!env.OPENROUTER_API_KEY) {
    throw new Error('Assistant service not configured. Set OPENROUTER_API_KEY.');
  }

  // Get the last user message for context retrieval
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found');
  }

  // Retrieve context
  const context = await retrieveContext(repositoryId, lastUserMessage.content, {
    limit: 5,
    includeGraph: true,
  });

  // Build system prompt with context
  const systemPrompt = buildSystemPrompt(context, commandType);

  // Prepare messages for API
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  // Call OpenRouter
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.APP_URL,
      'X-Title': brand.appName,
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Assistant] OpenRouter error:', errorText);
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  const assistantMessage = data.choices[0]?.message?.content || 'No response generated.';

  return {
    message: assistantMessage,
    context,
    model: data.model || model,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/**
 * Quick query without message history
 */
export async function query(
  repositoryId: string,
  question: string,
  options: {
    commandType?: string;
    model?: string;
  } = {}
): Promise<AssistantResponse> {
  return chat(repositoryId, [{ role: 'user', content: question }], options);
}
