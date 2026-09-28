import fs from 'fs';
import path from 'path';
import { toJSONSchema } from 'zod';
import { BackForgeConfigSchema } from '../engine/config.js';

export function generateJsonSchema(): Record<string, unknown> {
  const schema = toJSONSchema(BackForgeConfigSchema);
  return schema as Record<string, unknown>;
}

export function writeJsonSchema(targetPath: string): string {
  const resolvedPath = path.resolve(process.cwd(), targetPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const schema = generateJsonSchema();
  const content = JSON.stringify(schema, null, 2);
  fs.writeFileSync(resolvedPath, content, 'utf-8');
  return resolvedPath;
}
