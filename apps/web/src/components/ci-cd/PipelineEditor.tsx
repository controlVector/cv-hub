/**
 * PipelineEditor Component
 * Monaco Editor for editing pipeline YAML with syntax highlighting
 */

import { useRef, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Alert,
  CircularProgress,
  Chip,
  alpha,
} from '@mui/material';
import {
  Save,
  PlayArrow,
  ContentCopy,
  CheckCircle,
  Error as ErrorIcon,
} from '@mui/icons-material';
import Editor, { type Monaco } from '@monaco-editor/react';
import { colors } from '../../theme';

type MonacoEditor = Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[0];

interface PipelineEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  onRun?: () => void;
  readOnly?: boolean;
  height?: number | string;
  error?: string | null;
  isSaving?: boolean;
  isRunning?: boolean;
  showActions?: boolean;
}

// Example pipeline YAML for placeholder
const PLACEHOLDER_YAML = `# Pipeline Configuration
version: "1.0"
name: Build and Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

stages:
  - name: Build
    jobs:
      - name: build-app
        key: build
        runs-on: ubuntu-latest
        container:
          image: node:20-alpine
        steps:
          - uses: checkout@v1
          - run: npm ci
          - run: npm run build

  - name: Test
    jobs:
      - name: unit-tests
        key: test
        needs: [build]
        steps:
          - uses: checkout@v1
          - run: npm test
`;

export function PipelineEditor({
  value,
  onChange,
  onSave,
  onRun,
  readOnly = false,
  height = 500,
  error,
  isSaving = false,
  isRunning = false,
  showActions = true,
}: PipelineEditorProps) {
  const editorRef = useRef<MonacoEditor | null>(null);
  const [copied, setCopied] = useState(false);
  const [isValid, setIsValid] = useState(true);

  const handleEditorMount = (editor: MonacoEditor, monaco: Monaco) => {
    editorRef.current = editor;

    // Configure YAML language features
    monaco.languages.setLanguageConfiguration('yaml', {
      comments: {
        lineComment: '#',
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    // Set editor theme to match our dark theme
    monaco.editor.defineTheme('cv-hub-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
        { token: 'string', foreground: '10b981' },
        { token: 'keyword', foreground: '8b5cf6' },
        { token: 'number', foreground: 'f59e0b' },
        { token: 'type', foreground: '06b6d4' },
      ],
      colors: {
        'editor.background': '#0f172a',
        'editor.foreground': '#f8fafc',
        'editor.lineHighlightBackground': '#1e293b',
        'editor.selectionBackground': '#3b82f640',
        'editorCursor.foreground': '#8b5cf6',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#8b5cf6',
        'editorIndentGuide.background': '#334155',
        'editorIndentGuide.activeBackground': '#8b5cf6',
      },
    });

    monaco.editor.setTheme('cv-hub-dark');

    // Add keyboard shortcut for save
    editor.addAction({
      id: 'save-pipeline',
      label: 'Save Pipeline',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        if (onSave && !readOnly) {
          onSave(editor.getValue());
        }
      },
    });
  };

  const handleEditorChange = useCallback(
    (newValue: string | undefined) => {
      if (newValue !== undefined && onChange) {
        onChange(newValue);

        // Basic YAML validation (check for obvious syntax errors)
        try {
          // Simple validation: check for balanced brackets
          const openBrackets = (newValue.match(/[{\[]/g) || []).length;
          const closeBrackets = (newValue.match(/[}\]]/g) || []).length;
          setIsValid(openBrackets === closeBrackets);
        } catch {
          setIsValid(false);
        }
      }
    },
    [onChange]
  );

  const handleCopy = async () => {
    if (editorRef.current) {
      const content = editorRef.current.getValue();
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSave = () => {
    if (onSave && editorRef.current) {
      onSave(editorRef.current.getValue());
    }
  };

  return (
    <Box
      sx={{
        border: `1px solid ${colors.slateLighter}`,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: colors.slate,
      }}
    >
      {/* Toolbar */}
      {showActions && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 1.5,
            borderBottom: `1px solid ${colors.slateLighter}`,
            backgroundColor: colors.slateLight,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Chip
              label="YAML"
              size="small"
              sx={{
                backgroundColor: alpha(colors.violet, 0.15),
                color: colors.violet,
                fontFamily: 'monospace',
              }}
            />
            {!isValid && (
              <Chip
                icon={<ErrorIcon sx={{ fontSize: 14 }} />}
                label="Syntax Error"
                size="small"
                sx={{
                  backgroundColor: alpha(colors.rose, 0.15),
                  color: colors.rose,
                }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={
                copied ? (
                  <CheckCircle sx={{ color: colors.green }} />
                ) : (
                  <ContentCopy />
                )
              }
              onClick={handleCopy}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>

            {!readOnly && onSave && (
              <Button
                size="small"
                variant="outlined"
                startIcon={isSaving ? <CircularProgress size={16} /> : <Save />}
                onClick={handleSave}
                disabled={isSaving || !isValid}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            )}

            {onRun && (
              <Button
                size="small"
                variant="contained"
                startIcon={isRunning ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
                onClick={onRun}
                disabled={isRunning || !isValid}
              >
                {isRunning ? 'Running...' : 'Run'}
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* Error Alert */}
      {error && (
        <Alert
          severity="error"
          sx={{
            borderRadius: 0,
            backgroundColor: alpha(colors.rose, 0.1),
            borderBottom: `1px solid ${colors.slateLighter}`,
          }}
        >
          {error}
        </Alert>
      )}

      {/* Editor */}
      <Editor
        height={height}
        language="yaml"
        value={value || PLACEHOLDER_YAML}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          padding: { top: 16, bottom: 16 },
          renderLineHighlight: 'line',
          cursorBlinking: 'smooth',
          cursorStyle: 'line',
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
        loading={
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        }
      />
    </Box>
  );
}

export default PipelineEditor;
