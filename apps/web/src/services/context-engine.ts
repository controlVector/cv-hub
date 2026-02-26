/**
 * Context Engine Service
 * API client for context engine UI pages
 */

import { api } from '../lib/api';
import type { VizData } from './repository';

// Types

export interface CESession {
  sessionId: string;
  userId: string;
  activeConcern: string;
  lastTurnCount: number;
  lastTokenEst: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface CESessionsResponse {
  sessions: CESession[];
  pagination: { limit: number; offset: number; total: number };
}

export interface CETimelineTurn {
  turnNumber: number;
  timestamp: number;
  summary: string;
  concern: string;
  filesTouched: string[];
  symbolsReferenced: string[];
}

export interface CESessionTimeline {
  sessionId: string;
  turns: CETimelineTurn[];
}

export interface CEKnowledgeNode {
  sessionId: string;
  turnNumber: number;
  timestamp: number;
  summary: string;
  concern: string;
  filesTouched: string[];
  symbolsReferenced: string[];
}

export interface CEKnowledgeResponse {
  knowledge: CEKnowledgeNode[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}

export interface CEStats {
  totalSessions: number;
  activeSessions: number;
  totalKnowledgeNodes: number;
  totalAboutEdges: number;
  totalFollowsEdges: number;
  topFiles: Array<{ file: string; mentions: number }>;
}

// Global (cross-repo) types

export interface CEGlobalStats {
  totalSessions: number;
  activeSessions: number;
  totalKnowledgeNodes: number;
  totalAboutEdges: number;
  totalFollowsEdges: number;
  repoCount: number;
}

export interface CEGlobalSession {
  sessionId: string;
  repositoryId: string;
  repoName: string;
  repoSlug: string;
  repoOwner: string;
  activeConcern: string;
  lastTurnCount: number;
  lastTokenEst: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface CEGlobalSessionsResponse {
  sessions: CEGlobalSession[];
  pagination: { limit: number; offset: number; total: number };
}

export interface CEHealth {
  graph: {
    connected: boolean;
    latencyMs: number;
  };
  skNodeCount: number;
  lastEgressTimestamp: number | null;
  hooksInstalled: boolean;
  activeSessions: number;
}

// API Functions

export async function getContextEngineHealth(
  owner: string,
  repo: string,
): Promise<CEHealth> {
  const response = await api.get(
    `/v1/repos/${owner}/${repo}/context-engine/health`,
  );
  return response.data.data;
}

export async function getContextEngineSessions(
  owner: string,
  repo: string,
  params?: { limit?: number; offset?: number },
): Promise<CESessionsResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const response = await api.get(
    `/v1/repos/${owner}/${repo}/context-engine/sessions?${query.toString()}`,
  );
  return response.data.data;
}

export async function getSessionTimeline(
  owner: string,
  repo: string,
  sessionId: string,
): Promise<CESessionTimeline> {
  const response = await api.get(
    `/v1/repos/${owner}/${repo}/context-engine/sessions/${encodeURIComponent(sessionId)}/timeline`,
  );
  return response.data.data;
}

export async function getKnowledgeFeed(
  owner: string,
  repo: string,
  params?: { concern?: string; file?: string; limit?: number; offset?: number },
): Promise<CEKnowledgeResponse> {
  const query = new URLSearchParams();
  if (params?.concern) query.set('concern', params.concern);
  if (params?.file) query.set('file', params.file);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const response = await api.get(
    `/v1/repos/${owner}/${repo}/context-engine/knowledge?${query.toString()}`,
  );
  return response.data.data;
}

export async function getContextEngineStats(
  owner: string,
  repo: string,
): Promise<CEStats> {
  const response = await api.get(
    `/v1/repos/${owner}/${repo}/context-engine/stats`,
  );
  return response.data.data;
}

export async function getContextEngineGraphData(
  owner: string,
  repo: string,
  params?: { limit?: number },
): Promise<VizData> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', params.limit.toString());
  const response = await api.get(
    `/v1/repos/${owner}/${repo}/context-engine/graph-data?${query.toString()}`,
  );
  return response.data.data;
}

// Global (cross-repo) API Functions

export async function getGlobalContextEngineStats(): Promise<CEGlobalStats> {
  const response = await api.get('/v1/context-engine/stats');
  return response.data.data;
}

export async function getGlobalContextEngineSessions(
  params?: { limit?: number; offset?: number },
): Promise<CEGlobalSessionsResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const response = await api.get(`/v1/context-engine/sessions?${query.toString()}`);
  return response.data.data;
}
