const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const ignoreDirs = ['node_modules', '.git', 'backups'];

function findJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoreDirs.includes(entry.name)) continue;
      results.push(...findJsFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    return false;
  }
  return true;
}

function main() {
  const files = findJsFiles(root);
  console.log(`Checking syntax for ${files.length} JavaScript files...`);

  let success = true;
  for (const file of files) {
    const relative = path.relative(root, file);
    process.stdout.write(`- ${relative} ... `);
    const ok = checkSyntax(file);
    if (!ok) {
      console.log('FAILED');
      success = false;
    } else {
      console.log('OK');
    }
  }

  if (!success) {
    console.error('Syntax validation failed. Fix the reported errors first.');
    process.exit(1);
  }

  console.log('Syntax validation passed.');
}

main();
