// Deploys the websites to Cloudflare Pages (see docs/DEPLOY.md).
//   node scripts/deploy.mjs site   pdf.stayunsold.com  (apps/site)
//   node scripts/deploy.mjs web    pdf.stayunsold.app  (apps/web, the app itself)
//   node scripts/deploy.mjs home   stayunsold.com      (../unsold/site, the Unsold home page)
//   node scripts/deploy.mjs redirect  www + stayunsold.app → stayunsold.com (../unsold/redirect)
//   add --no-build to deploy what's already built, --dry-run to check without deploying
// Needs `npx wrangler login` once. Creates the Pages project on first run;
// custom domains are attached once in the Cloudflare dashboard.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
const wrangler = (args) => run('npx', ['--yes', 'wrangler@4', ...args]);

const TARGETS = {
  site: {
    project: 'unsold-pdf-site',
    dir: 'apps/site/dist',
    build: () => run('npm', ['run', 'build', '-w', '@unsold/site']),
  },
  web: {
    project: 'unsold-pdf-web',
    dir: 'apps/web/dist',
    build: () => {
      run('npm', ['run', 'build:web']);
      run('npm', ['run', 'release:web']);
    },
  },
  home: {
    project: 'stayunsold-home',
    dir: process.env.UNSOLD_HOME_DIR || '../unsold/site', // static, no build step
  },
  // www.stayunsold.com, stayunsold.app and www.stayunsold.app all land here,
  // and its _redirects sends every request on to stayunsold.com.
  redirect: {
    project: 'stayunsold-redirect',
    dir: process.env.UNSOLD_REDIRECT_DIR || '../unsold/redirect',
  },
};

const name = process.argv[2];
const t = TARGETS[name];
if (!t) {
  console.error(
    `usage: node scripts/deploy.mjs ${Object.keys(TARGETS).join('|')} [--no-build]`
  );
  process.exit(1);
}
if (t.build && !process.argv.includes('--no-build')) t.build();

const dir = path.resolve(root, t.dir);
if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error(`deploy: ${dir} has no index.html; build it first`);
  process.exit(1);
}

// Cloudflare Pages limits (free plan): 20,000 files, 25 MiB per file.
let files = 0,
  largest = ['', 0];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      const s = fs.statSync(p).size;
      if (s > largest[1]) largest = [p, s];
    }
  }
};
walk(dir);
if (files > 20000 || largest[1] > 25 * 1024 * 1024) {
  console.error(
    `deploy: over Pages limits (${files} files, largest ${(largest[1] / 1048576).toFixed(1)} MiB: ${largest[0]})`
  );
  process.exit(1);
}
console.log(
  `deploy: ${name} → ${t.project} (${files} files, largest ${(largest[1] / 1048576).toFixed(1)} MiB)`
);

if (process.argv.includes('--dry-run')) process.exit(0);

// First run: create the project. If it already exists wrangler says so and we carry on.
try {
  execFileSync(
    'npx',
    [
      '--yes',
      'wrangler@4',
      'pages',
      'project',
      'create',
      t.project,
      '--production-branch',
      'main',
    ],
    {
      cwd: root,
      stdio: 'pipe',
    }
  );
  console.log(`deploy: created Pages project ${t.project}`);
} catch (e) {
  const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  if (!/already exists/i.test(out)) {
    console.error(out);
    process.exit(1);
  }
}

wrangler([
  'pages',
  'deploy',
  dir,
  '--project-name',
  t.project,
  '--branch',
  'main',
  '--commit-dirty=true',
]);
