import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  IconButton,
  Button,
  Skeleton,
  Alert,
  Tooltip,
  Collapse,
  Card,
  CardContent,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { listMyFeatureRequests } from '../../services/feature-request';
import type { FeatureRequest, RequestStatus } from '../../types/feature-request';
import { STATUS_LABELS, STATUS_COLORS } from '../../types/feature-request';

export default function MyFeatureRequests() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const result = await listMyFeatureRequests(user.id, page + 1, rowsPerPage);
      setRequests(result.requests);
      setTotalCount(result.total);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [user, page, rowsPerPage]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const toggleExpand = (requestId: string) => {
    setExpandedRow(expandedRow === requestId ? null : requestId);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusChip = (status: RequestStatus) => (
    <Chip
      label={STATUS_LABELS[status] || status}
      color={STATUS_COLORS[status] || 'default'}
      size="small"
    />
  );

  if (!user) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning">Please log in to view your feature requests.</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" gutterBottom>
            My Feature Requests
          </Typography>
          <Typography color="text.secondary">
            Track the status of your submitted feature requests.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchRequests} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/features/submit')}
          >
            New Request
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell width={40} />
                <TableCell>Title</TableCell>
                <TableCell width={120}>Type</TableCell>
                <TableCell width={150}>Status</TableCell>
                <TableCell width={120}>Created</TableCell>
                <TableCell width={80} align="center">
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                // Loading skeleton
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Skeleton variant="circular" width={24} height={24} />
                    </TableCell>
                    <TableCell>
                      <Skeleton variant="text" width="80%" />
                    </TableCell>
                    <TableCell>
                      <Skeleton variant="text" width={60} />
                    </TableCell>
                    <TableCell>
                      <Skeleton variant="rounded" width={80} height={24} />
                    </TableCell>
                    <TableCell>
                      <Skeleton variant="text" width={80} />
                    </TableCell>
                    <TableCell>
                      <Skeleton variant="circular" width={24} height={24} />
                    </TableCell>
                  </TableRow>
                ))
              ) : requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                    <Typography color="text.secondary" gutterBottom>
                      No feature requests yet
                    </Typography>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={() => navigate('/features/submit')}
                      sx={{ mt: 1 }}
                    >
                      Submit Your First Request
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((request) => (
                  <>
                    <TableRow
                      key={request.id}
                      hover
                      sx={{ '& > *': { borderBottom: expandedRow === request.id ? 'unset' : undefined } }}
                    >
                      <TableCell>
                        <IconButton size="small" onClick={() => toggleExpand(request.id)}>
                          {expandedRow === request.id ? <CollapseIcon /> : <ExpandIcon />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {request.title}
                        </Typography>
                        {request.category && (
                          <Typography variant="caption" color="text.secondary">
                            {request.category}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                          {request.request_type || 'feature'}
                        </Typography>
                      </TableCell>
                      <TableCell>{getStatusChip(request.status)}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{formatDate(request.created_at)}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="View Details">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/features/requests/${request.id}`)}
                          >
                            <ViewIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                    <TableRow key={`${request.id}-details`}>
                      <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
                        <Collapse in={expandedRow === request.id} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 2, px: 3 }}>
                            <Card variant="outlined">
                              <CardContent>
                                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                  Problem Statement
                                </Typography>
                                <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                                  {request.problem_statement}
                                </Typography>

                                {request.ai_summary && (
                                  <>
                                    <Divider sx={{ my: 2 }} />
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                      AI Summary
                                    </Typography>
                                    <Typography variant="body2" sx={{ mb: 2 }}>
                                      {request.ai_summary}
                                    </Typography>
                                  </>
                                )}

                                {request.tags && request.tags.length > 0 && (
                                  <Box sx={{ mt: 2 }}>
                                    {request.tags.map((tag) => (
                                      <Chip
                                        key={tag}
                                        label={tag}
                                        size="small"
                                        variant="outlined"
                                        sx={{ mr: 0.5, mb: 0.5 }}
                                      />
                                    ))}
                                  </Box>
                                )}

                                {request.reviewer_notes && (
                                  <>
                                    <Divider sx={{ my: 2 }} />
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                      Reviewer Notes
                                    </Typography>
                                    <Typography variant="body2">{request.reviewer_notes}</Typography>
                                  </>
                                )}

                                {request.rejection_reason && (
                                  <>
                                    <Divider sx={{ my: 2 }} />
                                    <Alert severity="error" sx={{ mt: 1 }}>
                                      <Typography variant="subtitle2" gutterBottom>
                                        Rejection Reason
                                      </Typography>
                                      <Typography variant="body2">{request.rejection_reason}</Typography>
                                    </Alert>
                                  </>
                                )}

                                <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap' }}>
                                  {request.priority && (
                                    <Typography variant="caption" color="text.secondary">
                                      Priority: <strong>{request.priority}</strong>
                                    </Typography>
                                  )}
                                  {request.triaged_at && (
                                    <Typography variant="caption" color="text.secondary">
                                      Triaged: {formatDate(request.triaged_at)}
                                    </Typography>
                                  )}
                                  {request.accepted_at && (
                                    <Typography variant="caption" color="text.secondary">
                                      Accepted: {formatDate(request.accepted_at)}
                                    </Typography>
                                  )}
                                  {request.shipped_at && (
                                    <Typography variant="caption" color="text.secondary">
                                      Shipped: {formatDate(request.shipped_at)}
                                    </Typography>
                                  )}
                                </Box>
                              </CardContent>
                            </Card>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={totalCount}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[5, 10, 25]}
        />
      </Paper>
    </Container>
  );
}
