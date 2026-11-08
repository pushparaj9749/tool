/**
 * Compiles the sky shader with the real glslang reference compiler.
 *
 * Why this exists: v2.2 shipped a black sky because the fragment shader used
 * `active` as a variable name. `active` is a reserved word in GLSL, so the
 * shader did not compile at all; WebGL then renders nothing and the player sees
 * an entirely black sky. Nothing in the JS test suite could catch that, because
 * the shader is just a string there.
 *
 * This links the shaders exactly as three.js presents them to a WebGL1 driver —
 * same #version, same precision qualifiers, same built-in uniforms and
 * attributes — and fails the build on any diagnostic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const SRC = fs.readFileSync(path.join(ROOT, 'web/src/main.js'), 'utf8');

const frag = SRC.match(/const SKY_FRAG = \/\* glsl \*\/ `([\s\S]*?)`;/)?.[1];
const vert = SRC.match(/vertexShader: `([\s\S]*?)`,\n\s*fragmentShader/)?.[1];

// three.js prepends these to every WebGL1 shader.
const VERT_PROLOGUE = `#version 100
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;
const FRAG_PROLOGUE = `#version 100
precision highp float;
precision highp int;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

// Reserved words that are easy to trip over and that a JS linter cannot see.
const RESERVED = [
  'active', 'common', 'partition', 'patch', 'asm', 'class', 'union', 'enum',
  'typedef', 'template', 'this', 'resource', 'goto', 'inline', 'noinline',
  'public', 'static', 'extern', 'external', 'interface', 'long', 'short',
  'double', 'half', 'fixed', 'unsigned', 'superp', 'input', 'output',
  'hvec2', 'hvec3', 'hvec4', 'fvec2', 'fvec3', 'fvec4', 'sampler3DRect',
  'filter', 'image1D', 'image2D', 'image3D', 'sizeof', 'cast', 'namespace',
  'using',
];

test('the sky shader sources were found', () => {
  assert.ok(frag && frag.length > 1000, 'could not extract SKY_FRAG from main.js');
  assert.ok(vert && vert.length > 50, 'could not extract the sky vertex shader');
});

test('no GLSL reserved words are used as identifiers', () => {
  const hits = [];
  for (const word of RESERVED) {
    // declaration position: `<type> word` followed by = ; , ) or space
    const re = new RegExp(`\\b(?:float|vec[234]|int|bool|mat[234])\\s+${word}\\b`, 'g');
    const m = frag.match(re);
    if (m) hits.push(`${word} (${m.length}x)`);
  }
  assert.deepEqual(hits, [], `reserved words used as variables: ${hits.join(', ')}`);
});

test('vertex shader compiles with the reference compiler', async (t) => {
  const { createGlslang } = await import('glslang-wasm');
  const glslang = await createGlslang();
  t.after(() => glslang.dispose());

  const r = await glslang.check(VERT_PROLOGUE + vert, {
    stage: 'vertex', client: 'none', link: false,
  });
  const errs = r.diagnostics.filter((d) => (d.severity ?? 'error') !== 'warning');
  assert.deepEqual(
    errs.map((d) => `line ${d.line ?? '?'}: ${d.message}`), [],
    'vertex shader failed to compile',
  );
});

test('fragment shader compiles with the reference compiler', async (t) => {
  const { createGlslang } = await import('glslang-wasm');
  const glslang = await createGlslang();
  t.after(() => glslang.dispose());

  const r = await glslang.check(FRAG_PROLOGUE + frag, {
    stage: 'fragment', client: 'none', link: false,
  });
  const errs = r.diagnostics.filter((d) => (d.severity ?? 'error') !== 'warning');
  assert.deepEqual(
    errs.map((d) => `line ${d.line ?? '?'}: ${d.message}`), [],
    'fragment shader failed to compile',
  );
});

/**
 * Splits `pow(<base>, <exp>)` arguments properly.
 *
 * A naive /pow\(([^,]+),/ regex breaks on nested calls like
 * `pow(max(1.0 - up, 0.0), 1.6)` and on multi-line arguments, so it reports
 * guarded expressions as unguarded. Walk the parentheses instead.
 */
function powArgs(src) {
  const out = [];
  const re = /\bpow\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let start = i;
    let base = null;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 1) {
        if (base === null) { base = src.slice(start, i).trim(); start = i + 1; }
      }
    }
    if (base !== null) out.push(base);
  }
  return out;
}

test('no pow() is called on a base that can go negative', () => {
  // pow() with a negative base is undefined in GLSL. Desktop drivers tend to
  // return NaN (renders black); mobile drivers are less predictable still.
  const KNOWN_SIGNED = new Set(['sunAmount', 'sunDot', 'across']);
  const bad = [];

  for (const base of powArgs(frag)) {
    // max()/abs()/clamp() with a zero-or-positive floor is the fix.
    if (/^(max|abs|clamp)\s*\(/.test(base)) continue;
    // `1.0 - clamp(x, 0.0, 1.0)` is provably non-negative.
    if (base.includes('clamp(')) continue;
    // A bare identifier is only safe if we know it was already max()-ed.
    if (KNOWN_SIGNED.has(base)) continue;
    bad.push(base);
  }

  assert.deepEqual(bad, [], `unguarded pow() bases: ${bad.join(' | ')}`);
});
