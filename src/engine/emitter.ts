import fs from 'fs';
import path from 'path';

const vfs: Map<string, string> = new Map();

export function addFile(filePath: string, content: string): void {
  vfs.set(filePath, content);
}

export function flushToDisk(outputDir: string): void {
  for (const [relativePath, content] of vfs) {
    const fullPath = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

export function getVFS(): Map<string, string> {
  return vfs;
}

export function resetVFS(): void {
  vfs.clear();
}
