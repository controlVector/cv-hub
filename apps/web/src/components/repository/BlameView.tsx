/**
 * BlameView Component
 * Shows line-by-line blame information for a file
 */

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Skeleton,
  Tooltip,
  Button,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../theme';
import { getBlame, getBlob } from '../../services/repository';

// Blame line info
interface BlameLine {
  lineNumber: number;
  sha: string;
  author: string;
  date: string;
  content: string;
}

// Generate color from string for consistent author colors
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 50%, 35%)`;
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffYear > 0) return `${diffYear}y ago`;
  if (diffMonth > 0) return `${diffMonth}mo ago`;
  if (diffDay > 0) return `${diffDay}d ago`;
  return 'today';
}

interface BlameViewProps {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

export function BlameView({ owner, repo, ref, path }: BlameViewProps) {
  const navigate = useNavigate();
  const [blameData, setBlameData] = useState<BlameLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filename = path.split('/').pop() || '';

  useEffect(() => {
    async function loadBlame() {
      setIsLoading(true);
      setError(null);

      try {
        // Load blame data and file content
        const [blameResponse, blobResponse] = await Promise.all([
          getBlame(owner, repo, ref, path),
          getBlob(owner, repo, ref, path),
        ]);

        // Parse blame data into lines
        const lines = (blobResponse.content || '').split('\n');
        const blameLines: BlameLine[] = [];

        // The blame API returns chunks with line ranges
        // We'll map each line to its blame info
        if (blameResponse.hunks) {
          let lineIndex = 0;
          for (const hunk of blameResponse.hunks) {
            for (let i = 0; i < hunk.lines; i++) {
              blameLines.push({
                lineNumber: lineIndex + 1,
                sha: hunk.commit?.sha || '',
                author: hunk.commit?.author?.name || 'Unknown',
                date: hunk.commit?.author?.date || '',
                content: lines[lineIndex] || '',
              });
              lineIndex++;
            }
          }
        } else {
          // Fallback: if no blame data, just show file content
          lines.forEach((line, index) => {
            blameLines.push({
              lineNumber: index + 1,
              sha: '',
              author: 'Unknown',
              date: '',
              content: line,
            });
          });
        }

        setBlameData(blameLines);
      } catch (err: any) {
        setError(err.message || 'Failed to load blame');
        console.error('Failed to load blame:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadBlame();
  }, [owner, repo, ref, path]);

  const handleBack = () => {
    navigate(`/repositories/${owner}/${repo}/blob/${ref}/${path}`);
  };

  const handleCommitClick = (sha: string) => {
    if (sha) {
      navigate(`/repositories/${owner}/${repo}/commit/${sha}`);
    }
  };

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={32} sx={{ mb: 2 }} />
        <Box
          sx={{
            backgroundColor: colors.navyLight,
            borderRadius: 2,
            border: `1px solid ${colors.navyLighter}`,
            overflow: 'hidden',
          }}
        >
          {Array.from({ length: 20 }).map((_, i) => (
            <Box key={i} sx={{ display: 'flex', borderBottom: `1px solid ${colors.navyLighter}` }}>
              <Skeleton variant="rectangular" width={200} height={24} />
              <Skeleton variant="text" width="100%" height={24} sx={{ ml: 1 }} />
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ color: colors.coral, mb: 2 }}>
          {error}
        </Typography>
        <Button variant="outlined" onClick={handleBack} startIcon={<ArrowBack />}>
          Go back to file
        </Button>
      </Box>
    );
  }

  // Group consecutive lines by the same commit for visual effect
  let currentSha = '';
  let groupIndex = 0;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Button
          variant="text"
          startIcon={<ArrowBack />}
          onClick={handleBack}
          sx={{ color: colors.textMuted }}
        >
          Back to file
        </Button>
        <Typography variant="h6">
          Blame: {filename}
        </Typography>
      </Box>

      {/* Blame content */}
      <Box
        sx={{
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          lineHeight: 1.6,
        }}
      >
        {blameData.map((line, index) => {
          // Track group changes for alternating background
          if (line.sha !== currentSha) {
            currentSha = line.sha;
            groupIndex++;
          }
          const isAlternate = groupIndex % 2 === 0;

          return (
            <Box
              key={index}
              sx={{
                display: 'flex',
                backgroundColor: isAlternate ? 'transparent' : `${colors.navy}50`,
                '&:hover': {
                  backgroundColor: `${colors.orange}10`,
                },
              }}
            >
              {/* Blame info column */}
              <Box
                sx={{
                  width: 280,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  borderRight: `1px solid ${colors.navyLighter}`,
                  backgroundColor: `${colors.navy}30`,
                }}
              >
                {/* SHA */}
                <Tooltip title={line.sha ? `View commit ${line.sha.slice(0, 7)}` : ''}>
                  <Typography
                    component="span"
                    onClick={() => handleCommitClick(line.sha)}
                    sx={{
                      width: 60,
                      color: line.sha ? colors.blue : colors.textMuted,
                      cursor: line.sha ? 'pointer' : 'default',
                      '&:hover': line.sha ? { textDecoration: 'underline' } : {},
                    }}
                  >
                    {line.sha ? line.sha.slice(0, 7) : ''}
                  </Typography>
                </Tooltip>

                {/* Author */}
                <Typography
                  component="span"
                  sx={{
                    flex: 1,
                    color: stringToColor(line.author),
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {line.author}
                </Typography>

                {/* Date */}
                <Typography
                  component="span"
                  sx={{
                    width: 50,
                    textAlign: 'right',
                    color: colors.textMuted,
                    fontSize: '0.75rem',
                  }}
                >
                  {line.date ? formatRelativeTime(line.date) : ''}
                </Typography>
              </Box>

              {/* Line number */}
              <Box
                sx={{
                  width: 50,
                  px: 1,
                  textAlign: 'right',
                  color: colors.textMuted,
                  userSelect: 'none',
                  borderRight: `1px solid ${colors.navyLighter}`,
                }}
              >
                {line.lineNumber}
              </Box>

              {/* Code content */}
              <Box
                sx={{
                  flex: 1,
                  px: 1,
                  whiteSpace: 'pre',
                  color: colors.textLight,
                  overflow: 'hidden',
                }}
              >
                {line.content || ' '}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default BlameView;
