import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Card,
  CardContent,
  Chip,
  Avatar,
  CircularProgress,
  Tooltip,
  Menu,
  MenuItem,
  Alert,
} from '@mui/material';
import {
  Send,
  AutoAwesome as AIIcon,
  Person,
  Code,
  Search,
  RateReview,
  Build,
  BubbleChart as GraphIcon,
  ContentCopy,
  KeyboardArrowDown,
  CheckCircle,
  Cancel,
} from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { colors } from '../theme';
import { api } from '../lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'explain' | 'find' | 'review' | 'do' | 'graph';
  codeBlocks?: { language: string; code: string }[];
  context?: {
    type: string;
    snippetCount: number;
    snippets?: {
      filePath: string;
      language: string;
      startLine?: number;
      endLine?: number;
      symbolName?: string;
      score?: number;
    }[];
  };
  timestamp: Date;
}

interface Repository {
  id: string;
  name: string;
  slug: string;
  owner?: string;
  organization?: { slug: string };
}

interface AssistantStatus {
  available: boolean;
  reason: string;
  features: {
    chat: boolean;
    contextRetrieval: boolean;
    semanticSearch: boolean;
  };
}

const commandTypes = [
  { id: 'explain', label: 'Explain', icon: <Code />, description: 'Get AI explanations of code' },
  { id: 'find', label: 'Find', icon: <Search />, description: 'Semantic code search' },
  { id: 'review', label: 'Review', icon: <RateReview />, description: 'AI code review' },
  { id: 'do', label: 'Do', icon: <Build />, description: 'Execute AI-powered tasks' },
  { id: 'graph', label: 'Graph', icon: <GraphIcon />, description: 'Query knowledge graph' },
];

const welcomeMessage: Message = {
  id: 'welcome',
  role: 'assistant',
  content: `Welcome to the ControlVector AI Assistant! I can help you understand your codebase, find relevant code, review changes, and execute development tasks.

**Available commands:**
- **explain** - Get detailed explanations of functions, files, or concepts
- **find** - Search your codebase using natural language
- **review** - Get AI-powered code review with security and best practice checks
- **do** - Execute development tasks with AI assistance
- **graph** - Query your code's knowledge graph

Select a repository above and try asking me something like:
- "Explain the authentication flow"
- "Find all database connection code"
- "Review the error handling"`,
  timestamp: new Date(),
};

// Extract code blocks from markdown
function extractCodeBlocks(content: string): { text: string; codeBlocks: { language: string; code: string }[] } {
  const codeBlocks: { language: string; code: string }[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

  let match;
  let text = content;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    });
  }

  // Remove code blocks from text for cleaner display
  text = content.replace(codeBlockRegex, '\n[Code block shown below]\n');

  return { text, codeBlocks };
}

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [input, setInput] = useState('');
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [repoMenuAnchor, setRepoMenuAnchor] = useState<null | HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch assistant status
  const { data: assistantStatus } = useQuery<AssistantStatus>({
    queryKey: ['assistant-status'],
    queryFn: async () => {
      const response = await api.get('/v1/assistant/status');
      return response.data;
    },
  });

  // Fetch repositories
  const { data: reposData } = useQuery<{ repositories: Repository[] }>({
    queryKey: ['user-repositories'],
    queryFn: async () => {
      const response = await api.get('/v1/repositories');
      return response.data;
    },
  });

  const repositories = reposData?.repositories || [];
  const selectedRepo = repositories.find(r => r.id === selectedRepoId);
  const selectedRepoDisplay = selectedRepo
    ? `${selectedRepo.owner || selectedRepo.organization?.slug || 'user'}/${selectedRepo.slug}`
    : 'Select a repository';

  // Auto-select first repo
  useEffect(() => {
    if (repositories.length > 0 && !selectedRepoId) {
      setSelectedRepoId(repositories[0].id);
    }
  }, [repositories, selectedRepoId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Chat mutation
  const chatMutation = useMutation({
    mutationFn: async (params: { messages: { role: string; content: string }[]; commandType?: string }) => {
      const response = await api.post('/v1/assistant/chat', {
        repositoryId: selectedRepoId,
        messages: params.messages,
        commandType: params.commandType,
      });
      return response.data;
    },
    onSuccess: (data) => {
      const { text, codeBlocks } = extractCodeBlocks(data.message || '');

      const aiResponse: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: text,
        codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
        context: data.context,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
    },
    onError: (error: any) => {
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.response?.data?.reason || error.message || 'Unknown error'}. Please try again.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    },
  });

  const handleSend = useCallback(async () => {
    if (!input.trim() || chatMutation.isPending || !selectedRepoId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      type: selectedCommand as any,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Build message history for context (last 10 messages)
    const recentMessages = [...messages.slice(-10), userMessage]
      .filter(m => m.id !== 'welcome')
      .map(m => ({
        role: m.role,
        content: m.content,
      }));

    chatMutation.mutate({
      messages: recentMessages,
      commandType: selectedCommand || undefined,
    });

    setSelectedCommand(null);
  }, [input, chatMutation, selectedRepoId, selectedCommand, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
            AI Assistant
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            Intelligent code understanding powered by knowledge graph
          </Typography>
        </Box>
        <Box
          onClick={(e) => setRepoMenuAnchor(e.currentTarget)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            borderRadius: 2,
            backgroundColor: colors.navyLight,
            border: `1px solid ${colors.navyLighter}`,
            cursor: 'pointer',
            '&:hover': { borderColor: colors.orange },
          }}
        >
          <Typography variant="body2">{selectedRepoDisplay}</Typography>
          <KeyboardArrowDown sx={{ fontSize: 18, color: colors.textMuted }} />
        </Box>
      </Box>

      {/* Status Chips */}
      {assistantStatus && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Chip
            icon={assistantStatus.available ? <CheckCircle /> : <Cancel />}
            label={assistantStatus.available ? 'AI Ready' : 'AI Not Configured'}
            size="small"
            color={assistantStatus.available ? 'success' : 'default'}
            variant="outlined"
          />
          {assistantStatus.features.semanticSearch && (
            <Chip
              icon={<AIIcon />}
              label="Semantic Search"
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
        </Box>
      )}

      {!assistantStatus?.available && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          AI Assistant requires OPENROUTER_API_KEY to be configured. Context retrieval from the knowledge graph is still available.
        </Alert>
      )}

      {/* Command Chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        {commandTypes.map((cmd) => (
          <Tooltip key={cmd.id} title={cmd.description}>
            <Chip
              icon={cmd.icon}
              label={cmd.label}
              onClick={() => setSelectedCommand(selectedCommand === cmd.id ? null : cmd.id)}
              sx={{
                backgroundColor: selectedCommand === cmd.id ? `${colors.orange}20` : colors.navyLight,
                borderColor: selectedCommand === cmd.id ? colors.orange : colors.navyLighter,
                border: '1px solid',
                '&:hover': { borderColor: colors.orange },
                '& .MuiChip-icon': {
                  color: selectedCommand === cmd.id ? colors.orange : colors.textMuted,
                },
              }}
            />
          </Tooltip>
        ))}
      </Box>

      {/* Messages */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          mb: 2,
          px: 1,
        }}
      >
        {messages.map((message) => (
          <Box
            key={message.id}
            sx={{
              display: 'flex',
              gap: 2,
              mb: 3,
              flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
            }}
          >
            <Avatar
              sx={{
                width: 36,
                height: 36,
                backgroundColor: message.role === 'assistant' ? colors.orange : colors.navyLighter,
              }}
            >
              {message.role === 'assistant' ? (
                <AIIcon sx={{ fontSize: 20 }} />
              ) : (
                <Person sx={{ fontSize: 20 }} />
              )}
            </Avatar>
            <Card
              sx={{
                maxWidth: '80%',
                backgroundColor: message.role === 'user' ? colors.navyLighter : colors.navyLight,
                border: `1px solid ${colors.navyLighter}`,
              }}
            >
              <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                {message.type && (
                  <Chip
                    label={message.type}
                    size="small"
                    sx={{
                      mb: 1,
                      height: 20,
                      fontSize: '0.7rem',
                      textTransform: 'uppercase',
                      backgroundColor: `${colors.orange}20`,
                      color: colors.orange,
                    }}
                  />
                )}

                {/* Context info */}
                {message.context && message.context.snippetCount > 0 && (
                  <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label={`${message.context.type} context`}
                      size="small"
                      sx={{ height: 18, fontSize: '0.65rem' }}
                    />
                    <Chip
                      label={`${message.context.snippetCount} snippets`}
                      size="small"
                      sx={{ height: 18, fontSize: '0.65rem' }}
                    />
                  </Box>
                )}

                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    '& strong': { color: colors.orange },
                    '& code': {
                      backgroundColor: colors.navy,
                      px: 0.5,
                      borderRadius: 0.5,
                      fontFamily: 'monospace',
                    },
                  }}
                  dangerouslySetInnerHTML={{
                    __html: message.content
                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                      .replace(/`([^`]+)`/g, '<code>$1</code>')
                      .replace(/\n/g, '<br />'),
                  }}
                />
                {message.codeBlocks?.map((block, i) => (
                  <Box key={i} sx={{ mt: 2, position: 'relative' }}>
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 1,
                      }}
                    >
                      <Tooltip title="Copy code">
                        <IconButton
                          size="small"
                          sx={{ color: colors.textMuted }}
                          onClick={() => navigator.clipboard.writeText(block.code)}
                        >
                          <ContentCopy sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <SyntaxHighlighter
                      language={block.language}
                      style={oneDark}
                      customStyle={{
                        borderRadius: 8,
                        fontSize: '0.8rem',
                        margin: 0,
                      }}
                    >
                      {block.code}
                    </SyntaxHighlighter>
                  </Box>
                ))}
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 1, color: colors.textMuted }}
                >
                  {message.timestamp.toLocaleTimeString()}
                </Typography>
              </CardContent>
            </Card>
          </Box>
        ))}

        {chatMutation.isPending && (
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <Avatar sx={{ width: 36, height: 36, backgroundColor: colors.orange }}>
              <AIIcon sx={{ fontSize: 20 }} />
            </Avatar>
            <Card sx={{ backgroundColor: colors.navyLight }}>
              <CardContent sx={{ py: 2, px: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <CircularProgress size={20} sx={{ color: colors.orange }} />
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    Analyzing codebase...
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* Input */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          p: 2,
          backgroundColor: colors.navyLight,
          borderRadius: 2,
          border: `1px solid ${colors.navyLighter}`,
        }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={4}
          placeholder={
            !selectedRepoId
              ? 'Select a repository first...'
              : selectedCommand
              ? `Ask AI to ${selectedCommand}...`
              : 'Ask anything about your codebase...'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!selectedRepoId || !assistantStatus?.available}
          sx={{
            '& .MuiOutlinedInput-root': {
              backgroundColor: colors.navy,
            },
          }}
        />
        <IconButton
          onClick={handleSend}
          disabled={!input.trim() || chatMutation.isPending || !selectedRepoId || !assistantStatus?.available}
          sx={{
            alignSelf: 'flex-end',
            width: 48,
            height: 48,
            background: input.trim() && selectedRepoId && assistantStatus?.available
              ? `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`
              : colors.navyLighter,
            color: input.trim() && selectedRepoId && assistantStatus?.available ? colors.navy : colors.textMuted,
            '&:hover': {
              background: input.trim() && selectedRepoId && assistantStatus?.available
                ? `linear-gradient(135deg, #e09518 0%, #d44a62 100%)`
                : colors.navyLighter,
            },
          }}
        >
          <Send />
        </IconButton>
      </Box>

      {/* Repository Menu */}
      <Menu
        anchorEl={repoMenuAnchor}
        open={Boolean(repoMenuAnchor)}
        onClose={() => setRepoMenuAnchor(null)}
      >
        {repositories.length === 0 ? (
          <MenuItem disabled>No repositories available</MenuItem>
        ) : (
          repositories.map((repo) => (
            <MenuItem
              key={repo.id}
              onClick={() => {
                setSelectedRepoId(repo.id);
                setRepoMenuAnchor(null);
              }}
              selected={repo.id === selectedRepoId}
            >
              {repo.owner || repo.organization?.slug || 'user'}/{repo.slug}
            </MenuItem>
          ))
        )}
      </Menu>
    </Box>
  );
}
