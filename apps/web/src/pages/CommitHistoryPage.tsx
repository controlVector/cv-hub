/**
 * CommitHistoryPage
 * Displays commit history for a repository branch
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { colors } from '../theme';
import { getCommits, type CommitInfo } from '../services/repository';
import { CommitHistory, BranchSelector } from '../components/repository';

export default function CommitHistoryPage() {
  const navigate = useNavigate();
  const params = useParams<{ owner: string; repo: string; '*': string }>();

  const owner = params.owner || '';
  const repo = params.repo || '';

  // Parse ref from wildcard path (commits/:ref)
  const wildcardPath = params['*'] || '';
  const initialRef = wildcardPath.replace('commits/', '') || 'main';

  const [currentRef, setCurrentRef] = useState(initialRef);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const loadCommits = useCallback(async (ref: string, reset = false) => {
    setIsLoading(true);

    try {
      const limit = 30;
      const data = await getCommits(owner, repo, { ref, limit: limit + 1 });

      const newCommits = data.commits.slice(0, limit);
      setHasMore(data.commits.length > limit);

      if (reset) {
        setCommits(newCommits);
        setPage(1);
      } else {
        setCommits((prev) => [...prev, ...newCommits]);
      }
    } catch (err) {
      console.error('Failed to load commits:', err);
    } finally {
      setIsLoading(false);
    }
  }, [owner, repo, page]);

  useEffect(() => {
    loadCommits(currentRef, true);
  }, [currentRef]);

  const handleRefChange = (ref: string) => {
    setCurrentRef(ref);
    navigate(`/repositories/${owner}/${repo}/commits/${ref}`);
  };

  const handleLoadMore = () => {
    setPage((p) => p + 1);
    loadCommits(currentRef, false);
  };

  const handleBack = () => {
    navigate(`/repositories/${owner}/${repo}`);
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="text"
            startIcon={<ArrowBack />}
            onClick={handleBack}
            sx={{ color: colors.textMuted }}
          >
            Back
          </Button>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Commits
          </Typography>
        </Box>

        <BranchSelector
          currentRef={currentRef}
          branches={[]} // TODO: Load branches
          tags={[]}
          onSelect={handleRefChange}
        />
      </Box>

      {/* Commit list */}
      <CommitHistory
        commits={commits}
        owner={owner}
        repo={repo}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
      />
    </Box>
  );
}
