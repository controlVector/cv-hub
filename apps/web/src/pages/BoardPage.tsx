import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Paper,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Skeleton,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowForward as ArrowForwardIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { colors } from '../theme';
import { api } from '../lib/api';

// ── Types ───────────────────────────────────────────────────────────────────

interface BoardTask {
  id: string;
  title: string;
  description?: string;
  task_type: string;
  status: string;
  priority: string;
  repository_id?: string;
  branch?: string;
  thread_id?: string;
  executor_id?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

// ── Column config ───────────────────────────────────────────────────────────

const BOARD_COLUMNS = [
  { key: 'pending', label: 'Backlog', color: colors.textMuted },
  { key: 'queued', label: 'To Do', color: '#3b82f6' },
  { key: 'running', label: 'In Progress', color: '#f59e0b' },
  { key: 'completed', label: 'Done', color: colors.green },
] as const;

const STATUS_ORDER = BOARD_COLUMNS.map((c) => c.key);

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: colors.textMuted,
};

const TYPE_LABELS: Record<string, string> = {
  code_change: 'Code',
  review: 'Review',
  debug: 'Debug',
  research: 'Research',
  deploy: 'Deploy',
  test: 'Test',
  custom: 'Custom',
};

// ── Component ───────────────────────────────────────────────────────────────

export default function BoardPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [repoFilter, setRepoFilter] = useState<string>('');
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    task_type: 'custom' as string,
    priority: 'medium' as string,
  });

  // Fetch tasks
  const { data, isLoading, error } = useQuery<{ tasks: BoardTask[] }>({
    queryKey: ['board-tasks', repoFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (repoFilter) params.set('repository_id', repoFilter);
      const res = await api.get(`/v1/tasks?${params.toString()}`);
      return res.data;
    },
    staleTime: 10_000,
  });

  // Create task
  const createMutation = useMutation({
    mutationFn: async (body: typeof newTask) => {
      const res = await api.post('/v1/tasks', body);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-tasks'] });
      setCreateOpen(false);
      setNewTask({ title: '', description: '', task_type: 'custom', priority: 'medium' });
    },
  });

  // Update status (move between columns)
  const moveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await api.patch(`/v1/tasks/${id}`, { status });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-tasks'] });
    },
  });

  const tasks = data?.tasks ?? [];

  // Group tasks by column
  const grouped: Record<string, BoardTask[]> = {};
  for (const col of BOARD_COLUMNS) {
    grouped[col.key] = [];
  }
  for (const t of tasks) {
    // Map assigned status to queued column, failed to completed column
    let bucket = t.status;
    if (bucket === 'assigned') bucket = 'queued';
    if (bucket === 'failed' || bucket === 'cancelled') bucket = 'completed';
    if (grouped[bucket]) {
      grouped[bucket].push(t);
    }
  }

  function moveTask(taskId: string, currentStatus: string, direction: 'forward' | 'back') {
    const currentIdx = STATUS_ORDER.indexOf(currentStatus as any);
    const nextIdx = direction === 'forward' ? currentIdx + 1 : currentIdx - 1;
    if (nextIdx < 0 || nextIdx >= STATUS_ORDER.length) return;
    moveMutation.mutate({ id: taskId, status: STATUS_ORDER[nextIdx] });
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Board
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted, mt: 0.5 }}>
            Manage tasks across your workflow
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{
            background: `linear-gradient(135deg, ${colors.violet} 0%, ${colors.purple} 100%)`,
          }}
        >
          New Task
        </Button>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load tasks
        </Alert>
      )}

      {/* Board columns */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 2,
          minHeight: 400,
        }}
      >
        {BOARD_COLUMNS.map((col) => (
          <Paper
            key={col.key}
            sx={{
              p: 2,
              backgroundColor: colors.slateLight,
              borderTop: `3px solid ${col.color}`,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                {col.label}
              </Typography>
              <Chip
                label={isLoading ? '...' : grouped[col.key]?.length ?? 0}
                size="small"
                sx={{ backgroundColor: colors.slateLighter, minWidth: 28 }}
              />
            </Box>

            {isLoading ? (
              <>
                <Skeleton variant="rounded" height={80} sx={{ mb: 1 }} />
                <Skeleton variant="rounded" height={80} sx={{ mb: 1 }} />
              </>
            ) : grouped[col.key]?.length === 0 ? (
              <Typography
                variant="body2"
                sx={{ color: colors.textMuted, textAlign: 'center', mt: 4 }}
              >
                No tasks
              </Typography>
            ) : (
              grouped[col.key]?.map((task) => (
                <Paper
                  key={task.id}
                  elevation={1}
                  sx={{
                    p: 1.5,
                    mb: 1,
                    backgroundColor: colors.slate,
                    cursor: 'default',
                    '&:hover': { borderColor: colors.violet },
                    border: `1px solid ${colors.slateLighter}`,
                    borderRadius: 1.5,
                  }}
                >
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                    {task.title}
                  </Typography>
                  {task.description && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: colors.textMuted,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mb: 0.5,
                      }}
                    >
                      {task.description}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip
                      label={TYPE_LABELS[task.task_type] ?? task.task_type}
                      size="small"
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                    <Chip
                      label={task.priority}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        color: PRIORITY_COLORS[task.priority] ?? colors.textMuted,
                        borderColor: PRIORITY_COLORS[task.priority] ?? colors.textMuted,
                      }}
                      variant="outlined"
                    />
                    {task.status === 'failed' && (
                      <Chip label="Failed" size="small" color="error" sx={{ height: 20, fontSize: '0.7rem' }} />
                    )}
                  </Box>
                  {/* Move buttons */}
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, gap: 0.5 }}>
                    {STATUS_ORDER.indexOf(col.key) > 0 && (
                      <IconButton
                        size="small"
                        onClick={() => moveTask(task.id, col.key, 'back')}
                        aria-label="move back"
                        sx={{ p: 0.5 }}
                      >
                        <ArrowBackIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                    {STATUS_ORDER.indexOf(col.key) < STATUS_ORDER.length - 1 && (
                      <IconButton
                        size="small"
                        onClick={() => moveTask(task.id, col.key, 'forward')}
                        aria-label="move forward"
                        sx={{ p: 0.5 }}
                      >
                        <ArrowForwardIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                  </Box>
                </Paper>
              ))
            )}
          </Paper>
        ))}
      </Box>

      {/* Create Task Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Task</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField
            label="Title"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            fullWidth
            required
          />
          <TextField
            label="Description"
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            fullWidth
            multiline
            rows={3}
          />
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select
              value={newTask.task_type}
              label="Type"
              onChange={(e) => setNewTask({ ...newTask, task_type: e.target.value })}
            >
              <MenuItem value="code_change">Code Change</MenuItem>
              <MenuItem value="review">Review</MenuItem>
              <MenuItem value="debug">Debug</MenuItem>
              <MenuItem value="research">Research</MenuItem>
              <MenuItem value="deploy">Deploy</MenuItem>
              <MenuItem value="test">Test</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Priority</InputLabel>
            <Select
              value={newTask.priority}
              label="Priority"
              onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newTask.title.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(newTask)}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
