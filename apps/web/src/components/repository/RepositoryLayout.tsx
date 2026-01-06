/**
 * RepositoryLayout Component
 * Wraps repository pages with the RepositoryProvider
 */

import type { ReactNode } from 'react';
import { Box, Skeleton, Alert, Button } from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { RepositoryProvider, useRepository } from '../../contexts/RepositoryContext';
import { colors } from '../../theme';

interface RepositoryLayoutProps {
  children: ReactNode;
}

function RepositoryLayoutContent({ children }: RepositoryLayoutProps) {
  const { isLoading, error } = useRepository();

  if (isLoading) {
    return (
      <Box>
        {/* Header skeleton */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Skeleton variant="circular" width={20} height={20} />
            <Skeleton variant="text" width={60} height={24} />
            <Skeleton variant="text" width={10} height={24} />
            <Skeleton variant="text" width={100} height={28} />
            <Skeleton variant="rounded" width={60} height={20} />
          </Box>
          <Skeleton variant="text" width={400} height={20} />
          <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
            <Skeleton variant="rounded" width={100} height={32} />
            <Skeleton variant="rounded" width={80} height={32} />
            <Skeleton variant="rounded" width={100} height={32} />
          </Box>
        </Box>

        {/* Tabs skeleton */}
        <Box sx={{ borderBottom: `1px solid ${colors.navyLighter}`, mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" width={80} height={40} />
            ))}
          </Box>
        </Box>

        {/* Content skeleton */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          <Skeleton variant="rounded" width={280} height={400} />
          <Skeleton variant="rounded" sx={{ flex: 1 }} height={400} />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 8 }}>
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<Refresh />}
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          }
        >
          Failed to load repository: {error}
        </Alert>
      </Box>
    );
  }

  return <>{children}</>;
}

export function RepositoryLayout({ children }: RepositoryLayoutProps) {
  return (
    <RepositoryProvider>
      <RepositoryLayoutContent>{children}</RepositoryLayoutContent>
    </RepositoryProvider>
  );
}

export default RepositoryLayout;
