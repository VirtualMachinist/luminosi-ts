import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The one-renderer tripwire (ROADMAP D1): no `WebGLRenderer` is constructed, named or imported, and no
// React Three Fiber `Canvas` is rendered, anywhere in `apps/*/src` and `packages/*/src` — outside tests,
// generated code and `assets/vendor`. The one `Canvas` the library renders is `WebGPUCanvas`'s own, in
// `packages/adapters/src/postfx.tsx`, which always passes the WebGPU `gl`; that file is the allowlist.
// A plain `<Canvas>` anywhere else, or any `WebGLRenderer` at all, is the classic renderer back, and this
// test fails it.
//
// Exception while Wave 8's G2 (stills and embed) is still open on its branch: `apps/catalog/src/Still.tsx`
// and `apps/catalog/src/embed.ts` are that step's files, and its PR moves both onto the WebGPU renderer.
// The entries below are removed when G2 merges; ROADMAP D1 is ticked only after every step of the wave has.

/** The repo root, from this file's place in tools/assets/src. */
const ROOT = join(import.meta.dirname, "..", "..", "..");

/** The directories the tripwire walks: every app's and package's `src`. */
const scanRoots = (): readonly string[] => {
  const roots: string[] = [];
  for (const top of ["apps", "packages"]) {
    const dir = join(ROOT, top);
    for (const entry of readdirSync(dir)) {
      const src = join(dir, entry, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // no src in that package
      }
    }
  }
  return roots;
};

/** Generated code: the icons' generated module, and anything under a `generated` folder. */
const GENERATED = /(?:^|[\\/])generated[\\/]|generated\.tsx$/;

const isTestFile = (file: string): boolean => /\.(?:test|spec)\.(?:ts|tsx)$/.test(file) || file.includes(`${sep}__tests__${sep}`);

/** The one file allowed to render a `Canvas`: it always passes three's WebGPU renderer as `gl`. */
const CANVAS_ALLOW = join(ROOT, "packages", "adapters", "src", "postfx.tsx");

/** The files of an open step whose move to the WebGPU renderer is the step's own PR (Wave 8's G2). */
const OPEN_STEP_FILES = new Set([join(ROOT, "apps", "catalog", "src", "Still.tsx"), join(ROOT, "apps", "catalog", "src", "embed.ts")]);

/**
 * The file's text with its comments removed, so a comment that names `WebGLRenderer` ("this used to hold a
 * `WebGLRenderer`") is not a violation. Strings are left alone: an honest message may say WebGL, and the
 * matcher only reads identifiers.
 */
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
const where = (file: string): string => relative(ROOT, file);

/** The tripwire's matchers over one comment-free line, as the walk applies them. */
const matches = (line: string, allowCanvas: boolean): boolean =>
  /\bnew\s+WebGLRenderer\b/.test(line) ||
  (/\bWebGLRenderer\b/.test(line)) ||
  (/<Canvas\b/.test(line) && !allowCanvas);

/** The scanned files, so a test can prove the walk reached the code it guards. */
const scanned: string[] = [];

const violations: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) {
        walk(file);
        continue;
      }
      if (!/\.(?:ts|tsx|js|mjs|astro)$/.test(file)) continue;
      if (isTestFile(file)) continue;
      if (GENERATED.test(file)) continue;
      if (OPEN_STEP_FILES.has(file)) continue;
      scanned.push(relative(ROOT, file));
      const text = stripComments(readFileSync(file, "utf8"));
      for (const line of text.split("\n")) {
        if (/\bnew\s+WebGLRenderer\b/.test(line)) found.push(`${where(file)}: constructing three's WebGL renderer: ${line.trim()}`);
        else if (/\bWebGLRenderer\b/.test(line)) found.push(`${where(file)}: the WebGL renderer's name (a type-only import is a violation too): ${line.trim()}`);
        else if (/<Canvas\b/.test(line) && file !== CANVAS_ALLOW) found.push(`${where(file)}: a plain React Three Fiber <Canvas> (the WebGPU canvas is in packages/adapters/src/postfx.tsx): ${line.trim()}`);
      }
    }
  };
  for (const root of scanRoots()) walk(root);
  return found;
})();

describe("one renderer", () => {
  it("finds no WebGL renderer and no plain React Three Fiber canvas in the sources", () => {
    expect(violations, "the classic renderer is back").toEqual([]);
  });

  it("walked the sources it guards, the WebGPU canvas's own file among them", () => {
    expect(scanned.length, "the walk reached the code").toBeGreaterThan(0);
    expect(scanned).toContain(relative(ROOT, CANVAS_ALLOW));
  });

  it("keeps a WebGPU gl on the one canvas it allows", () => {
    const text = readFileSync(CANVAS_ALLOW, "utf8");
    // The allowlisted <Canvas> is WebGPUCanvas's own: it builds a WebGPURenderer and hands it to R3F as gl.
    expect(text).toMatch(/<Canvas\b/);
    expect(text).toMatch(/gl=\{?async/);
    expect(text).toMatch(/new\s+WebGPURenderer/);
  });

  it("fails a planted classic renderer and a planted plain canvas, in a tree of its own", () => {
    const root = mkdtempSync(join(tmpdir(), "lts-onerenderer-"));
    try {
      for (const top of ["apps", "packages"]) mkdirSync(join(root, top, "demo", "src"), { recursive: true });
      writeFileSync(
        join(root, "packages", "demo", "src", "classic.ts"),
        'import { WebGLRenderer } from "three";\nexport const renderer = new WebGLRenderer();\n',
      );
      writeFileSync(
        join(root, "packages", "demo", "src", "typed.ts"),
        'import type { WebGLRenderer } from "three";\nexport type R = WebGLRenderer;\n',
      );
      writeFileSync(join(root, "packages", "demo", "src", "commented.ts"), '// a WebGLRenderer used to live here\nexport const ok = 1;\n');
      writeFileSync(join(root, "apps", "demo", "src", "stage.tsx"), 'import { Canvas } from "@react-three/fiber";\nexport const Stage = () => <Canvas />;\n');
      // A comment naming the renderer is not a violation; a construction, a type-only import and a plain canvas are.
      const planted = [join(root, "packages", "demo", "src", "classic.ts"), join(root, "packages", "demo", "src", "typed.ts"), join(root, "apps", "demo", "src", "stage.tsx")];
      const clean = [join(root, "packages", "demo", "src", "commented.ts")];
      const read = (file: string): readonly string[] => stripComments(readFileSync(file, "utf8")).split("\n");
      const relativeFile = (file: string): string => relative(root, file);
      for (const file of planted) expect(read(file).some((line) => matches(line, false)), `${relativeFile(file)} must trip the tripwire`).toBe(true);
      for (const file of clean) expect(read(file).some((line) => matches(line, false)), `${relativeFile(file)} must stay clean`).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
