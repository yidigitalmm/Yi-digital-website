import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Source clips remain untouched. Rebuild the browser-friendly continuous timeline.
const clips = ['tea-growth', 'connector-01', 'harvest-collection', 'connector-02', 'fermentation-line', 'connector-03', 'packaging', 'connector-04', 'shop-sale'];
const folder = resolve('public/videos/start-end');
const sourceFolder = resolve(process.argv[2] ?? 'local-only/tea-source');
const temp = mkdtempSync(join(tmpdir(), 'yi-tea-'));
function run(command, args) {
  const result = spawnSync(command, args, { stdio:'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed`);
}
try {
  const list = join(temp, 'clips.txt');
  writeFileSync(list, clips.map(name => `file '${join(sourceFolder, name + '.mp4').replaceAll("'", "'\\''")}'`).join('\n'));
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', 'scale=768:-2', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '32', '-pix_fmt', 'yuv420p', '-g', '1', '-bf', '0', '-movflags', '+faststart', join(folder, 'tea-journey-web-v2.mp4')]);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(sourceFolder, 'tea-growth.mp4'), '-frames:v', '1', '-q:v', '2', join(folder, 'tea-journey-poster.jpg')]);
} finally { rmSync(temp, { recursive:true, force:true }); }
