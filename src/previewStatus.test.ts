import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { previewStatus: convert } = createRequire(import.meta.url)('../scripts/github/preview-status.cjs');
const previewStatus = (check: unknown) => convert(check, [{ref:'refs/heads/cms/journal/example',object:{sha:'abc'}}]);
const check = () => ({ app: { id: 85455 }, name: 'Workers Builds: yi-digital-website', head_sha: 'abc', status: 'completed', conclusion: 'success', output: { summary: '\nVersion ID: b2a0bfc7-0561-4ba8-8b70-fc4945c6181e\nPreview URL: https://b2a0bfc7-yi-digital-website.yidigitalmm.workers.dev\nPreview Alias URL: https://cms-journal-example-yi-digital-website.yidigitalmm.workers.dev\n' } });
describe('Decap preview status bridge', () => {
  it('uses the immutable preview URL from a successful Cloudflare check', () => {
    expect(previewStatus(check())).toMatchObject({sha:'abc',state:'success',context:'deploy/decap-preview',target_url:'https://b2a0bfc7-yi-digital-website.yidigitalmm.workers.dev'});
  });
  it('ignores unrelated providers, workers and unfinished checks', () => {
    expect(previewStatus({...check(),app:{id:1}})).toBeNull();
    expect(previewStatus({...check(),name:'verify'})).toBeNull();
    expect(previewStatus({...check(),status:'in_progress'})).toBeNull();
  });
  it('does not advertise failed builds as ready', () => {
    expect(previewStatus({...check(),conclusion:'failure'})).toMatchObject({state:'failure'});
    expect(previewStatus({...check(),conclusion:'failure'})).not.toHaveProperty('target_url');
  });
  it('ignores production builds and superseded drafts', () => {
    expect(convert(check(), [{ref:'refs/heads/main',object:{sha:'abc'}}])).toBeNull();
    expect(convert(check(), [{ref:'refs/heads/cms/journal/example',object:{sha:'newer'}}])).toBeNull();
    expect(convert({...check(),output:{summary:'Version ID: 67209dfa'}}, [])).toBeNull();
  });
  it('rejects missing or foreign preview URLs', () => {
    for (const summary of ['', 'Preview URL: https://example.com', 'Preview URL: https://b2a0bfc7-yi-digital-website.yidigitalmm.workers.dev.evil.test']) {
      expect(previewStatus({...check(),output:{summary}})).toMatchObject({state:'error'});
    }
  });
});
