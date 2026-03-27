/**
 * Deploy a Foyer worker to Cloudflare.
 * Usage: node deployFoyer.js [foyer.config.yaml]
 */
import { execSync } from 'child_process';
import { setup } from './foyer.setup.js';

const { workerDir } = setup(process.argv[2]);
console.log('→ Deploying...\n');
execSync('npx wrangler deploy', { cwd: workerDir, stdio: 'inherit' });
