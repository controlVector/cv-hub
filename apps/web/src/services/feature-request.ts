/**
 * Feature Request Service
 *
 * Handles communication between cv-hub and cv-prd for feature requests.
 */

import { api } from '../lib/api';
import type {
  FeatureRequest,
  FeatureRequestInput,
  FeatureRequestCreateResponse,
  FeatureRequestListResponse,
} from '../types/feature-request';

// cv-prd API base URL (configured via environment or proxy)
const CV_PRD_API = import.meta.env.VITE_CV_PRD_API_URL || '/api/prd';

/**
 * Submit a new feature request to cv-prd
 */
export async function submitFeatureRequest(
  userId: string,
  userName: string,
  userEmail: string,
  input: FeatureRequestInput
): Promise<FeatureRequestCreateResponse> {
  const externalId = `cvhub-${userId}-${Date.now()}`;

  const response = await api.post<FeatureRequestCreateResponse>(`${CV_PRD_API}/requests`, {
    external_id: externalId,
    requester_id: userId,
    requester_name: userName,
    requester_email: userEmail,
    source: 'cv-hub',
    title: input.title,
    problem_statement: input.problemStatement,
    proposed_solution: input.proposedSolution,
    success_criteria: input.successCriteria,
    additional_context: input.additionalContext,
  });

  return response.data;
}

/**
 * Get a feature request by ID
 */
export async function getFeatureRequest(requestId: string): Promise<FeatureRequest> {
  const response = await api.get<FeatureRequest>(`${CV_PRD_API}/requests/${requestId}`);
  return response.data;
}

/**
 * Get a feature request by external ID (cv-hub reference)
 */
export async function getFeatureRequestByExternalId(externalId: string): Promise<FeatureRequest> {
  const response = await api.get<FeatureRequest>(
    `${CV_PRD_API}/requests/by-external-id/${externalId}`
  );
  return response.data;
}

/**
 * List feature requests for the current user
 */
export async function listMyFeatureRequests(
  userId: string,
  page: number = 1,
  pageSize: number = 10
): Promise<FeatureRequestListResponse> {
  const response = await api.get<FeatureRequestListResponse>(`${CV_PRD_API}/requests`, {
    params: {
      requester_id: userId,
      page,
      page_size: pageSize,
    },
  });
  return response.data;
}

/**
 * List all feature requests (for reviewers)
 */
export async function listAllFeatureRequests(
  status?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<FeatureRequestListResponse> {
  const response = await api.get<FeatureRequestListResponse>(`${CV_PRD_API}/requests`, {
    params: {
      status,
      page,
      page_size: pageSize,
    },
  });
  return response.data;
}
