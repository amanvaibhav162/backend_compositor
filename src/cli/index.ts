import { Command } from 'commander';
import fs from 'fs';
import { parse } from 'yaml';

const program = new Command();

program
  .name('backforge')
  .description('Deterministic backend code generator composition engine')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize a new backend.yaml file')
  .action(() => {
    const defaultYaml = `project:
  name: "my-backend"
services:
  - id: "database"
    type: "mongodb"
  - id: "auth"
    type: "jwt"
`;
    fs.writeFileSync('backend.yaml', defaultYaml);
    console.log('✅ Created backend.yaml');
  });

program
  .command('generate')
  .description('Generate backend from backend.yaml')
  .argument('[file]', 'YAML config file', 'backend.yaml')
  .action((file) => {
    if (!fs.existsSync(file)) {
      console.error(`❌ Error: Could not find ${file}. Run 'backforge init' first.`);
      process.exit(1);
    }
    
    const config = parse(fs.readFileSync(file, 'utf-8'));
    console.log('🚀 Parsing configuration...', config.project.name);
    
    // TODO: 1. Normalize
    // TODO: 2. Validate
    // TODO: 3. IR
    // TODO: 4. DAG
    // TODO: 5. Execute Hooks
    // TODO: 6. Output
    console.log('✅ Generation complete! (Mock)');
  });

program.parse();
