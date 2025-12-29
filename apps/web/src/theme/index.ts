import { createTheme, alpha } from '@mui/material/styles';

// CV-PRD Color Palette - Dark theme with orange-coral accents
const colors = {
  navy: '#1e2a3a',
  navyLight: '#2a3a4d',
  navyLighter: '#3a4d63',
  orange: '#f5a623',
  coral: '#e85d75',
  textLight: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.7)',
  green: '#48bb78',
  blue: '#4299e1',
  purple: '#9f7aea',
  teal: '#38b2ac',
  amberGlow: 'rgba(245, 166, 35, 0.15)',
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: colors.orange,
      light: '#f7b84d',
      dark: '#e09518',
      contrastText: colors.navy,
    },
    secondary: {
      main: colors.coral,
      light: '#ec7a8f',
      dark: '#d44a62',
      contrastText: colors.textLight,
    },
    background: {
      default: colors.navy,
      paper: colors.navyLight,
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
      main: colors.orange,
    },
    error: {
      main: colors.coral,
    },
    divider: colors.navyLighter,
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
          backgroundColor: colors.navy,
          scrollbarColor: `${colors.navyLighter} ${colors.navy}`,
          '&::-webkit-scrollbar': {
            width: '10px',
          },
          '&::-webkit-scrollbar-track': {
            background: colors.navy,
          },
          '&::-webkit-scrollbar-thumb': {
            background: colors.navyLighter,
            borderRadius: '5px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: colors.orange,
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
          background: `linear-gradient(135deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
          '&:hover': {
            background: `linear-gradient(135deg, #e09518 0%, #d44a62 100%)`,
            boxShadow: `0 4px 15px ${colors.amberGlow}`,
            transform: 'translateY(-1px)',
          },
        },
        outlined: {
          borderColor: colors.orange,
          color: colors.orange,
          '&:hover': {
            borderColor: colors.orange,
            backgroundColor: alpha(colors.orange, 0.1),
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${colors.navyLighter}`,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: colors.navyLight,
          border: `2px solid ${colors.navyLighter}`,
          borderRadius: 12,
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: colors.orange,
            boxShadow: `0 8px 25px ${colors.amberGlow}`,
            transform: 'translateY(-3px)',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: colors.navyLight,
          borderBottom: `1px solid ${colors.navyLighter}`,
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: colors.navyLight,
          borderRight: `1px solid ${colors.navyLighter}`,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '2px 8px',
          '&:hover': {
            backgroundColor: alpha(colors.orange, 0.1),
          },
          '&.Mui-selected': {
            backgroundColor: alpha(colors.orange, 0.15),
            '&:hover': {
              backgroundColor: alpha(colors.orange, 0.2),
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
            color: colors.orange,
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          background: `linear-gradient(90deg, ${colors.orange} 0%, ${colors.coral} 100%)`,
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
          backgroundColor: colors.navyLighter,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: colors.navy,
            '& fieldset': {
              borderColor: colors.navyLighter,
            },
            '&:hover fieldset': {
              borderColor: colors.orange,
            },
            '&.Mui-focused fieldset': {
              borderColor: colors.orange,
              boxShadow: `0 0 0 3px ${colors.amberGlow}`,
            },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: colors.navyLight,
          border: `1px solid ${colors.navyLighter}`,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colors.navyLighter,
          border: `1px solid ${colors.orange}`,
          fontSize: '0.85rem',
        },
      },
    },
  },
});

export { colors };
export default theme;
