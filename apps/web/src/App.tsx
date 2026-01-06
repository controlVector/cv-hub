import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import theme from './theme';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import PublicRoute from './components/PublicRoute';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import Repositories from './pages/Repositories';
import RepositoryDetail from './pages/RepositoryDetail';
import AIAssistant from './pages/AIAssistant';
import PullRequests from './pages/PullRequests';
import KnowledgeGraph from './pages/KnowledgeGraph';
import Search from './pages/Search';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import SecurityPage from './pages/settings/SecurityPage';
import DeveloperPage from './pages/settings/DeveloperPage';
import ConnectionsPage from './pages/settings/ConnectionsPage';
import ConsentPage from './pages/oauth/ConsentPage';
import SubmitFeatureRequest from './pages/features/SubmitFeatureRequest';
import MyFeatureRequests from './pages/features/MyFeatureRequests';
import AppStore from './pages/apps/AppStore';
import AppDetail from './pages/apps/AppDetail';
import OrganizationList from './pages/orgs/OrganizationList';
import OrganizationStorefront from './pages/orgs/OrganizationStorefront';
import CreateOrganization from './pages/orgs/CreateOrganization';
import OrganizationSettings from './pages/orgs/OrganizationSettings';
import CommitHistoryPage from './pages/CommitHistoryPage';
import CommitDetailPage from './pages/CommitDetailPage';
import BlamePage from './pages/BlamePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              {/* Public landing page */}
              <Route
                path="/"
                element={
                  <PublicRoute redirectTo="/dashboard">
                    <LandingPage />
                  </PublicRoute>
                }
              />

              {/* Public auth routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/oauth/consent" element={<ConsentPage />} />

              {/* Public apps pages (viewable without login) */}
              <Route path="/apps" element={<AppStore />} />
              <Route path="/apps/:appId" element={<AppDetail />} />
              <Route path="/orgs/:slug" element={<OrganizationStorefront />} />

              {/* Protected routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="repositories" element={<Repositories />} />
                <Route path="repositories/:owner/:repo" element={<RepositoryDetail />} />
                <Route path="repositories/:owner/:repo/commit/:sha" element={<CommitDetailPage />} />
                <Route path="repositories/:owner/:repo/commits/*" element={<CommitHistoryPage />} />
                <Route path="repositories/:owner/:repo/blame/*" element={<BlamePage />} />
                <Route path="repositories/:owner/:repo/*" element={<RepositoryDetail />} />
                <Route path="ai-assistant" element={<AIAssistant />} />
                <Route path="pull-requests" element={<PullRequests />} />
                <Route path="graph" element={<KnowledgeGraph />} />
                <Route path="search" element={<Search />} />
                <Route path="settings/security" element={<SecurityPage />} />
                <Route path="settings/developer" element={<DeveloperPage />} />
                <Route path="settings/connections" element={<ConnectionsPage />} />
                <Route path="features/submit" element={<SubmitFeatureRequest />} />
                <Route path="features/my-requests" element={<MyFeatureRequests />} />
                <Route path="orgs" element={<OrganizationList />} />
                <Route path="orgs/new" element={<CreateOrganization />} />
                <Route path="orgs/:slug/settings" element={<OrganizationSettings />} />
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
