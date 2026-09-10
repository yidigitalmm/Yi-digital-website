// Cloudflare Workers publishes Check Runs; Decap reads legacy commit statuses.
function previewStatus(check) {
  if (check.app?.id !== 85455 || check.name !== 'Workers Builds: yi-digital-website') return null;
  if (check.status !== 'completed') return null;
  const base = { sha: check.head_sha, context: 'deploy/decap-preview' };
  if (check.conclusion !== 'success') {
    return { ...base, state: 'failure', description: 'Cloudflare preview build did not succeed' };
  }
  // Only accept this Worker's immutable version URL, never a dashboard or alias URL.
  const match = (check.output?.summary ?? '').match(/^Preview URL: (https:\/\/[a-f0-9]{8}-yi-digital-website\.yidigitalmm\.workers\.dev)\s*$/m);
  if (!match) return { ...base, state: 'error', description: 'Cloudflare did not provide a recognized preview URL' };
  return { ...base, state: 'success', description: 'Cloudflare preview is ready', target_url: match[1] };
}
module.exports = { previewStatus };
