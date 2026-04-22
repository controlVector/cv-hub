import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Skeleton,
  Alert,
  Avatar,
  Chip,
  Button,
  IconButton,
  Tooltip,
  Tabs,
  Tab,
  Stack,
  Link as MuiLink,
} from '@mui/material';
import {
  Business as BusinessIcon,
  Apps as AppsIcon,
  People as PeopleIcon,
  Language as WebsiteIcon,
  Settings as SettingsIcon,
  Download as DownloadIcon,
  Verified as VerifiedIcon,
  ArrowBack as BackIcon,
  Code as CodeIcon,
  Star as StarIcon,
  Folder as RepoIcon,
  Add as AddIcon,
  Lock as LockIcon,
  Public as PublicIcon,
  Archive as ArchiveIcon,
  CallMerge as PRIcon,
  BugReport as IssueIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import {
  getOrganization,
  getOrganizationApps,
  getMyOrganizations,
  listOrganizationRepos,
  listMembers,
  type OrgRepositorySummary,
} from '../../services/organization';
import { useAuth } from '../../contexts/AuthContext';
import { brand } from '../../config/brand';

interface App {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  category: string;
  isFeatured: boolean;
  totalDownloads: number;
  latestRelease?: {
    version: string;
    publishedAt: string;
  } | null;
}

function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return d.toLocaleDateString();
}

export default function OrganizationStorefront() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [tab, setTab] = useState(0);

  const { data: org, isLoading: orgLoading, error: orgError } = useQuery({
    queryKey: ['organization', slug],
    queryFn: () => getOrganization(slug!),
    enabled: !!slug,
  });

  const { data: apps, isLoading: appsLoading } = useQuery<App[]>({
    queryKey: ['organization-apps', slug],
    queryFn: () => getOrganizationApps(slug!),
    enabled: !!slug,
  });

  const { data: myOrgs } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: getMyOrganizations,
    enabled: isAuthenticated,
  });

  const isMember = !!myOrgs?.some((o) => o.slug === slug);

  // Lazy-load per-tab data — only fetch members/repos once the member has opened the tab
  // (and we know they have access).
  const { data: reposData, isLoading: reposLoading, error: reposError } = useQuery({
    queryKey: ['organization-repos', slug],
    queryFn: () => listOrganizationRepos(slug!),
    enabled: !!slug && isMember && tab === 1,
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['organization-members', slug],
    queryFn: () => listMembers(slug!),
    enabled: !!slug && isMember && tab === 2,
  });

  if (orgError) {
    return (
      <Box>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/dashboard/orgs')} sx={{ mb: 2 }}>
          Back to Organizations
        </Button>
        <Alert severity="error">
          Organization not found or you don't have access.
        </Alert>
      </Box>
    );
  }

  const featuredApps = apps?.filter((app) => app.isFeatured) || [];
  const otherApps = apps?.filter((app) => !app.isFeatured) || [];

  return (
    <Box>
      <Button startIcon={<BackIcon />} onClick={() => navigate('/dashboard/orgs')} sx={{ mb: 2 }}>
        Back to Organizations
      </Button>

      {/* Organization Header */}
      {orgLoading ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 3 }}>
              <Skeleton variant="circular" width={96} height={96} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="40%" height={40} />
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="30%" />
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : org ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Avatar
                src={org.logoUrl || undefined}
                sx={{ width: 96, height: 96, backgroundColor: colors.navyLighter }}
              >
                <BusinessIcon sx={{ fontSize: 48 }} />
              </Avatar>

              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    {org.name}
                  </Typography>
                  {org.isVerified && (
                    <Tooltip title="Verified Organization">
                      <VerifiedIcon sx={{ fontSize: 28, color: colors.orange }} />
                    </Tooltip>
                  )}
                </Box>

                <Typography variant="body1" sx={{ color: colors.textMuted, mb: 2 }}>
                  @{org.slug}
                </Typography>

                {org.description && (
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {org.description}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip
                    icon={<AppsIcon sx={{ fontSize: 16 }} />}
                    label={`${org.appCount} applications`}
                    sx={{ backgroundColor: colors.navyLighter }}
                  />
                  <Chip
                    icon={<PeopleIcon sx={{ fontSize: 16 }} />}
                    label={`${org.memberCount} members`}
                    sx={{ backgroundColor: colors.navyLighter }}
                  />
                  {org.websiteUrl && (
                    <Button
                      size="small"
                      startIcon={<WebsiteIcon />}
                      href={org.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Website
                    </Button>
                  )}
                </Box>
              </Box>

              {isMember && (
                <Box>
                  <Tooltip title="Organization Settings">
                    <IconButton onClick={() => navigate(`/dashboard/orgs/${slug}/settings`)}>
                      <SettingsIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {/* Tabs — Repositories + Members only shown to members */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab
            icon={brand.features.appstore ? <AppsIcon fontSize="small" /> : <BusinessIcon fontSize="small" />}
            iconPosition="start"
            label="Overview"
          />
          {isMember && (
            <Tab icon={<RepoIcon fontSize="small" />} iconPosition="start" label="Repositories" />
          )}
          {isMember && (
            <Tab icon={<PeopleIcon fontSize="small" />} iconPosition="start" label="Members" />
          )}
        </Tabs>
      </Box>

      {/* Overview — public + members */}
      {tab === 0 && (
        <OverviewTab
          featuredApps={featuredApps}
          otherApps={otherApps}
          apps={apps}
          appsLoading={appsLoading}
          onOpenApp={(id) => navigate(`/apps/${id}`)}
        />
      )}

      {/* Repositories — member-only */}
      {tab === 1 && isMember && (
        <RepositoriesTab
          slug={slug!}
          orgName={org?.name ?? slug!}
          isLoading={reposLoading}
          error={reposError as Error | null}
          repos={reposData?.repositories ?? []}
          onCreateRepo={() =>
            navigate(`/dashboard/repositories/new?org=${encodeURIComponent(slug!)}`)
          }
          onOpenRepo={(repoSlug) =>
            navigate(`/dashboard/repositories/${slug}/${repoSlug}`)
          }
        />
      )}

      {/* Members — member-only */}
      {tab === 2 && isMember && (
        <MembersTab
          slug={slug!}
          isLoading={membersLoading}
          members={members ?? []}
          onManage={() => navigate(`/dashboard/orgs/${slug}/settings`)}
        />
      )}
    </Box>
  );
}

// ============================================================================
// Tab: Overview (public-facing app storefront)
// ============================================================================

interface OverviewTabProps {
  featuredApps: App[];
  otherApps: App[];
  apps: App[] | undefined;
  appsLoading: boolean;
  onOpenApp: (id: string) => void;
}

function OverviewTab({ featuredApps, otherApps, apps, appsLoading, onOpenApp }: OverviewTabProps) {
  // If app-store is disabled brand-wide, surface a simpler "no apps yet" state
  // instead of a broken "Applications" heading.
  if (!brand.features.appstore) {
    return (
      <Card>
        <CardContent sx={{ textAlign: 'center', py: 8 }}>
          <BusinessIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
          <Typography variant="h6" sx={{ color: colors.textMuted, mb: 1 }}>
            Organization profile
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textMuted, maxWidth: 420, mx: 'auto' }}>
            This tab surfaces the organization's public apps. The app store is currently hidden
            brand-wide; members can still manage repositories and settings from the tabs above.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {featuredApps.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <StarIcon sx={{ color: colors.orange }} />
            Featured Applications
          </Typography>
          <Grid container spacing={3}>
            {featuredApps.map((app) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={app.id}>
                <AppCard app={app} onClick={() => onOpenApp(app.id)} featured />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          All Applications
        </Typography>
        {appsLoading ? (
          <Grid container spacing={3}>
            {[1, 2, 3].map((i) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
                <Card>
                  <CardContent>
                    <Skeleton variant="circular" width={48} height={48} sx={{ mb: 2 }} />
                    <Skeleton variant="text" width="60%" height={28} />
                    <Skeleton variant="text" width="100%" />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : apps && apps.length > 0 ? (
          <Grid container spacing={3}>
            {(otherApps.length > 0 ? otherApps : apps).map((app) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={app.id}>
                <AppCard app={app} onClick={() => onOpenApp(app.id)} />
              </Grid>
            ))}
          </Grid>
        ) : (
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <CodeIcon sx={{ fontSize: 48, color: colors.textMuted, mb: 2 }} />
              <Typography variant="h6" sx={{ color: colors.textMuted }}>
                No applications yet
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textMuted }}>
                This organization hasn't published any applications.
              </Typography>
            </CardContent>
          </Card>
        )}
      </Box>
    </>
  );
}

// ============================================================================
// Tab: Repositories (member-only)
// ============================================================================

interface RepositoriesTabProps {
  slug: string;
  orgName: string;
  isLoading: boolean;
  error: Error | null;
  repos: OrgRepositorySummary[];
  onCreateRepo: () => void;
  onOpenRepo: (repoSlug: string) => void;
}

function RepositoriesTab({ slug, orgName, isLoading, error, repos, onCreateRepo, onOpenRepo }: RepositoriesTabProps) {
  const gitBase = `https://git.${brand.domain}/${slug}`;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Repositories {repos.length > 0 && (
            <Typography component="span" sx={{ color: colors.textMuted, fontWeight: 400, ml: 1 }}>
              ({repos.length})
            </Typography>
          )}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateRepo}>
          New Repository
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load repositories.
        </Alert>
      )}

      {isLoading && (
        <Stack spacing={1}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" height={70} sx={{ borderRadius: 1 }} />
          ))}
        </Stack>
      )}

      {!isLoading && !error && repos.length === 0 && (
        <EmptyReposState orgName={orgName} onCreate={onCreateRepo} gitBase={gitBase} />
      )}

      {!isLoading && repos.length > 0 && (
        <Stack spacing={1}>
          {repos.map((r) => (
            <Card
              key={r.id}
              onClick={() => onOpenRepo(r.slug)}
              sx={{ cursor: 'pointer', '&:hover': { borderColor: colors.cyan } }}
            >
              <CardContent sx={{ py: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
                  <RepoIcon sx={{ color: colors.textMuted }} />
                  <Typography sx={{ fontWeight: 600 }}>
                    {r.name}
                  </Typography>
                  <VisibilityChip visibility={r.visibility} isArchived={r.isArchived} />
                </Stack>
                {r.description && (
                  <Typography variant="body2" sx={{ color: colors.textMuted, mt: 0.5, ml: 4 }}>
                    {r.description}
                  </Typography>
                )}
                <Stack direction="row" spacing={2} sx={{ mt: 1, ml: 4, color: colors.textMuted }}>
                  <InlineStat icon={<PRIcon sx={{ fontSize: 14 }} />} label={`${r.openPrCount} PRs`} />
                  <InlineStat icon={<IssueIcon sx={{ fontSize: 14 }} />} label={`${r.openIssueCount} issues`} />
                  <Typography variant="caption">updated {formatRelativeDate(r.updatedAt)}</Typography>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {!isLoading && repos.length > 0 && (
        <ImportHelp slug={slug} gitBase={gitBase} />
      )}
    </Box>
  );
}

function EmptyReposState({ orgName, onCreate, gitBase }: { orgName: string; onCreate: () => void; gitBase: string }) {
  return (
    <Card>
      <CardContent sx={{ py: 5, px: 4 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <RepoIcon sx={{ fontSize: 32, color: colors.textMuted }} />
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              No repositories yet
            </Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted }}>
              Create your first repository for <b>{orgName}</b>, or import one from another git host.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
            New Repository
          </Button>
        </Stack>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          Or import from Bitbucket / GitHub / GitLab
        </Typography>
        <ImportInstructions gitBase={gitBase} />
      </CardContent>
    </Card>
  );
}

function ImportHelp({ slug, gitBase }: { slug: string; gitBase: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{ mt: 3 }}>
      <Button
        size="small"
        onClick={() => setExpanded((x) => !x)}
        sx={{ color: colors.textMuted, textTransform: 'none' }}
      >
        {expanded ? '− Hide' : '+ Show'} instructions for importing a repo from Bitbucket / GitHub
      </Button>
      {expanded && (
        <Card sx={{ mt: 1 }}>
          <CardContent>
            <Typography variant="body2" sx={{ mb: 1 }}>
              After creating the empty target repo above (org: <b>{slug}</b>), push from a local mirror clone:
            </Typography>
            <ImportInstructions gitBase={gitBase} />
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

function ImportInstructions({ gitBase }: { gitBase: string }) {
  const lines = [
    `# 1. Mirror-clone from the source host`,
    `git clone --mirror https://bitbucket.org/<workspace>/<repo>.git /tmp/cv-import.git`,
    ``,
    `# 2. Push everything (branches, tags, history) to cv-hub`,
    `cd /tmp/cv-import.git`,
    `git push --mirror ${gitBase}/<new-repo-name>.git`,
    ``,
    `# 3. Verify in the UI — then remove the local mirror`,
    `cd .. && rm -rf /tmp/cv-import.git`,
  ].join('\n');

  const copy = async () => {
    try { await navigator.clipboard.writeText(lines); } catch {}
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="pre"
        sx={{
          backgroundColor: colors.navy,
          border: `1px solid ${colors.navyLighter}`,
          borderRadius: 1,
          p: 2,
          fontSize: '0.8rem',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          margin: 0,
        }}
      >
        {lines}
      </Box>
      <Tooltip title="Copy">
        <IconButton
          size="small"
          onClick={copy}
          sx={{ position: 'absolute', top: 4, right: 4, color: colors.textMuted }}
        >
          <CopyIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Typography variant="caption" sx={{ color: colors.textMuted, mt: 1, display: 'block' }}>
        The empty target repo must exist first (use <b>New Repository</b> above). Mirror-clone preserves all branches, tags, and full history.
        {' '}See <MuiLink href="https://git-scm.com/docs/git-push#Documentation/git-push.txt---mirror" target="_blank" rel="noopener noreferrer">git push --mirror</MuiLink> for details.
      </Typography>
    </Box>
  );
}

function VisibilityChip({ visibility, isArchived }: { visibility: string; isArchived: boolean }) {
  if (isArchived) {
    return (
      <Chip
        icon={<ArchiveIcon sx={{ fontSize: 14 }} />}
        label="Archived"
        size="small"
        sx={{ height: 20, fontSize: '0.65rem', backgroundColor: colors.navyLighter }}
      />
    );
  }
  const color = visibility === 'public' ? colors.green : colors.textMuted;
  const Icon = visibility === 'public' ? PublicIcon : LockIcon;
  return (
    <Chip
      icon={<Icon sx={{ fontSize: 14 }} />}
      label={visibility}
      size="small"
      sx={{ height: 20, fontSize: '0.65rem', color, textTransform: 'capitalize' }}
    />
  );
}

function InlineStat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      {icon}
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}

// ============================================================================
// Tab: Members (summary only — full mgmt in Settings)
// ============================================================================

interface MembersTabMember {
  id: string;
  role: string;
  user: {
    id: string;
    email: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    username?: string | null;
  };
}

interface MembersTabProps {
  slug: string;
  isLoading: boolean;
  members: MembersTabMember[];
  onManage: () => void;
}

function MembersTab({ isLoading, members, onManage }: MembersTabProps) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Members <Typography component="span" sx={{ color: colors.textMuted, fontWeight: 400, ml: 1 }}>
            ({members.length})
          </Typography>
        </Typography>
        <Button variant="outlined" startIcon={<SettingsIcon />} onClick={onManage}>
          Manage members
        </Button>
      </Stack>

      {isLoading && (
        <Stack spacing={1}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" height={60} sx={{ borderRadius: 1 }} />
          ))}
        </Stack>
      )}

      {!isLoading && (
        <Stack spacing={1}>
          {members.map((m) => (
            <Card key={m.id}>
              <CardContent sx={{ py: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <Avatar src={m.user?.avatarUrl ?? undefined} sx={{ width: 36, height: 36 }}>
                    {(m.user?.displayName || m.user?.username || m.user?.email || '?').charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>
                      {m.user?.displayName || m.user?.username || '(no username)'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: colors.textMuted }}>
                      {m.user?.email}
                    </Typography>
                  </Box>
                  <Chip
                    label={m.role}
                    size="small"
                    sx={{
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      fontSize: '0.65rem',
                      height: 22,
                    }}
                  />
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}

// ============================================================================
// App card (unchanged from previous storefront)
// ============================================================================

interface AppCardProps {
  app: App;
  onClick: () => void;
  featured?: boolean;
}

function AppCard({ app, onClick, featured }: AppCardProps) {
  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: featured ? `2px solid ${colors.orange}` : undefined,
        position: 'relative',
      }}
    >
      {featured && (
        <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
          <Tooltip title="Featured">
            <VerifiedIcon sx={{ color: colors.orange }} />
          </Tooltip>
        </Box>
      )}
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Avatar
            src={app.iconUrl}
            sx={{ width: 48, height: 48, backgroundColor: colors.navyLighter }}
          >
            <CodeIcon />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }} noWrap>
              {app.name}
            </Typography>
            <Chip
              label={app.category.replace('-', ' ')}
              size="small"
              sx={{ fontSize: '0.7rem', height: 20, textTransform: 'capitalize' }}
            />
          </Box>
        </Box>

        <Typography
          variant="body2"
          sx={{
            color: colors.textMuted,
            flex: 1,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            mb: 2,
          }}
        >
          {app.description}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {app.latestRelease ? (
            <Chip
              label={`v${app.latestRelease.version}`}
              size="small"
              sx={{ backgroundColor: colors.navyLighter, fontSize: '0.75rem' }}
            />
          ) : (
            <Box />
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: colors.textMuted }}>
            <DownloadIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption">
              {formatDownloads(app.totalDownloads)}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
