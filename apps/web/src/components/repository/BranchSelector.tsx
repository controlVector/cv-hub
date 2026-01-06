/**
 * BranchSelector Component
 * Dropdown for selecting branches and tags
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Typography,
  TextField,
  InputAdornment,
  Divider,
} from '@mui/material';
import {
  KeyboardArrowDown,
  Search,
  AccountTree,
  LocalOffer,
  Check,
} from '@mui/icons-material';
import { colors } from '../../theme';
import type { Branch, Tag } from '../../services/repository';

interface BranchSelectorProps {
  currentRef: string;
  branches: Branch[];
  tags: Tag[];
  onSelect: (ref: string) => void;
}

export function BranchSelector({ currentRef, branches, tags, onSelect }: BranchSelectorProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'branches' | 'tags'>('branches');

  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setSearchQuery('');
  };

  const handleSelect = (ref: string) => {
    onSelect(ref);
    handleClose();
  };

  const filteredBranches = branches.filter(
    (b) => b.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTags = tags.filter(
    (t) => t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const items = activeTab === 'branches' ? filteredBranches : filteredTags;

  return (
    <>
      <Button
        onClick={handleClick}
        variant="outlined"
        size="small"
        endIcon={<KeyboardArrowDown />}
        sx={{
          minWidth: 120,
          justifyContent: 'space-between',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          borderColor: colors.navyLighter,
          '&:hover': {
            borderColor: colors.orange,
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <AccountTree sx={{ fontSize: 16 }} />
          {currentRef}
        </Box>
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            width: 300,
            maxHeight: 400,
            mt: 1,
          },
        }}
      >
        {/* Search */}
        <Box sx={{ px: 2, py: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Find a branch or tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 18, color: colors.textMuted }} />
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: '0.9rem',
              },
            }}
          />
        </Box>

        {/* Tabs */}
        <Box sx={{ display: 'flex', px: 2, pb: 1 }}>
          <Button
            size="small"
            startIcon={<AccountTree sx={{ fontSize: 16 }} />}
            onClick={() => setActiveTab('branches')}
            sx={{
              flex: 1,
              color: activeTab === 'branches' ? colors.orange : colors.textMuted,
              borderBottom: activeTab === 'branches' ? `2px solid ${colors.orange}` : 'none',
              borderRadius: 0,
            }}
          >
            Branches
          </Button>
          <Button
            size="small"
            startIcon={<LocalOffer sx={{ fontSize: 16 }} />}
            onClick={() => setActiveTab('tags')}
            sx={{
              flex: 1,
              color: activeTab === 'tags' ? colors.orange : colors.textMuted,
              borderBottom: activeTab === 'tags' ? `2px solid ${colors.orange}` : 'none',
              borderRadius: 0,
            }}
          >
            Tags
          </Button>
        </Box>

        <Divider />

        {/* Items list */}
        <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
          {items.length === 0 ? (
            <Typography
              variant="body2"
              sx={{ color: colors.textMuted, p: 2, textAlign: 'center' }}
            >
              No {activeTab} found
            </Typography>
          ) : (
            items.map((item) => {
              const name = item.name;
              const isSelected = name === currentRef;
              const isDefault = activeTab === 'branches' && (item as Branch).isDefault;

              return (
                <MenuItem
                  key={name}
                  onClick={() => handleSelect(name)}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    backgroundColor: isSelected ? `${colors.orange}15` : 'transparent',
                    '&:hover': {
                      backgroundColor: isSelected ? `${colors.orange}20` : undefined,
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isSelected && <Check sx={{ fontSize: 16, color: colors.green }} />}
                    <Typography
                      component="span"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        color: isSelected ? colors.orange : colors.textLight,
                      }}
                    >
                      {name}
                    </Typography>
                  </Box>
                  {isDefault && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: colors.textMuted,
                        fontSize: '0.7rem',
                      }}
                    >
                      default
                    </Typography>
                  )}
                </MenuItem>
              );
            })
          )}
        </Box>
      </Menu>
    </>
  );
}

export default BranchSelector;
