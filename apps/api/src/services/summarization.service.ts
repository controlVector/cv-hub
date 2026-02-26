/**
 * Summarization Service
 * AI-powered summaries at 3 levels: repository, file, symbol
 * Uses credit system for platform key, free for BYOK
 */

import { env } from '../config/env';
import { brand } from '../config/brand';
import { db } from '../db';
import { repositorySummaries, repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { GraphManager } from './graph/graph.service';

const SUMMARY_MODEL = 'anthropic/claude-3.5-sonnet';

interface SummarizeOptions {
  orgId?: string;
  apiKey?: string; // BYOK key (already decrypted)
  jobId?: string;
}

/**
 * Resolve the API key and billing for summarization
 * Returns null if no key/credits are available (skip silently)
 */
async function resolveApiKey(orgId?: string): Promise<{
  apiKey: string;
  isBYOK: boolean;
} | null> {
  // Check org BYOK first
  if (orgId) {
    try {
      const { organizationEmbeddingConfig } = await import('../db/schema');
      const orgConfig = await db.query.organizationEmbeddingConfig?.findFirst({
        where: eq(organizationEmbeddingConfig.organizationId, orgId),
      });

      if (orgConfig?.apiKeyEncrypted) {
        try {
          // We have an encrypted key — the org has BYOK
          // The key is already in the DB; we need to decrypt it
          // Use the same decryption logic as embedding service
          const crypto = await import('crypto');
          const keySource = env.MFA_ENCRYPTION_KEY;
          const key = crypto.createHash('sha256').update(keySource).digest();
          const data = Buffer.from(orgConfig.apiKeyEncrypted, 'base64');
          const iv = data.subarray(0, 12);
          const authTag = data.subarray(12, 28);
          const ciphertext = data.subarray(28);
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
          decipher.setAuthTag(authTag);
          const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
          return { apiKey: decrypted.toString('utf8'), isBYOK: true };
        } catch {
          // Decryption failed, fall through
        }
      }
    } catch {
      // Tables may not exist yet
    }

    // Check credits for platform key usage
    try {
      const { hasCreditsOrBYOK } = await import('./credit.service');
      const hasAccess = await hasCreditsOrBYOK(orgId);
      if (!hasAccess) {
        console.log('[Summarization] No credits or BYOK for org', orgId);
        return null;
      }
    } catch {
      // Credit tables may not exist
    }
  }

  // Fall back to platform key
  if (env.OPENROUTER_API_KEY) {
    return { apiKey: env.OPENROUTER_API_KEY, isBYOK: false };
  }

  return null;
}

/**
 * Call LLM for summarization
 */
async function callLLM(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.APP_URL,
      'X-Title': brand.appName || 'CV-Hub',
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (!data.choices?.length) {
    throw new Error('No choices in LLM response');
  }

  return {
    content: data.choices[0]?.message?.content || '',
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
  };
}

// Delay helper for rate limiting between LLM batches
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Generate and save repository-level summary
 */
export async function summarizeRepository(
  repositoryId: string,
  repoInfo: { owner: string; name: string; language?: string },
  graphStats: { fileCount: number; symbolCount: number; functionCount: number; classCount: number },
  topFiles: Array<{ path: string; complexity: number; linesOfCode: number }>,
  topSymbols: Array<{ name: string; kind: string; complexity: number; file: string }>,
  options: SummarizeOptions = {},
): Promise<void> {
  const keyInfo = await resolveApiKey(options.orgId);
  if (!keyInfo) {
    console.log('[Summarization] Skipping repo summary — no API key/credits');
    return;
  }

  const systemPrompt = `You are a code architecture analyst. Generate a concise summary of a code repository based on its knowledge graph stats and top files/symbols.

Output JSON with these fields:
- summary: 2-3 sentence overview of what this project does and how it's structured
- technologies: array of key technologies/frameworks used
- entryPoints: array of main entry point files
- keyPatterns: array of architectural patterns observed (e.g. "MVC", "event-driven", "microservices")

Output ONLY valid JSON, no markdown fences.`;

  const userPrompt = `Repository: ${repoInfo.owner}/${repoInfo.name}
Stats: ${graphStats.fileCount} files, ${graphStats.symbolCount} symbols, ${graphStats.functionCount} functions, ${graphStats.classCount} classes

Top files by complexity:
${topFiles.slice(0, 20).map(f => `- ${f.path} (complexity: ${f.complexity}, LOC: ${f.linesOfCode})`).join('\n')}

Top symbols by complexity:
${topSymbols.slice(0, 20).map(s => `- ${s.kind} ${s.name} in ${s.file} (complexity: ${s.complexity})`).join('\n')}`;

  try {
    const result = await callLLM(keyInfo.apiKey, systemPrompt, userPrompt);

    // Parse JSON response
    let parsed: any;
    try {
      // Strip markdown fences if present
      const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        summary: result.content,
        technologies: [],
        entryPoints: [],
        keyPatterns: [],
      };
    }

    // Upsert to database
    const existing = await db.query.repositorySummaries?.findFirst({
      where: eq(repositorySummaries.repositoryId, repositoryId),
    });

    if (existing) {
      await db.update(repositorySummaries)
        .set({
          summary: parsed.summary || result.content,
          technologies: parsed.technologies || [],
          entryPoints: parsed.entryPoints || [],
          keyPatterns: parsed.keyPatterns || [],
          model: SUMMARY_MODEL,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          graphSyncJobId: options.jobId || null,
          updatedAt: new Date(),
        })
        .where(eq(repositorySummaries.id, existing.id));
    } else {
      await db.insert(repositorySummaries).values({
        repositoryId,
        summary: parsed.summary || result.content,
        technologies: parsed.technologies || [],
        entryPoints: parsed.entryPoints || [],
        keyPatterns: parsed.keyPatterns || [],
        model: SUMMARY_MODEL,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        graphSyncJobId: options.jobId || null,
      });
    }

    // Deduct credits for platform key (proportional to tokens)
    if (!keyInfo.isBYOK && options.orgId) {
      try {
        const { deductCredits, calculateCreditCost } = await import('./credit.service');
        const totalTokens = result.promptTokens + result.completionTokens;
        const cost = calculateCreditCost('summarization', totalTokens);
        await deductCredits(options.orgId, cost, `Repo summary: ${repositoryId}`, { tokensUsed: totalTokens });
      } catch (err) {
        console.warn('[Summarization] Credit deduction failed:', err instanceof Error ? err.message : err);
      }
    }

    console.log('[Summarization] Repository summary saved');
  } catch (error: any) {
    console.error('[Summarization] Failed to generate repo summary:', error.message);
  }
}

/**
 * Batch-generate file summaries and store in FalkorDB
 */
export async function summarizeFiles(
  graph: GraphManager,
  files: Array<{ path: string; language: string; linesOfCode: number; symbols?: string[] }>,
  options: SummarizeOptions = {},
): Promise<number> {
  const keyInfo = await resolveApiKey(options.orgId);
  if (!keyInfo) {
    console.log('[Summarization] Skipping file summaries — no API key/credits');
    return 0;
  }

  let summarized = 0;
  const batchSize = 10;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    const systemPrompt = `You are a code analyst. For each file listed, provide a one-sentence summary of what it does. Output a JSON array of objects with "path" and "summary" fields. Output ONLY valid JSON, no markdown fences.`;

    const userPrompt = batch.map(f =>
      `- ${f.path} (${f.language}, ${f.linesOfCode} LOC${f.symbols?.length ? `, symbols: ${f.symbols.join(', ')}` : ''})`
    ).join('\n');

    try {
      const result = await callLLM(keyInfo.apiKey, systemPrompt, userPrompt);

      let summaries: Array<{ path: string; summary: string }>;
      try {
        const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        summaries = JSON.parse(cleaned);
      } catch {
        continue;
      }

      // Update FalkorDB nodes
      for (const s of summaries) {
        try {
          await graph.query(
            `MATCH (f:File {path: $path}) SET f.summary = $summary`,
            { path: s.path, summary: s.summary }
          );
          summarized++;
        } catch {
          // Node might not exist
        }
      }

      // Deduct credits for platform key (proportional to tokens)
      if (!keyInfo.isBYOK && options.orgId) {
        try {
          const { deductCredits, calculateCreditCost } = await import('./credit.service');
          const totalTokens = result.promptTokens + result.completionTokens;
          const cost = calculateCreditCost('summarization', totalTokens);
          await deductCredits(options.orgId, cost, `File summaries batch: ${i / batchSize + 1}`, { tokensUsed: totalTokens });
        } catch (err) {
          console.warn('[Summarization] Credit deduction failed:', err instanceof Error ? err.message : err);
        }
      }
    } catch (error: any) {
      console.error(`[Summarization] File batch failed: ${error.message}`);
    }

    // Rate limit between batches
    if (i + batchSize < files.length) {
      await delay(500);
    }
  }

  console.log(`[Summarization] Summarized ${summarized} files`);
  return summarized;
}

/**
 * Batch-generate symbol summaries and store in FalkorDB
 */
export async function summarizeSymbols(
  graph: GraphManager,
  symbols: Array<{ qualifiedName: string; name: string; kind: string; file: string; signature?: string }>,
  options: SummarizeOptions = {},
): Promise<number> {
  const keyInfo = await resolveApiKey(options.orgId);
  if (!keyInfo) {
    console.log('[Summarization] Skipping symbol summaries — no API key/credits');
    return 0;
  }

  let summarized = 0;
  const batchSize = 20;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);

    const systemPrompt = `You are a code analyst. For each code symbol listed, provide a one-sentence summary of its purpose. Output a JSON array of objects with "qualifiedName" and "summary" fields. Output ONLY valid JSON, no markdown fences.`;

    const userPrompt = batch.map(s =>
      `- ${s.kind} ${s.qualifiedName} in ${s.file}${s.signature ? ` — ${s.signature}` : ''}`
    ).join('\n');

    try {
      const result = await callLLM(keyInfo.apiKey, systemPrompt, userPrompt);

      let summaries: Array<{ qualifiedName: string; summary: string }>;
      try {
        const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        summaries = JSON.parse(cleaned);
      } catch {
        continue;
      }

      // Update FalkorDB nodes
      for (const s of summaries) {
        try {
          await graph.query(
            `MATCH (s:Symbol {qualifiedName: $qualifiedName}) SET s.summary = $summary`,
            { qualifiedName: s.qualifiedName, summary: s.summary }
          );
          summarized++;
        } catch {
          // Node might not exist
        }
      }

      // Deduct credits for platform key (proportional to tokens)
      if (!keyInfo.isBYOK && options.orgId) {
        try {
          const { deductCredits, calculateCreditCost } = await import('./credit.service');
          const totalTokens = result.promptTokens + result.completionTokens;
          const cost = calculateCreditCost('summarization', totalTokens);
          await deductCredits(options.orgId, cost, `Symbol summaries batch: ${i / batchSize + 1}`, { tokensUsed: totalTokens });
        } catch (err) {
          console.warn('[Summarization] Credit deduction failed:', err instanceof Error ? err.message : err);
        }
      }
    } catch (error: any) {
      console.error(`[Summarization] Symbol batch failed: ${error.message}`);
    }

    // Rate limit between batches
    if (i + batchSize < symbols.length) {
      await delay(500);
    }
  }

  console.log(`[Summarization] Summarized ${summarized} symbols`);
  return summarized;
}

/**
 * Get repository summary from database
 */
export async function getRepositorySummary(repositoryId: string) {
  try {
    return await db.query.repositorySummaries?.findFirst({
      where: eq(repositorySummaries.repositoryId, repositoryId),
    }) || null;
  } catch {
    return null;
  }
}

/**
 * Run full summarization pipeline during graph sync
 * Step 5.5: between embeddings and finalize
 */
export async function syncSummaries(
  repositoryId: string,
  graph: GraphManager,
  ownerSlug: string,
  repoSlug: string,
  branch: string,
  orgId?: string,
  jobId?: string,
): Promise<{ filesSummarized: number; symbolsSummarized: number }> {
  console.log('[Summarization] Starting summary generation...');

  const options: SummarizeOptions = { orgId, jobId };

  // 1. Get graph stats
  const stats = await graph.getStats();

  // 2. Get top files by complexity
  const topFileResults = await graph.query(`
    MATCH (f:File)
    WHERE f.complexity > 0
    RETURN f.path AS path, f.complexity AS complexity, f.linesOfCode AS linesOfCode, f.language AS language
    ORDER BY f.complexity DESC
    LIMIT 20
  `);
  const topFiles = topFileResults.map((r: any) => ({
    path: r.path,
    complexity: r.complexity || 0,
    linesOfCode: r.linesOfCode || 0,
    language: r.language || 'unknown',
  }));

  // 3. Get top symbols by complexity
  const topSymbolResults = await graph.query(`
    MATCH (s:Symbol)
    WHERE s.complexity > 0
    RETURN s.qualifiedName AS qualifiedName, s.name AS name, s.kind AS kind,
           s.file AS file, s.complexity AS complexity, s.signature AS signature
    ORDER BY s.complexity DESC
    LIMIT 20
  `);
  const topSymbols = topSymbolResults.map((r: any) => ({
    qualifiedName: r.qualifiedName,
    name: r.name,
    kind: r.kind,
    file: r.file,
    complexity: r.complexity || 0,
    signature: r.signature,
  }));

  // 4. Generate repo summary
  await summarizeRepository(repositoryId, { owner: ownerSlug, name: repoSlug }, stats, topFiles, topSymbols, options);

  // 5. Get all files for summarization (those without summary)
  const filesToSummarize = await graph.query(`
    MATCH (f:File)
    WHERE (f.summary IS NULL OR f.summary = '') AND f.linesOfCode > 0
    RETURN f.path AS path, f.language AS language, f.linesOfCode AS linesOfCode
    ORDER BY f.complexity DESC
    LIMIT 100
  `);

  const filesSummarized = await summarizeFiles(
    graph,
    filesToSummarize.map((r: any) => ({
      path: r.path,
      language: r.language || 'unknown',
      linesOfCode: r.linesOfCode || 0,
    })),
    options,
  );

  // 6. Get symbols for summarization (those without summary)
  const symbolsToSummarize = await graph.query(`
    MATCH (s:Symbol)
    WHERE (s.summary IS NULL OR s.summary = '') AND s.complexity > 0
    RETURN s.qualifiedName AS qualifiedName, s.name AS name, s.kind AS kind,
           s.file AS file, s.signature AS signature
    ORDER BY s.complexity DESC
    LIMIT 100
  `);

  const symbolsSummarized = await summarizeSymbols(
    graph,
    symbolsToSummarize.map((r: any) => ({
      qualifiedName: r.qualifiedName,
      name: r.name,
      kind: r.kind,
      file: r.file,
      signature: r.signature,
    })),
    options,
  );

  console.log(`[Summarization] Done: ${filesSummarized} files, ${symbolsSummarized} symbols summarized`);
  return { filesSummarized, symbolsSummarized };
}
