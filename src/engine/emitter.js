import fs from 'fs';
import path from 'path';

const vfs = new Map();

export function addFile(filePath, content) {
  vfs.set(filePath, content);
}

export function flushToDisk(outputDir) {
  for (const [relativePath, content] of vfs) {
    const fullPath = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

export function getVFS() {
  return vfs;
}

export function resetVFS() {
  vfs.clear();
}
