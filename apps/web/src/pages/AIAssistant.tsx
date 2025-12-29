import { useState, useRef, useEffect } from 'react';
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
} from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { colors } from '../theme';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'explain' | 'find' | 'review' | 'do' | 'graph';
  codeBlocks?: { language: string; code: string }[];
  timestamp: Date;
}

const commandTypes = [
  { id: 'explain', label: 'Explain', icon: <Code />, description: 'Get AI explanations of code' },
  { id: 'find', label: 'Find', icon: <Search />, description: 'Semantic code search' },
  { id: 'review', label: 'Review', icon: <RateReview />, description: 'AI code review' },
  { id: 'do', label: 'Do', icon: <Build />, description: 'Execute AI-powered tasks' },
  { id: 'graph', label: 'Graph', icon: <GraphIcon />, description: 'Query knowledge graph' },
];

const mockMessages: Message[] = [
  {
    id: '1',
    role: 'assistant',
    content: `Welcome to the ControlVector AI Assistant! I can help you understand your codebase, find relevant code, review changes, and execute development tasks.

**Available commands:**
- **explain** - Get detailed explanations of functions, files, or concepts
- **find** - Search your codebase using natural language
- **review** - Get AI-powered code review with security and best practice checks
- **do** - Execute development tasks with AI assistance
- **graph** - Query your code's knowledge graph

Try asking me something like:
- "Explain the authentication flow"
- "Find all database connection code"
- "Review my latest changes"`,
    timestamp: new Date(Date.now() - 60000),
  },
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState('team/cv-git');
  const [repoMenuAnchor, setRepoMenuAnchor] = useState<null | HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      type: selectedCommand as any,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: generateMockResponse(input, selectedCommand),
        type: selectedCommand as any,
        codeBlocks: selectedCommand === 'find' || selectedCommand === 'explain' ? [
          {
            language: 'typescript',
            code: `// Found in src/auth/service.ts
export async function authenticateUser(
  credentials: UserCredentials
): Promise<AuthResult> {
  const user = await userRepository.findByEmail(
    credentials.email
  );

  if (!user || !await verifyPassword(
    credentials.password,
    user.passwordHash
  )) {
    throw new AuthenticationError('Invalid credentials');
  }

  return generateAuthTokens(user);
}`,
          },
        ] : undefined,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
      setIsLoading(false);
    }, 1500);

    setSelectedCommand(null);
  };

  const generateMockResponse = (query: string, command: string | null): string => {
    if (command === 'explain') {
      return `## Authentication Flow Explanation

The authentication system in **cv-git** uses a JWT-based approach with the following components:

1. **User Authentication** (\`src/auth/service.ts\`)
   - Validates credentials against the database
   - Uses bcrypt for password verification
   - Generates JWT access and refresh tokens

2. **Token Management** (\`src/auth/tokens.ts\`)
   - Access tokens expire in 15 minutes
   - Refresh tokens expire in 7 days
   - Tokens are signed with RS256 algorithm

3. **Middleware** (\`src/middleware/auth.ts\`)
   - Validates tokens on protected routes
   - Extracts user context from token payload
   - Handles token refresh automatically

**Security Considerations:**
- Passwords are hashed with bcrypt (cost factor 12)
- Tokens use asymmetric signing (RS256)
- Refresh token rotation is implemented

Here's the main authentication function:`;
    }

    if (command === 'find') {
      return `## Search Results

Found **5 matches** for "${query}" in **team/cv-git**:

### High Relevance (Score: 0.95)
**src/auth/service.ts** - Lines 45-78
Main authentication service with user validation

### High Relevance (Score: 0.89)
**src/middleware/auth.ts** - Lines 12-34
Authentication middleware for route protection

### Medium Relevance (Score: 0.72)
**src/auth/tokens.ts** - Lines 1-50
JWT token generation and validation utilities

---

Showing the most relevant result:`;
    }

    if (command === 'review') {
      return `## AI Code Review

### Summary
Reviewed **12 files** with **+245 / -89** lines changed.

### Issues Found

**Critical (1)**
- \`src/api/users.ts:45\` - Potential SQL injection in user query. Use parameterized queries.

**Warnings (3)**
- \`src/utils/helpers.ts:23\` - Unused function \`formatDate\` should be removed
- \`src/components/Form.tsx:89\` - Missing error boundary for async operations
- \`src/services/api.ts:156\` - Consider adding retry logic for network requests

### Suggestions
- Add unit tests for the new authentication flow
- Consider extracting the validation logic into a separate utility
- Documentation could be improved for public API methods

### Security Score: **87/100**
### Code Quality Score: **92/100**`;
    }

    if (command === 'do') {
      return `## Task Plan: ${query}

I've analyzed your codebase and created the following implementation plan:

### Steps
1. **Create new authentication module** (\`src/auth/oauth.ts\`)
   - Set up OAuth2 client configuration
   - Implement authorization URL generation

2. **Add OAuth routes** (\`src/routes/auth.ts\`)
   - GET /auth/oauth/authorize
   - GET /auth/oauth/callback

3. **Update user service** (\`src/services/user.ts\`)
   - Add method to link OAuth accounts
   - Handle OAuth user creation

### Estimated Impact
- **Files to create:** 2
- **Files to modify:** 3
- **Complexity:** Medium

Would you like me to proceed with this implementation?`;
    }

    if (command === 'graph') {
      return `## Knowledge Graph Query Results

### Call Graph for \`authenticateUser\`

**Called by (3 functions):**
- \`loginHandler\` in \`src/routes/auth.ts:34\`
- \`refreshTokens\` in \`src/auth/tokens.ts:78\`
- \`validateSession\` in \`src/middleware/session.ts:12\`

**Calls (4 functions):**
- \`findByEmail\` in \`src/repositories/user.ts:23\`
- \`verifyPassword\` in \`src/auth/crypto.ts:45\`
- \`generateAuthTokens\` in \`src/auth/tokens.ts:12\`
- \`logAuthAttempt\` in \`src/services/audit.ts:89\`

### Metrics
- **Cyclomatic Complexity:** 8
- **Dependencies:** 4 modules
- **Test Coverage:** 85%`;
    }

    return `I understand you're asking about "${query}". Let me analyze your codebase and provide a detailed response.

Based on the knowledge graph and code analysis of **team/cv-git**, here's what I found...`;
  };

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
          <Typography variant="body2">{selectedRepo}</Typography>
          <KeyboardArrowDown sx={{ fontSize: 18, color: colors.textMuted }} />
        </Box>
      </Box>

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
                border: `1px solid ${message.role === 'user' ? colors.navyLighter : colors.navyLighter}`,
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
                        <IconButton size="small" sx={{ color: colors.textMuted }}>
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

        {isLoading && (
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
            selectedCommand
              ? `Ask AI to ${selectedCommand}...`
              : 'Ask anything about your codebase...'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{
            '& .MuiOutlinedInput-root': {
              backgroundColor: colors.navy,
            },
          }}
        />
        <IconButton
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          sx={{
            alignSelf: 'flex-end',
            width: 48,
            height: 48,
            background: input.trim()
              ? `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`
              : colors.navyLighter,
            color: input.trim() ? colors.navy : colors.textMuted,
            '&:hover': {
              background: input.trim()
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
        {['team/cv-git', 'team/api-service', 'team/web-frontend'].map((repo) => (
          <MenuItem
            key={repo}
            onClick={() => {
              setSelectedRepo(repo);
              setRepoMenuAnchor(null);
            }}
            selected={repo === selectedRepo}
          >
            {repo}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
