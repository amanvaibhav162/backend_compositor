#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { runPipeline } from '../engine/pipeline.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const program = new Command();

program
  .name('backforge')
  .description('🔨 Deterministic Backend Composition Engine')
  .version(pkg.version);

// ── backforge init ────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Create a starter backend.yaml in the current directory')
  .action(() => {
    const target = path.join(process.cwd(), 'backend.yaml');
    if (fs.existsSync(target)) {
      console.error('❌  backend.yaml already exists. Remove it first.');
      process.exit(1);
    }
    const template = `project:
  name: "my-backend"

services:
  - id: "express"
    type: "express"

  - id: "database"
    type: "mongodb"

  - id: "auth"
    type: "jwt"
`;
    fs.writeFileSync(target, template, 'utf-8');
    console.log('✅  Created backend.yaml');
    console.log('   Edit it, then run: backforge generate');
  });

// ── backforge generate ────────────────────────────────────────────────────────
program
  .command('generate')
  .description('Generate backend from a YAML config file')
  .argument('[file]', 'Path to your YAML config', 'backend.yaml')
  .option('-o, --out <dir>', 'Output directory', './output')
  .action(async (file, opts) => {
    const yamlPath = path.resolve(process.cwd(), file);

    if (!fs.existsSync(yamlPath)) {
      console.error(`❌  Config file not found: ${yamlPath}`);
      console.error('   Run "backforge init" to create one.');
      process.exit(1);
    }

    console.log(`\n🔨 BackForge — Compiling ${file}...\n`);

    let rawConfig;
    try {
      rawConfig = parse(fs.readFileSync(yamlPath, 'utf-8'));
    } catch (err) {
      console.error(`❌  Failed to parse YAML: ${err.message}`);
      process.exit(1);
    }

    try {
      await runPipeline(rawConfig, path.resolve(process.cwd(), opts.out));
      console.log(`\n✅  Backend generated successfully → ${opts.out}/`);
      console.log('   Next steps:');
      console.log(`     cd ${opts.out}`);
      console.log('     cp .env.template .env');
      console.log('     npm install && npm start\n');
    } catch (err) {
      console.error(`\n❌  Compilation failed:\n   ${err.message}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
