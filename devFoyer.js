/**
 * Run a Foyer worker locally with wrangler dev.
 * Usage: node devFoyer.js [foyer.config.yaml]
 */
import { execSync } from 'child_process';
import { setup } from './foyer.setup.js';

const { workerDir } = setup(process.argv[2]);
console.log('→ Starting dev server...\n');
execSync('npx wrangler dev', { cwd: workerDir, stdio: 'inherit' });
