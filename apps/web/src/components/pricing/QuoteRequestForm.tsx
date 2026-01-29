import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Alert,
  CircularProgress,
  alpha,
} from '@mui/material';
import { Send as SendIcon, CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import type { SubmitQuoteInput, BillingInterval, PricingRequirements } from '../../types/pricing';
import { submitQuoteRequest } from '../../services/pricing';
import { colors } from '../../theme';

interface QuoteRequestFormProps {
  requestedTier?: string;
  billingInterval?: BillingInterval;
  requirements?: PricingRequirements;
  onSuccess?: () => void;
}

export default function QuoteRequestForm({
  requestedTier = 'enterprise',
  billingInterval = 'annual',
  requirements,
  onSuccess,
}: QuoteRequestFormProps) {
  const [formData, setFormData] = useState<SubmitQuoteInput>({
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    companyName: '',
    companySize: undefined,
    requestedTier,
    billingInterval,
    requirements: {
      ...requirements,
      additionalNotes: '',
    },
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (field: keyof SubmitQuoteInput) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | { target: { value: string } }
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: e.target.value,
    }));
  };

  const handleRequirementsChange = (field: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const value = field === 'additionalNotes' ? e.target.value : Number(e.target.value);
    setFormData((prev) => ({
      ...prev,
      requirements: {
        ...prev.requirements,
        [field]: value,
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await submitQuoteRequest(formData);
      setSuccess(true);
      onSuccess?.();
    } catch (err: any) {
      setError(
        err.response?.data?.error?.message ||
          'Failed to submit quote request. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <CheckCircleIcon sx={{ fontSize: 64, color: colors.green, mb: 2 }} />
        <Typography variant="h5" gutterBottom>
          Quote Request Submitted!
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Thank you for your interest. Our sales team will contact you within 1 business day.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Request a Quote
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Fill out the form below and our team will get back to you with a custom quote.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit}>
        {/* Contact info section */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 2,
            mb: 3,
          }}
        >
          <TextField
            required
            label="Full Name"
            value={formData.contactName}
            onChange={handleChange('contactName')}
            fullWidth
          />
          <TextField
            required
            type="email"
            label="Email Address"
            value={formData.contactEmail}
            onChange={handleChange('contactEmail')}
            fullWidth
          />
          <TextField
            label="Phone Number"
            value={formData.contactPhone}
            onChange={handleChange('contactPhone')}
            fullWidth
          />
          <TextField
            label="Company Name"
            value={formData.companyName}
            onChange={handleChange('companyName')}
            fullWidth
          />
        </Box>

        {/* Company size */}
        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>Company Size</InputLabel>
          <Select
            value={formData.companySize || ''}
            label="Company Size"
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                companySize: e.target.value as SubmitQuoteInput['companySize'],
              }))
            }
          >
            <MenuItem value="">Select...</MenuItem>
            <MenuItem value="1-10">1-10 employees</MenuItem>
            <MenuItem value="11-50">11-50 employees</MenuItem>
            <MenuItem value="51-200">51-200 employees</MenuItem>
            <MenuItem value="201-500">201-500 employees</MenuItem>
            <MenuItem value="500+">500+ employees</MenuItem>
          </Select>
        </FormControl>

        {/* Requirements section */}
        <Box
          sx={{
            p: 2,
            bgcolor: alpha(colors.violet, 0.05),
            borderRadius: 1,
            mb: 3,
          }}
        >
          <Typography variant="subtitle2" gutterBottom sx={{ color: colors.violetLight }}>
            Your Requirements (Optional)
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' },
              gap: 2,
              mb: 2,
            }}
          >
            <TextField
              type="number"
              label="Environments"
              value={formData.requirements?.environments || ''}
              onChange={handleRequirementsChange('environments')}
              inputProps={{ min: 0 }}
              size="small"
            />
            <TextField
              type="number"
              label="Repositories"
              value={formData.requirements?.repositories || ''}
              onChange={handleRequirementsChange('repositories')}
              inputProps={{ min: 0 }}
              size="small"
            />
            <TextField
              type="number"
              label="Team Members"
              value={formData.requirements?.teamMembers || ''}
              onChange={handleRequirementsChange('teamMembers')}
              inputProps={{ min: 0 }}
              size="small"
            />
            <TextField
              type="number"
              label="Storage (GB)"
              value={formData.requirements?.storageGb || ''}
              onChange={handleRequirementsChange('storageGb')}
              inputProps={{ min: 0 }}
              size="small"
            />
            <TextField
              type="number"
              label="Build Minutes / Month"
              value={formData.requirements?.buildMinutes || ''}
              onChange={handleRequirementsChange('buildMinutes')}
              inputProps={{ min: 0 }}
              size="small"
            />
          </Box>
          <TextField
            label="Additional Notes"
            value={formData.requirements?.additionalNotes || ''}
            onChange={handleRequirementsChange('additionalNotes')}
            multiline
            rows={3}
            fullWidth
            placeholder="Tell us about your specific needs, compliance requirements, or any questions..."
          />
        </Box>

        {/* Submit */}
        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
          sx={{
            py: 1.5,
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          {loading ? 'Submitting...' : 'Submit Quote Request'}
        </Button>
      </Box>
    </Paper>
  );
}
