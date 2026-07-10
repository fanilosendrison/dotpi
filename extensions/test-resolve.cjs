const path = require('path');
const fs = require('fs');
console.log('__dirname:', __dirname);
console.log('__filename:', __filename);
console.log('realpath dirname:', fs.realpathSync(__dirname));
console.log('cwd:', process.cwd());

// Try the exact pattern used in the extension
const importPath = '../../dotagents/agent-enforcers/command-validator/src/core/validator.ts';
const resolved = path.resolve(__dirname, importPath);
console.log('Resolved:', resolved);
console.log('Exists:', fs.existsSync(resolved));

// Also try from real path
const realDir = fs.realpathSync(__dirname);
const resolvedFromReal = path.resolve(realDir, importPath);
console.log('Resolved from real:', resolvedFromReal);
console.log('Exists from real:', fs.existsSync(resolvedFromReal));
