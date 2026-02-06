import { Container, Typography, Paper, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import {
  Security as SecurityIcon,
  Code as DeveloperIcon,
  Link as ConnectionsIcon,
  Dns as EnvironmentIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../theme';

const settingsItems = [
  {
    title: 'Security',
    description: 'Manage two-factor authentication, passkeys, and backup codes',
    icon: <SecurityIcon />,
    path: '/dashboard/settings/security',
  },
  {
    title: 'Developer',
    description: 'API tokens, OAuth applications, and webhooks',
    icon: <DeveloperIcon />,
    path: '/dashboard/settings/developer',
  },
  {
    title: 'Connections',
    description: 'Connect external services like GitHub, GitLab, and Bitbucket',
    icon: <ConnectionsIcon />,
    path: '/dashboard/settings/connections',
  },
  {
    title: 'Environment',
    description: 'Manage environment variables and secrets',
    icon: <EnvironmentIcon />,
    path: '/dashboard/settings/environment',
  },
];

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body2" sx={{ color: colors.textMuted, mb: 4 }}>
        Manage your account settings and preferences
      </Typography>

      <Paper>
        <List disablePadding>
          {settingsItems.map((item, index) => (
            <ListItemButton
              key={item.path}
              onClick={() => navigate(item.path)}
              sx={{
                py: 2.5,
                borderBottom: index < settingsItems.length - 1 ? `1px solid ${colors.slateLighter}` : 'none',
              }}
            >
              <ListItemIcon sx={{ color: colors.violet }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.title}
                secondary={item.description}
                primaryTypographyProps={{ fontWeight: 600 }}
                secondaryTypographyProps={{ sx: { color: colors.textMuted } }}
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>
    </Container>
  );
}
