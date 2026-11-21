# LuminosiTS (LTS)

**A progressive, modular TypeScript visual library for designing anything.**

LuminosiTS is a typed arsenal of icons, Three.js primitives, objects, scenes, materials, and shaders. It is built so a single engineer (or small team) can design, iterate, and ship visual work for any client, any aesthetic, and any medium — web, games, or interactive experiences. Personal or house styles are optional packs or presets, not the foundation of the library.

The library surface is pure TypeScript. React and TSX appear only where they are the natural interface. Heavy processing and generation can live in companion tools written in Rust or Go. The development environment is reproducible with Nix and fast with Bun.

How these languages and tools fit together: [STACK.md](STACK.md).

---

## Philosophy

- **General-purpose by design.** Assets are style-agnostic building blocks. Any aesthetic (corporate, playful, technical, artistic, or custom) is composed on top, not baked in.
- **Progressive by design.** Start with a usable core and grow the arsenal visibly. The catalog is the living index of that growth.
- **Assets as code.** Everything is typed, importable, tree-shakeable, and disposable. No opaque dumps.
- **Pure TypeScript first.** Core packages have no React or JSX dependency. They work with vanilla Three.js, games, or any framework.
- **TSX is complementary.** React components and R3F wrappers exist where they are the natural interface (icons, adapters, catalog). React is an optional peer dependency.
- **Modular consumption.** Import only what you need. Icons alone, primitives alone, or the full stack.
- **Optimization-first.** Web and game constraints (poly budgets, compressed formats, proper disposal) are considered from the start.
- **Dogfooding and portfolio.** The catalog (with its playground) and the Astro site are the first real consumers. The project itself demonstrates range and quality.

---

## Package Boundaries

Monorepo managed with Bun workspaces + Turborepo. Nix flake for the reproducible shell. Package names use the `@hedronite/lts-*` scope (or a neutral scope if preferred).

| Package | Scope | Responsibility | Notes |
|---------|-------|----------------|-------|
| `core` | `@hedronite/lts-core` | Asset registry, typed metadata (Zod), manifests, versioning, shared types | Zero runtime deps beyond Zod. Pure TS. |
| `tokens` | `@hedronite/lts-tokens` | Design tokens: scales, colors and looks (presets), with the CSS they generate | Pure TS. Every text pair in every look is contrast-tested. |
| `icons` | `@hedronite/lts-icons` | Tree-shakeable SVG data + optional React components. Categories and tags are flexible. Optional 3D extrusions. | Dual export: pure TS + `/react` TSX. React optional peer. |
| `primitives` | `@hedronite/lts-primitives` | Three.js geometric primitives, materials, lights, helpers | Pure TS. Style-agnostic. |
| `objects` | `@hedronite/lts-objects` | Composable 3D objects, typed GLTF/GLB wrappers, procedural generators | Pure TS. |
| `scenes` | `@hedronite/lts-scenes` | Prebuilt scene kits, environments, lighting setups, camera presets | Pure TS. Kits can target different aesthetics. |
| `materials` | `@hedronite/lts-materials` | PBR material presets, texture packs, shared palettes | Pure TS. Presets are examples, not constraints. |
| `shaders` | `@hedronite/lts-shaders` | Custom GLSL / TSL shaders | Pure TS. Effects are tools, not a fixed look. |
| `postfx` | `@hedronite/lts-postfx` | Screen effects: passes over the rendered frame (dither, ASCII, grain, scan, lens, smoke) | Pure TS. Three.js WebGPU (peer). |
| `registry` | `@hedronite/lts-registry` | Every package's assets registered together, with search and copy-ready snippets | Data only: manifests and root entries, never a `./three` entry. |
| `scene` | `@hedronite/lts-scene` | One composition as one versioned document: schema, migration, reference check, and its canonical JSON | Root and `./emit` are data only: zod and core, no three.js, no React. |
| `adapters` | `@hedronite/lts-adapters` | R3F components, vanilla helpers, future framework targets | TSX. React + R3F optional peers. Every viewport draws on the WebGPU renderer (`./webgpu`); its canvas says which backend drew it. |

**Apps (not published):**
- `catalog` — interactive visual browser and progressive showcase, with a scene playground and a growth view
- `site` — an Astro page that dogfoods the library from a built island

**Tools (not published):**
- CLIs and pipelines for optimization, generation, and validation. These may call out to Rust or Go.

**Rules:**
- No circular dependencies.
- `core` is the only shared foundation.
- Adapters are optional; raw packages are usable without them.
- Each package has a clean public API.
- Prefer style-agnostic primitives; aesthetic direction lives in presets, packs, or consuming projects.

---

## Scaffolding Notes

### Root
- Bun workspaces
- Turborepo for task orchestration
- `tsconfig.base.json` with strict settings and `jsx: "react-jsx"` available for packages that need it
- Nix flake providing Bun and Node (TypeScript and every other JS tool come from `bun.lock`)
- `AGENTS.md` at the root for AI agent guidance

### Package pattern
- Pure packages: `"type": "module"`, clean `exports`, `tsc` build
- Icons: dual `exports` (`.` and `./react`)
- Adapters: peerDependencies with `optional: true`
- Source in `src/`, built to `dist/`

### Bun-specific
- Use `bun install` and `bun run`
- The catalog uses Vite under Bun for fast iteration; the site uses Astro

---

## Catalogue App

The catalog is both a development tool and a demonstration of range. It surfaces every icon, primitive, object, material, shader, and scene as the library grows.

**Stack:** Bun + Vite + React + TypeScript + React Three Fiber + Tailwind

**Surfaces:**
1. **Gallery / Grid** — Filterable, searchable cards with live or static thumbnails. Categories and tags. Progressive empty states.
2. **Detail / Preview** — Full preview. Icons show SVG + copyable component/SVG. 3D items get an interactive R3F viewport. Code snippet panel with typed import and minimal usage.
3. **Scene playground** — Compose multiple objects, control lighting/environment, export composition as code or JSON.
4. **Search & timeline** — Instant search. “Recently added” and growth timeline views.
5. **Range** — The catalog can host multiple demo packs or aesthetic presets side-by-side so the breadth of possible client work is visible.

The catalog imports from local workspace packages and uses the core registry so new assets appear with minimal manual registration.

---

## Agent tools: lumin

Agents reach the library through `lumin`, a command-line tool that prints one JSON envelope (`{ ok, command, data }`, or `{ ok: false, command, error, kind, exit }`) and exits with its code, and through the Nushell skills in `.agents/skills` that wrap it.

- **Scene documents.** The `lumin-scene` skill is the primary path to a scene document (`lts-scene` JSON, see [STACK.md](STACK.md#scene-document)): `nu .agents/skills/lumin-scene/lumin-scene.nu validate|diff|patch|export`. It checks a document and names every problem by path, compares two documents by node id, applies the package's edit operations all or nothing, and writes a document as React code, a vanilla module, canonical JSON or a share link. Without Nushell, `bun run lumin scene validate|diff|patch|export` prints the same envelope.
- **MCP server.** For a client that speaks MCP and not Nushell, `lumin mcp [--root PATH]... [--allow-write] [--allow-render]` serves the same operations over stdio, after the skill and below it in preference: `scene_validate`, `scene_diff`, `scene_patch` and `scene_export` (one tool for each row of the operation table), and `asset_search` and `asset_show` for the library. A tool's result is the CLI's envelope, exactly, in `structuredContent`. A client config:

  ```json
  { "mcpServers": { "lumin": { "command": "bun", "args": ["/path/to/luminosi-ts/tools/lumin/src/cli.ts", "mcp", "--root", "/path/to/your/documents"] } } }
  ```

  The server reads a document by path only under a `--root`, writes a file (`out`) only with `--allow-write` and under a root, and lists `scene_render` only with both `--allow-render` and `--allow-write`. See [STACK.md](STACK.md#scene-document).
- **Assets and the rest.** `lumin` (find and read), `lumin-check` (the gate), `lumin-new`, `lumin-adopt` and `lumin-ui`. See [AGENTS.md](AGENTS.md).

## Aesthetic Flexibility

Visual language is not prescribed by the library. Primitives, materials, and shaders are tools. Specific looks (including any house style) are optional packs, presets, or consuming-project decisions. The catalog and its playground should be able to demonstrate contrasting examples so the library’s generality is obvious.

---

## Purpose

LuminosiTS exists so that designing for any client — law, clinic, commerce, restaurant, technical, artistic, or otherwise — has a shared, typed, progressive visual foundation. It is a personal arsenal that scales to client work and portfolio demonstration without locking the aesthetic.

---

*This manifesto is the single source of conceptual and structural truth for LuminosiTS. Implementation details live in code, [AGENTS.md](AGENTS.md), and the companion [roadmap](ROADMAP.md).*

---

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option.

Third-party material is listed, with its license and credit, in [`CREDITS.md`](CREDITS.md). The main exception is `tools/img-to-object/upstream/`, a vendored copy of an Apache-2.0 project: it is under the Apache License 2.0 only. See its [`NOTICE`](tools/img-to-object/NOTICE).

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this work, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
