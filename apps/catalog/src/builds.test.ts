/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, type BufferGeometry, type Material } from "three";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildsOf, effectBuildsOf, memoryOf, noteBuilds, noteEffectTargets } from "./builds";

const count = (root: Group): number => {
  const seen = new Set<string>();
  noteBuilds(root, seen);
  return seen.size;
};

describe("noteBuilds", () => {
  it("counts a mesh, its geometry and its material once each, however often it looks", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const seen = new Set<string>();
    noteBuilds(root, seen);
    noteBuilds(root, seen);
    expect(seen.size).toBe(3);
  });

  it("is raised by a new mesh, by a swapped material and by a swapped geometry, and never lowered", () => {
    const root = new Group();
    const mesh = new Mesh<BufferGeometry, Material>(new BoxGeometry(), new MeshBasicMaterial());
    root.add(mesh);
    const seen = new Set<string>();
    noteBuilds(root, seen);
    expect(seen.size).toBe(3);

    root.add(new Mesh(mesh.geometry, mesh.material));
    noteBuilds(root, seen);
    expect(seen.size).toBe(4);

    mesh.material = new MeshBasicMaterial();
    noteBuilds(root, seen);
    expect(seen.size).toBe(5);

    mesh.geometry = new SphereGeometry();
    noteBuilds(root, seen);
    expect(seen.size).toBe(6);

    root.remove(mesh);
    noteBuilds(root, seen);
    expect(seen.size).toBe(6);
  });

  it("counts every material of a mesh that has several, and sees nothing in a graph with no drawable", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), [new MeshBasicMaterial(), new MeshBasicMaterial()]));
    expect(count(root)).toBe(4);
    expect(count(new Group().add(new Group()))).toBe(0);
  });

  it("does not read a name: two meshes named alike are two", () => {
    const root = new Group();
    const first = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const second = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    first.name = second.name = "the same";
    root.add(first, second);
    expect(count(root)).toBe(6);
  });
});

describe("buildsOf", () => {
  it("is one set for a stage that has a test id, even when its host is a new element", () => {
    buildsOf({ dataset: { testid: "stage-a" } }).add("one");
    expect([...buildsOf({ dataset: { testid: "stage-a" } })]).toEqual(["one"]);
    expect(buildsOf({ dataset: { testid: "stage-b" } }).size).toBe(0);
  });

  it("refuses a host with no test id, which has nothing to keep its count by across a mount", () => {
    expect(() => buildsOf({ dataset: {} })).toThrow(/data-testid/);
  });
});

describe("effectBuildsOf", () => {
  it("keeps its own set per stage, apart from the builds, and keeps it when the host is a new element", () => {
    effectBuildsOf({ dataset: { testid: "stage-c" } }).add("target");
    expect([...effectBuildsOf({ dataset: { testid: "stage-c" } })]).toEqual(["target"]);
    expect(buildsOf({ dataset: { testid: "stage-c" } }).size).toBe(0);
    expect(() => effectBuildsOf({ dataset: {} })).toThrow(/data-testid/);
  });

  it("is added to by a stage's pipeline, only ever adds, and says so when the host is not there instead of dropping the targets", () => {
    const host = { dataset: { testid: "stage-d" } };
    noteEffectTargets(host, ["a", "b"]);
    noteEffectTargets(host, ["b", "c"]);
    noteEffectTargets(host, []);
    expect([...effectBuildsOf(host)]).toEqual(["a", "b", "c"]);
    expect(() => {
      noteEffectTargets(null, ["d"]);
    }).toThrow(/not mounted/);
  });
});

describe("memoryOf", () => {
  it("reads geometries, textures and render targets from the renderer's own memory report", () => {
    expect(memoryOf({ info: { memory: { geometries: 3, textures: 5, renderTargets: 2, programs: 9 } } })).toEqual({ geometries: 3, textures: 5, targets: 2 });
  });

  it("reads 0 for a count the renderer does not report (the WebGL renderer has no render targets) and for no report at all", () => {
    expect(memoryOf({ info: { memory: { geometries: 3, textures: 5 } } })).toEqual({ geometries: 3, textures: 5, targets: 0 });
    expect(memoryOf({ info: {} })).toEqual({ geometries: 0, textures: 0, targets: 0 });
    expect(memoryOf({})).toEqual({ geometries: 0, textures: 0, targets: 0 });
    expect(memoryOf({ info: { memory: { geometries: "3" } } }).geometries).toBe(0);
  });
});

// The still-frame rig draws one frame for a poster or a golden: it is no stage, and nobody reads its counters.
const exempt = new Set(["Still.tsx"]);

const canvasTags = new Set(["Canvas", "WebGPUCanvas"]);
/** Names the check reads by their elements: used any other way (as a value, passed on, wrapped), a stage would be one it cannot see. */
const watched = new Set([...canvasTags, "ScreenEffectsPass"]);

type Element = ts.JsxElement | ts.JsxSelfClosingElement;
const isElement = (node: ts.Node): node is Element => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
const openingOf = (element: Element): ts.JsxOpeningLikeElement => (ts.isJsxElement(element) ? element.openingElement : element);

/** The JSX elements under `node`, from its syntax tree (a comment or a string is no element). */
function elementsUnder(node: ts.Node): Element[] {
  const found: Element[] = [];
  const visit = (child: ts.Node): void => {
    if (isElement(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** Whether `element` has a prop called `name` written out (a spread may hold it, and that cannot be seen). */
const hasProp = (element: Element, name: string): boolean => openingOf(element).attributes.properties.some((prop) => ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name) && prop.name.text === name);

/**
 * What a source file shows of its 3D stages, read from its syntax tree: how many Canvas elements it has, and what is wrong with them.
 * Each Canvas needs `counter` inside it, a screen-effect pass inside it needs `onPipeline`, and the counter of a Canvas that runs one
 * says `screenEffects`. Anything the check cannot see is a problem too: a pass outside every Canvas, and a Canvas or pass used as a value.
 */
function stagesIn(source: string, counter: string): { readonly stages: number; readonly problems: string[] } {
  const file = ts.createSourceFile("stage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const everything = elementsUnder(file);
  const tagOf = (element: Element): string => openingOf(element).tagName.getText(file);
  const canvases = everything.filter((element) => canvasTags.has(tagOf(element)));
  const inside = new Set<Element>();
  for (const canvas of canvases) {
    const within = elementsUnder(canvas);
    const counters = within.filter((element) => tagOf(element) === counter);
    if (counters.length === 0) problems.push(`a ${tagOf(canvas)} has no ${counter} inside it`);
    if (within.some((element) => tagOf(element) === "ScreenEffectsPass") && !counters.some((element) => hasProp(element, "screenEffects"))) problems.push(`a ${tagOf(canvas)} runs screen effects, and no ${counter} inside it says screenEffects`);
    for (const element of within) inside.add(element);
  }
  for (const pass of everything.filter((element) => tagOf(element) === "ScreenEffectsPass")) {
    if (!hasProp(pass, "onPipeline")) problems.push("a ScreenEffectsPass has no onPipeline");
    if (!inside.has(pass)) problems.push("a ScreenEffectsPass sits outside every Canvas in its file, so its stage cannot be seen");
  }
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && watched.has(node.text)) {
      const parent = node.parent;
      const named = ts.isImportSpecifier(parent) || ((ts.isJsxOpeningElement(parent) || ts.isJsxClosingElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === node);
      if (!named) problems.push(`${node.text} is used as a value, so the check cannot see the stage`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { stages: canvases.length, problems };
}

/** The source files under `dir` (the whole tree when `deep`) that are not tests, as `[path, text]`. */
const sourcesUnder = (dir: string, deep: boolean): readonly (readonly [string, string])[] =>
  readdirSync(dir, { recursive: deep, encoding: "utf8" })
    .filter((name) => /\.(?:ts|tsx|astro)$/.test(name) && !/\.test\.tsx?$/.test(name) && !exempt.has(name))
    .map((name) => [name, readFileSync(join(dir, name), "utf8")] as const);

describe("the check on the stages", () => {
  const counted = (body: string): string => `<WebGPUCanvas>${body}<GpuCounts target={t} /></WebGPUCanvas>`;

  it("passes a stage with its counter, and a stage with effects that reports its pipeline and says so", () => {
    expect(stagesIn(counted(""), "GpuCounts")).toEqual({ stages: 1, problems: [] });
    expect(stagesIn('<Canvas><ScreenEffectsPass effects={x.filter((e) => e.on)} onPipeline={note} /><GpuCounts target={t} screenEffects /></Canvas>', "GpuCounts").problems).toEqual([]);
  });

  it("sees a Canvas with no counter, however many Canvas elements the file has", () => {
    expect(stagesIn("<Canvas frameloop={x}><Lights /></Canvas>", "GpuCounts").problems).toEqual(["a Canvas has no GpuCounts inside it"]);
    expect(stagesIn(`${counted("")}<Canvas><Lights /></Canvas>`, "GpuCounts")).toMatchObject({ stages: 2, problems: ["a Canvas has no GpuCounts inside it"] });
  });

  it("is not fooled by a counter or a prop that is only in a comment or a string, or by an arrow function in an earlier prop", () => {
    expect(stagesIn("<Canvas>{/* <GpuCounts target={t} /> */}</Canvas>", "GpuCounts").problems).toHaveLength(1);
    expect(stagesIn('<Canvas><Lights note="<GpuCounts />" /></Canvas>', "GpuCounts").problems).toHaveLength(1);
    const pass = (props: string): string => `<Canvas><ScreenEffectsPass effects={x.filter((e) => e.on)} ${props} /><GpuCounts target={t} screenEffects /></Canvas>`;
    expect(stagesIn(pass("{/* onPipeline={note} */}"), "GpuCounts").problems).toEqual(["a ScreenEffectsPass has no onPipeline"]);
    expect(stagesIn(pass("{...rest}"), "GpuCounts").problems).toEqual(["a ScreenEffectsPass has no onPipeline"]);
  });

  it("asks each Canvas that runs screen effects for its own counter to say so, not any counter in the file", () => {
    const withEffects = '<Canvas><ScreenEffectsPass effects={e} onPipeline={note} /><GpuCounts target={a} /></Canvas>';
    const other = "<Canvas><GpuCounts target={b} screenEffects /></Canvas>";
    expect(stagesIn(`${withEffects}${other}`, "GpuCounts").problems).toEqual(["a Canvas runs screen effects, and no GpuCounts inside it says screenEffects"]);
  });

  it("flags what it cannot see: a pass outside every Canvas, a Canvas used as a value", () => {
    expect(stagesIn("<Group><ScreenEffectsPass effects={e} onPipeline={n} /></Group>", "GpuCounts").problems).toEqual(["a ScreenEffectsPass sits outside every Canvas in its file, so its stage cannot be seen"]);
    expect(stagesIn("const Stage = Canvas; export const Other = () => <Stage />;", "GpuCounts").problems).toEqual(["Canvas is used as a value, so the check cannot see the stage"]);
    expect(stagesIn('import { Canvas } from "@react-three/fiber";', "GpuCounts")).toEqual({ stages: 0, problems: [] });
  });

  it("reads the counter by the name it is given", () => {
    expect(stagesIn("<Canvas><IslandCounts target={t} /></Canvas>", "IslandCounts").problems).toEqual([]);
    expect(stagesIn("<Canvas><GpuCounts target={t} /></Canvas>", "IslandCounts").problems).toHaveLength(1);
  });
});

describe("every 3D stage in the catalog", () => {
  const sources = sourcesUnder(fileURLToPath(new URL(".", import.meta.url)), false);

  it("has the counter inside each of its Canvas and WebGPUCanvas elements, and every screen-effect pass reporting its pipeline to a counter that says so", () => {
    const read = sources.map(([name, text]) => [name, stagesIn(text, "GpuCounts")] as const);
    expect(read.reduce((all, [, one]) => all + one.stages, 0)).toBeGreaterThanOrEqual(5);
    expect(Object.fromEntries(read.filter(([, one]) => one.problems.length > 0).map(([name, one]) => [name, one.problems]))).toEqual({});
  });
});

describe("every 3D stage on the site", () => {
  const sources = sourcesUnder(fileURLToPath(new URL("../../site/src/", import.meta.url)), true);
  it("draws no canvas of its own: the scene is `<lts-scene>` (`@hedronite/lts-scene/element`), which publishes its own counters", () => {
    // No source file under the site's tree draws a React Three Fiber stage (the tripwire in
    // tools/assets/src/oneRenderer.test.ts holds the whole repo to the same), and the element is the only
    // thing on the page that publishes `data-builds`.
    expect(sources.filter(([, text]) => /\bCanvas\b/.test(text)).map(([file]) => file)).toEqual([]);
    expect(sources.filter(([, text]) => /\bIslandCounts\b/.test(text)).map(([file]) => file)).toEqual([]);
    expect(sources.filter(([file]) => file.endsWith(".astro")).length, "the page is still Astro").toBeGreaterThan(0);
  });
});