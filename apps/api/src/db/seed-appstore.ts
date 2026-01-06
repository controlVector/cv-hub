import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { apps, releases, releaseAssets, organizations, organizationMembers, users } from './schema';
import { eq } from 'drizzle-orm';

// Configuration - update these for your environment
const API_URL = process.env.API_URL || 'https://api.hub.controlvector.io';
const STORAGE_BASE_URL = process.env.STORAGE_BASE_URL || 'https://storage.hub.controlvector.io';
const ORG_LOGO_URL = 'https://hub.controlvector.io/assets/cv-logo.png';

/**
 * Seed script for App Store
 *
 * Run with: pnpm run db:seed-appstore
 *
 * This creates the ControlVector organization and its apps (cv-git, cv-prd, cv-hub).
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
    where: eq(organizations.slug, 'controlvector'),
  });

  if (existingOrg) {
    console.log('');
    console.log('⚠️  ControlVector organization already exists.');
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
  console.log('📦 Creating ControlVector organization...');

  const [controlvectorOrg] = await db.insert(organizations).values({
    slug: 'controlvector',
    name: 'ControlVector',
    description: 'AI-powered developer tools for the modern software team. Building intelligent applications that understand code.',
    logoUrl: ORG_LOGO_URL,
    websiteUrl: 'https://controlvector.io',
    isPublic: true,
    isVerified: true,
  }).returning();

  // Find an existing user to make org owner (if any exist)
  const existingUser = await db.query.users.findFirst();
  if (existingUser) {
    await db.insert(organizationMembers).values({
      organizationId: controlvectorOrg.id,
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
      organizationId: controlvectorOrg.id,
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
      homepageUrl: 'https://hub.controlvector.io/apps/cv-git',
      repositoryUrl: 'https://hub.controlvector.io/controlvector/cv-git',
      isActive: true,
      isFeatured: true,
      totalDownloads: 0,
    },
    {
      id: 'cv-prd',
      organizationId: controlvectorOrg.id,
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
      homepageUrl: 'https://hub.controlvector.io/apps/cv-prd',
      repositoryUrl: 'https://hub.controlvector.io/controlvector/cv-prd',
      isActive: true,
      isFeatured: true,
      totalDownloads: 0,
    },
    {
      id: 'cv-hub',
      organizationId: controlvectorOrg.id,
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

See deployment documentation at https://hub.controlvector.io/docs`,
      iconUrl: `${ORG_LOGO_URL}`,
      category: 'developer-tools',
      homepageUrl: 'https://hub.controlvector.io',
      repositoryUrl: 'https://hub.controlvector.io/controlvector/cv-hub',
      isActive: true,
      isFeatured: false,
      totalDownloads: 0,
    },
  ]);

  console.log('   ✓ cv-git');
  console.log('   ✓ cv-prd');
  console.log('   ✓ cv-hub');

  // Create releases for cv-git
  console.log('');
  console.log('📦 Creating releases...');

  const cvGitRelease = await db.insert(releases).values({
    appId: 'cv-git',
    version: '0.4.3',
    releaseNotes: `## CV-Git 0.4.3

### What's New
- Support for OpenRouter embeddings in AI commands
- Improved model configuration with valid defaults
- APT repository for easy Linux installation

### Features
- Knowledge graph generation for repositories
- Semantic code search with AI embeddings
- Intelligent commit message suggestions
- Branch comparison and visualization
- MCP (Model Context Protocol) integration

### Installation
Download the installer for your platform below, or on Linux:
\`\`\`bash
curl -fsSL https://apt.controlvector.io/gpg.pub | sudo gpg --dearmor -o /usr/share/keyrings/controlvector.gpg
echo "deb [signed-by=/usr/share/keyrings/controlvector.gpg] https://apt.controlvector.io stable main" | sudo tee /etc/apt/sources.list.d/controlvector.list
sudo apt update && sudo apt install cv-git
\`\`\`

### Feedback
Report issues at https://github.com/controlVector/cv-git/issues`,
    isPrerelease: false,
    isLatest: true,
    downloadCount: 0,
    publishedAt: new Date(),
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

  console.log('   ✓ cv-git v0.4.3');
  console.log('   ✓ cv-prd v0.2.0');

  // Create release assets
  console.log('');
  console.log('📥 Creating download assets...');

  // CV-Git assets
  await db.insert(releaseAssets).values([
    {
      releaseId: cvGitRelease[0].id,
      platform: 'windows-x64',
      fileName: 'cv-git_0.4.3_x64-setup.exe',
      fileSize: 85000000, // ~85MB
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.4.3/cv-git_0.4.3_x64-setup.exe`,
      downloadCount: 0,
    },
    {
      releaseId: cvGitRelease[0].id,
      platform: 'macos-arm64',
      fileName: 'cv-git_0.4.3_aarch64.dmg',
      fileSize: 78000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.4.3/cv-git_0.4.3_aarch64.dmg`,
      downloadCount: 0,
    },
    {
      releaseId: cvGitRelease[0].id,
      platform: 'macos-x64',
      fileName: 'cv-git_0.4.3_x64.dmg',
      fileSize: 80000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.4.3/cv-git_0.4.3_x64.dmg`,
      downloadCount: 0,
    },
    {
      releaseId: cvGitRelease[0].id,
      platform: 'linux-x64',
      fileName: 'cv-git_0.4.3_amd64.AppImage',
      fileSize: 75000000,
      fileHash: 'placeholder-update-after-upload',
      signature: 'placeholder-update-after-upload',
      downloadUrl: `${STORAGE_BASE_URL}/releases/cv-git/0.4.3/cv-git_0.4.3_amd64.AppImage`,
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
  console.log('  • 1 organization: controlvector');
  console.log('  • 3 apps: cv-git, cv-prd, cv-hub');
  console.log('  • 2 releases with 8 platform assets');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Upload actual binaries to storage:');
  console.log(`     ${STORAGE_BASE_URL}/releases/cv-git/0.4.3/`);
  console.log('  2. Update file hashes and signatures in the database');
  console.log('  3. Test downloads at:');
  console.log('     https://hub.controlvector.io/apps/cv-git');
  console.log('     https://hub.controlvector.io/apps/cv-prd');
  console.log('');
  console.log('Organization storefront:');
  console.log('  https://hub.controlvector.io/orgs/controlvector');
  console.log('');

  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
