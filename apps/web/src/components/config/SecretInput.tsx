import { useState } from 'react';
import {
  TextField,
  InputAdornment,
  IconButton,
  Tooltip,
} from '@mui/material';
import type { TextFieldProps } from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';

interface SecretInputProps extends Omit<TextFieldProps, 'type'> {
  onCopy?: () => void;
  showCopyButton?: boolean;
  masked?: boolean;
}

export default function SecretInput({
  onCopy,
  showCopyButton = true,
  masked = true,
  value,
  ...props
}: SecretInputProps) {
  const [showValue, setShowValue] = useState(!masked);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (value) {
      navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy?.();
    }
  };

  const handleToggleVisibility = () => {
    setShowValue(!showValue);
  };

  return (
    <TextField
      {...props}
      value={value}
      type={showValue ? 'text' : 'password'}
      InputProps={{
        ...props.InputProps,
        sx: {
          fontFamily: 'monospace',
          ...props.InputProps?.sx,
        },
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={showValue ? 'Hide' : 'Show'}>
              <IconButton
                onClick={handleToggleVisibility}
                edge="end"
                size="small"
              >
                {showValue ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </IconButton>
            </Tooltip>
            {showCopyButton && (
              <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                <IconButton
                  onClick={handleCopy}
                  edge="end"
                  size="small"
                  sx={{ color: copied ? colors.green : undefined }}
                >
                  <CopyIcon />
                </IconButton>
              </Tooltip>
            )}
          </InputAdornment>
        ),
      }}
    />
  );
}
