import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  Stepper,
  Step,
  StepLabel,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
} from '@mui/material';
import {
  Lightbulb as IdeaIcon,
  Send as SendIcon,
  CheckCircle as SuccessIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { submitFeatureRequest } from '../../services/feature-request';
import type { FeatureRequestInput, FeatureRequestCreateResponse } from '../../types/feature-request';

const steps = ['Describe the Problem', 'Propose a Solution', 'Review & Submit'];

export default function SubmitFeatureRequest() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeStep, setActiveStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [response, setResponse] = useState<FeatureRequestCreateResponse | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [proposedSolution, setProposedSolution] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');

  const canProceedStep0 = title.length >= 5 && problemStatement.length >= 20;
  const canProceedStep1 = true; // Solution is optional

  const handleNext = () => {
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const handleSubmit = async () => {
    if (!user) return;

    setSubmitting(true);
    setError(null);

    try {
      const input: FeatureRequestInput = {
        title,
        problemStatement,
        proposedSolution: proposedSolution || undefined,
        successCriteria: successCriteria || undefined,
        additionalContext: additionalContext || undefined,
      };

      const result = await submitFeatureRequest(
        user.id,
        user.displayName || user.username,
        user.email,
        input
      );

      setResponse(result);
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to submit feature request');
    } finally {
      setSubmitting(false);
    }
  };

  if (success && response) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <SuccessIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            Feature Request Submitted!
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Your request has been received and will be reviewed by our team.
          </Typography>

          {response.ai_analysis && (
            <Card variant="outlined" sx={{ textAlign: 'left', mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  AI Analysis
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {response.ai_analysis.summary}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip
                    label={`Type: ${response.ai_analysis.request_type}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                  <Chip
                    label={`Category: ${response.ai_analysis.category}`}
                    size="small"
                    variant="outlined"
                  />
                  <Chip
                    label={`Priority: ${response.ai_analysis.priority_suggestion}`}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              </CardContent>
            </Card>
          )}

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button variant="outlined" onClick={() => navigate('/features/my-requests')}>
              View My Requests
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                setSuccess(false);
                setResponse(null);
                setActiveStep(0);
                setTitle('');
                setProblemStatement('');
                setProposedSolution('');
                setSuccessCriteria('');
                setAdditionalContext('');
              }}
            >
              Submit Another
            </Button>
          </Box>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <IdeaIcon sx={{ fontSize: 32, color: 'primary.main' }} />
          <Typography variant="h4">Submit a Feature Request</Typography>
        </Box>
        <Typography color="text.secondary">
          Help us improve by sharing your ideas. Your request will be reviewed and may become a new feature!
        </Typography>
      </Box>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 4 }}>
        {activeStep === 0 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              What problem are you trying to solve?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Start with a clear title and describe the problem you're experiencing.
            </Typography>

            <TextField
              fullWidth
              label="Title"
              placeholder="e.g., Add dark mode support"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              sx={{ mb: 3 }}
              helperText={`${title.length}/255 characters (minimum 5)`}
              error={title.length > 0 && title.length < 5}
            />

            <TextField
              fullWidth
              multiline
              rows={6}
              label="Problem Statement"
              placeholder="Describe the problem in detail. What's not working? What's frustrating? Who does this affect?"
              value={problemStatement}
              onChange={(e) => setProblemStatement(e.target.value)}
              helperText={`${problemStatement.length} characters (minimum 20)`}
              error={problemStatement.length > 0 && problemStatement.length < 20}
            />
          </Box>
        )}

        {activeStep === 1 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              How would you solve it? (Optional)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              If you have ideas for a solution, share them here. This helps us understand your vision.
            </Typography>

            <TextField
              fullWidth
              multiline
              rows={4}
              label="Proposed Solution"
              placeholder="Describe your ideal solution..."
              value={proposedSolution}
              onChange={(e) => setProposedSolution(e.target.value)}
              sx={{ mb: 3 }}
            />

            <TextField
              fullWidth
              multiline
              rows={3}
              label="Success Criteria"
              placeholder="What would success look like? How would you know the problem is solved?"
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              sx={{ mb: 3 }}
            />

            <TextField
              fullWidth
              multiline
              rows={3}
              label="Additional Context"
              placeholder="Any other details, links, or references that might help..."
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value)}
            />
          </Box>
        )}

        {activeStep === 2 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Review Your Request
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Please review your submission before sending.
            </Typography>

            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">
                  Title
                </Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {title}
                </Typography>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" color="text.secondary">
                  Problem Statement
                </Typography>
                <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                  {problemStatement}
                </Typography>

                {proposedSolution && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" color="text.secondary">
                      Proposed Solution
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                      {proposedSolution}
                    </Typography>
                  </>
                )}

                {successCriteria && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" color="text.secondary">
                      Success Criteria
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {successCriteria}
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>

            <Alert severity="info">
              After submission, your request will be analyzed by AI and reviewed by our team.
              You'll be able to track its status on the "My Requests" page.
            </Alert>
          </Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          <Button disabled={activeStep === 0} onClick={handleBack}>
            Back
          </Button>

          {activeStep < 2 ? (
            <Button
              variant="contained"
              onClick={handleNext}
              disabled={activeStep === 0 ? !canProceedStep0 : !canProceedStep1}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              onClick={handleSubmit}
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={20} /> : <SendIcon />}
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          )}
        </Box>
      </Paper>
    </Container>
  );
}
