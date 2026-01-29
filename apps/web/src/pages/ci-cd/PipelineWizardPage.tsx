/**
 * PipelineWizardPage
 * Page wrapper for the pipeline creation wizard
 */

import { Box, Breadcrumbs, Link, Typography } from '@mui/material';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { colors } from '../../theme';
import { PipelineWizard } from '../../components/ci-cd/PipelineWizard';

export function PipelineWizardPage() {
  const navigate = useNavigate();
  const { owner, repo } = useParams<{ owner: string; repo: string }>();

  const handleComplete = () => {
    // Navigate back to repository actions tab
    navigate(`/repositories/${owner}/${repo}`, { state: { tab: 3 } });
  };

  const handleCancel = () => {
    navigate(`/repositories/${owner}/${repo}`, { state: { tab: 3 } });
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', py: 3 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link
          component={RouterLink}
          to={`/repositories/${owner}/${repo}`}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          {owner}/{repo}
        </Link>
        <Link
          component={RouterLink}
          to={`/repositories/${owner}/${repo}`}
          state={{ tab: 3 }}
          sx={{ color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.violet } }}
        >
          Actions
        </Link>
        <Typography sx={{ color: colors.textLight }}>New Pipeline</Typography>
      </Breadcrumbs>

      <PipelineWizard
        owner={owner!}
        repo={repo!}
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </Box>
  );
}

export default PipelineWizardPage;
