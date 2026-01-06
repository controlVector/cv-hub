/**
 * BlamePage
 * Shows line-by-line blame for a file
 */

import { useParams } from 'react-router-dom';
import { BlameView } from '../components/repository';

export default function BlamePage() {
  const params = useParams<{ owner: string; repo: string; '*': string }>();

  const owner = params.owner || '';
  const repo = params.repo || '';

  // Parse ref and path from wildcard (blame/:ref/*path)
  const wildcardPath = params['*'] || '';
  const parts = wildcardPath.replace('blame/', '').split('/');
  const ref = parts[0] || 'main';
  const path = parts.slice(1).join('/');

  if (!owner || !repo || !path) {
    return null;
  }

  return <BlameView owner={owner} repo={repo} ref={ref} path={path} />;
}
