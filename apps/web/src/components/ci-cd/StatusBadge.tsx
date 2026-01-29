/**
 * StatusBadge Component
 * Displays pipeline/job status with appropriate colors and animations
 */

import { Chip, keyframes } from '@mui/material';
import {
  CheckCircle,
  Cancel,
  HourglassEmpty,
  PlayCircle,
  StopCircle,
  SkipNext,
  Timer,
  Schedule,
} from '@mui/icons-material';
import type { PipelineRunStatus, JobStatus } from '../../types/ci-cd';

// Pulsing animation for running status
const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(6, 182, 212, 0.4);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(6, 182, 212, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(6, 182, 212, 0);
  }
`;

type StatusType = PipelineRunStatus | JobStatus;

interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ElementType;
  animate?: boolean;
}

const statusConfigs: Record<StatusType, StatusConfig> = {
  pending: {
    label: 'Pending',
    color: '#f59e0b', // amber
    bgColor: 'rgba(245, 158, 11, 0.15)',
    icon: HourglassEmpty,
  },
  queued: {
    label: 'Queued',
    color: '#f59e0b', // amber
    bgColor: 'rgba(245, 158, 11, 0.15)',
    icon: Schedule,
  },
  running: {
    label: 'Running',
    color: '#06b6d4', // cyan
    bgColor: 'rgba(6, 182, 212, 0.15)',
    icon: PlayCircle,
    animate: true,
  },
  success: {
    label: 'Success',
    color: '#10b981', // green
    bgColor: 'rgba(16, 185, 129, 0.15)',
    icon: CheckCircle,
  },
  failure: {
    label: 'Failed',
    color: '#f43f5e', // rose
    bgColor: 'rgba(244, 63, 94, 0.15)',
    icon: Cancel,
  },
  cancelled: {
    label: 'Cancelled',
    color: '#94a3b8', // gray
    bgColor: 'rgba(148, 163, 184, 0.15)',
    icon: StopCircle,
  },
  skipped: {
    label: 'Skipped',
    color: '#94a3b8', // gray
    bgColor: 'rgba(148, 163, 184, 0.15)',
    icon: SkipNext,
  },
  timed_out: {
    label: 'Timed Out',
    color: '#f59e0b', // amber
    bgColor: 'rgba(245, 158, 11, 0.15)',
    icon: Timer,
  },
};

interface StatusBadgeProps {
  status: StatusType;
  size?: 'small' | 'medium';
  showIcon?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  size = 'small',
  showIcon = true,
  className,
}: StatusBadgeProps) {
  const config = statusConfigs[status] || statusConfigs.pending;
  const Icon = config.icon;

  return (
    <Chip
      className={className}
      size={size}
      label={config.label}
      icon={showIcon ? <Icon sx={{ fontSize: size === 'small' ? 16 : 20 }} /> : undefined}
      sx={{
        backgroundColor: config.bgColor,
        color: config.color,
        border: `1px solid ${config.color}`,
        fontWeight: 500,
        fontSize: size === 'small' ? '0.75rem' : '0.875rem',
        '& .MuiChip-icon': {
          color: config.color,
        },
        ...(config.animate && {
          animation: `${pulse} 2s infinite`,
        }),
      }}
    />
  );
}

export default StatusBadge;
