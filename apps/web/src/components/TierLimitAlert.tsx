import { Alert, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getApiError, isTierLimitError } from '../lib/api';

interface TierLimitAlertProps {
  error: unknown;
  orgSlug?: string;
}

export default function TierLimitAlert({ error, orgSlug }: TierLimitAlertProps) {
  const navigate = useNavigate();

  if (!isTierLimitError(error)) return null;

  const apiError = getApiError(error)!;

  return (
    <Alert
      severity="warning"
      sx={{ mb: 2 }}
      action={
        orgSlug ? (
          <Button
            color="inherit"
            size="small"
            onClick={() => navigate(`/dashboard/orgs/${orgSlug}/settings?tab=billing`)}
          >
            Upgrade Plan
          </Button>
        ) : undefined
      }
    >
      {apiError.message}
      {apiError.current != null && apiError.limit != null && (
        <> ({apiError.current}/{apiError.limit})</>
      )}
    </Alert>
  );
}
