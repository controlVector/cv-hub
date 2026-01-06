/**
 * CommitDetailPage
 * Shows detailed information about a single commit
 */

import { useParams } from 'react-router-dom';
import { CommitDetail } from '../components/repository';

export default function CommitDetailPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();

  if (!owner || !repo) {
    return null;
  }

  return <CommitDetail owner={owner} repo={repo} />;
}
