import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { pages } from '../gateway/paths.mjs';

const origin = new URL(process.env.APEX_API_ORIGIN || 'invalid:');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Set APEX_API_ORIGIN to the HTTPS origin of the persistent 12x12 backend.');
}

const dist = new URL('../dist/', import.meta.url);
const output = new URL('../.vercel/output/', import.meta.url);
const assets = new URL('static/', output);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliases = ['deposit', 'withdraw', 'cashier', 'portfolio'];
const routes = [
  {
    src: '^(/api/.*|/healthz|/config\\.json|/(?:' + aliases.join('|') + ')(?:\\.html)?/?)$',
    dest: origin.origin + '$1'
  },
  ...Object.entries(pages).map(([path, page]) => ({
    src: path === '/' ? '^/$' : '^' + escape(path) + '/?$',
    dest: '/' + page + '.html'
  })),
  { handle: 'filesystem' }
];

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
for (const entry of await readdir(dist, { withFileTypes: true })) {
  if (entry.name === 'assets' || (entry.isFile() && /\.(?:html|css|js|txt)$/.test(entry.name))) {
    await cp(new URL(entry.name, dist), new URL(entry.name, assets), { recursive: entry.isDirectory() });
  }
}
await writeFile(new URL('config.json', output), JSON.stringify({ version: 3, routes }, null, 2) + '\n');
