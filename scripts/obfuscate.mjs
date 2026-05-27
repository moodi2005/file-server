// scripts/obfuscate.mjs
import { glob } from 'glob';
import fs from 'fs/promises';
import JavaScriptObfuscator from 'javascript-obfuscator';
import path from 'path';

const pattern = './build/**/*.js';

// list of filename patterns to skip (relative to build/)
const skipPatterns = [
  'build/some-native-module.js',
  'build/config/*.js' // نمونه — فایل‌هایی که نباید مبهم بشن
];

function shouldSkip(filePath) {
  return skipPatterns.some(p => filePath.includes(p.replace(/^build\//, '')));
}

async function main() {
  try {
    const files = await glob(pattern, { nodir: true });
    if (!files.length) {
      console.log('No JS files found to obfuscate.');
      return;
    }

    console.log(`Found ${files.length} files — starting obfuscation...`);

    const options = {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.2,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.9,
      renameGlobals: false,
      selfDefending: false,
      debugProtection: false
    };

    for (const f of files) {
      if (shouldSkip(f)) {
        console.log('Skipping (excluded):', f);
        continue;
      }

      // optionally skip source maps
      if (f.endsWith('.map')) continue;

      try {
        const code = await fs.readFile(f, 'utf8');
        const obf = JavaScriptObfuscator.obfuscate(code, options);
        await fs.writeFile(f, obf.getObfuscatedCode(), 'utf8');
        console.log('Obfuscated:', f);
      } catch (errFile) {
        console.error('Error obfuscating file', f, errFile);
        // do not throw — ادامه بدیم برای فایل‌های بعدی
      }
    }

    console.log('Obfuscation complete.');
  } catch (err) {
    console.error('Obfuscation script error:', err);
    process.exitCode = 1;
  }
}

main();
