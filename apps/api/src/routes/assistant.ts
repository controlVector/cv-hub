/**
 * AI Assistant Routes
 * RAG-powered code assistant endpoints
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { db } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { canUserAccessRepo } from '../services/repository.service';
import {
  isAssistantServiceAvailable,
  chat,
  query,
  retrieveContext,
} from '../services/assistant.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const assistantRoutes = new Hono<AppEnv>();

// ============================================================================
// Status
// ============================================================================

/**
 * GET /api/v1/assistant/status
 * Check if assistant is available
 */
assistantRoutes.get('/assistant/status', async (c) => {
  const available = isAssistantServiceAvailable();

  return c.json({
    available,
    reason: available ? 'configured' : 'OPENROUTER_API_KEY not set',
    features: {
      chat: available,
      contextRetrieval: true,
      semanticSearch: available,
    },
  });
});

// ============================================================================
// Chat
// ============================================================================

/**
 * POST /api/v1/assistant/chat
 * Chat with the AI assistant about a repository
 */
const chatSchema = z.object({
  repositoryId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(10000),
  })).min(1).max(50),
  commandType: z.enum(['explain', 'find', 'review', 'do', 'graph']).optional(),
  model: z.string().optional(),
});

assistantRoutes.post('/assistant/chat', optionalAuth, zValidator('json', chatSchema), async (c) => {
  const { repositoryId, messages, commandType, model } = c.req.valid('json');
  const userId = c.get('userId');

  // Verify repository access
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  });

  if (!repo) {
    throw new NotFoundError('Repository not found');
  }

  const canAccess = await canUserAccessRepo(repositoryId, userId || null);
  if (!canAccess) {
    throw new ForbiddenError('You do not have access to this repository');
  }

  // Check if assistant is available
  if (!isAssistantServiceAvailable()) {
    return c.json({
      error: 'Assistant not available',
      reason: 'OPENROUTER_API_KEY not configured',
      message: null,
    }, 503);
  }

  try {
    const response = await chat(repositoryId, messages, {
      commandType,
      model,
    });

    return c.json({
      message: response.message,
      context: {
        type: response.context.type,
        snippetCount: response.context.snippets.length,
        snippets: response.context.snippets.map(s => ({
          filePath: s.filePath,
          language: s.language,
          startLine: s.startLine,
          endLine: s.endLine,
          symbolName: s.symbolName,
          symbolKind: s.symbolKind,
          score: s.score,
        })),
      },
      model: response.model,
      usage: response.usage,
    });
  } catch (error: any) {
    console.error('[Assistant] Chat error:', error);
    return c.json({
      error: 'Chat failed',
      reason: error.message,
      message: null,
    }, 500);
  }
});

// ============================================================================
// Quick Query
// ============================================================================

/**
 * POST /api/v1/assistant/query
 * Quick single-turn query
 */
const querySchema = z.object({
  repositoryId: z.string().uuid(),
  question: z.string().min(1).max(5000),
  commandType: z.enum(['explain', 'find', 'review', 'do', 'graph']).optional(),
});

assistantRoutes.post('/assistant/query', optionalAuth, zValidator('json', querySchema), async (c) => {
  const { repositoryId, question, commandType } = c.req.valid('json');
  const userId = c.get('userId');

  // Verify repository access
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  });

  if (!repo) {
    throw new NotFoundError('Repository not found');
  }

  const canAccess = await canUserAccessRepo(repositoryId, userId || null);
  if (!canAccess) {
    throw new ForbiddenError('You do not have access to this repository');
  }

  if (!isAssistantServiceAvailable()) {
    return c.json({
      error: 'Assistant not available',
      reason: 'OPENROUTER_API_KEY not configured',
    }, 503);
  }

  try {
    const response = await query(repositoryId, question, { commandType });

    return c.json({
      answer: response.message,
      context: {
        type: response.context.type,
        snippetCount: response.context.snippets.length,
      },
      model: response.model,
      usage: response.usage,
    });
  } catch (error: any) {
    console.error('[Assistant] Query error:', error);
    return c.json({
      error: 'Query failed',
      reason: error.message,
    }, 500);
  }
});

// ============================================================================
// Context Preview
// ============================================================================

/**
 * POST /api/v1/assistant/context
 * Preview what context would be retrieved for a query (without calling LLM)
 */
const contextSchema = z.object({
  repositoryId: z.string().uuid(),
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(20).optional(),
});

assistantRoutes.post('/assistant/context', optionalAuth, zValidator('json', contextSchema), async (c) => {
  const { repositoryId, query: queryText, limit = 5 } = c.req.valid('json');
  const userId = c.get('userId');

  // Verify repository access
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  });

  if (!repo) {
    throw new NotFoundError('Repository not found');
  }

  const canAccess = await canUserAccessRepo(repositoryId, userId || null);
  if (!canAccess) {
    throw new ForbiddenError('You do not have access to this repository');
  }

  try {
    const context = await retrieveContext(repositoryId, queryText, {
      limit,
      includeGraph: true,
    });

    return c.json({
      type: context.type,
      snippets: context.snippets,
      graphData: context.graphData ? {
        symbolCount: context.graphData.symbols.length,
        relationshipCount: context.graphData.relationships.length,
        symbols: context.graphData.symbols.slice(0, 10),
        relationships: context.graphData.relationships.slice(0, 10),
      } : null,
    });
  } catch (error: any) {
    console.error('[Assistant] Context retrieval error:', error);
    return c.json({
      error: 'Context retrieval failed',
      reason: error.message,
    }, 500);
  }
});

export default assistantRoutes;
