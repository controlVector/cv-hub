import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import theme from './theme';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Repositories from './pages/Repositories';
import RepositoryDetail from './pages/RepositoryDetail';
import AIAssistant from './pages/AIAssistant';
import PullRequests from './pages/PullRequests';
import KnowledgeGraph from './pages/KnowledgeGraph';
import Search from './pages/Search';

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
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="repositories" element={<Repositories />} />
              <Route path="repositories/:owner/:repo" element={<RepositoryDetail />} />
              <Route path="repositories/:owner/:repo/*" element={<RepositoryDetail />} />
              <Route path="ai-assistant" element={<AIAssistant />} />
              <Route path="pull-requests" element={<PullRequests />} />
              <Route path="graph" element={<KnowledgeGraph />} />
              <Route path="search" element={<Search />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
