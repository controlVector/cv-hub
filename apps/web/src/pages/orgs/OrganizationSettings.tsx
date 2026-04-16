import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Alert,
  FormControlLabel,
  Switch,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  Skeleton,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Warning as WarningIcon,
  PersonAdd as PersonAddIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import {
  getOrganization,
  updateOrganization,
  deleteOrganization,
  listMembers,
  updateMemberRole,
  removeMember,
  inviteMember,
  listPendingInvites,
  cancelInvite,
} from '../../services/organization';
import type { UpdateOrganizationInput, OrgRole } from '../../types/organization';
import { useAuth } from '../../contexts/AuthContext';
import { BillingCard, AISettingsCard } from '../../components/billing';
import { fetchOrgSubscription } from '../../services/pricing';
import TierLimitAlert from '../../components/TierLimitAlert';

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

const ROLE_COLORS: Record<OrgRole, string> = {
  owner: colors.orange,
  admin: colors.navyLighter,
  member: colors.navyLighter,
};

export default function OrganizationSettings() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const checkoutStatus = searchParams.get('checkout') as 'success' | 'canceled' | null;

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const { data: org, isLoading: orgLoading, error: orgError } = useQuery({
    queryKey: ['organization', slug],
    queryFn: () => getOrganization(slug!),
    enabled: !!slug,
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['organization-members', slug],
    queryFn: () => listMembers(slug!),
    enabled: !!slug,
  });

  const { data: subData } = useQuery({
    queryKey: ['org-subscription', org?.id],
    queryFn: () => fetchOrgSubscription(org!.id),
    enabled: !!org?.id,
  });

  const [formData, setFormData] = useState<UpdateOrganizationInput>({});

  // Initialize form when org loads
  useEffect(() => {
    if (org) {
      setFormData({
        name: org.name,
        description: org.description || '',
        logoUrl: org.logoUrl || '',
        websiteUrl: org.websiteUrl || '',
        isPublic: org.isPublic,
      });
    }
  }, [org]);

  const updateMutation = useMutation({
    mutationFn: (data: UpdateOrganizationInput) => updateOrganization(slug!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', slug] });
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteOrganization(slug!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      queryClient.invalidateQueries({ queryKey: ['my-organizations'] });
      navigate('/orgs');
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: OrgRole }) =>
      updateMemberRole(slug!, memberId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members', slug] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => removeMember(slug!, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members', slug] });
      queryClient.invalidateQueries({ queryKey: ['organization', slug] });
    },
  });

  // Invite member functionality
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const { data: pendingInvites } = useQuery({
    queryKey: ['org-invites', slug],
    queryFn: () => listPendingInvites(slug!),
    enabled: !!slug,
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteMember(slug!, inviteEmail, inviteRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invites', slug] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteSuccess('Invitation sent');
      setTimeout(() => setInviteSuccess(''), 3000);
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => cancelInvite(slug!, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invites', slug] });
    },
  });

  // Find current user's role
  const currentMember = members?.find((m) => m.user.id === user?.id);
  const isOwner = currentMember?.role === 'owner';
  const isAdmin = currentMember?.role === 'owner' || currentMember?.role === 'admin';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  const handleDelete = () => {
    if (deleteConfirm === org?.slug) {
      deleteMutation.mutate();
    }
  };

  if (orgError) {
    return (
      <Box>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/orgs')} sx={{ mb: 2 }}>
          Back to Organizations
        </Button>
        <Alert severity="error">
          Organization not found or you don't have access.
        </Alert>
      </Box>
    );
  }

  if (!isAdmin && !orgLoading) {
    return (
      <Box>
        <Button startIcon={<BackIcon />} onClick={() => navigate(`/orgs/${slug}`)} sx={{ mb: 2 }}>
          Back to Organization
        </Button>
        <Alert severity="error">
          You don't have permission to manage this organization.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Button startIcon={<BackIcon />} onClick={() => navigate(`/orgs/${slug}`)} sx={{ mb: 2 }}>
        Back to Organization
      </Button>

      <Typography variant="h4" sx={{ fontWeight: 700, mb: 4 }}>
        Organization Settings
      </Typography>

      {orgLoading ? (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Skeleton variant="text" width="30%" height={40} sx={{ mb: 2 }} />
            <Skeleton variant="rectangular" height={56} sx={{ mb: 2 }} />
            <Skeleton variant="rectangular" height={56} sx={{ mb: 2 }} />
            <Skeleton variant="rectangular" height={100} />
          </CardContent>
        </Card>
      ) : org ? (
        <>
          {/* General Settings */}
          <Card sx={{ mb: 4 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                General Settings
              </Typography>

              {updateMutation.isSuccess && (
                <Alert severity="success" sx={{ mb: 3 }}>
                  Organization updated successfully!
                </Alert>
              )}

              {updateMutation.error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                  Failed to update organization
                </Alert>
              )}

              <form onSubmit={handleSubmit}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <TextField
                    label="Organization Name"
                    value={formData.name ?? org.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    fullWidth
                  />

                  <TextField
                    label="Description"
                    value={formData.description ?? org.description ?? ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    fullWidth
                    multiline
                    rows={3}
                  />

                  <TextField
                    label="Logo URL"
                    value={formData.logoUrl ?? org.logoUrl ?? ''}
                    onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                    fullWidth
                    type="url"
                  />

                  <TextField
                    label="Website URL"
                    value={formData.websiteUrl ?? org.websiteUrl ?? ''}
                    onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                    fullWidth
                    type="url"
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={formData.isPublic ?? org.isPublic}
                        onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
                      />
                    }
                    label="Public organization"
                  />

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={<SaveIcon />}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </Box>
                </Box>
              </form>
            </CardContent>
          </Card>

          {/* Members */}
          <Card sx={{ mb: 4 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Members
                </Typography>
                {isAdmin && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<PersonAddIcon />}
                    onClick={() => setInviteOpen(true)}
                  >
                    Invite member
                  </Button>
                )}
              </Box>

              {inviteSuccess && (
                <Alert severity="success" sx={{ mb: 2 }}>{inviteSuccess}</Alert>
              )}

              <TierLimitAlert error={removeMemberMutation.error} orgSlug={slug} />
              <TierLimitAlert error={updateRoleMutation.error} orgSlug={slug} />

              {membersLoading ? (
                <Box>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} variant="rectangular" height={56} sx={{ mb: 1 }} />
                  ))}
                </Box>
              ) : (
                <List>
                  {members?.map((member) => (
                    <ListItem key={member.id} divider>
                      <ListItemAvatar>
                        <Avatar src={member.user.avatarUrl || undefined}>
                          <PersonIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={member.user.displayName || member.user.email}
                        secondary={member.user.email}
                      />
                      <ListItemSecondaryAction>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {isOwner && member.role !== 'owner' ? (
                            <FormControl size="small" sx={{ minWidth: 100 }}>
                              <Select
                                value={member.role}
                                onChange={(e) =>
                                  updateRoleMutation.mutate({
                                    memberId: member.userId,
                                    role: e.target.value as OrgRole,
                                  })
                                }
                                disabled={updateRoleMutation.isPending}
                              >
                                <MenuItem value="admin">Admin</MenuItem>
                                <MenuItem value="member">Member</MenuItem>
                              </Select>
                            </FormControl>
                          ) : (
                            <Chip
                              label={ROLE_LABELS[member.role]}
                              size="small"
                              sx={{
                                backgroundColor: ROLE_COLORS[member.role],
                                color: member.role === 'owner' ? 'white' : undefined,
                              }}
                            />
                          )}

                          {isAdmin && member.role !== 'owner' && member.userId !== user?.id && (
                            <IconButton
                              edge="end"
                              onClick={() => removeMemberMutation.mutate(member.userId)}
                              disabled={removeMemberMutation.isPending}
                              color="error"
                              size="small"
                            >
                              <DeleteIcon />
                            </IconButton>
                          )}
                        </Box>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}

              {/* Pending Invites */}
              {pendingInvites && pendingInvites.length > 0 && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: colors.textMuted, mb: 1 }}>
                    Pending Invitations
                  </Typography>
                  <List dense>
                    {pendingInvites.map((invite) => (
                      <ListItem key={invite.id} divider>
                        <ListItemText
                          primary={invite.email}
                          secondary={`Invited as ${invite.role} — ${new Date(invite.createdAt).toLocaleDateString()}`}
                        />
                        {isAdmin && (
                          <ListItemSecondaryAction>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => cancelInviteMutation.mutate(invite.id)}
                              title="Cancel invitation"
                            >
                              <CancelIcon fontSize="small" />
                            </IconButton>
                          </ListItemSecondaryAction>
                        )}
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Invite Member Dialog */}
          <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogContent>
              <TextField
                label="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                fullWidth
                autoFocus
                type="email"
                placeholder="colleague@example.com"
                sx={{ mt: 1, mb: 2 }}
              />
              <FormControl fullWidth>
                <Select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  size="small"
                >
                  <MenuItem value="member">Member — Can view repos and participate</MenuItem>
                  <MenuItem value="admin">Admin — Full access including settings</MenuItem>
                </Select>
              </FormControl>
              {inviteMutation.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {(inviteMutation.error as Error).message || 'Failed to send invitation'}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={() => inviteMutation.mutate()}
                disabled={!inviteEmail || inviteMutation.isPending}
                startIcon={<PersonAddIcon />}
              >
                {inviteMutation.isPending ? 'Sending...' : 'Send Invitation'}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Billing */}
          {isAdmin && org && (
            <BillingCard
              organizationId={org.id}
              orgSlug={slug!}
              isAdmin={isAdmin}
              checkoutStatus={checkoutStatus}
            />
          )}

          {/* AI & Embeddings */}
          {isAdmin && org && (
            <AISettingsCard
              organizationId={org.id}
              orgSlug={slug!}
              isAdmin={isAdmin}
              tier={subData?.tier || 'starter'}
            />
          )}

          {/* Danger Zone */}
          {isOwner && (
            <Card sx={{ border: `1px solid ${colors.coral}` }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 1, color: colors.coral }}>
                  Danger Zone
                </Typography>
                <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
                  Deleting an organization will remove all associated data including apps and releases.
                  This action cannot be undone.
                </Typography>

                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<WarningIcon />}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  Delete Organization
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Delete Confirmation Dialog */}
          <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WarningIcon color="error" />
              Delete Organization
            </DialogTitle>
            <DialogContent>
              <DialogContentText sx={{ mb: 2 }}>
                Are you sure you want to delete <strong>{org.name}</strong>? This will permanently
                delete all apps, releases, and data associated with this organization.
              </DialogContentText>
              <DialogContentText sx={{ mb: 2 }}>
                Type <strong>{org.slug}</strong> to confirm:
              </DialogContentText>
              <TextField
                fullWidth
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={org.slug}
                autoComplete="off"
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleDelete}
                color="error"
                variant="contained"
                disabled={deleteConfirm !== org.slug || deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Organization'}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      ) : null}
    </Box>
  );
}
