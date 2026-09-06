#!/usr/bin/env tsx
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { parse } from 'yaml';
import inquirer from 'inquirer';
import { runPipeline } from '../engine/pipeline.js';
import { flushToDisk } from '../engine/emitter.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

const program = new Command();

program
  .name('backforge')
  .description('🔨 Deterministic Backend Composition Engine')
  .version(pkg.version);

program
  .command('init')
  .description('Create a starter backend.yaml in the current directory')
  .option('-i, --interactive', 'Interactive configuration')
  .action(async (options: { interactive?: boolean }) => {
    const target = path.join(process.cwd(), 'backend.yaml');
    if (fs.existsSync(target)) {
      console.error('❌  backend.yaml already exists. Remove it first.');
      process.exit(1);
    }

    let template = "";

    if (options.interactive) {
      console.log('✨ Welcome to BackForge Interactive Init ✨\n');
      
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: 'Project name:',
          default: 'my-backend'
        },
        {
          type: 'list',
          name: 'database',
          message: 'Which database do you want to use?',
          choices: [
            { name: 'MongoDB', value: 'mongodb' },
            { name: 'None', value: 'none' }
          ]
        },
        {
          type: 'confirm',
          name: 'useJwt',
          message: 'Include JWT Auth?',
          default: true,
          when: (answers: Record<string, unknown>) => answers.database !== 'none'
        },
        {
          type: 'confirm',
          name: 'useRbac',
          message: 'Enable RBAC (Role Based Access Control)?',
          default: false,
          when: (answers: Record<string, unknown>) => answers.useJwt as boolean
        },
        {
          type: 'confirm',
          name: 'useOauth',
          message: 'Include Google OAuth?',
          default: false,
          when: (answers: Record<string, unknown>) => answers.database !== 'none'
        }
      ]) as {
        projectName: string;
        database: string;
        useJwt?: boolean;
        useRbac?: boolean;
        useOauth?: boolean;
      };

      const { projectName, database, useJwt, useRbac, useOauth } = answers;

      template += `project:\n  name: "${projectName}"\n\nservices:\n`;
      template += `  - id: "express"\n    type: "express"\n\n`;
      
      if (database !== 'none') {
        template += `  - id: "database"\n    type: "${database}"\n\n`;
      }
      if (useJwt) {
        template += `  - id: "auth"\n    type: "jwt"\n`;
        if (useRbac) {
          template += `    options:\n      rbac: true\n`;
        }
        template += `\n`;
      }
      if (useOauth) {
        template += `  - id: "oauth"\n    type: "oauth"\n\n`;
      }
    } else {
      template = `project:
  name: "my-backend"

services:
  - id: "express"
    type: "express"

  - id: "database"
    type: "mongodb"

  - id: "auth"
    type: "jwt"
`;
    }

    fs.writeFileSync(target, template, 'utf-8');
    console.log('✅  Created backend.yaml');
    console.log('   Edit it, then run: backforge generate');
  });

program
  .command('generate')
  .description('Generate backend from a YAML config file')
  .argument('[file]', 'Path to your YAML config', 'backend.yaml')
  .option('-o, --out <dir>', 'Output directory', './output')
  .option('-d, --dry-run', 'Preview generated files without writing to disk')
  .action(async (file: string, opts: { out: string; dryRun?: boolean }) => {
    const yamlPath = path.resolve(process.cwd(), file);

    if (!fs.existsSync(yamlPath)) {
      console.error(`❌  Config file not found: ${yamlPath}`);
      console.error('   Run "backforge init" to create one.');
      process.exit(1);
    }

    console.log(`\n🔨 BackForge — Compiling ${file}...\n`);

    let rawConfig: Record<string, unknown>;
    try {
      rawConfig = parse(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`❌  Failed to parse YAML: ${(err as Error).message}`);
      process.exit(1);
      return;
    }

    try {
      const vfs = await runPipeline(rawConfig, path.resolve(process.cwd(), opts.out));
      
      if (opts.dryRun) {
        console.log('\n🔍 [DRY RUN] Previewing generated files:\n');
        for (const [filePath, content] of vfs.entries()) {
          console.log(`\n📄 ${filePath}\n${'-'.repeat(40)}\n${content}\n${'-'.repeat(40)}`);
        }
        return;
      }
      
      let editing = true;
      while (editing) {
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'Generated files are ready in memory. What would you like to do?',
            choices: [
              { name: '✅ Save to disk', value: 'save' },
              { name: '📝 Edit a file', value: 'edit' },
              { name: '❌ Cancel generation', value: 'cancel' }
            ]
          }
        ]) as { action: string };
        
        if (action === 'save') {
          editing = false;
        } else if (action === 'cancel') {
          console.log('Generation cancelled.');
          process.exit(0);
        } else if (action === 'edit') {
          const { fileToEdit } = await inquirer.prompt([
            {
              type: 'list',
              name: 'fileToEdit',
              message: 'Which file do you want to edit?',
              choices: Array.from(vfs.keys()),
              pageSize: 15
            }
          ]) as { fileToEdit: string };
          
          const tempFile = path.join(os.tmpdir(), `backforge-${Date.now()}-${path.basename(fileToEdit)}`);
          fs.writeFileSync(tempFile, vfs.get(fileToEdit)!);
          
          const editor = process.env.EDITOR || 'nano';
          spawnSync(editor, [tempFile], { stdio: 'inherit' });
          
          const newContent = fs.readFileSync(tempFile, 'utf-8');
          vfs.set(fileToEdit, newContent);
          fs.unlinkSync(tempFile);
          
          console.log(`\n✅ Updated ${fileToEdit} in memory.\n`);
        }
      }

      flushToDisk(path.resolve(process.cwd(), opts.out));

      console.log(`\n✅  Backend generated successfully → ${opts.out}/`);
      console.log('   Next steps:');
      console.log(`     cd ${opts.out}`);
      console.log('     cp .env.template .env');
      console.log('     npm install && npm start\n');
      
    } catch (err) {
      console.error(`\n❌  Compilation failed:\n   ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
