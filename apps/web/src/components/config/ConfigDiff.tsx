import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import {
  Add as AddIcon,
  Remove as RemoveIcon,
  Compare as CompareIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';

interface DiffValue {
  key: string;
  value: unknown;
}

interface DiffResult {
  onlyInFirst: DiffValue[];
  onlyInSecond: DiffValue[];
  different: Array<{
    key: string;
    firstValue: unknown;
    secondValue: unknown;
  }>;
  same: DiffValue[];
}

interface ConfigDiffProps {
  firstName: string;
  secondName: string;
  diff: DiffResult;
  showUnchanged?: boolean;
}

export default function ConfigDiff({
  firstName,
  secondName,
  diff,
  showUnchanged = false,
}: ConfigDiffProps) {
  const formatValue = (value: unknown): string => {
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const totalChanges = diff.onlyInFirst.length + diff.onlyInSecond.length + diff.different.length;

  return (
    <Box>
      {/* Summary */}
      <Paper sx={{ bgcolor: colors.slateLight, p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <RemoveIcon sx={{ color: colors.rose }} />
            <Typography>
              <strong>{diff.onlyInFirst.length}</strong> removed
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddIcon sx={{ color: colors.green }} />
            <Typography>
              <strong>{diff.onlyInSecond.length}</strong> added
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CompareIcon sx={{ color: colors.amber }} />
            <Typography>
              <strong>{diff.different.length}</strong> modified
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckIcon sx={{ color: colors.textMuted }} />
            <Typography>
              <strong>{diff.same.length}</strong> unchanged
            </Typography>
          </Box>
        </Box>
      </Paper>

      {totalChanges === 0 && !showUnchanged ? (
        <Paper sx={{ bgcolor: colors.slateLight, p: 4, textAlign: 'center' }}>
          <CheckIcon sx={{ fontSize: 48, color: colors.green, mb: 2 }} />
          <Typography variant="h6">No differences found</Typography>
          <Typography color="text.secondary">
            Both config sets have identical values
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} sx={{ bgcolor: colors.slateLight }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: 80 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Key</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{firstName}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{secondName}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Removed (only in first) */}
              {diff.onlyInFirst.map(({ key, value }) => (
                <TableRow key={`removed-${key}`} sx={{ bgcolor: `${colors.rose}10` }}>
                  <TableCell>
                    <Chip
                      icon={<RemoveIcon />}
                      label="Removed"
                      size="small"
                      sx={{
                        bgcolor: `${colors.rose}20`,
                        color: colors.rose,
                        '& .MuiChip-icon': { color: colors.rose },
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography fontFamily="monospace" fontWeight={500}>
                      {key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      fontFamily="monospace"
                      sx={{
                        bgcolor: `${colors.rose}20`,
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        display: 'inline-block',
                      }}
                    >
                      {formatValue(value)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography color="text.secondary" fontStyle="italic">
                      (not present)
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}

              {/* Added (only in second) */}
              {diff.onlyInSecond.map(({ key, value }) => (
                <TableRow key={`added-${key}`} sx={{ bgcolor: `${colors.green}10` }}>
                  <TableCell>
                    <Chip
                      icon={<AddIcon />}
                      label="Added"
                      size="small"
                      sx={{
                        bgcolor: `${colors.green}20`,
                        color: colors.green,
                        '& .MuiChip-icon': { color: colors.green },
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography fontFamily="monospace" fontWeight={500}>
                      {key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography color="text.secondary" fontStyle="italic">
                      (not present)
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      fontFamily="monospace"
                      sx={{
                        bgcolor: `${colors.green}20`,
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        display: 'inline-block',
                      }}
                    >
                      {formatValue(value)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}

              {/* Modified */}
              {diff.different.map(({ key, firstValue, secondValue }) => (
                <TableRow key={`modified-${key}`} sx={{ bgcolor: `${colors.amber}10` }}>
                  <TableCell>
                    <Chip
                      icon={<CompareIcon />}
                      label="Modified"
                      size="small"
                      sx={{
                        bgcolor: `${colors.amber}20`,
                        color: colors.amber,
                        '& .MuiChip-icon': { color: colors.amber },
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography fontFamily="monospace" fontWeight={500}>
                      {key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      fontFamily="monospace"
                      sx={{
                        bgcolor: `${colors.rose}20`,
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        display: 'inline-block',
                        textDecoration: 'line-through',
                      }}
                    >
                      {formatValue(firstValue)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      fontFamily="monospace"
                      sx={{
                        bgcolor: `${colors.green}20`,
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        display: 'inline-block',
                      }}
                    >
                      {formatValue(secondValue)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}

              {/* Unchanged */}
              {showUnchanged && diff.same.map(({ key, value }) => (
                <TableRow key={`same-${key}`}>
                  <TableCell>
                    <Chip
                      icon={<CheckIcon />}
                      label="Same"
                      size="small"
                      sx={{
                        bgcolor: colors.slateLighter,
                        color: colors.textMuted,
                        '& .MuiChip-icon': { color: colors.textMuted },
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography fontFamily="monospace" fontWeight={500} color="text.secondary">
                      {key}
                    </Typography>
                  </TableCell>
                  <TableCell colSpan={2}>
                    <Typography fontFamily="monospace" color="text.secondary">
                      {formatValue(value)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
