import { createTheme, alpha } from '@mui/material/styles';

// Control Fabric Color Palette - Dark theme with purple/violet AI aesthetic
const colors = {
  // Base dark colors
  slate: '#0f172a',       // Deepest background
  slateLight: '#1e293b',  // Card/paper background
  slateLighter: '#334155', // Borders, dividers

  // Primary purple/violet spectrum
  violet: '#8b5cf6',      // Primary - vibrant violet
  violetLight: '#a78bfa', // Lighter variant
  violetDark: '#7c3aed',  // Darker/hover variant
  purple: '#a855f7',      // Secondary purple

  // Accent colors
  cyan: '#06b6d4',        // Accent - bright cyan for contrast
  cyanLight: '#22d3ee',   // Light cyan

  // Text
  textLight: '#f8fafc',
  textMuted: 'rgba(248, 250, 252, 0.7)',

  // Status colors
  green: '#10b981',       // Success - emerald
  blue: '#3b82f6',        // Info
  amber: '#f59e0b',       // Warning
  rose: '#f43f5e',        // Error/danger
  teal: '#14b8a6',        // Teal

  // Glow effects
  violetGlow: 'rgba(139, 92, 246, 0.15)',
  cyanGlow: 'rgba(6, 182, 212, 0.15)',

  // Legacy aliases (for backward compatibility during migration)
  navy: '#0f172a',        // -> slate
  navyLight: '#1e293b',   // -> slateLight
  navyLighter: '#334155', // -> slateLighter
  orange: '#8b5cf6',      // -> violet (primary)
  coral: '#f43f5e',       // -> rose (error/accent)
  amberGlow: 'rgba(139, 92, 246, 0.15)', // -> violetGlow
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: colors.violet,
      light: colors.violetLight,
      dark: colors.violetDark,
      contrastText: colors.textLight,
    },
    secondary: {
      main: colors.cyan,
      light: colors.cyanLight,
      dark: '#0891b2',
      contrastText: colors.slate,
    },
    background: {
      default: colors.slate,
      paper: colors.slateLight,
    },
    text: {
      primary: colors.textLight,
      secondary: colors.textMuted,
    },
    success: {
      main: colors.green,
    },
    info: {
      main: colors.blue,
    },
    warning: {
      main: colors.amber,
    },
    error: {
      main: colors.rose,
    },
    divider: colors.slateLighter,
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      'Oxygen',
      'Ubuntu',
      'Cantarell',
      '"Fira Sans"',
      '"Droid Sans"',
      '"Helvetica Neue"',
      'sans-serif',
    ].join(','),
    h1: {
      fontSize: '2.5rem',
      fontWeight: 700,
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 600,
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 600,
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '1.1rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
    },
    button: {
      textTransform: 'none',
      fontWeight: 500,
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: colors.slate,
          scrollbarColor: `${colors.slateLighter} ${colors.slate}`,
          '&::-webkit-scrollbar': {
            width: '10px',
          },
          '&::-webkit-scrollbar-track': {
            background: colors.slate,
          },
          '&::-webkit-scrollbar-thumb': {
            background: colors.slateLighter,
            borderRadius: '5px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: colors.violet,
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          padding: '8px 16px',
          transition: 'all 0.2s ease',
        },
        contained: {
          background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          '&:hover': {
            background: `linear-gradient(135deg, ${colors.violetDark} 0%, ${colors.violet} 100%)`,
            boxShadow: `0 4px 15px ${colors.violetGlow}`,
            transform: 'translateY(-1px)',
          },
        },
        outlined: {
          borderColor: colors.violet,
          color: colors.violet,
          '&:hover': {
            borderColor: colors.violetLight,
            backgroundColor: alpha(colors.violet, 0.1),
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${colors.slateLighter}`,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: colors.slateLight,
          border: `1px solid ${colors.slateLighter}`,
          borderRadius: 12,
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: colors.violet,
            boxShadow: `0 8px 25px ${colors.violetGlow}`,
            transform: 'translateY(-2px)',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: colors.slateLight,
          borderBottom: `1px solid ${colors.slateLighter}`,
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: colors.slateLight,
          borderRight: `1px solid ${colors.slateLighter}`,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '2px 8px',
          '&:hover': {
            backgroundColor: alpha(colors.violet, 0.1),
          },
          '&.Mui-selected': {
            backgroundColor: alpha(colors.violet, 0.15),
            '&:hover': {
              backgroundColor: alpha(colors.violet, 0.2),
            },
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          '&.Mui-selected': {
            color: colors.violet,
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          background: `linear-gradient(90deg, ${colors.violet} 0%, ${colors.cyan} 100%)`,
          height: 3,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
        filled: {
          backgroundColor: colors.slateLighter,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: colors.slate,
            '& fieldset': {
              borderColor: colors.slateLighter,
            },
            '&:hover fieldset': {
              borderColor: colors.violet,
            },
            '&.Mui-focused fieldset': {
              borderColor: colors.violet,
              boxShadow: `0 0 0 3px ${colors.violetGlow}`,
            },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: colors.slateLight,
          border: `1px solid ${colors.slateLighter}`,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colors.slateLighter,
          border: `1px solid ${colors.violet}`,
          fontSize: '0.85rem',
        },
      },
    },
  },
});

export { colors };
export default theme;
