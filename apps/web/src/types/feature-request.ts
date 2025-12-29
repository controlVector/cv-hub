/**
 * Feature Request Types for cv-hub ↔ cv-prd integration
 */

export type RequestStatus =
  | 'raw'
  | 'under_review'
  | 'accepted'
  | 'rejected'
  | 'merged'
  | 'elaborating'
  | 'ready'
  | 'in_progress'
  | 'shipped';

export type RequestType =
  | 'feature'
  | 'enhancement'
  | 'bug'
  | 'change'
  | 'integration'
  | 'usability';

export interface FeatureRequestInput {
  title: string;
  problemStatement: string;
  proposedSolution?: string;
  successCriteria?: string;
  additionalContext?: string;
}

export interface AIAnalysis {
  summary: string;
  request_type: RequestType;
  category: string;
  priority_suggestion: string;
  tags: string[];
  similar_requests: SimilarRequest[];
  related_prds: RelatedPRD[];
  prd_skeleton?: PRDSkeleton;
}

export interface SimilarRequest {
  id: string;
  title: string;
  status: RequestStatus;
  similarity_score: number;
}

export interface RelatedPRD {
  id: string;
  name: string;
  relevance_score: number;
}

export interface PRDSkeleton {
  name: string;
  description: string;
  sections: PRDSkeletonSection[];
}

export interface PRDSkeletonSection {
  title: string;
  suggested_content: string;
  priority: string;
}

export interface FeatureRequest {
  id: string;
  external_id: string;
  requester_id: string;
  requester_name?: string;
  source: string;
  title: string;
  problem_statement: string;
  proposed_solution?: string;
  success_criteria?: string;
  additional_context?: string;
  request_type?: RequestType;
  category?: string;
  tags: string[];
  status: RequestStatus;
  priority?: string;
  reviewer_id?: string;
  reviewer_notes?: string;
  rejection_reason?: string;
  prd_id?: string;
  merged_into_id?: string;
  created_at?: string;
  updated_at?: string;
  triaged_at?: string;
  accepted_at?: string;
  shipped_at?: string;
  ai_summary?: string;
  priority_suggestion?: string;
  similar_requests?: SimilarRequest[];
  related_prds?: RelatedPRD[];
  prd_skeleton?: PRDSkeleton;
}

export interface FeatureRequestCreateResponse {
  id: string;
  external_id: string;
  status: RequestStatus;
  ai_analysis?: AIAnalysis;
}

export interface FeatureRequestListResponse {
  requests: FeatureRequest[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

// Status display helpers
export const STATUS_LABELS: Record<RequestStatus, string> = {
  raw: 'Submitted',
  under_review: 'Under Review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  merged: 'Merged',
  elaborating: 'Being Elaborated',
  ready: 'Ready for Implementation',
  in_progress: 'In Progress',
  shipped: 'Shipped',
};

export const STATUS_COLORS: Record<RequestStatus, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  raw: 'default',
  under_review: 'info',
  accepted: 'primary',
  rejected: 'error',
  merged: 'secondary',
  elaborating: 'warning',
  ready: 'success',
  in_progress: 'warning',
  shipped: 'success',
};
