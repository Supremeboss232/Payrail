import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#6366f1', // brand indigo
    },
    secondary: {
      main: '#06b6d4',
    },
    error: {
      main: '#f43f5e',
    },
    background: {
      default: '#060a12',
      paper: '#0d1526'
    },
    text: {
      primary: '#f0f4ff',
      secondary: '#8fa3c4'
    }
  },
  typography: {
    fontFamily: [
      'Inter',
      'Roboto',
      'Helvetica Neue',
      'Arial',
      'sans-serif'
    ].join(',')
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 10,
        }
      }
    }
  }
});

export default theme;
