import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  InputBase,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Badge,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Folder as RepoIcon,
  CallMerge as PRIcon,
  Search as SearchIcon,
  AutoAwesome as AIIcon,
  BubbleChart as GraphIcon,
  Settings as SettingsIcon,
  Notifications as NotificationsIcon,
  Add as AddIcon,
  KeyboardArrowDown,
  Security as SecurityIcon,
  Store as StoreIcon,
  Business as BusinessIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { colors } from '../theme';
import { useAuth } from '../contexts/AuthContext';

const drawerWidth = 260;

const menuItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'Repositories', icon: <RepoIcon />, path: '/dashboard/repositories' },
  { text: 'Pull Requests', icon: <PRIcon />, path: '/dashboard/pull-requests' },
  { text: 'AI Assistant', icon: <AIIcon />, path: '/dashboard/ai-assistant' },
  { text: 'Knowledge Graph', icon: <GraphIcon />, path: '/dashboard/graph' },
  { text: 'Search', icon: <SearchIcon />, path: '/dashboard/search' },
  { text: 'App Store', icon: <StoreIcon />, path: '/apps' },
  { text: 'Organizations', icon: <BusinessIcon />, path: '/dashboard/orgs' },
];

export default function Layout() {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { user, logout } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleProfileClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      navigate(`/dashboard/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Logo */}
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          component="img"
          src="/logo.png"
          alt="Control Fabric"
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
          }}
        />
        <Box>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Control Fabric
          </Typography>
          <Typography variant="caption" sx={{ color: colors.textMuted }}>
            The AI Development Platform
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ borderColor: colors.slateLighter }} />

      {/* New Repository Button */}
      <Box sx={{ p: 2 }}>
        <Box
          onClick={() => navigate('/dashboard/repositories/new')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            p: 1.5,
            borderRadius: 2,
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
            color: colors.textLight,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'translateY(-1px)',
              boxShadow: `0 4px 15px ${colors.violetGlow}`,
            },
          }}
        >
          <AddIcon />
          New Repository
        </Box>
      </Box>

      {/* Navigation */}
      <List sx={{ flex: 1, px: 1 }}>
        {menuItems.map((item) => (
          <ListItemButton
            key={item.text}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              if (isMobile) setMobileOpen(false);
            }}
            sx={{
              mb: 0.5,
              '&.Mui-selected': {
                '& .MuiListItemIcon-root': {
                  color: colors.violet,
                },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40, color: colors.textMuted }}>
              {item.icon}
            </ListItemIcon>
            <ListItemText primary={item.text} />
            {item.text === 'AI Assistant' && (
              <Box
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                  color: colors.textLight,
                }}
              >
                AI
              </Box>
            )}
          </ListItemButton>
        ))}
      </List>

      <Divider sx={{ borderColor: colors.slateLighter }} />

      {/* AI Usage Stats */}
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" sx={{ color: colors.textMuted }}>
          AI Operations
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box
            sx={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              backgroundColor: colors.slateLighter,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                width: '35%',
                height: '100%',
                background: `linear-gradient(90deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                borderRadius: 3,
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: colors.textMuted }}>
            3.5K/10K
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* App Bar */}
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          {/* Search Bar */}
          <Box
            sx={{
              flex: 1,
              maxWidth: 600,
              display: 'flex',
              alignItems: 'center',
              backgroundColor: colors.slate,
              borderRadius: 2,
              border: `1px solid ${colors.slateLighter}`,
              px: 2,
              transition: 'all 0.2s ease',
              '&:focus-within': {
                borderColor: colors.violet,
                boxShadow: `0 0 0 3px ${colors.violetGlow}`,
              },
            }}
          >
            <SearchIcon sx={{ color: colors.textMuted, mr: 1 }} />
            <InputBase
              placeholder="Search repositories, code, or use AI commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              sx={{
                flex: 1,
                color: colors.textLight,
                '& input::placeholder': {
                  color: colors.textMuted,
                  opacity: 1,
                },
              }}
            />
            <Box
              sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 0.5,
                ml: 1,
                px: 1,
                py: 0.25,
                borderRadius: 1,
                backgroundColor: colors.slateLighter,
                fontSize: '0.75rem',
                color: colors.textMuted,
              }}
            >
              <kbd>/</kbd>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Notifications */}
            <Tooltip title="Notifications">
              <IconButton color="inherit">
                <Badge badgeContent={3} color="secondary">
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* Settings */}
            <Tooltip title="Settings">
              <IconButton color="inherit" onClick={() => navigate('/dashboard/settings')}>
                <SettingsIcon />
              </IconButton>
            </Tooltip>

            {/* Profile */}
            <Box
              onClick={handleProfileClick}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                ml: 1,
                p: 0.5,
                borderRadius: 2,
                '&:hover': {
                  backgroundColor: alpha(colors.violet, 0.1),
                },
              }}
            >
              <Avatar
                src={user?.avatarUrl}
                sx={{
                  width: 32,
                  height: 32,
                  background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
                }}
              >
                {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
              </Avatar>
              <KeyboardArrowDown sx={{ color: colors.textMuted }} />
            </Box>
          </Box>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
            PaperProps={{
              sx: { minWidth: 200, mt: 1 },
            }}
          >
            <MenuItem onClick={() => { handleMenuClose(); navigate('/dashboard/profile'); }}>
              Your Profile
            </MenuItem>
            <MenuItem onClick={() => { handleMenuClose(); navigate('/dashboard/repositories'); }}>
              Your Repositories
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { handleMenuClose(); navigate('/dashboard/settings'); }}>
              Settings
            </MenuItem>
            <MenuItem onClick={() => { handleMenuClose(); navigate('/dashboard/settings/security'); }}>
              <SecurityIcon sx={{ mr: 1, fontSize: '1.2rem' }} />
              Security
            </MenuItem>
            <MenuItem onClick={() => { handleMenuClose(); navigate('/dashboard/settings/connections'); }}>
              <LinkIcon sx={{ mr: 1, fontSize: '1.2rem' }} />
              Connections
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { handleMenuClose(); logout(); }} sx={{ color: colors.rose }}>
              Sign Out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Drawer */}
      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
      >
        {/* Mobile drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>

        {/* Desktop drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          minHeight: '100vh',
          backgroundColor: colors.slate,
        }}
      >
        <Toolbar />
        <Box sx={{ p: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
