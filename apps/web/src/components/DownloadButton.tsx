import { useState, useRef } from 'react';
import {
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  Box,
} from '@mui/material';
import {
  Download as DownloadIcon,
  ExpandMore as ExpandIcon,
  Computer as WindowsIcon,
  Apple as AppleIcon,
  Code as LinuxIcon,
} from '@mui/icons-material';
import { colors } from '../theme';

interface ReleaseAsset {
  id: string;
  platform: string;
  fileName: string;
  fileSize: number;
  downloadUrl: string;
}

interface Release {
  id: string;
  version: string;
  assets?: ReleaseAsset[];
}

interface DownloadButtonProps {
  appId: string;
  release: Release;
  variant?: 'contained' | 'outlined';
}

type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

function detectPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();

  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }
  if (platform.includes('mac') || userAgent.includes('mac')) {
    return 'macos';
  }
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'linux';
  }
  return 'unknown';
}

function detectArch(): 'x64' | 'arm64' {
  // Check for ARM architecture indicators
  const userAgent = navigator.userAgent.toLowerCase();

  // Apple Silicon detection
  if (userAgent.includes('mac') && (
    // Check for ARM indicators in various ways
    /arm|aarch64/i.test(navigator.platform) ||
    // On macOS, check if it's likely Apple Silicon
    (window as any).navigator?.userAgentData?.platform === 'macOS'
  )) {
    // Most newer Macs are Apple Silicon, default to ARM
    // This is a heuristic - could be improved with feature detection
    return 'arm64';
  }

  // Default to x64 for most systems
  return 'x64';
}

function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    'windows-x64': 'Windows (64-bit)',
    'windows-arm64': 'Windows (ARM)',
    'macos-x64': 'macOS (Intel)',
    'macos-arm64': 'macOS (Apple Silicon)',
    'linux-x64': 'Linux (64-bit)',
    'linux-arm64': 'Linux (ARM)',
  };
  return labels[platform] || platform;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getBestMatch(assets: ReleaseAsset[] | undefined): ReleaseAsset | null {
  if (!assets || assets.length === 0) return null;

  const detectedPlatform = detectPlatform();
  const detectedArch = detectArch();

  // Try to find exact match
  const exactMatch = assets.find(a =>
    a.platform === `${detectedPlatform}-${detectedArch}`
  );
  if (exactMatch) return exactMatch;

  // Try to find platform match with different arch
  const platformMatch = assets.find(a =>
    a.platform.startsWith(detectedPlatform)
  );
  if (platformMatch) return platformMatch;

  // Return first available
  return assets[0];
}

export default function DownloadButton({ appId, release, variant = 'contained' }: DownloadButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const open = Boolean(anchorEl);

  const assets = release.assets || [];
  const bestMatch = getBestMatch(assets);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (assets.length <= 1 && bestMatch) {
      // Direct download if only one option
      window.location.href = `/api/v1/apps/${appId}/download/${bestMatch.platform}`;
    } else {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleDownload = (platform: string) => {
    window.location.href = `/api/v1/apps/${appId}/download/${platform}`;
    handleClose();
  };

  if (!bestMatch) {
    return (
      <Button
        variant={variant}
        disabled
        startIcon={<DownloadIcon />}
      >
        No Downloads Available
      </Button>
    );
  }

  // Group assets by OS
  const windowsAssets = assets.filter(a => a.platform.startsWith('windows'));
  const macosAssets = assets.filter(a => a.platform.startsWith('macos'));
  const linuxAssets = assets.filter(a => a.platform.startsWith('linux'));

  return (
    <Box ref={buttonRef}>
      <Button
        variant={variant}
        onClick={handleClick}
        startIcon={<DownloadIcon />}
        endIcon={assets.length > 1 ? <ExpandIcon /> : null}
        sx={{
          minWidth: 180,
          ...(variant === 'contained' && {
            background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
            '&:hover': {
              background: `linear-gradient(135deg, #e09518 0%, #d44a62 100%)`,
            },
          }),
        }}
      >
        Download v{release.version}
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            minWidth: 280,
            backgroundColor: colors.navyLight,
            border: `1px solid ${colors.navyLighter}`,
          },
        }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" sx={{ color: colors.textMuted }}>
            Select your platform
          </Typography>
        </Box>
        <Divider />

        {windowsAssets.length > 0 && (
          <>
            <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: colors.textMuted }}>
              Windows
            </Typography>
            {windowsAssets.map(asset => (
              <MenuItem
                key={asset.id}
                onClick={() => handleDownload(asset.platform)}
                sx={{
                  mx: 1,
                  borderRadius: 1,
                  '&:hover': {
                    backgroundColor: colors.navy,
                  },
                }}
              >
                <ListItemIcon>
                  <WindowsIcon sx={{ color: colors.blue }} />
                </ListItemIcon>
                <ListItemText
                  primary={getPlatformLabel(asset.platform)}
                  secondary={formatBytes(asset.fileSize)}
                />
                {asset.platform === bestMatch.platform && (
                  <Typography variant="caption" sx={{ color: colors.orange, ml: 1 }}>
                    Recommended
                  </Typography>
                )}
              </MenuItem>
            ))}
          </>
        )}

        {macosAssets.length > 0 && (
          <>
            <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: colors.textMuted }}>
              macOS
            </Typography>
            {macosAssets.map(asset => (
              <MenuItem
                key={asset.id}
                onClick={() => handleDownload(asset.platform)}
                sx={{
                  mx: 1,
                  borderRadius: 1,
                  '&:hover': {
                    backgroundColor: colors.navy,
                  },
                }}
              >
                <ListItemIcon>
                  <AppleIcon sx={{ color: colors.textLight }} />
                </ListItemIcon>
                <ListItemText
                  primary={getPlatformLabel(asset.platform)}
                  secondary={formatBytes(asset.fileSize)}
                />
                {asset.platform === bestMatch.platform && (
                  <Typography variant="caption" sx={{ color: colors.orange, ml: 1 }}>
                    Recommended
                  </Typography>
                )}
              </MenuItem>
            ))}
          </>
        )}

        {linuxAssets.length > 0 && (
          <>
            <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: colors.textMuted }}>
              Linux
            </Typography>
            {linuxAssets.map(asset => (
              <MenuItem
                key={asset.id}
                onClick={() => handleDownload(asset.platform)}
                sx={{
                  mx: 1,
                  borderRadius: 1,
                  '&:hover': {
                    backgroundColor: colors.navy,
                  },
                }}
              >
                <ListItemIcon>
                  <LinuxIcon sx={{ color: colors.orange }} />
                </ListItemIcon>
                <ListItemText
                  primary={getPlatformLabel(asset.platform)}
                  secondary={formatBytes(asset.fileSize)}
                />
                {asset.platform === bestMatch.platform && (
                  <Typography variant="caption" sx={{ color: colors.orange, ml: 1 }}>
                    Recommended
                  </Typography>
                )}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </Box>
  );
}
