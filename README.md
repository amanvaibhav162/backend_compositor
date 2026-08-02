<p align="center">
  <h1 align="center">🔨 BackForge</h1>
  <p align="center"><strong>Deterministic Backend Composition Engine</strong></p>
  <p align="center">
    Describe your backend in YAML. Get a production-grade Express.js project in seconds.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/license-ISC-blue" alt="License">
  <img src="https://img.shields.io/badge/version-1.0.0-orange" alt="Version">
</p>

---

## What is BackForge?

BackForge is a **code-generation CLI** that compiles a declarative YAML configuration into a fully-structured Express.js backend. Instead of copy-pasting boilerplate or wiring up auth / database logic by hand, you define _what_ your backend needs and BackForge deterministically assembles the code for you.

**Key idea:** Same input YAML → same output code, every time. No randomness, no AI hallucinations — just a well-defined compiler pipeline.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Declarative YAML config** | Define services, databases, and auth in a simple `backend.yaml` file |
| **Modular architecture** | Plug-in modules for Express, MongoDB, JWT, OAuth — easily extensible |
| **Compiler pipeline** | 9-step deterministic pipeline: Parse → Validate → IR → DAG → Compile → Emit |
| **Slot / Hook system** | Modules inject code into each other through named slots with priority ordering |
| **DAG orchestration** | Kahn's algorithm resolves service dependencies and detects cycles |
| **Virtual file system** | All files are generated in-memory first — nothing touches disk until the full build succeeds |
| **Dry-run mode** | Preview every generated file without writing anything |
| **Interactive editing** | Edit generated files in your `$EDITOR` before saving |
| **Interactive init** | Guided wizard to scaffold your `backend.yaml` |
| **RBAC support** | Optional role-based access control via a single config flag |
| **Google OAuth** | One-line addition for Passport.js Google OAuth2 |

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
git clone <repo-url> && cd backend_compositor
npm install
```

### 2. Initialize a project

```bash
# Static template
npm run backforge init

# Interactive wizard
npm run backforge init -- -i
```

This creates a `backend.yaml` in your current directory:

```yaml
project:
  name: "my-backend"

services:
  - id: "express"
    type: "express"

  - id: "database"
    type: "mongodb"

  - id: "auth"
    type: "jwt"
```

### 3. Generate your backend

```bash
npm run backforge generate
```

BackForge compiles the YAML, resolves dependencies, and emits a complete project into `./output/`.

### 4. Run the generated backend

```bash
cd output
cp .env.template .env   # fill in your secrets
npm install
npm run dev
```

Your server is live at `http://localhost:8000` 🎉

---

## 📖 CLI Reference

### `backforge init`

Scaffolds a starter `backend.yaml` file.

| Flag | Description |
|---|---|
| `-i, --interactive` | Launch guided wizard with Inquirer prompts |

### `backforge generate [file]`

Compiles a YAML config into a full backend project.

| Argument / Flag | Default | Description |
|---|---|---|
| `[file]` | `backend.yaml` | Path to your YAML config |
| `-o, --out <dir>` | `./output` | Output directory |
| `-d, --dry-run` | — | Preview generated files without writing to disk |

After generation, BackForge enters an **interactive mode** where you can:
- ✅ **Save to disk** — flush all files to the output directory
- 📝 **Edit a file** — open any generated file in `$EDITOR` before saving
- ❌ **Cancel** — abort without writing anything

---

## 🏗️ Architecture

### Compiler Pipeline (9 Steps)

```
YAML File
  │
  ▼
┌─────────────────────────────────────────────────┐
│  Step 1–2: Parse YAML                           │
├─────────────────────────────────────────────────┤
│  Step 3: Normalize to InternalConfig            │
├─────────────────────────────────────────────────┤
│  Step 4: Validate (Zod schema + semantic rules) │
├─────────────────────────────────────────────────┤
│  Step 5: Build IR (Intermediate Representation) │
├─────────────────────────────────────────────────┤
│  Step 6: DAG sort (Kahn's algorithm)            │
├─────────────────────────────────────────────────┤
│  Step 7: Slot + Hook registration               │
├─────────────────────────────────────────────────┤
│  Step 8: Module execution + code generation     │
├─────────────────────────────────────────────────┤
│  Step 9: VFS flush to disk                      │
└─────────────────────────────────────────────────┘
  │
  ▼
Generated Project
```

### Slot / Hook System

Modules communicate through a **slot/hook** mechanism for deterministic code injection:

- **Slots** are named injection points exposed by a module (e.g., `express:app:middleware`)
- **Hooks** are code fragments registered by other modules that target a slot
- At compile time, hooks are sorted by `priority` (lower = first), then alphabetically for ties
- This guarantees **100% deterministic output** — same config always produces the same code

### Project Structure

```
backend_compositor/
├── src/
│   ├── cli/
│   │   └── index.js           # CLI entry point (Commander.js)
│   ├── engine/
│   │   ├── config.js           # Zod schemas + semantic validation
│   │   ├── emitter.js          # Virtual file system (VFS)
│   │   ├── hookSystem.js       # Slot/Hook registry + resolution
│   │   ├── orchestrator.js     # DAG topological sort (Kahn's)
│   │   ├── pipeline.js         # 9-step compiler pipeline
│   │   └── types.js            # JSDoc type definitions
│   └── modules/
│       ├── core-express/       # Express.js base server
│       ├── db-mongodb/         # MongoDB/Mongoose integration
│       ├── auth-jwt/           # JWT auth (access + refresh tokens)
│       └── auth-oauth/         # Google OAuth2 via Passport.js
└── package.json
```

---

## 📦 Available Modules

### `core-express` — Base HTTP Server

The foundation module. Generates a professional Express.js project with:

- `src/app.js` — Express app with CORS, JSON parsing, cookie-parser, and static files
- `src/index.js` — Server entry point
- `src/utils/asyncHandler.js` — Clean async error handling for controllers
- `src/utils/ApiError.js` — Standardized error class
- `src/utils/ApiResponse.js` — Standardized response class

**Exposed Slots:**

| Slot | Purpose |
|---|---|
| `express:app:imports` | Import statements for `app.js` |
| `express:app:middleware` | Middleware registration in `app.js` |
| `express:app:routes` | Route mounting in `app.js` |
| `express:index:imports` | Import statements for `index.js` |
| `express:index:start` | Pre-start logic in `index.js` (e.g., DB connect) |

---

### `db-mongodb` — MongoDB Integration

Hooks into Express to add Mongoose database connectivity.

- `src/db/db.js` — Connection helper with error handling
- Automatically injects `connectDB()` call before server start

**Depends on:** `core-express`

---

### `auth-jwt` — JWT Authentication

Full auth system with access/refresh token flow.

- `src/models/user.model.js` — User schema with bcrypt + JWT methods
- `src/controllers/user.controller.js` — Register, login, logout handlers
- `src/middlewares/auth.middleware.js` — `verifyJWT` middleware
- `src/routes/user.routes.js` — `/api/v1/users/*` routes

**Depends on:** `db-mongodb`

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `rbac` | `boolean` | `false` | Enable role-based access control (`user` / `admin` roles) |

When RBAC is enabled, an additional `role.middleware.js` with a `checkRole()` guard is generated.

**YAML example:**

```yaml
- id: "auth"
  type: "jwt"
  options:
    rbac: true
```

---

### `auth-oauth` — Google OAuth2

Passport.js integration for Google sign-in.

- `src/middlewares/passport.js` — Google Strategy configuration
- `src/routes/auth.routes.js` — `/auth/google` and `/auth/google/callback`

**Depends on:** `db-mongodb`, `core-express`

---

## 🔧 Generated Output Structure

For a full-featured config (Express + MongoDB + JWT + OAuth), BackForge generates:

```
output/
├── .env.template
├── .gitignore
├── package.json
├── README.md
├── public/
│   └── temp/
│       └── .gitkeep
└── src/
    ├── app.js
    ├── index.js
    ├── constants.js
    ├── controllers/
    │   └── user.controller.js
    ├── db/
    │   └── db.js
    ├── middlewares/
    │   ├── auth.middleware.js
    │   ├── passport.js
    │   └── role.middleware.js       # only with rbac: true
    ├── models/
    │   └── user.model.js
    ├── routes/
    │   ├── auth.routes.js
    │   └── user.routes.js
    └── utils/
        ├── ApiError.js
        ├── ApiResponse.js
        └── asyncHandler.js
```

---

## 🧩 Writing Custom Modules

Each module is a single ES module file that exports:

```js
// Unique module identifier
export const id = 'feature:my-module';

// What this module provides
export const provides = ['feature:my-module'];

// Module dependencies (other module IDs)
export const requires = ['core:express'];

// npm packages to include in generated package.json
export const dependencies = { 'some-package': '^1.0.0' };

// Environment variables for .env.template
export const envVars = `MY_VAR=default_value`;

// Slots this module exposes (optional)
export const slots = {
  'my-module:config': {
    name: 'my-module:config',
    description: 'Inject config into my module',
  },
};

// Hooks this module injects into other modules' slots (optional)
export const hooks = [
  {
    name: 'my-module:express-route',
    targetSlot: 'express:app:routes',
    priority: 20,
    async execute(config) {
      return { content: `app.use('/my-route', myRouter);` };
    },
  },
];

// Main code generation function
export async function bootstrap(config, resolveSlot) {
  addFile('src/my-feature.js', `// generated code here`);
}
```

Then register it in `src/engine/pipeline.js`:

```js
import * as myModule from '../modules/my-module/index.js';

const MODULE_REGISTRY = {
  // ...existing modules
  [myModule.id]: myModule,
};

const TYPE_TO_MODULE = {
  // ...existing mappings
  'my-module': 'feature:my-module',
};
```

---

## ⚙️ Dependencies

| Package | Purpose |
|---|---|
| [commander](https://www.npmjs.com/package/commander) | CLI framework |
| [inquirer](https://www.npmjs.com/package/inquirer) | Interactive prompts |
| [yaml](https://www.npmjs.com/package/yaml) | YAML parsing |
| [zod](https://www.npmjs.com/package/zod) | Schema validation |

---

## 📄 License

ISC
