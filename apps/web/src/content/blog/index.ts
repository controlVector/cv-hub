import post1 from './2026-02-17-metadata-is-not-understanding.md?raw';

export interface BlogPost {
  title: string;
  date: string;
  author: string;
  excerpt: string;
  slug: string;
  content: string;
}

function parseFrontmatter(raw: string): BlogPost {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid frontmatter');

  const frontmatter = match[1];
  const content = match[2].trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
    meta[key] = value;
  }

  return {
    title: meta.title || '',
    date: meta.date || '',
    author: meta.author || '',
    excerpt: meta.excerpt || '',
    slug: meta.slug || '',
    content,
  };
}

// Add new posts here — they'll be sorted newest-first automatically
export const blogPosts: BlogPost[] = [
  parseFrontmatter(post1),
].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find(p => p.slug === slug);
}
