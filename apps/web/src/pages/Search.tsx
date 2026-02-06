import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  Code,
  InsertDriveFile,
  Functions,
  AutoAwesome as AIIcon,
  ExpandMore,
  ExpandLess,
  ContentCopy,
  OpenInNew,
  CheckCircle,
  Cancel,
} from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSearchParams } from 'react-router-dom';
import { colors } from '../theme';
import { api } from '../lib/api';

interface SearchResult {
  id: string;
  type: 'code' | 'file' | 'symbol';
  score: number;
  repositoryId: string;
  path?: string;
  filePath?: string;
  line?: number;
  startLine?: number;
  content?: string;
  highlight?: string;
  title?: string;
  language?: string;
  symbolName?: string;
  symbolKind?: string;
  chunkType?: string;
}

interface SearchStatus {
  embedding: { available: boolean; reason: string };
  vector: { available: boolean; reason: string };
  semanticSearch: boolean;
}

const getResultIcon = (type: string) => {
  switch (type) {
    case 'code':
      return <Code />;
    case 'file':
      return <InsertDriveFile />;
    case 'symbol':
      return <Functions />;
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
    default:
      return colors.textMuted;
  }
};

export default function Search() {
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(urlQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [tabValue, setTabValue] = useState(0);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [searchStats, setSearchStats] = useState<{ total: number; searchedRepos: number; method: string } | null>(null);

  // Track if we should auto-search on URL change
  const [shouldAutoSearch, setShouldAutoSearch] = useState(false);

  // Check search service status
  const { data: searchStatus } = useQuery<SearchStatus>({
    queryKey: ['search-status'],
    queryFn: async () => {
      const response = await api.get('/v1/search/status');
      return response.data;
    },
  });

  // Semantic search mutation
  const semanticSearchMutation = useMutation({
    mutationFn: async (searchQuery: string) => {
      const response = await api.post('/v1/search/semantic', {
        query: searchQuery,
        limit: 30,
      });
      return response.data;
    },
  });

  // Symbol search mutation (fallback)
  const symbolSearchMutation = useMutation({
    mutationFn: async (searchQuery: string) => {
      const response = await api.post('/v1/search/symbols', {
        query: searchQuery,
        limit: 30,
      });
      return response.data;
    },
  });

  // Code/file search mutation (fallback)
  const codeSearchMutation = useMutation({
    mutationFn: async (searchQuery: string) => {
      const response = await api.post('/v1/search/code', {
        query: searchQuery,
        limit: 30,
      });
      return response.data;
    },
  });

  const handleSearch = useCallback(async (searchQuery?: string) => {
    const queryToSearch = searchQuery ?? query;
    if (!queryToSearch.trim()) return;

    const allResults: SearchResult[] = [];
    let searchMethod = 'graph';
    let totalSearchedRepos = 0;

    // Try semantic search first if available
    if (searchStatus?.semanticSearch) {
      try {
        const semanticResults = await semanticSearchMutation.mutateAsync(queryToSearch);
        searchMethod = 'semantic';
        totalSearchedRepos = semanticResults.searchedRepos || 0;

        for (const result of semanticResults.results || []) {
          allResults.push({
            id: result.id,
            type: 'code',
            score: result.score,
            repositoryId: result.repositoryId,
            path: result.filePath,
            filePath: result.filePath,
            startLine: result.startLine,
            line: result.startLine,
            content: result.content,
            language: result.language,
            symbolName: result.symbolName,
            symbolKind: result.symbolKind,
            chunkType: result.chunkType,
            highlight: result.symbolName
              ? `${result.symbolKind || 'symbol'}: ${result.symbolName}`
              : `Code in ${result.filePath}`,
          });
        }
      } catch (error) {
        console.warn('Semantic search failed, falling back to graph search:', error);
      }
    }

    // Fall back to graph-based search if semantic not available or failed
    if (allResults.length === 0) {
      // Search symbols
      try {
        const symbolResults = await symbolSearchMutation.mutateAsync(queryToSearch);
        totalSearchedRepos = Math.max(totalSearchedRepos, symbolResults.searchedRepos || 0);

        for (const result of symbolResults.results || []) {
          allResults.push({
            id: `symbol-${result.symbol.qualifiedName}`,
            type: 'symbol',
            score: 0.8,
            repositoryId: result.repositoryId,
            path: result.symbol.file,
            line: result.symbol.startLine,
            title: result.symbol.name,
            highlight: result.symbol.signature || `${result.symbol.kind}: ${result.symbol.qualifiedName}`,
            language: 'typescript',
          });
        }
      } catch (error) {
        console.error('Symbol search failed:', error);
      }

      // Search files
      try {
        const codeResults = await codeSearchMutation.mutateAsync(queryToSearch);
        totalSearchedRepos = Math.max(totalSearchedRepos, codeResults.searchedRepos || 0);

        for (const result of codeResults.results || []) {
          allResults.push({
            id: `file-${result.file.path}`,
            type: 'file',
            score: 0.7,
            repositoryId: result.repositoryId,
            path: result.file.path,
            language: result.file.language,
            highlight: `File matching "${queryToSearch}"`,
          });
        }
      } catch (error) {
        console.error('Code search failed:', error);
      }
    }

    // Sort by score
    allResults.sort((a, b) => b.score - a.score);

    setResults(allResults);
    setSearchStats({
      total: allResults.length,
      searchedRepos: totalSearchedRepos,
      method: searchMethod,
    });

    // Auto-expand first 2 results with content
    const withContent = allResults.filter(r => r.content).slice(0, 2).map(r => r.id);
    setExpandedResults(new Set(withContent));
  }, [query, searchStatus, semanticSearchMutation, symbolSearchMutation, codeSearchMutation]);

  // React to URL query param changes (e.g., from header search bar)
  useEffect(() => {
    if (urlQuery && urlQuery !== query) {
      setQuery(urlQuery);
      setShouldAutoSearch(true);
    }
  }, [urlQuery]);

  // Trigger search when shouldAutoSearch is set and searchStatus is ready
  useEffect(() => {
    if (shouldAutoSearch && query && searchStatus !== undefined) {
      setShouldAutoSearch(false);
      handleSearch(query);
    }
  }, [shouldAutoSearch, query, searchStatus, handleSearch]);

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

  const isSearching = semanticSearchMutation.isPending || symbolSearchMutation.isPending || codeSearchMutation.isPending;

  const filteredResults = results.filter((r) => {
    if (tabValue === 0) return true;
    if (tabValue === 1) return r.type === 'code';
    if (tabValue === 2) return r.type === 'file';
    if (tabValue === 3) return r.type === 'symbol';
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
          {searchStatus?.semanticSearch
            ? 'AI-powered semantic code search'
            : 'Search symbols and files across repositories'}
        </Typography>
      </Box>

      {/* Search Status */}
      {searchStatus && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <Chip
            icon={searchStatus.embedding.available ? <CheckCircle /> : <Cancel />}
            label={`Embeddings: ${searchStatus.embedding.available ? 'Ready' : 'Not configured'}`}
            size="small"
            color={searchStatus.embedding.available ? 'success' : 'default'}
            variant="outlined"
          />
          <Chip
            icon={searchStatus.vector.available ? <CheckCircle /> : <Cancel />}
            label={`Vector DB: ${searchStatus.vector.available ? 'Connected' : 'Unavailable'}`}
            size="small"
            color={searchStatus.vector.available ? 'success' : 'default'}
            variant="outlined"
          />
          <Chip
            icon={searchStatus.semanticSearch ? <AIIcon /> : <SearchIcon />}
            label={searchStatus.semanticSearch ? 'Semantic Search Active' : 'Graph Search Only'}
            size="small"
            color={searchStatus.semanticSearch ? 'primary' : 'default'}
            variant="outlined"
          />
        </Box>
      )}

      {/* Search Box */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                background: searchStatus?.semanticSearch
                  ? `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`
                  : colors.navyLight,
              }}
            >
              {searchStatus?.semanticSearch ? (
                <AIIcon sx={{ color: colors.navy }} />
              ) : (
                <SearchIcon sx={{ color: colors.textMuted }} />
              )}
            </Box>
            <TextField
              fullWidth
              placeholder={
                searchStatus?.semanticSearch
                  ? "Search using natural language... (e.g., 'authentication logic' or 'error handling')"
                  : "Search for symbols and files..."
              }
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
              onClick={() => handleSearch()}
              sx={{
                px: 4,
                py: 1.5,
                borderRadius: 2,
                background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
                color: colors.navy,
                fontWeight: 600,
                cursor: isSearching ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
                opacity: isSearching ? 0.7 : 1,
                '&:hover': {
                  transform: isSearching ? 'none' : 'translateY(-1px)',
                  boxShadow: isSearching ? 'none' : `0 4px 15px ${colors.amberGlow}`,
                },
              }}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </Box>
          </Box>

          {/* Search Tips */}
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: colors.textMuted }}>
              Try:
            </Typography>
            {searchStatus?.semanticSearch
              ? ['authentication flow', 'error handling', 'database queries', 'API routes'].map((tip) => (
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
                ))
              : ['auth', 'config', 'service', 'handler'].map((tip) => (
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

          {!searchStatus?.semanticSearch && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Semantic search requires OPENROUTER_API_KEY. Currently using graph-based symbol and file search.
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Loading */}
      {isSearching && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ color: colors.textMuted, mb: 1 }}>
            {searchStatus?.semanticSearch
              ? 'Searching using AI embeddings...'
              : 'Searching symbols and files...'}
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
            </Tabs>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {searchStats?.method === 'semantic' && (
                <Chip
                  icon={<AIIcon sx={{ fontSize: 14 }} />}
                  label="Semantic"
                  size="small"
                  sx={{
                    backgroundColor: `${colors.orange}20`,
                    color: colors.orange,
                  }}
                />
              )}
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                {filteredResults.length} results
                {searchStats && ` (${searchStats.searchedRepos} repos)`}
              </Typography>
            </Box>
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
                          <Typography
                            sx={{
                              fontFamily: 'monospace',
                              color: colors.orange,
                              cursor: 'pointer',
                              '&:hover': { textDecoration: 'underline' },
                            }}
                          >
                            {result.path || result.filePath || result.title || 'Unknown'}
                            {(result.line || result.startLine) && `:${result.line || result.startLine}`}
                          </Typography>
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
                          {result.chunkType && result.chunkType !== 'file' && (
                            <Chip
                              label={result.chunkType}
                              size="small"
                              sx={{
                                height: 18,
                                fontSize: '0.65rem',
                              }}
                            />
                          )}
                        </Box>
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          Repo: {result.repositoryId?.slice(0, 8)}...
                          {result.language && ` | ${result.language}`}
                        </Typography>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Tooltip title="Relevance Score">
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
                        <IconButton
                          size="small"
                          onClick={() => {
                            const path = result.path || result.filePath;
                            if (path) navigator.clipboard.writeText(path);
                          }}
                        >
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
                          startingLineNumber={result.startLine || result.line || 1}
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
              Try different keywords or make sure repositories have been synced
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
              {searchStatus?.semanticSearch ? 'Semantic Code Search' : 'Code Search'}
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted, maxWidth: 500, mx: 'auto' }}>
              {searchStatus?.semanticSearch
                ? "Search your codebase using natural language. Our AI understands the meaning of your code, not just keywords."
                : "Search for symbols and files across your repositories. Enable OPENROUTER_API_KEY for semantic search."}
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
