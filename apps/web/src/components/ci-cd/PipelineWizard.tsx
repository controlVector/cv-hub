/**
 * PipelineWizard Component
 * AI-powered pipeline creation wizard with 4 steps:
 * 1. Analyze Repository
 * 2. Describe Pipeline (natural language)
 * 3. Review Generated YAML
 * 4. Save & Run
 */

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Stepper,
  Step,
  StepLabel,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  FormControlLabel,
  Switch,
  Alert,
  alpha,
  Skeleton,
} from '@mui/material';
import {
  ArrowBack,
  ArrowForward,
  AutoAwesome as AIIcon,
  Check,
  Code,
  Terminal,
  Science,
  Storage,
  Settings,
  Lightbulb,
} from '@mui/icons-material';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../theme';
import { analyzeRepository, generatePipeline, createPipeline, triggerRun } from '../../services/ci-cd';
import { PipelineEditor } from './PipelineEditor';
import type { RepoAnalysis, GeneratedPipeline } from '../../types/ci-cd';

const steps = [
  { label: 'Analyze', description: 'Scanning repository' },
  { label: 'Describe', description: 'Define requirements' },
  { label: 'Review', description: 'Check generated YAML' },
  { label: 'Save', description: 'Create pipeline' },
];

interface PipelineWizardProps {
  owner: string;
  repo: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

// Suggested pipeline templates based on repo analysis
const getSuggestions = (analysis: RepoAnalysis | null): string[] => {
  if (!analysis) return [];

  const suggestions: string[] = [];

  // Language-based suggestions
  if (analysis.languages.some((l) => l.name.toLowerCase().includes('javascript') || l.name.toLowerCase().includes('typescript'))) {
    suggestions.push('Build and test my Node.js application');
    if (analysis.hasTests) {
      suggestions.push('Run linting, type checking, and tests');
    }
  }

  if (analysis.languages.some((l) => l.name.toLowerCase().includes('python'))) {
    suggestions.push('Build and test my Python application');
    suggestions.push('Run pytest with coverage report');
  }

  if (analysis.languages.some((l) => l.name.toLowerCase().includes('go'))) {
    suggestions.push('Build and test my Go application');
  }

  if (analysis.languages.some((l) => l.name.toLowerCase().includes('rust'))) {
    suggestions.push('Build and test my Rust application with Cargo');
  }

  // Framework-based suggestions
  if (analysis.frameworks.includes('react') || analysis.frameworks.includes('vue') || analysis.frameworks.includes('angular')) {
    suggestions.push('Build and deploy frontend to CDN');
  }

  if (analysis.frameworks.includes('docker')) {
    suggestions.push('Build Docker image and push to registry');
  }

  // Add generic suggestions
  suggestions.push('Run tests on every pull request');
  suggestions.push('Deploy to staging when merged to main');

  return suggestions.slice(0, 4); // Max 4 suggestions
};

export function PipelineWizard({ owner, repo, onComplete, onCancel }: PipelineWizardProps) {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [prompt, setPrompt] = useState('');
  const [generatedPipeline, setGeneratedPipeline] = useState<GeneratedPipeline | null>(null);
  const [editedYaml, setEditedYaml] = useState('');
  const [pipelineName, setPipelineName] = useState('');
  const [runImmediately, setRunImmediately] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Analyze repository mutation
  const analyzeMutation = useMutation({
    mutationFn: () => analyzeRepository(owner, repo),
    onSuccess: (data) => {
      setAnalysis(data);
      setError(null);
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to analyze repository');
    },
  });

  // Generate pipeline mutation
  const generateMutation = useMutation({
    mutationFn: (userPrompt: string) => generatePipeline(owner, repo, userPrompt),
    onSuccess: (data) => {
      setGeneratedPipeline(data);
      setEditedYaml(data.yaml);
      setError(null);
      // Auto-generate a name from the prompt
      const name = prompt.split(' ').slice(0, 4).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
      setPipelineName(name || 'my-pipeline');
      setActiveStep(2);
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to generate pipeline');
    },
  });

  // Create pipeline mutation
  const createMutation = useMutation({
    mutationFn: () => createPipeline(owner, repo, { name: pipelineName, yaml: editedYaml }),
    onSuccess: async (pipeline) => {
      setError(null);
      if (runImmediately) {
        try {
          await triggerRun(owner, repo, pipeline.slug);
        } catch {
          // Pipeline created but run failed - still success
        }
      }
      if (onComplete) {
        onComplete();
      } else {
        navigate(`/repositories/${owner}/${repo}/pipelines/${pipeline.slug}`);
      }
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to create pipeline');
    },
  });

  // Auto-start analysis on mount
  useEffect(() => {
    analyzeMutation.mutate();
  }, []);

  const handleNext = () => {
    if (activeStep === 1) {
      // Generate pipeline
      generateMutation.mutate(prompt);
    } else if (activeStep === 3) {
      // Create pipeline
      createMutation.mutate();
    } else {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
    setError(null);
  };

  const handleSelectSuggestion = (suggestion: string) => {
    setPrompt(suggestion);
  };

  const canProceed = () => {
    switch (activeStep) {
      case 0:
        return analysis !== null;
      case 1:
        return prompt.trim().length > 10;
      case 2:
        return editedYaml.trim().length > 0;
      case 3:
        return pipelineName.trim().length > 0;
      default:
        return false;
    }
  };

  const suggestions = getSuggestions(analysis);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          <AIIcon sx={{ color: 'white' }} />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Create Pipeline with AI
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted }}>
            {owner}/{repo}
          </Typography>
        </Box>
      </Box>

      {/* Stepper */}
      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map((step) => (
          <Step key={step.label}>
            <StepLabel
              optional={
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  {step.description}
                </Typography>
              }
            >
              {step.label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Step Content */}
      <Card sx={{ mb: 4, minHeight: 400 }}>
        <CardContent sx={{ p: 3 }}>
          {/* Step 0: Analyze Repository */}
          {activeStep === 0 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3 }}>
                Analyzing Repository
              </Typography>

              {analyzeMutation.isPending ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <CircularProgress size={24} />
                    <Typography variant="body2" sx={{ color: colors.textMuted }}>
                      Scanning files and detecting project structure...
                    </Typography>
                  </Box>
                  <LinearProgress sx={{ borderRadius: 1 }} />
                  <Box sx={{ mt: 4 }}>
                    <Skeleton variant="rectangular" height={40} sx={{ mb: 2, borderRadius: 1 }} />
                    <Skeleton variant="rectangular" height={40} sx={{ mb: 2, borderRadius: 1 }} />
                    <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
                  </Box>
                </Box>
              ) : analysis ? (
                <Box>
                  <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
                    We've analyzed your repository and detected the following:
                  </Typography>

                  {/* Languages */}
                  <Box sx={{ mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <Code sx={{ fontSize: 18, color: colors.violet }} />
                      <Typography variant="subtitle2">Languages</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {analysis.languages.map((lang) => (
                        <Chip
                          key={lang.name}
                          label={`${lang.name} (${lang.percentage}%)`}
                          size="small"
                          sx={{
                            backgroundColor: alpha(colors.violet, 0.15),
                            color: colors.violet,
                          }}
                        />
                      ))}
                    </Box>
                  </Box>

                  {/* Frameworks */}
                  {analysis.frameworks.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <Settings sx={{ fontSize: 18, color: colors.cyan }} />
                        <Typography variant="subtitle2">Frameworks & Tools</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {analysis.frameworks.map((fw) => (
                          <Chip
                            key={fw}
                            label={fw}
                            size="small"
                            sx={{
                              backgroundColor: alpha(colors.cyan, 0.15),
                              color: colors.cyan,
                            }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Package Managers & Build Tools */}
                  <Box sx={{ display: 'flex', gap: 4, mb: 3 }}>
                    {analysis.packageManagers.length > 0 && (
                      <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                          <Storage sx={{ fontSize: 18, color: colors.amber }} />
                          <Typography variant="subtitle2">Package Managers</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {analysis.packageManagers.map((pm) => (
                            <Chip key={pm} label={pm} size="small" variant="outlined" />
                          ))}
                        </Box>
                      </Box>
                    )}

                    {analysis.buildTools.length > 0 && (
                      <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                          <Terminal sx={{ fontSize: 18, color: colors.green }} />
                          <Typography variant="subtitle2">Build Tools</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {analysis.buildTools.map((tool) => (
                            <Chip key={tool} label={tool} size="small" variant="outlined" />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>

                  {/* Tests */}
                  {analysis.hasTests && (
                    <Box sx={{ mb: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <Science sx={{ fontSize: 18, color: colors.green }} />
                        <Typography variant="subtitle2">Test Frameworks</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {analysis.testFrameworks.map((tf) => (
                          <Chip
                            key={tf}
                            label={tf}
                            size="small"
                            sx={{
                              backgroundColor: alpha(colors.green, 0.15),
                              color: colors.green,
                            }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}

                  <Alert severity="success" icon={<Check />} sx={{ mt: 3 }}>
                    Analysis complete! Click "Next" to describe your pipeline.
                  </Alert>
                </Box>
              ) : null}
            </Box>
          )}

          {/* Step 1: Describe Pipeline */}
          {activeStep === 1 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>
                What should your pipeline do?
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
                Describe your pipeline in plain English. Our AI will generate the configuration for you.
              </Typography>

              <TextField
                fullWidth
                multiline
                rows={4}
                placeholder="Example: Build and test my Node.js app, then deploy to staging when merged to main"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                sx={{ mb: 3 }}
              />

              {/* Quick suggestions */}
              {suggestions.length > 0 && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Lightbulb sx={{ fontSize: 18, color: colors.amber }} />
                    <Typography variant="subtitle2">Suggestions based on your repo</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {suggestions.map((suggestion) => (
                      <Chip
                        key={suggestion}
                        label={suggestion}
                        onClick={() => handleSelectSuggestion(suggestion)}
                        sx={{
                          cursor: 'pointer',
                          backgroundColor: prompt === suggestion ? alpha(colors.violet, 0.2) : colors.slateLighter,
                          borderColor: prompt === suggestion ? colors.violet : 'transparent',
                          border: '1px solid',
                          '&:hover': {
                            backgroundColor: alpha(colors.violet, 0.15),
                          },
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {generateMutation.isPending && (
                <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    AI is generating your pipeline...
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Step 2: Review Generated YAML */}
          {activeStep === 2 && generatedPipeline && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant="h6" sx={{ mb: 0.5 }}>
                    Review Generated Pipeline
                  </Typography>
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    {generatedPipeline.reasoning}
                  </Typography>
                </Box>
                <Chip
                  label={`${Math.round(generatedPipeline.confidence * 100)}% confidence`}
                  size="small"
                  sx={{
                    backgroundColor: alpha(colors.green, 0.15),
                    color: colors.green,
                  }}
                />
              </Box>

              <PipelineEditor
                value={editedYaml}
                onChange={setEditedYaml}
                height={350}
                showActions={false}
              />

              {/* Alternative suggestions */}
              {generatedPipeline.alternatives.length > 0 && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Alternative approaches:
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {generatedPipeline.alternatives.map((alt, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          p: 1.5,
                          borderRadius: 1,
                          backgroundColor: colors.slateLighter,
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {alt.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>
                          {alt.description}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {/* Step 3: Save & Run */}
          {activeStep === 3 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3 }}>
                Save Your Pipeline
              </Typography>

              <TextField
                fullWidth
                label="Pipeline Name"
                placeholder="my-pipeline"
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                helperText="Use lowercase letters, numbers, and hyphens only"
                sx={{ mb: 3 }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={runImmediately}
                    onChange={(e) => setRunImmediately(e.target.checked)}
                    color="primary"
                  />
                }
                label="Run pipeline immediately after saving"
              />

              {createMutation.isPending && (
                <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" sx={{ color: colors.textMuted }}>
                    Creating pipeline...
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          startIcon={<ArrowBack />}
          onClick={activeStep === 0 ? onCancel : handleBack}
          disabled={analyzeMutation.isPending || generateMutation.isPending || createMutation.isPending}
        >
          {activeStep === 0 ? 'Cancel' : 'Back'}
        </Button>

        <Button
          variant="contained"
          endIcon={activeStep === 3 ? <Check /> : <ArrowForward />}
          onClick={handleNext}
          disabled={
            !canProceed() ||
            analyzeMutation.isPending ||
            generateMutation.isPending ||
            createMutation.isPending
          }
        >
          {activeStep === 3 ? 'Create Pipeline' : 'Next'}
        </Button>
      </Box>
    </Box>
  );
}

export default PipelineWizard;
