import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Box, Typography, Link } from '@mui/material';
import { colors } from '../theme';

interface MarkdownProps {
  children: string;
}

export default function Markdown({ children }: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <Typography variant="h4" sx={{ fontWeight: 700, mt: 3, mb: 2 }}>
            {children}
          </Typography>
        ),
        h2: ({ children }) => (
          <Typography variant="h5" sx={{ fontWeight: 600, mt: 3, mb: 1.5 }}>
            {children}
          </Typography>
        ),
        h3: ({ children }) => (
          <Typography variant="h6" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
            {children}
          </Typography>
        ),
        h4: ({ children }) => (
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
            {children}
          </Typography>
        ),
        p: ({ children }) => (
          <Typography variant="body1" sx={{ mb: 2, lineHeight: 1.7 }}>
            {children}
          </Typography>
        ),
        a: ({ href, children }) => (
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: colors.orange }}
          >
            {children}
          </Link>
        ),
        ul: ({ children }) => (
          <Box component="ul" sx={{ pl: 3, mb: 2 }}>
            {children}
          </Box>
        ),
        ol: ({ children }) => (
          <Box component="ol" sx={{ pl: 3, mb: 2 }}>
            {children}
          </Box>
        ),
        li: ({ children }) => (
          <Typography component="li" sx={{ mb: 0.5, lineHeight: 1.7 }}>
            {children}
          </Typography>
        ),
        code: ({ className, children }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <Box
                component="code"
                sx={{
                  backgroundColor: colors.navyLighter,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 0.5,
                  fontFamily: 'monospace',
                  fontSize: '0.9em',
                }}
              >
                {children}
              </Box>
            );
          }
          return (
            <Box
              component="pre"
              sx={{
                backgroundColor: colors.navy,
                border: `1px solid ${colors.navyLighter}`,
                borderRadius: 2,
                p: 2,
                overflow: 'auto',
                mb: 2,
              }}
            >
              <Box
                component="code"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.9em',
                }}
              >
                {children}
              </Box>
            </Box>
          );
        },
        blockquote: ({ children }) => (
          <Box
            sx={{
              borderLeft: `4px solid ${colors.orange}`,
              pl: 2,
              py: 0.5,
              my: 2,
              backgroundColor: colors.navy,
              borderRadius: '0 4px 4px 0',
            }}
          >
            {children}
          </Box>
        ),
        hr: () => (
          <Box
            component="hr"
            sx={{
              border: 'none',
              borderTop: `1px solid ${colors.navyLighter}`,
              my: 3,
            }}
          />
        ),
        table: ({ children }) => (
          <Box
            component="table"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              mb: 2,
              '& th, & td': {
                border: `1px solid ${colors.navyLighter}`,
                p: 1.5,
                textAlign: 'left',
              },
              '& th': {
                backgroundColor: colors.navy,
                fontWeight: 600,
              },
            }}
          >
            {children}
          </Box>
        ),
        img: ({ src, alt }) => (
          <Box
            component="img"
            src={src}
            alt={alt}
            sx={{
              maxWidth: '100%',
              height: 'auto',
              borderRadius: 2,
              my: 2,
            }}
          />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
