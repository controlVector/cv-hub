/**
 * BreadcrumbPath Component
 * File path navigation with clickable segments
 */

import { Box, Breadcrumbs, Link, IconButton, Tooltip } from '@mui/material';
import { ContentCopy, Folder } from '@mui/icons-material';
import { colors } from '../../theme';

interface BreadcrumbPathProps {
  repoName: string;
  path: string | null;
  onNavigate: (path: string) => void;
}

export function BreadcrumbPath({ repoName, path, onNavigate }: BreadcrumbPathProps) {
  const pathParts = path ? path.split('/').filter(Boolean) : [];

  const handleCopy = () => {
    if (path) {
      navigator.clipboard.writeText(path);
    }
  };

  const handleNavigateToRoot = () => {
    onNavigate('');
  };

  const handleNavigateToPart = (index: number) => {
    const targetPath = pathParts.slice(0, index + 1).join('/');
    onNavigate(targetPath);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Breadcrumbs
        separator="/"
        sx={{
          '& .MuiBreadcrumbs-separator': {
            color: colors.textMuted,
            mx: 0.5,
          },
        }}
      >
        {/* Repository root */}
        <Link
          component="button"
          underline="hover"
          onClick={handleNavigateToRoot}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            color: pathParts.length === 0 ? colors.textLight : colors.textMuted,
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            cursor: 'pointer',
            '&:hover': {
              color: colors.orange,
            },
          }}
        >
          <Folder sx={{ fontSize: 16 }} />
          {repoName}
        </Link>

        {/* Path segments */}
        {pathParts.map((part, index) => {
          const isLast = index === pathParts.length - 1;

          return (
            <Link
              key={index}
              component="button"
              underline={isLast ? 'none' : 'hover'}
              onClick={() => !isLast && handleNavigateToPart(index)}
              sx={{
                color: isLast ? colors.textLight : colors.textMuted,
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                cursor: isLast ? 'default' : 'pointer',
                fontWeight: isLast ? 600 : 400,
                '&:hover': {
                  color: isLast ? colors.textLight : colors.orange,
                },
              }}
            >
              {part}
            </Link>
          );
        })}
      </Breadcrumbs>

      {/* Copy path button */}
      {path && (
        <Tooltip title="Copy file path">
          <IconButton
            size="small"
            onClick={handleCopy}
            sx={{
              ml: 1,
              color: colors.textMuted,
              '&:hover': {
                color: colors.orange,
              },
            }}
          >
            <ContentCopy sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

export default BreadcrumbPath;
