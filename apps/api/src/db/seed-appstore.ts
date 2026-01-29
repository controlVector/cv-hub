import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { apps, releases, releaseAssets, organizations, organizationMembers, users } from './schema';
import { eq } from 'drizzle-orm';

// Configuration - update these for your environment
const API_URL = process.env.API_URL || 'https://api.hub.controlfab.ai';
const STORAGE_BASE_URL = process.env.STORAGE_BASE_URL || 'https://releases.hub.controlfab.ai';
const ORG_LOGO_URL = 'https://hub.controlfab.ai/logo.png';

/**
 * Seed script for App Store
 *
 * Run with: pnpm run db:seed-appstore
 *
 * This creates the Control Fabric organization and its apps (cv-git, cv-prd, cv-hub, mcp-gateway).
 * Download URLs will point to storage - upload actual binaries separately.
 */

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema });

  console.log('🚀 Seeding App Store data...');
  console.log(`   API URL: ${API_URL}`);
  console.log(`   Storage URL: ${STORAGE_BASE_URL}`);

  // Check if already seeded
  const existingOrg = await db.query.organizations.findFirst({
    where: eq(organizations.slug, 'controlfabric'),
  });

  if (existingOrg) {
    console.log('');
    console.log('⚠️  Control Fabric organization already exists.');
    console.log('   Run with --force to recreate, or update releases manually.');

    // Just update asset URLs to current storage URL
    console.log('');
    console.log('📝 Updating asset download URLs...');

    const allAssets = await db.query.releaseAssets.findMany();
    for (const asset of allAssets) {
      // Extract app/version/filename from existing URL and rebuild
      const match = asset.downloadUrl.match(/releases\/([^/]+)\/([^/]+)\/(.+)$/);
      if (match) {
        const [, appId, version, fileName] = match;
        const newUrl = `${STORAGE_BASE_URL}/releases/${appId}/${version}/${fileName}`;
        await db.update(releaseAssets)
          .set({ downloadUrl: newUrl })
          .where(eq(releaseAssets.id, asset.id));
      }
    }

    console.log('✅ Asset URLs updated');
    await pool.end();
    return;
  }

  // Create organization
  console.log('');
  console.log('📦 Creating Control Fabric organization...');

  const [controlfabricOrg] = await db.insert(organizations).values({
    slug: 'controlfabric',
    name: 'Control Fabric',
    description: 'AI-powered developer tools for the modern software team. Building intelligent applications that understand code.',
    logoUrl: ORG_LOGO_URL,
    websiteUrl: 'https://controlfab.ai',
    isPublic: true,
    isVerified: true,
  }).returning();

  // Find an existing user to make org owner (if any exist)
  const existingUser = await db.query.users.findFirst();
  if (existingUser) {
    await db.insert(organizationMembers).values({
      organizationId: controlfabricOrg.id,
      userId: existingUser.id,
      role: 'owner',
      acceptedAt: new Date(),
    });
    console.log(`   Added ${existingUser.email} as organization owner`);
  }

  // Create apps
  console.log('');
  console.log('📱 Creating apps...');

  await db.insert(apps).values([
    {
      id: 'cv-git',
      organizationId: controlfabricOrg.id,
      name: 'CV-Git',
      description: 'AI-powered Git client with knowledge graphs, semantic code search, and intelligent code analysis.',
      longDescription: `# CV-Git

CV-Git is an AI-native Git client that understands your codebase at a deeper level.

## Features

### 🧠 Knowledge Graph
Build and explore a knowledge graph of your codebase - understand how files, functions, and modules connect.

### 🔍 Semantic Code Search
Search your code using natural language. Find functions by what they do, not just what they're called.

### 🤖 AI-Powered Analysis
- Intelligent commit message suggestions
- Code review assistance
- Impact analysis for changes
- Automatic documentation generation

### 📊 Visualization
- Interactive dependency graphs
- Commit history visualization
- Branch comparison views

## System Requirements

- **Windows**: 10/11 (x64)
- **macOS**: 11+ (Intel or Apple Silicon)
- **Linux**: Ubuntu 20.04+ or equivalent (x64)
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 500MB for installation

## Getting Started

1. Download the installer for your platform
2. Run the installer and follow the setup wizard
3. Connect your Git repositories
4. Start exploring with AI-powered insights!

## Privacy

CV-Git processes your code locally. Your code is never sent to external servers unless you explicitly enable cloud features.`,
      iconUrl: `${ORG_LOGO_URL}`,
      category: 'developer-tools',
      homepageUrl: 'https://hub.controlfab.ai/apps/cv-git',
      repositoryUrl: 'https://hub.controlfab.ai/controlfabric/cv-git',
      isActive: true,
      isFeatured: true,
      totalDownloads: 0,
    },
    {
      id: 'cv-prd',
      organizationId: controlfabricOrg.id,
      name: 'CV-PRD',
      description: 'AI-powered product requirements document manager with semantic search and knowledge graph visualization.',
      longDescription: `# CV-PRD

CV-PRD helps product teams manage and understand their requirements documentation using AI.

## Features

### 📄 Document Management
- Import PRDs from Word, Markdown, or Confluence
- Organize by project, feature, or sprint
- Version history and change tracking

### 🔍 Semantic Search
Find relevant requirements using natural language queries across all your documents.

### 🕸️ Knowledge Graph
Visualize relationships between features, requirements, and dependencies.

### 🤖 AI Analysis
- Automatic categorization
- Gap detection
- Dependency analysis
- Summary generation

## System Requirements

- **Windows**: 10/11 (x64)
- **macOS**: 11+ (Intel or Apple Silicon)
- **Linux**: Ubuntu 20.04+ (x64)
- **RAM**: 4GB minimum
- **Docker**: Required for local database services`,
      iconUrl: `${ORG_LOGO_URL}`,
      category: 'developer-tools',
      homepageUrl: 'https://hub.controlfab.ai/apps/cv-prd',
      repositoryUrl: 'https://hub.controlfab.ai/controlfabric/cv-prd',
      isActive: true,
      isFeatured: true,
      totalDownloads: 0,
    },
    {
      id: 'cv-hub',
      organizationId: controlfabricOrg.id,
      name: 'CV-Hub',
      description: 'Self-hosted Git platform with AI-powered code intelligence, semantic search, and knowledge graphs.',
      longDescription: `# CV-Hub

CV-Hub is a self-hosted Git platform designed for teams who want AI-powered code intelligence.

## Features

### 🗂️ Git Hosting
Full Git server with web interface, similar to GitHub or GitLab.

### 🧠 Knowledge Graphs
Automatic knowledge graph generation for every repository - understand your codebase structure.

### 🔍 Semantic Search
Search code using natural language across all your repositories.

### 🤖 AI Assistant
Built-in AI assistant that understands your codebase context.

### 📊 PR & Issue Tracking
Complete workflow for pull requests and issue management.

## Deployment

CV-Hub can be deployed on:
- **Kubernetes** (recommended for production)
- **Docker Compose** (for development/small teams)
- **Single server** (for personal use)

See deployment documentation at https://hub.controlfab.ai/docs`,
      iconUrl: `${ORG_LOGO_URL}`,
      category: 'developer-tools',
      homepageUrl: 'https://hub.controlfab.ai',
      repositoryUrl: 'https://hub.controlfab.ai/controlfabric/cv-hub',
      isActive: true,
      isFeatured: false,
      totalDownloads: 0,
    },
    {
      id: 'mcp-gateway',
      organizationId: controlfabricOrg.id,
      name: 'MCP Gateway',
      description: 'Enterprise MCP server management platform. Centralized tool orchestration, team-based access control, and SSO integration for AI agents.',
      longDescription: `# MCP Gateway

MCP Gateway is an enterprise-grade platform for managing Model Context Protocol (MCP) servers, enabling teams to securely orchestrate AI agent tools at scale.

## Features

### 🔧 Server Management
- Centralized dashboard for all MCP servers
- One-click server deployment and configuration
- Health monitoring and auto-restart

### 👥 Team-Based Access Control
- Role-based permissions (super_admin, tenant_admin, developer, member, viewer)
- Team-scoped tool visibility
- Fine-grained permission management

### 🔐 Enterprise Security
- SSO integration (Azure AD, Okta, Google, GitHub)
- API token management with scopes
- Audit logging for compliance

### 🛠️ Tool Orchestration
- Virtual server compositions
- Tool discovery and cataloging
- Cross-server tool routing

### 📊 Observability
- Request tracing and logging
- Usage analytics per team/user
- Performance metrics

## Getting Started

Visit [mcp.controlfab.ai](https://mcp.controlfab.ai) to access the hosted MCP Gateway or deploy your own instance.

## Documentation

Full documentation available at https://mcp.controlfab.ai/docs`,
      iconUrl: `${ORG_LOGO_URL}`,
      category: 'developer-tools',
      homepageUrl: 'https://mcp.controlfab.ai',
      repositoryUrl: 'https://hub.controlfab.ai/controlfabric/mcp-gateway',
      isActive: true,
      isFeatured: true,
      totalDownloads: 0,
    },
  ]);

  console.log('   ✓ cv-git');
  console.log('   ✓ cv-prd');
  console.log('   ✓ cv-hub');
  console.log('   ✓ mcp-gateway');

  // Create releases for cv-git
  console.log('');
  console.log('📦 Creating releases...');

  const cvGitRelease = await db.insert(releases).values({
    appId: 'cv-git',
    version: '0.5.0',
    releaseNotes: `## CV-Git 0.5.0 - User Mode & Mac Support

### What's New
- **User Mode Installation**: CV-Git now installs in user mode (~/cv-hub) by default, no root required
- **Full macOS Support**: Native builds for both Intel (x64) and Apple Silicon (ARM64)
- **Improved Windows Support**: Better installation experience on Windows x64

### Platform Support
- **Windows x64**: cv-windows-x64.exe
- **macOS Intel (x64)**: cv-macos-x64
- **macOS Apple Silicon (arm64)**: cv-macos-arm64
- **Linux (Debian/Ubuntu)**: cv-git_0.5.0_amd64.deb

### Installation

**Quick Install (Linux/macOS):**
\`\`\`bash
curl -fsSL https://hub.controlfab.ai/install.sh | bash
\`\`\`

**Post-Installation:**
\`\`\`bash
cv doctor    # Verify installation
cv init      # Initialize configuration
cv sync      # Build knowledge graph
\`\`\`

### Features
- Knowledge graph generation for repositories
- Semantic code search with AI embeddings
- Intelligent commit message suggestions
- Branch comparison and visualization
- MCP (Model Context Protocol) integration

### Feedback
Report issues at https://hub.controlfab.ai/controlfabric/cv-git/issues`,
    isPrerelease: false,
    isLatest: true,
    downloadCount: 0,
    publishedAt: new Date('2026-01-21T14:43:00Z'),
  }).returning();

  const cvPrdRelease = await db.insert(releases).values({
    appId: 'cv-prd',
    version: '0.2.0',
    releaseNotes: `## CV-PRD 0.2.0

### 🎉 Now available on CV-Hub!

### What's New
- Improved semantic search accuracy
- New knowledge graph visualization
- Export to Confluence and Notion
- Performance improvements

### Bug Fixes
- Fixed memory leak in document parser
- Resolved authentication timeout issues`,
    isPrerelease: false,
    isLatest: true,
    downloadCount: 0,
    publishedAt: new Date(),
  }).returning();

  console.log('   ✓ cv-git v0.5.0');
  console.log('   ✓ cv-prd v0.2.0');

  // Create release assets
  console.log('');
  console.log('📥 Creating download assets...');

  // CV-Git assets for v0.5.0
  await db.insert(releaseAssets).values([
    {
      releaseId: cvGitRelease[0].id,
      platform: 'windows-x64',
      fileName: 'cv-windows-x64.exe',
      fileSize: 85000000, // ~85MB
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.5.0/cv-windows-x64.exe`,
      downloadCount: 0,
    },
    {
      releaseId: cvGitRelease[0].id,
      platform: 'macos-arm64',
      fileName: 'cv-macos-arm64',
      fileSize: 78000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.5.0/cv-macos-arm64`,
      downloadCount: 0,
    },
    {
      releaseId: cvGitRelease[0].id,
      platform: 'macos-x64',
      fileName: 'cv-macos-x64',
      fileSize: 80000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.5.0/cv-macos-x64`,
      downloadCount: 0,
    },
    {
      releaseId: cvGitRelease[0].id,
      platform: 'linux-x64',
      fileName: 'cv-git_0.5.0_amd64.deb',
      fileSize: 75000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.5.0/cv-git_0.5.0_amd64.deb`,
      downloadCount: 0,
    },
  ]);

  // CV-PRD assets
  await db.insert(releaseAssets).values([
    {
      releaseId: cvPrdRelease[0].id,
      platform: 'windows-x64',
      fileName: 'cv-prd_0.2.0_x64-setup.exe',
      fileSize: 65000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-prd/0.2.0/cv-prd_0.2.0_x64-setup.exe`,
      downloadCount: 0,
    },
    {
      releaseId: cvPrdRelease[0].id,
      platform: 'macos-arm64',
      fileName: 'cv-prd_0.2.0_aarch64.dmg',
      fileSize: 60000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-prd/0.2.0/cv-prd_0.2.0_aarch64.dmg`,
      downloadCount: 0,
    },
    {
      releaseId: cvPrdRelease[0].id,
      platform: 'macos-x64',
      fileName: 'cv-prd_0.2.0_x64.dmg',
      fileSize: 62000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-prd/0.2.0/cv-prd_0.2.0_x64.dmg`,
      downloadCount: 0,
    },
    {
      releaseId: cvPrdRelease[0].id,
      platform: 'linux-x64',
      fileName: 'cv-prd_0.2.0_amd64.AppImage',
      fileSize: 58000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-prd/0.2.0/cv-prd_0.2.0_amd64.AppImage`,
      downloadCount: 0,
    },
  ]);

  console.log('   ✓ cv-git: Windows, macOS (Intel + ARM), Linux');
  console.log('   ✓ cv-prd: Windows, macOS (Intel + ARM), Linux');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ Seed completed successfully!');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Created:');
  console.log('  • 1 organization: controlfabric');
  console.log('  • 4 apps: cv-git, cv-prd, cv-hub, mcp-gateway');
  console.log('  • 2 releases with 8 platform assets');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Upload actual binaries to storage:');
  console.log(`     ${STORAGE_BASE_URL}/releases/cv-git/0.5.0/`);
  console.log('  2. Update file hashes and signatures in the database');
  console.log('  3. Test downloads at:');
  console.log('     https://hub.controlfab.ai/apps/cv-git');
  console.log('     https://hub.controlfab.ai/apps/cv-prd');
  console.log('');
  console.log('Organization storefront:');
  console.log('  https://hub.controlfab.ai/orgs/controlfabric');
  console.log('');

  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
