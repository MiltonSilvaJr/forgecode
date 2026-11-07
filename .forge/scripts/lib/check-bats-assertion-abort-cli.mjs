#!/usr/bin/env node
// CLI de check-bats-assertion-abort.sh - ver cabeçalho do .sh para o achado completo (LDG-1626).
// Zero-dependência: node:fs/node:path/node:child_process + bats-assertion-lint.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { findVulnerableTests, collectBatsFiles, parseAddedLines, fixText } from './bats-assertion-lint.mjs';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

function emitHits(file, vulnerable) {
  for (const v of vulnerable) {
    console.log(`HIT\t${file}\t${v.startLine + 1}\t${v.name.replace(/\t/g, ' ')}\t${v.bareCount}`);
  }
}

const [, , mode, arg, root] = process.argv;

if (mode === 'path') {
  const files = collectBatsFiles(arg, { readdirSync: (await import('node:fs')).readdirSync, statSync: (await import('node:fs')).statSync });
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    emitHits(f, findVulnerableTests(text));
  }
  console.log(`SCANNED\t${files.length}`);
} else if (mode === 'report') {
  const dir = existsSync(arg) ? arg : root;
  const files = collectBatsFiles(dir, { readdirSync: (await import('node:fs')).readdirSync, statSync: (await import('node:fs')).statSync });
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    emitHits(f, findVulnerableTests(text));
  }
  console.log(`SCANNED\t${files.length}`);
} else if (mode === 'range') {
  const nameRes = run('git', ['-C', root, '-c', 'core.quotePath=false', 'diff', '--no-color', '--diff-filter=AM', '--name-only', arg, '--', '*.bats']);
  if (nameRes.status !== 0) {
    console.error(`git diff --name-only falhou: ${(nameRes.stderr || '').trim()}`);
    process.exit(1);
  }
  const files = nameRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean);

  const diffRes = run('git', ['-C', root, '-c', 'core.quotePath=false', 'diff', '--no-color', '-U0', arg, '--', '*.bats']);
  if (diffRes.status !== 0) {
    console.error(`git diff -U0 falhou: ${(diffRes.stderr || '').trim()}`);
    process.exit(1);
  }
  const addedByFile = parseAddedLines(diffRes.stdout);

  for (const f of files) {
    const abs = join(root, f);
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { continue; } // arquivo removido no range: nada a lintar
    const added = addedByFile.get(f) || new Set();
    const vulnerable = findVulnerableTests(text).filter((v) => {
      for (let ln = v.startLine + 1; ln <= v.endLine; ln++) {
        if (added.has(ln)) return true;
      }
      return false;
    });
    emitHits(f, vulnerable);
  }
  console.log(`SCANNED\t${files.length}`);
} else if (mode === 'fix') {
  const files = collectBatsFiles(arg, { readdirSync: (await import('node:fs')).readdirSync, statSync: (await import('node:fs')).statSync });
  let totalFixed = 0;
  let filesChanged = 0;
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const { text: fixed, changed } = fixText(text);
    if (changed > 0) {
      writeFileSync(f, fixed, 'utf8');
      totalFixed += changed;
      filesChanged += 1;
      console.log(`FIXED\t${f}\t${changed}`);
    }
  }
  console.log(`SCANNED\t${files.length}`);
  console.log(`TOTALFIXED\t${totalFixed}\t${filesChanged}`);
} else {
  console.error(`modo desconhecido: ${mode}`);
  process.exit(1);
}
