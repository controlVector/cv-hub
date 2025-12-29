import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
  LinearProgress,
  Collapse,
} from '@mui/material';
import {
  Search as SearchIcon,
  Code,
  InsertDriveFile,
  Functions,
  History,
  CallMerge as PRIcon,
  AutoAwesome as AIIcon,
  ExpandMore,
  ExpandLess,
  ContentCopy,
  OpenInNew,
} from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { colors } from '../theme';

interface SearchResult {
  id: string;
  type: 'code' | 'file' | 'symbol' | 'commit' | 'pr';
  score: number;
  repository: string;
  path?: string;
  line?: number;
  content?: string;
  highlight?: string;
  title?: string;
  language?: string;
}

const mockResults: SearchResult[] = [
  {
    id: '1',
    type: 'code',
    score: 0.95,
    repository: 'team/cv-git',
    path: 'src/auth/service.ts',
    line: 45,
    language: 'typescript',
    content: `export async function authenticateUser(
  credentials: UserCredentials
): Promise<AuthResult> {
  const user = await userRepository.findByEmail(credentials.email);

  if (!user || !await verifyPassword(credentials.password, user.passwordHash)) {
    throw new AuthenticationError('Invalid credentials');
  }

  return generateAuthTokens(user);
}`,
    highlight: 'Main authentication function that validates user credentials',
  },
  {
    id: '2',
    type: 'code',
    score: 0.89,
    repository: 'team/cv-git',
    path: 'src/middleware/auth.ts',
    line: 12,
    language: 'typescript',
    content: `export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}`,
    highlight: 'Authentication middleware for protecting routes',
  },
  {
    id: '3',
    type: 'symbol',
    score: 0.85,
    repository: 'team/cv-git',
    path: 'src/auth/tokens.ts',
    line: 23,
    language: 'typescript',
    title: 'generateAuthTokens',
    content: `export function generateAuthTokens(user: User): AuthTokens {
  const accessToken = signToken({ userId: user.id }, ACCESS_TOKEN_SECRET, '15m');
  const refreshToken = signToken({ userId: user.id }, REFRESH_TOKEN_SECRET, '7d');
  return { accessToken, refreshToken };
}`,
    highlight: 'Function that generates JWT access and refresh tokens',
  },
  {
    id: '4',
    type: 'file',
    score: 0.78,
    repository: 'team/api-service',
    path: 'internal/auth/handler.go',
    language: 'go',
    title: 'Authentication Handler',
    highlight: 'Go implementation of authentication endpoints',
  },
  {
    id: '5',
    type: 'commit',
    score: 0.72,
    repository: 'team/cv-git',
    title: 'feat: implement OAuth2 authentication flow',
    content: 'Added OAuth2 support for GitHub and Google providers',
    highlight: 'Commit from 3 days ago by developer@example.com',
  },
  {
    id: '6',
    type: 'pr',
    score: 0.68,
    repository: 'team/cv-git',
    title: 'PR #38: Add two-factor authentication',
    content: 'Implements TOTP-based 2FA for enhanced security',
    highlight: 'Open PR with 5 files changed',
  },
];

const getResultIcon = (type: string) => {
  switch (type) {
    case 'code':
      return <Code />;
    case 'file':
      return <InsertDriveFile />;
    case 'symbol':
      return <Functions />;
    case 'commit':
      return <History />;
    case 'pr':
      return <PRIcon />;
    default:
      return <Code />;
  }
};

const getResultTypeColor = (type: string) => {
  switch (type) {
    case 'code':
      return colors.orange;
    case 'file':
      return colors.blue;
    case 'symbol':
      return colors.purple;
    case 'commit':
      return colors.green;
    case 'pr':
      return colors.coral;
    default:
      return colors.textMuted;
  }
};

export default function Search() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>(initialQuery ? mockResults : []);
  const [tabValue, setTabValue] = useState(0);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set(['1', '2']));

  const handleSearch = () => {
    if (!query.trim()) return;
    setIsSearching(true);
    // Simulate search
    setTimeout(() => {
      setResults(mockResults);
      setIsSearching(false);
    }, 800);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedResults);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedResults(newExpanded);
  };

  const filteredResults = results.filter((r) => {
    if (tabValue === 0) return true;
    if (tabValue === 1) return r.type === 'code';
    if (tabValue === 2) return r.type === 'file';
    if (tabValue === 3) return r.type === 'symbol';
    if (tabValue === 4) return r.type === 'commit' || r.type === 'pr';
    return true;
  });

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Search
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textMuted }}>
          Semantic code search powered by AI embeddings
        </Typography>
      </Box>

      {/* Search Box */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
              }}
            >
              <AIIcon sx={{ color: colors.navy }} />
            </Box>
            <TextField
              fullWidth
              placeholder="Search using natural language... (e.g., 'authentication logic' or 'database connection handling')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: colors.textMuted }} />
                  </InputAdornment>
                ),
              }}
            />
            <Box
              onClick={handleSearch}
              sx={{
                px: 4,
                py: 1.5,
                borderRadius: 2,
                background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
                color: colors.navy,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-1px)',
                  boxShadow: `0 4px 15px ${colors.amberGlow}`,
                },
              }}
            >
              Search
            </Box>
          </Box>

          {/* Search Tips */}
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              Try:
            </Typography>
            {['authentication flow', 'error handling', 'API endpoints', 'database queries'].map((tip) => (
              <Chip
                key={tip}
                label={tip}
                size="small"
                onClick={() => setQuery(tip)}
                sx={{
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: `${colors.orange}20` },
                }}
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* Loading */}
      {isSearching && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ color: colors.textMuted, mb: 1 }}>
            Searching across all repositories using semantic embeddings...
          </Typography>
          <LinearProgress
            sx={{
              borderRadius: 2,
              backgroundColor: colors.navyLighter,
              '& .MuiLinearProgress-bar': {
                background: `linear-gradient(90deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
              },
            }}
          />
        </Box>
      )}

      {/* Results */}
      {results.length > 0 && !isSearching && (
        <>
          {/* Result Tabs */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
              <Tab
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    All
                    <Chip label={results.length} size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
                  </Box>
                }
              />
              <Tab
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Code sx={{ fontSize: 16 }} />
                    Code
                  </Box>
                }
              />
              <Tab
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <InsertDriveFile sx={{ fontSize: 16 }} />
                    Files
                  </Box>
                }
              />
              <Tab
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Functions sx={{ fontSize: 16 }} />
                    Symbols
                  </Box>
                }
              />
              <Tab
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <History sx={{ fontSize: 16 }} />
                    History
                  </Box>
                }
              />
            </Tabs>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              {filteredResults.length} results for "{query}"
            </Typography>
          </Box>

          {/* Result List */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredResults.map((result) => (
              <Card
                key={result.id}
                sx={{
                  borderLeft: `4px solid ${getResultTypeColor(result.type)}`,
                }}
              >
                <CardContent sx={{ py: 2 }}>
                  {/* Result Header */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      mb: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box
                        sx={{
                          p: 0.75,
                          borderRadius: 1,
                          backgroundColor: `${getResultTypeColor(result.type)}20`,
                          color: getResultTypeColor(result.type),
                        }}
                      >
                        {getResultIcon(result.type)}
                      </Box>
                      <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {result.path ? (
                            <Typography
                              sx={{
                                fontFamily: 'monospace',
                                color: colors.orange,
                                cursor: 'pointer',
                                '&:hover': { textDecoration: 'underline' },
                              }}
                              onClick={() => navigate(`/repositories/${result.repository}?file=${result.path}`)}
                            >
                              {result.path}
                              {result.line && `:${result.line}`}
                            </Typography>
                          ) : (
                            <Typography sx={{ fontWeight: 600 }}>{result.title}</Typography>
                          )}
                          <Chip
                            label={result.type}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: '0.65rem',
                              textTransform: 'uppercase',
                              backgroundColor: `${getResultTypeColor(result.type)}20`,
                              color: getResultTypeColor(result.type),
                            }}
                          />
                        </Box>
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {result.repository}
                        </Typography>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {/* Relevance Score */}
                      <Tooltip title="Semantic Relevance Score">
                        <Chip
                          label={`${Math.round(result.score * 100)}%`}
                          size="small"
                          sx={{
                            background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
                            color: colors.navy,
                            fontWeight: 600,
                          }}
                        />
                      </Tooltip>

                      <Tooltip title="Copy path">
                        <IconButton size="small">
                          <ContentCopy sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Open in repository">
                        <IconButton size="small">
                          <OpenInNew sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      {result.content && (
                        <IconButton size="small" onClick={() => toggleExpanded(result.id)}>
                          {expandedResults.has(result.id) ? (
                            <ExpandLess sx={{ fontSize: 18 }} />
                          ) : (
                            <ExpandMore sx={{ fontSize: 18 }} />
                          )}
                        </IconButton>
                      )}
                    </Box>
                  </Box>

                  {/* Highlight/Description */}
                  <Typography variant="body2" sx={{ color: colors.textMuted, ml: 6 }}>
                    {result.highlight}
                  </Typography>

                  {/* Code Preview */}
                  {result.content && (
                    <Collapse in={expandedResults.has(result.id)}>
                      <Box sx={{ mt: 2, ml: 6 }}>
                        <SyntaxHighlighter
                          language={result.language || 'typescript'}
                          style={oneDark}
                          customStyle={{
                            borderRadius: 8,
                            fontSize: '0.8rem',
                            margin: 0,
                          }}
                          showLineNumbers
                          startingLineNumber={result.line || 1}
                        >
                          {result.content}
                        </SyntaxHighlighter>
                      </Box>
                    </Collapse>
                  )}
                </CardContent>
              </Card>
            ))}
          </Box>
        </>
      )}

      {/* Empty State */}
      {!isSearching && results.length === 0 && query && (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <SearchIcon sx={{ fontSize: 48, color: colors.navyLighter, mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              No results found
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Try different keywords or check your filters
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Initial State */}
      {!query && results.length === 0 && (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <AIIcon sx={{ fontSize: 48, color: colors.orange, mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              Semantic Code Search
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted, maxWidth: 500, mx: 'auto' }}>
              Search your codebase using natural language. Our AI understands the meaning
              of your code, not just keywords, so you can find what you're looking for
              even when you don't know the exact function names.
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
