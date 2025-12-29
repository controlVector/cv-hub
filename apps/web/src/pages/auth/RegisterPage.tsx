import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  CircularProgress,
} from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, isAuthenticated } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    displayName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
  if (isAuthenticated) {
    navigate('/', { replace: true });
    return null;
  }

  function handleChange(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData(prev => ({ ...prev, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      await register({
        email: formData.email,
        username: formData.username,
        password: formData.password,
        displayName: formData.displayName || undefined,
      });
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1e2a3a',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%', backgroundColor: '#2a3a4d' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" align="center" gutterBottom sx={{ color: '#fff' }}>
            Create Account
          </Typography>
          <Typography variant="body2" align="center" sx={{ mb: 3, color: 'rgba(255,255,255,0.7)' }}>
            Join ControlVector today
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={formData.email}
              onChange={handleChange('email')}
              margin="normal"
              required
              autoComplete="email"
              autoFocus
            />
            <TextField
              fullWidth
              label="Username"
              value={formData.username}
              onChange={handleChange('username')}
              margin="normal"
              required
              autoComplete="username"
              helperText="3-30 characters, letters, numbers, _ and -"
            />
            <TextField
              fullWidth
              label="Display Name"
              value={formData.displayName}
              onChange={handleChange('displayName')}
              margin="normal"
              autoComplete="name"
            />
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={formData.password}
              onChange={handleChange('password')}
              margin="normal"
              required
              autoComplete="new-password"
              helperText="At least 8 characters with uppercase, lowercase, and number"
            />
            <TextField
              fullWidth
              label="Confirm Password"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange('confirmPassword')}
              margin="normal"
              required
              autoComplete="new-password"
            />

            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              sx={{ mt: 3 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Create Account'}
            </Button>
          </form>

          <Typography variant="body2" align="center" sx={{ mt: 3, color: 'rgba(255,255,255,0.7)' }}>
            Already have an account?{' '}
            <Link component={RouterLink} to="/login" sx={{ color: '#f5a623' }}>
              Sign in
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
