import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const scanDirs = ['components', 'pages'];
const interactiveTag = /<(input|select)\b([^>]*)>/g;
const buttonTag = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
const nonNativeClick = /<(div|p|span)\b[^>]*\bonClick=/g;
const iconOnlyMarkup = /<svg\b|<[A-Z][A-Za-z0-9]*\b[^>]*className="[^"]*\bw-[\d.]+[^"]*"/;

function filesIn(dir) {
  const full = join(root, dir);
  return readdirSync(full).flatMap((name) => {
    const path = join(full, name);
    const stats = statSync(path);
    if (stats.isDirectory()) return filesIn(relative(root, path));
    return path.endsWith('.tsx') ? [path] : [];
  });
}

function hasAccessibleName(attrs, source) {
  const id = attrs.match(/\bid="([^"]+)"/)?.[1];
  if (/\baria-label=|\baria-labelledby=|\btitle=/.test(attrs)) return true;
  return Boolean(id && source.includes(`htmlFor="${id}"`));
}

const violations = [];

for (const file of scanDirs.flatMap(filesIn)) {
  const source = readFileSync(file, 'utf8');
  const label = relative(root, file).replaceAll('\\', '/');

  for (const match of source.matchAll(interactiveTag)) {
    const [, tag, attrs] = match;
    if (attrs.includes('type="hidden"')) continue;
    if (!hasAccessibleName(attrs, source)) {
      violations.push(`${label}: <${tag}> is missing a label, aria-label, aria-labelledby, or title`);
    }
  }

  for (const match of source.matchAll(buttonTag)) {
    const [, attrs, children] = match;
    const textContent = children
      .replace(/<[^>]+>/g, ' ')
      .replace(/[{}?:`$()[\].,+\-*/'"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!textContent && !/\baria-label=|\baria-labelledby=|\btitle=/.test(attrs)) {
      violations.push(`${label}: icon-only <button> is missing an accessible name`);
    }
    if (iconOnlyMarkup.test(children) && !/\baria-label=|\baria-labelledby=|\btitle=/.test(attrs) && !textContent) {
      violations.push(`${label}: icon-only button needs aria-label or visible text`);
    }
  }

  for (const match of source.matchAll(nonNativeClick)) {
    violations.push(`${label}: <${match[1]}> has onClick; use a native button/link for keyboard support`);
  }
}

if (violations.length) {
  console.error('Accessibility audit failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Accessibility audit passed: controls have accessible names and non-native click handlers were not found.');
