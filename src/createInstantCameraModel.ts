import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  /** Use false when the host supplies its own independently authored PBR maps. */
  referenceTextures?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless || options.referenceTextures === false
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Instant Camera
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createInstantCameraModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Instant Camera";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 36, "aspect": 1.0, "orientation": {"yaw": 0.35, "pitch": 0.18, "roll": 0}, "positionHint": [4, 2.6, 10], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["cream"] = createSculptMaterial(
    "cream",
    {"id": "cream", "name": "cream", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#e8e1cc", "color": "#e8e1cc", "albedo": {"dominant": "#BDB19D", "secondary": ["#766852", "#8B7D67", "#AC9F89"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/images/instant-camera-materials/cream_albedo.png", "url": "/images/instant-camera-materials/cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#BDB19D", "#766852", "#8B7D67", "#AC9F89", "#988B74"], "pattern": "reference-derived pixel palette", "amplitude": 0.136, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.393, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.23, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.101, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.681, "variation": 0.05, "map": {"path": "/images/instant-camera-materials/cream_roughness.png", "url": "/images/instant-camera-materials/cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.179, "map": {"path": "/images/instant-camera-materials/cream_normal.png", "url": "/images/instant-camera-materials/cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/images/instant-camera-materials/cream_height.png", "url": "/images/instant-camera-materials/cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.01, "map": {"path": "/images/instant-camera-materials/cream_height.png", "url": "/images/instant-camera-materials/cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/images/instant-camera-materials/cream_ao.png", "url": "/images/instant-camera-materials/cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "cream-surface", "region": "whole-part", "roughness": 0.58, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "referencePbr": {"version": "1.0", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.806, "estimatedFidelity": 0.806, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/images/instant-camera-materials/cream_albedo.png", "url": "/images/instant-camera-materials/cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/images/instant-camera-materials/cream_roughness.png", "url": "/images/instant-camera-materials/cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/images/instant-camera-materials/cream_height.png", "url": "/images/instant-camera-materials/cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/images/instant-camera-materials/cream_normal.png", "url": "/images/instant-camera-materials/cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/images/instant-camera-materials/cream_ao.png", "url": "/images/instant-camera-materials/cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 40, "sourceHeight": 95, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 44, "width": 6, "height": 51}, "mask": {"backgroundColor": "#DBD2C4", "backgroundNoise": 18.708, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.0384}, "mapStats": {"valueRange": 0.3233, "heightP90Gradient": 0.01916, "roughnessBase": 0.681, "roughnessVariation": 0.05, "normalStrength": 0.179, "blurRadius": 21}, "palette": ["#BDB19D", "#766852", "#8B7D67", "#AC9F89", "#988B74"]}, "warnings": ["foreground mask is very small", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["charcoal"] = createSculptMaterial(
    "charcoal",
    {"id": "charcoal", "name": "charcoal", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#292b2d", "color": "#292b2d", "albedo": {"dominant": "#404041", "secondary": ["#3C3C3D", "#454545", "#373638"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/images/instant-camera-materials/charcoal_albedo.png", "url": "/images/instant-camera-materials/charcoal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#404041", "#3C3C3D", "#454545", "#373638", "#4D4E4D"], "pattern": "reference-derived pixel palette", "amplitude": 0.08, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.308, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.813, "variation": 0.173, "map": {"path": "/images/instant-camera-materials/charcoal_roughness.png", "url": "/images/instant-camera-materials/charcoal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.308, "map": {"path": "/images/instant-camera-materials/charcoal_normal.png", "url": "/images/instant-camera-materials/charcoal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/images/instant-camera-materials/charcoal_height.png", "url": "/images/instant-camera-materials/charcoal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.058, "map": {"path": "/images/instant-camera-materials/charcoal_height.png", "url": "/images/instant-camera-materials/charcoal_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/images/instant-camera-materials/charcoal_ao.png", "url": "/images/instant-camera-materials/charcoal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "charcoal-surface", "region": "whole-part", "roughness": 0.7, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "referencePbr": {"version": "1.0", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.716, "estimatedFidelity": 0.716, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/images/instant-camera-materials/charcoal_albedo.png", "url": "/images/instant-camera-materials/charcoal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/images/instant-camera-materials/charcoal_roughness.png", "url": "/images/instant-camera-materials/charcoal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/images/instant-camera-materials/charcoal_height.png", "url": "/images/instant-camera-materials/charcoal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/images/instant-camera-materials/charcoal_normal.png", "url": "/images/instant-camera-materials/charcoal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/images/instant-camera-materials/charcoal_ao.png", "url": "/images/instant-camera-materials/charcoal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 60, "sourceHeight": 130, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 60, "height": 130}, "mask": {"backgroundColor": "#414041", "backgroundNoise": 13.304, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.08, "heightP90Gradient": 0.12991, "roughnessBase": 0.813, "roughnessVariation": 0.173, "normalStrength": 0.308, "blurRadius": 21}, "palette": ["#404041", "#3C3C3D", "#454545", "#373638", "#4D4E4D"]}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["black"] = createSculptMaterial(
    "black",
    {"id": "black", "name": "black", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#101318", "color": "#101318", "albedo": {"dominant": "#101318", "secondary": ["#101318"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#101318"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.33, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.15, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "black-surface", "region": "whole-part", "roughness": 0.33, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["glass"] = createSculptMaterial(
    "glass",
    {"id": "glass", "name": "glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#171a32", "color": "#171a32", "albedo": {"dominant": "#171a32", "secondary": ["#171a32"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#171a32"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.1, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.45, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "glass-surface", "region": "whole-part", "roughness": 0.1, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["flash"] = createSculptMaterial(
    "flash",
    {"id": "flash", "name": "flash", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#e8e5db", "color": "#e8e5db", "albedo": {"dominant": "#e8e5db", "secondary": ["#e8e5db"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#e8e5db"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.22, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.25, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "flash-surface", "region": "whole-part", "roughness": 0.22, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["metal"] = createSculptMaterial(
    "metal",
    {"id": "metal", "name": "metal", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b3b0a5", "color": "#b3b0a5", "albedo": {"dominant": "#b3b0a5", "secondary": ["#b3b0a5"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#b3b0a5"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.24, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.7, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "metal-surface", "region": "whole-part", "roughness": 0.24, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["red"] = createSculptMaterial(
    "red",
    {"id": "red", "name": "red", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#d43b31", "color": "#d43b31", "albedo": {"dominant": "#d43b31", "secondary": ["#d43b31"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#d43b31"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.3, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "red-surface", "region": "whole-part", "roughness": 0.3, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["orange"] = createSculptMaterial(
    "orange",
    {"id": "orange", "name": "orange", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#ec8a23", "color": "#ec8a23", "albedo": {"dominant": "#ec8a23", "secondary": ["#ec8a23"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#ec8a23"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.42, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "orange-surface", "region": "whole-part", "roughness": 0.42, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["yellow"] = createSculptMaterial(
    "yellow",
    {"id": "yellow", "name": "yellow", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#f3c93c", "color": "#f3c93c", "albedo": {"dominant": "#f3c93c", "secondary": ["#f3c93c"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#f3c93c"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.42, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "yellow-surface", "region": "whole-part", "roughness": 0.42, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["green"] = createSculptMaterial(
    "green",
    {"id": "green", "name": "green", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#508d63", "color": "#508d63", "albedo": {"dominant": "#508d63", "secondary": ["#508d63"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#508d63"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.42, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "green-surface", "region": "whole-part", "roughness": 0.42, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );
  materialMap["blue"] = createSculptMaterial(
    "blue",
    {"id": "blue", "name": "blue", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#2b7fab", "color": "#2b7fab", "albedo": {"dominant": "#2b7fab", "secondary": ["#2b7fab"], "samplingNotes": "Observed solid color zone."}, "colorVariation": {"palette": ["#2b7fab"], "pattern": "fine-grain", "amplitude": 0.006, "heightCorrelation": 0.3}, "roughness": {"base": 0.42, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "blue-surface", "region": "whole-part", "roughness": 0.42, "notes": "Molded surface, subtle highlight variation", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Synthetic reference approximate material family; no calibrated physical measurement.", "textureless": {"declared": true, "evidence": ["full-object: smooth optical glass, metal trim, red button and flat colored stripe regions show no resolvable texture; ring/rib details are geometry."]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.001, 0.001, 0.001);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["charcoal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_rear_shell_1 = makeAttachmentEndpoint(null);
  const node_rear_shell_1 = new THREE.Group();
  node_rear_shell_1.name = "rear-shell__pivot";
  node_rear_shell_1.scale.set(1, 1, 1);
  if (endpoint_rear_shell_1) {
    node_rear_shell_1.position.copy(endpoint_rear_shell_1.start);
    node_rear_shell_1.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_rear_shell_1.position.set(-1.8531999999999997, 0.0, 0.0);
    node_rear_shell_1.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_rear_shell_1.userData.sculptComponent = {"id": "rear-shell", "name": "rear-shell", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[1.08, -0.68], [1.08, 0.65], [0.72, 1.28], [-0.48, 1.28], [-0.64, -0.68]], "depth": 3.7063999999999995}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "rear-shell-mount", "localStart": [-1.64, 0, 0], "localEnd": [-1.64, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.8531999999999997, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-shell-detail", "type": "seam", "description": "Housing meeting film base", "placement": "visible front region", "size": 0.04, "geometryEffect": "Housing meeting film base", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rear_shell_1.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_rear_shell_1);
  nodes["rear-shell"] = node_rear_shell_1;
  const mesh_rear_shell_1Geometry = endpoint_rear_shell_1
    ? new THREE.CylinderGeometry(endpoint_rear_shell_1.endRadius, endpoint_rear_shell_1.baseRadius, endpoint_rear_shell_1.length, 16, 6)
    : buildExtrudeGeometry({"points": [[1.08, -0.68], [1.08, 0.65], [0.72, 1.28], [-0.48, 1.28], [-0.64, -0.68]], "depth": 3.7063999999999995});
  if (!endpoint_rear_shell_1) {
    mesh_rear_shell_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_shell_1 = new THREE.Mesh(
    mesh_rear_shell_1Geometry,
    materialMap["charcoal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_shell_1.name = "rear-shell";
  if (endpoint_rear_shell_1) {
    mesh_rear_shell_1.position.copy(endpoint_rear_shell_1.midpoint);
    mesh_rear_shell_1.quaternion.copy(endpoint_rear_shell_1.quaternion);
  }
  mesh_rear_shell_1.castShadow = options.castShadow ?? true;
  mesh_rear_shell_1.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_shell_1.userData.sculptComponent = {"id": "rear-shell", "name": "rear-shell", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[1.08, -0.68], [1.08, 0.65], [0.72, 1.28], [-0.48, 1.28], [-0.64, -0.68]], "depth": 3.7063999999999995}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "rear-shell-mount", "localStart": [-1.64, 0, 0], "localEnd": [-1.64, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.8531999999999997, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-shell-detail", "type": "seam", "description": "Housing meeting film base", "placement": "visible front region", "size": 0.04, "geometryEffect": "Housing meeting film base", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rear_shell_1.add(mesh_rear_shell_1);
  meshes["rear-shell"] = mesh_rear_shell_1;
  colliders["rear-shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-shell"] ??= [];
  destructionGroups["rear-shell"].push(node_rear_shell_1);

  const endpoint_film_base_2 = makeAttachmentEndpoint(null);
  const node_film_base_2 = new THREE.Group();
  node_film_base_2.name = "film-base__pivot";
  node_film_base_2.scale.set(1, 1, 1);
  if (endpoint_film_base_2) {
    node_film_base_2.position.copy(endpoint_film_base_2.start);
    node_film_base_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_film_base_2.position.set(0.0, -1.02, 0.05);
    node_film_base_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_film_base_2.userData.sculptComponent = {"id": "film-base", "name": "film-base", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "film-base-mount", "localStart": [0, -1.02, 0.05], "localEnd": [0, -1.02, 0.07], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.8419999999999996, "height": 0.68, "depth": 2.45, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -1.02, 0.05], "rotation": [0, 0, 0], "scale": [3.8419999999999996, 0.68, 2.45]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "film-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_film_base_2.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "film-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_film_base_2);
  nodes["film-base"] = node_film_base_2;
  const mesh_film_base_2Geometry = endpoint_film_base_2
    ? new THREE.CylinderGeometry(endpoint_film_base_2.endRadius, endpoint_film_base_2.baseRadius, endpoint_film_base_2.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_film_base_2) {
    mesh_film_base_2Geometry.scale(3.8419999999999996, 0.68, 2.45);
  }
  const mesh_film_base_2 = new THREE.Mesh(
    mesh_film_base_2Geometry,
    materialMap["charcoal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_film_base_2.name = "film-base";
  if (endpoint_film_base_2) {
    mesh_film_base_2.position.copy(endpoint_film_base_2.midpoint);
    mesh_film_base_2.quaternion.copy(endpoint_film_base_2.quaternion);
  }
  mesh_film_base_2.castShadow = options.castShadow ?? true;
  mesh_film_base_2.receiveShadow = options.receiveShadow ?? true;
  mesh_film_base_2.userData.sculptComponent = {"id": "film-base", "name": "film-base", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "film-base-mount", "localStart": [0, -1.02, 0.05], "localEnd": [0, -1.02, 0.07], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.8419999999999996, "height": 0.68, "depth": 2.45, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -1.02, 0.05], "rotation": [0, 0, 0], "scale": [3.8419999999999996, 0.68, 2.45]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "film-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_film_base_2.add(mesh_film_base_2);
  meshes["film-base"] = mesh_film_base_2;
  colliders["film-base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["film-base"] ??= [];
  destructionGroups["film-base"].push(node_film_base_2);

  const endpoint_cream_shell_3 = makeAttachmentEndpoint(null);
  const node_cream_shell_3 = new THREE.Group();
  node_cream_shell_3.name = "cream-shell__pivot";
  node_cream_shell_3.scale.set(1, 1, 1);
  if (endpoint_cream_shell_3) {
    node_cream_shell_3.position.copy(endpoint_cream_shell_3.start);
    node_cream_shell_3.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_cream_shell_3.position.set(-1.8644999999999998, 0.0, 0.0);
    node_cream_shell_3.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_cream_shell_3.userData.sculptComponent = {"id": "cream-shell", "name": "cream-shell", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-1.27, -0.67], [-1.27, -0.42], [-0.64, -0.02], [-0.64, 1.28], [-0.43, 1.28], [-0.43, -0.16], [-1.05, -0.67]], "depth": 3.7289999999999996}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "cream-shell-mount", "localStart": [-1.65, 0, 0], "localEnd": [-1.65, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.8644999999999998, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cream-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "cream", "materialLayers": ["cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cream-shell-detail", "type": "bevel", "description": "Molded cream edge radius .045", "placement": "visible front region", "size": 0.04, "geometryEffect": "Molded cream edge radius .045", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 225, 204, 1)", "secondaryAlbedo": "rgba(232, 225, 204, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cream_shell_3.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cream-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_cream_shell_3);
  nodes["cream-shell"] = node_cream_shell_3;
  const mesh_cream_shell_3Geometry = endpoint_cream_shell_3
    ? new THREE.CylinderGeometry(endpoint_cream_shell_3.endRadius, endpoint_cream_shell_3.baseRadius, endpoint_cream_shell_3.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-1.27, -0.67], [-1.27, -0.42], [-0.64, -0.02], [-0.64, 1.28], [-0.43, 1.28], [-0.43, -0.16], [-1.05, -0.67]], "depth": 3.7289999999999996});
  if (!endpoint_cream_shell_3) {
    mesh_cream_shell_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cream_shell_3 = new THREE.Mesh(
    mesh_cream_shell_3Geometry,
    materialMap["cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cream_shell_3.name = "cream-shell";
  if (endpoint_cream_shell_3) {
    mesh_cream_shell_3.position.copy(endpoint_cream_shell_3.midpoint);
    mesh_cream_shell_3.quaternion.copy(endpoint_cream_shell_3.quaternion);
  }
  mesh_cream_shell_3.castShadow = options.castShadow ?? true;
  mesh_cream_shell_3.receiveShadow = options.receiveShadow ?? true;
  mesh_cream_shell_3.userData.sculptComponent = {"id": "cream-shell", "name": "cream-shell", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-1.27, -0.67], [-1.27, -0.42], [-0.64, -0.02], [-0.64, 1.28], [-0.43, 1.28], [-0.43, -0.16], [-1.05, -0.67]], "depth": 3.7289999999999996}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "cream-shell-mount", "localStart": [-1.65, 0, 0], "localEnd": [-1.65, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.8644999999999998, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cream-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "cream", "materialLayers": ["cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cream-shell-detail", "type": "bevel", "description": "Molded cream edge radius .045", "placement": "visible front region", "size": 0.04, "geometryEffect": "Molded cream edge radius .045", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 225, 204, 1)", "secondaryAlbedo": "rgba(232, 225, 204, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cream_shell_3.add(mesh_cream_shell_3);
  meshes["cream-shell"] = mesh_cream_shell_3;
  colliders["cream-shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["cream-shell"] ??= [];
  destructionGroups["cream-shell"].push(node_cream_shell_3);

  const attachment_lens_seat_4 = {"parentId": "root", "parentSocket": "lens-seat-mount", "localStart": [0, 0.47, 0.6399999999999999], "localEnd": [0, 0.47, 0.76], "baseRadius": 0.71, "endRadius": 0.71, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]};
  const endpoint_lens_seat_4 = makeAttachmentEndpoint(attachment_lens_seat_4);
  const node_lens_seat_4 = new THREE.Group();
  node_lens_seat_4.name = "lens-seat__pivot";
  node_lens_seat_4.scale.set(1, 1, 1);
  if (endpoint_lens_seat_4) {
    node_lens_seat_4.position.copy(endpoint_lens_seat_4.start);
    node_lens_seat_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_seat_4.position.set(0.0, 0.47, 0.7);
    node_lens_seat_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_seat_4.userData.sculptComponent = {"id": "lens-seat", "name": "lens-seat", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-seat-mount", "localStart": [0, 0.47, 0.6399999999999999], "localEnd": [0, 0.47, 0.76], "baseRadius": 0.71, "endRadius": 0.71, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.42, "height": 0.12, "depth": 1.42, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 0.7], "rotation": [0, 0, 0], "scale": [1.42, 0.12, 1.42]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_seat_4.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_seat_4);
  nodes["lens-seat"] = node_lens_seat_4;
  const mesh_lens_seat_4Geometry = endpoint_lens_seat_4
    ? new THREE.CylinderGeometry(endpoint_lens_seat_4.endRadius, endpoint_lens_seat_4.baseRadius, endpoint_lens_seat_4.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_lens_seat_4) {
    mesh_lens_seat_4Geometry.scale(1.42, 0.12, 1.42);
  }
  const mesh_lens_seat_4 = new THREE.Mesh(
    mesh_lens_seat_4Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_seat_4.name = "lens-seat";
  if (endpoint_lens_seat_4) {
    mesh_lens_seat_4.position.copy(endpoint_lens_seat_4.midpoint);
    mesh_lens_seat_4.quaternion.copy(endpoint_lens_seat_4.quaternion);
  }
  mesh_lens_seat_4.castShadow = options.castShadow ?? true;
  mesh_lens_seat_4.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_seat_4.userData.sculptComponent = {"id": "lens-seat", "name": "lens-seat", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-seat-mount", "localStart": [0, 0.47, 0.6399999999999999], "localEnd": [0, 0.47, 0.76], "baseRadius": 0.71, "endRadius": 0.71, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.42, "height": 0.12, "depth": 1.42, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 0.7], "rotation": [0, 0, 0], "scale": [1.42, 0.12, 1.42]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_seat_4.add(mesh_lens_seat_4);
  meshes["lens-seat"] = mesh_lens_seat_4;
  colliders["lens-seat"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-seat"] ??= [];
  destructionGroups["lens-seat"].push(node_lens_seat_4);

  const endpoint_lens_barrel_5 = makeAttachmentEndpoint(null);
  const node_lens_barrel_5 = new THREE.Group();
  node_lens_barrel_5.name = "lens-barrel__pivot";
  node_lens_barrel_5.scale.set(1, 1, 1);
  if (endpoint_lens_barrel_5) {
    node_lens_barrel_5.position.copy(endpoint_lens_barrel_5.start);
    node_lens_barrel_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_lens_barrel_5.position.set(0.0, 0.47, 0.75);
    node_lens_barrel_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_lens_barrel_5.userData.sculptComponent = {"id": "lens-barrel", "name": "lens-barrel", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.64, 0], [0.68, 0.05], [0.66, 0.18], [0.59, 0.31], [0.45, 0.36], [0.29, 0.33], [0.26, 0.25], [0.26, 0.05], [0.64, 0]], "segments": 64}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-barrel-mount", "localStart": [0, 0.47, 0.75], "localEnd": [0, 0.47, 0.77], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 0.75], "rotation": [1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-barrel-detail", "type": "groove", "description": "Concentric recessed optical barrel", "placement": "visible front region", "size": 0.04, "geometryEffect": "Concentric recessed optical barrel", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_barrel_5.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_barrel_5);
  nodes["lens-barrel"] = node_lens_barrel_5;
  const mesh_lens_barrel_5Geometry = endpoint_lens_barrel_5
    ? new THREE.CylinderGeometry(endpoint_lens_barrel_5.endRadius, endpoint_lens_barrel_5.baseRadius, endpoint_lens_barrel_5.length, 16, 6)
    : buildLatheGeometry({"points": [[0.64, 0], [0.68, 0.05], [0.66, 0.18], [0.59, 0.31], [0.45, 0.36], [0.29, 0.33], [0.26, 0.25], [0.26, 0.05], [0.64, 0]], "segments": 64});
  if (!endpoint_lens_barrel_5) {
    mesh_lens_barrel_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lens_barrel_5 = new THREE.Mesh(
    mesh_lens_barrel_5Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_barrel_5.name = "lens-barrel";
  if (endpoint_lens_barrel_5) {
    mesh_lens_barrel_5.position.copy(endpoint_lens_barrel_5.midpoint);
    mesh_lens_barrel_5.quaternion.copy(endpoint_lens_barrel_5.quaternion);
  }
  mesh_lens_barrel_5.castShadow = options.castShadow ?? true;
  mesh_lens_barrel_5.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_barrel_5.userData.sculptComponent = {"id": "lens-barrel", "name": "lens-barrel", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.64, 0], [0.68, 0.05], [0.66, 0.18], [0.59, 0.31], [0.45, 0.36], [0.29, 0.33], [0.26, 0.25], [0.26, 0.05], [0.64, 0]], "segments": 64}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-barrel-mount", "localStart": [0, 0.47, 0.75], "localEnd": [0, 0.47, 0.77], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 0.75], "rotation": [1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-barrel-detail", "type": "groove", "description": "Concentric recessed optical barrel", "placement": "visible front region", "size": 0.04, "geometryEffect": "Concentric recessed optical barrel", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_barrel_5.add(mesh_lens_barrel_5);
  meshes["lens-barrel"] = mesh_lens_barrel_5;
  colliders["lens-barrel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-barrel"] ??= [];
  destructionGroups["lens-barrel"].push(node_lens_barrel_5);

  const endpoint_lens_glass_6 = makeAttachmentEndpoint(null);
  const node_lens_glass_6 = new THREE.Group();
  node_lens_glass_6.name = "lens-glass__pivot";
  node_lens_glass_6.scale.set(1, 1, 1);
  if (endpoint_lens_glass_6) {
    node_lens_glass_6.position.copy(endpoint_lens_glass_6.start);
    node_lens_glass_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_glass_6.position.set(0.0, 0.47, 1.08);
    node_lens_glass_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_glass_6.userData.sculptComponent = {"id": "lens-glass", "name": "lens-glass", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-glass-mount", "localStart": [0, 0.47, 1.08], "localEnd": [0, 0.47, 1.1], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.55, "height": 0.55, "depth": 0.14, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.08], "rotation": [0, 0, 0], "scale": [0.55, 0.55, 0.14]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-glass-detail", "type": "gloss", "description": "Blue-purple optical reflection", "placement": "visible front region", "size": 0.04, "geometryEffect": "Blue-purple optical reflection", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 50, 1)", "secondaryAlbedo": "rgba(23, 26, 50, 1)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_glass_6.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_glass_6);
  nodes["lens-glass"] = node_lens_glass_6;
  const mesh_lens_glass_6Geometry = endpoint_lens_glass_6
    ? new THREE.CylinderGeometry(endpoint_lens_glass_6.endRadius, endpoint_lens_glass_6.baseRadius, endpoint_lens_glass_6.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_lens_glass_6) {
    mesh_lens_glass_6Geometry.scale(0.55, 0.55, 0.14);
  }
  const mesh_lens_glass_6 = new THREE.Mesh(
    mesh_lens_glass_6Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_glass_6.name = "lens-glass";
  if (endpoint_lens_glass_6) {
    mesh_lens_glass_6.position.copy(endpoint_lens_glass_6.midpoint);
    mesh_lens_glass_6.quaternion.copy(endpoint_lens_glass_6.quaternion);
  }
  mesh_lens_glass_6.castShadow = options.castShadow ?? true;
  mesh_lens_glass_6.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_glass_6.userData.sculptComponent = {"id": "lens-glass", "name": "lens-glass", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-glass-mount", "localStart": [0, 0.47, 1.08], "localEnd": [0, 0.47, 1.1], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.55, "height": 0.55, "depth": 0.14, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.08], "rotation": [0, 0, 0], "scale": [0.55, 0.55, 0.14]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-glass-detail", "type": "gloss", "description": "Blue-purple optical reflection", "placement": "visible front region", "size": 0.04, "geometryEffect": "Blue-purple optical reflection", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 50, 1)", "secondaryAlbedo": "rgba(23, 26, 50, 1)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_glass_6.add(mesh_lens_glass_6);
  meshes["lens-glass"] = mesh_lens_glass_6;
  colliders["lens-glass"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-glass"] ??= [];
  destructionGroups["lens-glass"].push(node_lens_glass_6);

  const endpoint_flash_frame_7 = makeAttachmentEndpoint(null);
  const node_flash_frame_7 = new THREE.Group();
  node_flash_frame_7.name = "flash-frame__pivot";
  node_flash_frame_7.scale.set(1, 1, 1);
  if (endpoint_flash_frame_7) {
    node_flash_frame_7.position.copy(endpoint_flash_frame_7.start);
    node_flash_frame_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_frame_7.position.set(-1.1639, 0.82, 0.7);
    node_flash_frame_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_frame_7.userData.sculptComponent = {"id": "flash-frame", "name": "flash-frame", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-frame-mount", "localStart": [-1.1639, 0.82, 0.7], "localEnd": [-1.1639, 0.82, 0.72], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.85, "height": 0.64, "depth": 0.13, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.82, 0.7], "rotation": [0, 0, 0], "scale": [0.85, 0.64, 0.13]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_frame_7.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_frame_7);
  nodes["flash-frame"] = node_flash_frame_7;
  const mesh_flash_frame_7Geometry = endpoint_flash_frame_7
    ? new THREE.CylinderGeometry(endpoint_flash_frame_7.endRadius, endpoint_flash_frame_7.baseRadius, endpoint_flash_frame_7.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_frame_7) {
    mesh_flash_frame_7Geometry.scale(0.85, 0.64, 0.13);
  }
  const mesh_flash_frame_7 = new THREE.Mesh(
    mesh_flash_frame_7Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_frame_7.name = "flash-frame";
  if (endpoint_flash_frame_7) {
    mesh_flash_frame_7.position.copy(endpoint_flash_frame_7.midpoint);
    mesh_flash_frame_7.quaternion.copy(endpoint_flash_frame_7.quaternion);
  }
  mesh_flash_frame_7.castShadow = options.castShadow ?? true;
  mesh_flash_frame_7.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_frame_7.userData.sculptComponent = {"id": "flash-frame", "name": "flash-frame", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-frame-mount", "localStart": [-1.1639, 0.82, 0.7], "localEnd": [-1.1639, 0.82, 0.72], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.85, "height": 0.64, "depth": 0.13, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.82, 0.7], "rotation": [0, 0, 0], "scale": [0.85, 0.64, 0.13]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_frame_7.add(mesh_flash_frame_7);
  meshes["flash-frame"] = mesh_flash_frame_7;
  colliders["flash-frame"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-frame"] ??= [];
  destructionGroups["flash-frame"].push(node_flash_frame_7);

  const endpoint_flash_panel_8 = makeAttachmentEndpoint(null);
  const node_flash_panel_8 = new THREE.Group();
  node_flash_panel_8.name = "flash-panel__pivot";
  node_flash_panel_8.scale.set(1, 1, 1);
  if (endpoint_flash_panel_8) {
    node_flash_panel_8.position.copy(endpoint_flash_panel_8.start);
    node_flash_panel_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_panel_8.position.set(-1.1639, 0.82, 0.79);
    node_flash_panel_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_panel_8.userData.sculptComponent = {"id": "flash-panel", "name": "flash-panel", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-panel-mount", "localStart": [-1.1639, 0.82, 0.79], "localEnd": [-1.1639, 0.82, 0.81], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.73, "height": 0.51, "depth": 0.1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.82, 0.79], "rotation": [0, 0, 0], "scale": [0.73, 0.51, 0.1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "flash-panel-detail", "type": "ridge", "description": "Horizontal and vertical refractor ribs", "placement": "visible front region", "size": 0.04, "geometryEffect": "Horizontal and vertical refractor ribs", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_panel_8.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_panel_8);
  nodes["flash-panel"] = node_flash_panel_8;
  const mesh_flash_panel_8Geometry = endpoint_flash_panel_8
    ? new THREE.CylinderGeometry(endpoint_flash_panel_8.endRadius, endpoint_flash_panel_8.baseRadius, endpoint_flash_panel_8.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_panel_8) {
    mesh_flash_panel_8Geometry.scale(0.73, 0.51, 0.1);
  }
  const mesh_flash_panel_8 = new THREE.Mesh(
    mesh_flash_panel_8Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_panel_8.name = "flash-panel";
  if (endpoint_flash_panel_8) {
    mesh_flash_panel_8.position.copy(endpoint_flash_panel_8.midpoint);
    mesh_flash_panel_8.quaternion.copy(endpoint_flash_panel_8.quaternion);
  }
  mesh_flash_panel_8.castShadow = options.castShadow ?? true;
  mesh_flash_panel_8.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_panel_8.userData.sculptComponent = {"id": "flash-panel", "name": "flash-panel", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-panel-mount", "localStart": [-1.1639, 0.82, 0.79], "localEnd": [-1.1639, 0.82, 0.81], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.73, "height": 0.51, "depth": 0.1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.82, 0.79], "rotation": [0, 0, 0], "scale": [0.73, 0.51, 0.1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "flash-panel-detail", "type": "ridge", "description": "Horizontal and vertical refractor ribs", "placement": "visible front region", "size": 0.04, "geometryEffect": "Horizontal and vertical refractor ribs", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_panel_8.add(mesh_flash_panel_8);
  meshes["flash-panel"] = mesh_flash_panel_8;
  colliders["flash-panel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-panel"] ??= [];
  destructionGroups["flash-panel"].push(node_flash_panel_8);

  const endpoint_finder_frame_9 = makeAttachmentEndpoint(null);
  const node_finder_frame_9 = new THREE.Group();
  node_finder_frame_9.name = "finder-frame__pivot";
  node_finder_frame_9.scale.set(1, 1, 1);
  if (endpoint_finder_frame_9) {
    node_finder_frame_9.position.copy(endpoint_finder_frame_9.start);
    node_finder_frame_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_finder_frame_9.position.set(1.2204, 0.8, 0.7);
    node_finder_frame_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_finder_frame_9.userData.sculptComponent = {"id": "finder-frame", "name": "finder-frame", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "finder-frame-mount", "localStart": [1.2204, 0.8, 0.7], "localEnd": [1.2204, 0.8, 0.72], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.67, "height": 0.66, "depth": 0.13, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.2204, 0.8, 0.7], "rotation": [0, 0, 0], "scale": [0.67, 0.66, 0.13]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finder-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "finder-frame-detail", "type": "groove", "description": "Square inset optical finder", "placement": "visible front region", "size": 0.04, "geometryEffect": "Square inset optical finder", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_finder_frame_9.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finder-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_finder_frame_9);
  nodes["finder-frame"] = node_finder_frame_9;
  const mesh_finder_frame_9Geometry = endpoint_finder_frame_9
    ? new THREE.CylinderGeometry(endpoint_finder_frame_9.endRadius, endpoint_finder_frame_9.baseRadius, endpoint_finder_frame_9.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_finder_frame_9) {
    mesh_finder_frame_9Geometry.scale(0.67, 0.66, 0.13);
  }
  const mesh_finder_frame_9 = new THREE.Mesh(
    mesh_finder_frame_9Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_finder_frame_9.name = "finder-frame";
  if (endpoint_finder_frame_9) {
    mesh_finder_frame_9.position.copy(endpoint_finder_frame_9.midpoint);
    mesh_finder_frame_9.quaternion.copy(endpoint_finder_frame_9.quaternion);
  }
  mesh_finder_frame_9.castShadow = options.castShadow ?? true;
  mesh_finder_frame_9.receiveShadow = options.receiveShadow ?? true;
  mesh_finder_frame_9.userData.sculptComponent = {"id": "finder-frame", "name": "finder-frame", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "finder-frame-mount", "localStart": [1.2204, 0.8, 0.7], "localEnd": [1.2204, 0.8, 0.72], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.67, "height": 0.66, "depth": 0.13, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.2204, 0.8, 0.7], "rotation": [0, 0, 0], "scale": [0.67, 0.66, 0.13]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finder-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "finder-frame-detail", "type": "groove", "description": "Square inset optical finder", "placement": "visible front region", "size": 0.04, "geometryEffect": "Square inset optical finder", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_finder_frame_9.add(mesh_finder_frame_9);
  meshes["finder-frame"] = mesh_finder_frame_9;
  colliders["finder-frame"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["finder-frame"] ??= [];
  destructionGroups["finder-frame"].push(node_finder_frame_9);

  const endpoint_finder_glass_10 = makeAttachmentEndpoint(null);
  const node_finder_glass_10 = new THREE.Group();
  node_finder_glass_10.name = "finder-glass__pivot";
  node_finder_glass_10.scale.set(1, 1, 1);
  if (endpoint_finder_glass_10) {
    node_finder_glass_10.position.copy(endpoint_finder_glass_10.start);
    node_finder_glass_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_finder_glass_10.position.set(1.2204, 0.8, 0.78);
    node_finder_glass_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_finder_glass_10.userData.sculptComponent = {"id": "finder-glass", "name": "finder-glass", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "finder-glass-mount", "localStart": [1.2204, 0.8, 0.78], "localEnd": [1.2204, 0.8, 0.8], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.46, "depth": 0.09, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.2204, 0.8, 0.78], "rotation": [0, 0, 0], "scale": [0.48, 0.46, 0.09]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finder-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 50, 1)", "secondaryAlbedo": "rgba(23, 26, 50, 1)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_finder_glass_10.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finder-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_finder_glass_10);
  nodes["finder-glass"] = node_finder_glass_10;
  const mesh_finder_glass_10Geometry = endpoint_finder_glass_10
    ? new THREE.CylinderGeometry(endpoint_finder_glass_10.endRadius, endpoint_finder_glass_10.baseRadius, endpoint_finder_glass_10.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_finder_glass_10) {
    mesh_finder_glass_10Geometry.scale(0.48, 0.46, 0.09);
  }
  const mesh_finder_glass_10 = new THREE.Mesh(
    mesh_finder_glass_10Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_finder_glass_10.name = "finder-glass";
  if (endpoint_finder_glass_10) {
    mesh_finder_glass_10.position.copy(endpoint_finder_glass_10.midpoint);
    mesh_finder_glass_10.quaternion.copy(endpoint_finder_glass_10.quaternion);
  }
  mesh_finder_glass_10.castShadow = options.castShadow ?? true;
  mesh_finder_glass_10.receiveShadow = options.receiveShadow ?? true;
  mesh_finder_glass_10.userData.sculptComponent = {"id": "finder-glass", "name": "finder-glass", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "finder-glass-mount", "localStart": [1.2204, 0.8, 0.78], "localEnd": [1.2204, 0.8, 0.8], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.46, "depth": 0.09, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.2204, 0.8, 0.78], "rotation": [0, 0, 0], "scale": [0.48, 0.46, 0.09]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finder-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 50, 1)", "secondaryAlbedo": "rgba(23, 26, 50, 1)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_finder_glass_10.add(mesh_finder_glass_10);
  meshes["finder-glass"] = mesh_finder_glass_10;
  colliders["finder-glass"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["finder-glass"] ??= [];
  destructionGroups["finder-glass"].push(node_finder_glass_10);

  const endpoint_sensor_11 = makeAttachmentEndpoint(null);
  const node_sensor_11 = new THREE.Group();
  node_sensor_11.name = "sensor__pivot";
  node_sensor_11.scale.set(1, 1, 1);
  if (endpoint_sensor_11) {
    node_sensor_11.position.copy(endpoint_sensor_11.start);
    node_sensor_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sensor_11.position.set(1.2204, 0.18, 0.68);
    node_sensor_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_sensor_11.userData.sculptComponent = {"id": "sensor", "name": "sensor", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "sensor-mount", "localStart": [1.2204, 0.18, 0.68], "localEnd": [1.2204, 0.18, 0.7000000000000001], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.45, "height": 0.27, "depth": 0.05, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.2204, 0.18, 0.68], "rotation": [0, 0, 0], "scale": [0.45, 0.27, 0.05]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sensor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_sensor_11.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sensor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_sensor_11);
  nodes["sensor"] = node_sensor_11;
  const mesh_sensor_11Geometry = endpoint_sensor_11
    ? new THREE.CylinderGeometry(endpoint_sensor_11.endRadius, endpoint_sensor_11.baseRadius, endpoint_sensor_11.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_sensor_11) {
    mesh_sensor_11Geometry.scale(0.45, 0.27, 0.05);
  }
  const mesh_sensor_11 = new THREE.Mesh(
    mesh_sensor_11Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sensor_11.name = "sensor";
  if (endpoint_sensor_11) {
    mesh_sensor_11.position.copy(endpoint_sensor_11.midpoint);
    mesh_sensor_11.quaternion.copy(endpoint_sensor_11.quaternion);
  }
  mesh_sensor_11.castShadow = options.castShadow ?? true;
  mesh_sensor_11.receiveShadow = options.receiveShadow ?? true;
  mesh_sensor_11.userData.sculptComponent = {"id": "sensor", "name": "sensor", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "sensor-mount", "localStart": [1.2204, 0.18, 0.68], "localEnd": [1.2204, 0.18, 0.7000000000000001], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.45, "height": 0.27, "depth": 0.05, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.2204, 0.18, 0.68], "rotation": [0, 0, 0], "scale": [0.45, 0.27, 0.05]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sensor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_sensor_11.add(mesh_sensor_11);
  meshes["sensor"] = mesh_sensor_11;
  colliders["sensor"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["sensor"] ??= [];
  destructionGroups["sensor"].push(node_sensor_11);

  const attachment_shutter_trim_12 = {"parentId": "root", "parentSocket": "shutter-trim-mount", "localStart": [-1.1639, 0.05, 0.6699999999999999], "localEnd": [-1.1639, 0.05, 0.77], "baseRadius": 0.24, "endRadius": 0.24, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]};
  const endpoint_shutter_trim_12 = makeAttachmentEndpoint(attachment_shutter_trim_12);
  const node_shutter_trim_12 = new THREE.Group();
  node_shutter_trim_12.name = "shutter-trim__pivot";
  node_shutter_trim_12.scale.set(1, 1, 1);
  if (endpoint_shutter_trim_12) {
    node_shutter_trim_12.position.copy(endpoint_shutter_trim_12.start);
    node_shutter_trim_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shutter_trim_12.position.set(-1.1639, 0.05, 0.72);
    node_shutter_trim_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_shutter_trim_12.userData.sculptComponent = {"id": "shutter-trim", "name": "shutter-trim", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shutter-trim-mount", "localStart": [-1.1639, 0.05, 0.6699999999999999], "localEnd": [-1.1639, 0.05, 0.77], "baseRadius": 0.24, "endRadius": 0.24, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.1, "depth": 0.48, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.05, 0.72], "rotation": [0, 0, 0], "scale": [0.48, 0.1, 0.48]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shutter-trim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shutter-trim-detail", "type": "bevel", "description": "Metal shutter rim", "placement": "visible front region", "size": 0.04, "geometryEffect": "Metal shutter rim", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 176, 165, 1)", "secondaryAlbedo": "rgba(179, 176, 165, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_shutter_trim_12.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shutter-trim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_shutter_trim_12);
  nodes["shutter-trim"] = node_shutter_trim_12;
  const mesh_shutter_trim_12Geometry = endpoint_shutter_trim_12
    ? new THREE.CylinderGeometry(endpoint_shutter_trim_12.endRadius, endpoint_shutter_trim_12.baseRadius, endpoint_shutter_trim_12.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_shutter_trim_12) {
    mesh_shutter_trim_12Geometry.scale(0.48, 0.1, 0.48);
  }
  const mesh_shutter_trim_12 = new THREE.Mesh(
    mesh_shutter_trim_12Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shutter_trim_12.name = "shutter-trim";
  if (endpoint_shutter_trim_12) {
    mesh_shutter_trim_12.position.copy(endpoint_shutter_trim_12.midpoint);
    mesh_shutter_trim_12.quaternion.copy(endpoint_shutter_trim_12.quaternion);
  }
  mesh_shutter_trim_12.castShadow = options.castShadow ?? true;
  mesh_shutter_trim_12.receiveShadow = options.receiveShadow ?? true;
  mesh_shutter_trim_12.userData.sculptComponent = {"id": "shutter-trim", "name": "shutter-trim", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shutter-trim-mount", "localStart": [-1.1639, 0.05, 0.6699999999999999], "localEnd": [-1.1639, 0.05, 0.77], "baseRadius": 0.24, "endRadius": 0.24, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.1, "depth": 0.48, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.05, 0.72], "rotation": [0, 0, 0], "scale": [0.48, 0.1, 0.48]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shutter-trim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shutter-trim-detail", "type": "bevel", "description": "Metal shutter rim", "placement": "visible front region", "size": 0.04, "geometryEffect": "Metal shutter rim", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 176, 165, 1)", "secondaryAlbedo": "rgba(179, 176, 165, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_shutter_trim_12.add(mesh_shutter_trim_12);
  meshes["shutter-trim"] = mesh_shutter_trim_12;
  colliders["shutter-trim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["shutter-trim"] ??= [];
  destructionGroups["shutter-trim"].push(node_shutter_trim_12);

  const attachment_shutter_button_13 = {"parentId": "root", "parentSocket": "shutter-button-mount", "localStart": [-1.1639, 0.05, 0.75], "localEnd": [-1.1639, 0.05, 0.8500000000000001], "baseRadius": 0.195, "endRadius": 0.195, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]};
  const endpoint_shutter_button_13 = makeAttachmentEndpoint(attachment_shutter_button_13);
  const node_shutter_button_13 = new THREE.Group();
  node_shutter_button_13.name = "shutter-button__pivot";
  node_shutter_button_13.scale.set(1, 1, 1);
  if (endpoint_shutter_button_13) {
    node_shutter_button_13.position.copy(endpoint_shutter_button_13.start);
    node_shutter_button_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shutter_button_13.position.set(-1.1639, 0.05, 0.8);
    node_shutter_button_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_shutter_button_13.userData.sculptComponent = {"id": "shutter-button", "name": "shutter-button", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shutter-button-mount", "localStart": [-1.1639, 0.05, 0.75], "localEnd": [-1.1639, 0.05, 0.8500000000000001], "baseRadius": 0.195, "endRadius": 0.195, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.39, "height": 0.1, "depth": 0.39, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.05, 0.8], "rotation": [0, 0, 0], "scale": [0.39, 0.1, 0.39]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shutter-button", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "red", "materialLayers": ["red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 59, 49, 1)", "secondaryAlbedo": "rgba(212, 59, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_shutter_button_13.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shutter-button", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_shutter_button_13);
  nodes["shutter-button"] = node_shutter_button_13;
  const mesh_shutter_button_13Geometry = endpoint_shutter_button_13
    ? new THREE.CylinderGeometry(endpoint_shutter_button_13.endRadius, endpoint_shutter_button_13.baseRadius, endpoint_shutter_button_13.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_shutter_button_13) {
    mesh_shutter_button_13Geometry.scale(0.39, 0.1, 0.39);
  }
  const mesh_shutter_button_13 = new THREE.Mesh(
    mesh_shutter_button_13Geometry,
    materialMap["red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shutter_button_13.name = "shutter-button";
  if (endpoint_shutter_button_13) {
    mesh_shutter_button_13.position.copy(endpoint_shutter_button_13.midpoint);
    mesh_shutter_button_13.quaternion.copy(endpoint_shutter_button_13.quaternion);
  }
  mesh_shutter_button_13.castShadow = options.castShadow ?? true;
  mesh_shutter_button_13.receiveShadow = options.receiveShadow ?? true;
  mesh_shutter_button_13.userData.sculptComponent = {"id": "shutter-button", "name": "shutter-button", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shutter-button-mount", "localStart": [-1.1639, 0.05, 0.75], "localEnd": [-1.1639, 0.05, 0.8500000000000001], "baseRadius": 0.195, "endRadius": 0.195, "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.39, "height": 0.1, "depth": 0.39, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.05, 0.8], "rotation": [0, 0, 0], "scale": [0.39, 0.1, 0.39]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shutter-button", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "red", "materialLayers": ["red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 59, 49, 1)", "secondaryAlbedo": "rgba(212, 59, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_shutter_button_13.add(mesh_shutter_button_13);
  meshes["shutter-button"] = mesh_shutter_button_13;
  colliders["shutter-button"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["shutter-button"] ??= [];
  destructionGroups["shutter-button"].push(node_shutter_button_13);

  const endpoint_film_slot_14 = makeAttachmentEndpoint(null);
  const node_film_slot_14 = new THREE.Group();
  node_film_slot_14.name = "film-slot__pivot";
  node_film_slot_14.scale.set(1, 1, 1);
  if (endpoint_film_slot_14) {
    node_film_slot_14.position.copy(endpoint_film_slot_14.start);
    node_film_slot_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_film_slot_14.position.set(0.0, -1.04, 1.29);
    node_film_slot_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_film_slot_14.userData.sculptComponent = {"id": "film-slot", "name": "film-slot", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "film-slot-mount", "localStart": [0, -1.04, 1.29], "localEnd": [0, -1.04, 1.31], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.1187999999999994, "height": 0.18, "depth": 0.04, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -1.04, 1.29], "rotation": [0, 0, 0], "scale": [3.1187999999999994, 0.18, 0.04]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "film-slot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "film-slot-detail", "type": "hole", "description": "Horizontal ejection recess", "placement": "visible front region", "size": 0.04, "geometryEffect": "Horizontal ejection recess", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_film_slot_14.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "film-slot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_film_slot_14);
  nodes["film-slot"] = node_film_slot_14;
  const mesh_film_slot_14Geometry = endpoint_film_slot_14
    ? new THREE.CylinderGeometry(endpoint_film_slot_14.endRadius, endpoint_film_slot_14.baseRadius, endpoint_film_slot_14.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_film_slot_14) {
    mesh_film_slot_14Geometry.scale(3.1187999999999994, 0.18, 0.04);
  }
  const mesh_film_slot_14 = new THREE.Mesh(
    mesh_film_slot_14Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_film_slot_14.name = "film-slot";
  if (endpoint_film_slot_14) {
    mesh_film_slot_14.position.copy(endpoint_film_slot_14.midpoint);
    mesh_film_slot_14.quaternion.copy(endpoint_film_slot_14.quaternion);
  }
  mesh_film_slot_14.castShadow = options.castShadow ?? true;
  mesh_film_slot_14.receiveShadow = options.receiveShadow ?? true;
  mesh_film_slot_14.userData.sculptComponent = {"id": "film-slot", "name": "film-slot", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "film-slot-mount", "localStart": [0, -1.04, 1.29], "localEnd": [0, -1.04, 1.31], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.1187999999999994, "height": 0.18, "depth": 0.04, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -1.04, 1.29], "rotation": [0, 0, 0], "scale": [3.1187999999999994, 0.18, 0.04]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "film-slot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "film-slot-detail", "type": "hole", "description": "Horizontal ejection recess", "placement": "visible front region", "size": 0.04, "geometryEffect": "Horizontal ejection recess", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_film_slot_14.add(mesh_film_slot_14);
  meshes["film-slot"] = mesh_film_slot_14;
  colliders["film-slot"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["film-slot"] ??= [];
  destructionGroups["film-slot"].push(node_film_slot_14);

  const endpoint_slot_top_lip_15 = makeAttachmentEndpoint(null);
  const node_slot_top_lip_15 = new THREE.Group();
  node_slot_top_lip_15.name = "slot-top-lip__pivot";
  node_slot_top_lip_15.scale.set(1, 1, 1);
  if (endpoint_slot_top_lip_15) {
    node_slot_top_lip_15.position.copy(endpoint_slot_top_lip_15.start);
    node_slot_top_lip_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_slot_top_lip_15.position.set(0.0, -0.925, 1.31);
    node_slot_top_lip_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_slot_top_lip_15.userData.sculptComponent = {"id": "slot-top-lip", "name": "slot-top-lip", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "slot-top-lip-mount", "localStart": [0, -0.925, 1.31], "localEnd": [0, -0.925, 1.33], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.1413999999999995, "height": 0.065, "depth": 0.09, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -0.925, 1.31], "rotation": [0, 0, 0], "scale": [3.1413999999999995, 0.065, 0.09]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "slot-top-lip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_slot_top_lip_15.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "slot-top-lip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_slot_top_lip_15);
  nodes["slot-top-lip"] = node_slot_top_lip_15;
  const mesh_slot_top_lip_15Geometry = endpoint_slot_top_lip_15
    ? new THREE.CylinderGeometry(endpoint_slot_top_lip_15.endRadius, endpoint_slot_top_lip_15.baseRadius, endpoint_slot_top_lip_15.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_slot_top_lip_15) {
    mesh_slot_top_lip_15Geometry.scale(3.1413999999999995, 0.065, 0.09);
  }
  const mesh_slot_top_lip_15 = new THREE.Mesh(
    mesh_slot_top_lip_15Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_slot_top_lip_15.name = "slot-top-lip";
  if (endpoint_slot_top_lip_15) {
    mesh_slot_top_lip_15.position.copy(endpoint_slot_top_lip_15.midpoint);
    mesh_slot_top_lip_15.quaternion.copy(endpoint_slot_top_lip_15.quaternion);
  }
  mesh_slot_top_lip_15.castShadow = options.castShadow ?? true;
  mesh_slot_top_lip_15.receiveShadow = options.receiveShadow ?? true;
  mesh_slot_top_lip_15.userData.sculptComponent = {"id": "slot-top-lip", "name": "slot-top-lip", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "slot-top-lip-mount", "localStart": [0, -0.925, 1.31], "localEnd": [0, -0.925, 1.33], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.1413999999999995, "height": 0.065, "depth": 0.09, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -0.925, 1.31], "rotation": [0, 0, 0], "scale": [3.1413999999999995, 0.065, 0.09]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "slot-top-lip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_slot_top_lip_15.add(mesh_slot_top_lip_15);
  meshes["slot-top-lip"] = mesh_slot_top_lip_15;
  colliders["slot-top-lip"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["slot-top-lip"] ??= [];
  destructionGroups["slot-top-lip"].push(node_slot_top_lip_15);

  const endpoint_slot_bottom_lip_16 = makeAttachmentEndpoint(null);
  const node_slot_bottom_lip_16 = new THREE.Group();
  node_slot_bottom_lip_16.name = "slot-bottom-lip__pivot";
  node_slot_bottom_lip_16.scale.set(1, 1, 1);
  if (endpoint_slot_bottom_lip_16) {
    node_slot_bottom_lip_16.position.copy(endpoint_slot_bottom_lip_16.start);
    node_slot_bottom_lip_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_slot_bottom_lip_16.position.set(0.0, -1.155, 1.31);
    node_slot_bottom_lip_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_slot_bottom_lip_16.userData.sculptComponent = {"id": "slot-bottom-lip", "name": "slot-bottom-lip", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "slot-bottom-lip-mount", "localStart": [0, -1.155, 1.31], "localEnd": [0, -1.155, 1.33], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.1413999999999995, "height": 0.065, "depth": 0.09, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -1.155, 1.31], "rotation": [0, 0, 0], "scale": [3.1413999999999995, 0.065, 0.09]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "slot-bottom-lip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_slot_bottom_lip_16.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "slot-bottom-lip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_slot_bottom_lip_16);
  nodes["slot-bottom-lip"] = node_slot_bottom_lip_16;
  const mesh_slot_bottom_lip_16Geometry = endpoint_slot_bottom_lip_16
    ? new THREE.CylinderGeometry(endpoint_slot_bottom_lip_16.endRadius, endpoint_slot_bottom_lip_16.baseRadius, endpoint_slot_bottom_lip_16.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_slot_bottom_lip_16) {
    mesh_slot_bottom_lip_16Geometry.scale(3.1413999999999995, 0.065, 0.09);
  }
  const mesh_slot_bottom_lip_16 = new THREE.Mesh(
    mesh_slot_bottom_lip_16Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_slot_bottom_lip_16.name = "slot-bottom-lip";
  if (endpoint_slot_bottom_lip_16) {
    mesh_slot_bottom_lip_16.position.copy(endpoint_slot_bottom_lip_16.midpoint);
    mesh_slot_bottom_lip_16.quaternion.copy(endpoint_slot_bottom_lip_16.quaternion);
  }
  mesh_slot_bottom_lip_16.castShadow = options.castShadow ?? true;
  mesh_slot_bottom_lip_16.receiveShadow = options.receiveShadow ?? true;
  mesh_slot_bottom_lip_16.userData.sculptComponent = {"id": "slot-bottom-lip", "name": "slot-bottom-lip", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "slot-bottom-lip-mount", "localStart": [0, -1.155, 1.31], "localEnd": [0, -1.155, 1.33], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.1413999999999995, "height": 0.065, "depth": 0.09, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -1.155, 1.31], "rotation": [0, 0, 0], "scale": [3.1413999999999995, 0.065, 0.09]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "slot-bottom-lip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_slot_bottom_lip_16.add(mesh_slot_bottom_lip_16);
  meshes["slot-bottom-lip"] = mesh_slot_bottom_lip_16;
  colliders["slot-bottom-lip"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["slot-bottom-lip"] ??= [];
  destructionGroups["slot-bottom-lip"].push(node_slot_bottom_lip_16);

  const endpoint_rear_door_17 = makeAttachmentEndpoint(null);
  const node_rear_door_17 = new THREE.Group();
  node_rear_door_17.name = "rear-door__pivot";
  node_rear_door_17.scale.set(1, 1, 1);
  if (endpoint_rear_door_17) {
    node_rear_door_17.position.copy(endpoint_rear_door_17.start);
    node_rear_door_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_door_17.position.set(0.0, 0.03, -1.09);
    node_rear_door_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_door_17.userData.sculptComponent = {"id": "rear-door", "name": "rear-door", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "rear-door-mount", "localStart": [0, 0.03, -1.09], "localEnd": [0, 0.03, -1.07], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.3447999999999998, "height": 1.36, "depth": 0.07, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.03, -1.09], "rotation": [0, 0, 0], "scale": [3.3447999999999998, 1.36, 0.07]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-door", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rear_door_17.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-door", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_rear_door_17);
  nodes["rear-door"] = node_rear_door_17;
  const mesh_rear_door_17Geometry = endpoint_rear_door_17
    ? new THREE.CylinderGeometry(endpoint_rear_door_17.endRadius, endpoint_rear_door_17.baseRadius, endpoint_rear_door_17.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rear_door_17) {
    mesh_rear_door_17Geometry.scale(3.3447999999999998, 1.36, 0.07);
  }
  const mesh_rear_door_17 = new THREE.Mesh(
    mesh_rear_door_17Geometry,
    materialMap["charcoal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_door_17.name = "rear-door";
  if (endpoint_rear_door_17) {
    mesh_rear_door_17.position.copy(endpoint_rear_door_17.midpoint);
    mesh_rear_door_17.quaternion.copy(endpoint_rear_door_17.quaternion);
  }
  mesh_rear_door_17.castShadow = options.castShadow ?? true;
  mesh_rear_door_17.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_door_17.userData.sculptComponent = {"id": "rear-door", "name": "rear-door", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "rear-door-mount", "localStart": [0, 0.03, -1.09], "localEnd": [0, 0.03, -1.07], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.3447999999999998, "height": 1.36, "depth": 0.07, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.03, -1.09], "rotation": [0, 0, 0], "scale": [3.3447999999999998, 1.36, 0.07]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-door", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "charcoal", "materialLayers": ["charcoal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 43, 45, 1)", "secondaryAlbedo": "rgba(41, 43, 45, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rear_door_17.add(mesh_rear_door_17);
  meshes["rear-door"] = mesh_rear_door_17;
  colliders["rear-door"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-door"] ??= [];
  destructionGroups["rear-door"].push(node_rear_door_17);

  const endpoint_top_plate_18 = makeAttachmentEndpoint(null);
  const node_top_plate_18 = new THREE.Group();
  node_top_plate_18.name = "top-plate__pivot";
  node_top_plate_18.scale.set(1, 1, 1);
  if (endpoint_top_plate_18) {
    node_top_plate_18.position.copy(endpoint_top_plate_18.start);
    node_top_plate_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_top_plate_18.position.set(0.0, 1.35, -0.35);
    node_top_plate_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_top_plate_18.userData.sculptComponent = {"id": "top-plate", "name": "top-plate", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "top-plate-mount", "localStart": [0, 1.35, -0.35], "localEnd": [0, 1.35, -0.32999999999999996], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.57, "height": 0.1, "depth": 0.39, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 1.35, -0.35], "rotation": [0, 0, 0], "scale": [0.57, 0.1, 0.39]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-plate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_top_plate_18.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-plate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_top_plate_18);
  nodes["top-plate"] = node_top_plate_18;
  const mesh_top_plate_18Geometry = endpoint_top_plate_18
    ? new THREE.CylinderGeometry(endpoint_top_plate_18.endRadius, endpoint_top_plate_18.baseRadius, endpoint_top_plate_18.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_top_plate_18) {
    mesh_top_plate_18Geometry.scale(0.57, 0.1, 0.39);
  }
  const mesh_top_plate_18 = new THREE.Mesh(
    mesh_top_plate_18Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_top_plate_18.name = "top-plate";
  if (endpoint_top_plate_18) {
    mesh_top_plate_18.position.copy(endpoint_top_plate_18.midpoint);
    mesh_top_plate_18.quaternion.copy(endpoint_top_plate_18.quaternion);
  }
  mesh_top_plate_18.castShadow = options.castShadow ?? true;
  mesh_top_plate_18.receiveShadow = options.receiveShadow ?? true;
  mesh_top_plate_18.userData.sculptComponent = {"id": "top-plate", "name": "top-plate", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "top-plate-mount", "localStart": [0, 1.35, -0.35], "localEnd": [0, 1.35, -0.32999999999999996], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.57, "height": 0.1, "depth": 0.39, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 1.35, -0.35], "rotation": [0, 0, 0], "scale": [0.57, 0.1, 0.39]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-plate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_top_plate_18.add(mesh_top_plate_18);
  meshes["top-plate"] = mesh_top_plate_18;
  colliders["top-plate"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["top-plate"] ??= [];
  destructionGroups["top-plate"].push(node_top_plate_18);

  const endpoint_stripe_red_19 = makeAttachmentEndpoint(null);
  const node_stripe_red_19 = new THREE.Group();
  node_stripe_red_19.name = "stripe-red__pivot";
  node_stripe_red_19.scale.set(1, 1, 1);
  if (endpoint_stripe_red_19) {
    node_stripe_red_19.position.copy(endpoint_stripe_red_19.start);
    node_stripe_red_19.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_stripe_red_19.position.set(-0.25, 0.0, 0.0);
    node_stripe_red_19.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_stripe_red_19.userData.sculptComponent = {"id": "stripe-red", "name": "stripe-red", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-red-mount", "localStart": [-0.25, 0, 0], "localEnd": [-0.25, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.25, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-red", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "red", "materialLayers": ["red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stripe-red-detail", "type": "linework", "description": "Five colored bands crossing apron", "placement": "visible front region", "size": 0.04, "geometryEffect": "Five colored bands crossing apron", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 59, 49, 1)", "secondaryAlbedo": "rgba(212, 59, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_red_19.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-red", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_stripe_red_19);
  nodes["stripe-red"] = node_stripe_red_19;
  const mesh_stripe_red_19Geometry = endpoint_stripe_red_19
    ? new THREE.CylinderGeometry(endpoint_stripe_red_19.endRadius, endpoint_stripe_red_19.baseRadius, endpoint_stripe_red_19.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1});
  if (!endpoint_stripe_red_19) {
    mesh_stripe_red_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_stripe_red_19 = new THREE.Mesh(
    mesh_stripe_red_19Geometry,
    materialMap["red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stripe_red_19.name = "stripe-red";
  if (endpoint_stripe_red_19) {
    mesh_stripe_red_19.position.copy(endpoint_stripe_red_19.midpoint);
    mesh_stripe_red_19.quaternion.copy(endpoint_stripe_red_19.quaternion);
  }
  mesh_stripe_red_19.castShadow = options.castShadow ?? true;
  mesh_stripe_red_19.receiveShadow = options.receiveShadow ?? true;
  mesh_stripe_red_19.userData.sculptComponent = {"id": "stripe-red", "name": "stripe-red", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-red-mount", "localStart": [-0.25, 0, 0], "localEnd": [-0.25, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.25, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-red", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "red", "materialLayers": ["red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stripe-red-detail", "type": "linework", "description": "Five colored bands crossing apron", "placement": "visible front region", "size": 0.04, "geometryEffect": "Five colored bands crossing apron", "materialEffect": "per component material", "confidence": 0.9, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 59, 49, 1)", "secondaryAlbedo": "rgba(212, 59, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_red_19.add(mesh_stripe_red_19);
  meshes["stripe-red"] = mesh_stripe_red_19;
  colliders["stripe-red"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stripe-red"] ??= [];
  destructionGroups["stripe-red"].push(node_stripe_red_19);

  const endpoint_stripe_orange_20 = makeAttachmentEndpoint(null);
  const node_stripe_orange_20 = new THREE.Group();
  node_stripe_orange_20.name = "stripe-orange__pivot";
  node_stripe_orange_20.scale.set(1, 1, 1);
  if (endpoint_stripe_orange_20) {
    node_stripe_orange_20.position.copy(endpoint_stripe_orange_20.start);
    node_stripe_orange_20.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_stripe_orange_20.position.set(-0.15, 0.0, 0.0);
    node_stripe_orange_20.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_stripe_orange_20.userData.sculptComponent = {"id": "stripe-orange", "name": "stripe-orange", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-orange-mount", "localStart": [-0.15, 0, 0], "localEnd": [-0.15, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.15, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-orange", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "orange", "materialLayers": ["orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(236, 138, 35, 1)", "secondaryAlbedo": "rgba(236, 138, 35, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_orange_20.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-orange", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_stripe_orange_20);
  nodes["stripe-orange"] = node_stripe_orange_20;
  const mesh_stripe_orange_20Geometry = endpoint_stripe_orange_20
    ? new THREE.CylinderGeometry(endpoint_stripe_orange_20.endRadius, endpoint_stripe_orange_20.baseRadius, endpoint_stripe_orange_20.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1});
  if (!endpoint_stripe_orange_20) {
    mesh_stripe_orange_20Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_stripe_orange_20 = new THREE.Mesh(
    mesh_stripe_orange_20Geometry,
    materialMap["orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stripe_orange_20.name = "stripe-orange";
  if (endpoint_stripe_orange_20) {
    mesh_stripe_orange_20.position.copy(endpoint_stripe_orange_20.midpoint);
    mesh_stripe_orange_20.quaternion.copy(endpoint_stripe_orange_20.quaternion);
  }
  mesh_stripe_orange_20.castShadow = options.castShadow ?? true;
  mesh_stripe_orange_20.receiveShadow = options.receiveShadow ?? true;
  mesh_stripe_orange_20.userData.sculptComponent = {"id": "stripe-orange", "name": "stripe-orange", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-orange-mount", "localStart": [-0.15, 0, 0], "localEnd": [-0.15, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.15, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-orange", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "orange", "materialLayers": ["orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(236, 138, 35, 1)", "secondaryAlbedo": "rgba(236, 138, 35, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_orange_20.add(mesh_stripe_orange_20);
  meshes["stripe-orange"] = mesh_stripe_orange_20;
  colliders["stripe-orange"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stripe-orange"] ??= [];
  destructionGroups["stripe-orange"].push(node_stripe_orange_20);

  const endpoint_stripe_yellow_21 = makeAttachmentEndpoint(null);
  const node_stripe_yellow_21 = new THREE.Group();
  node_stripe_yellow_21.name = "stripe-yellow__pivot";
  node_stripe_yellow_21.scale.set(1, 1, 1);
  if (endpoint_stripe_yellow_21) {
    node_stripe_yellow_21.position.copy(endpoint_stripe_yellow_21.start);
    node_stripe_yellow_21.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_stripe_yellow_21.position.set(-0.04999999999999999, 0.0, 0.0);
    node_stripe_yellow_21.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_stripe_yellow_21.userData.sculptComponent = {"id": "stripe-yellow", "name": "stripe-yellow", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-yellow-mount", "localStart": [-0.04999999999999999, 0, 0], "localEnd": [-0.04999999999999999, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.04999999999999999, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-yellow", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 201, 60, 1)", "secondaryAlbedo": "rgba(243, 201, 60, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_yellow_21.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-yellow", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_stripe_yellow_21);
  nodes["stripe-yellow"] = node_stripe_yellow_21;
  const mesh_stripe_yellow_21Geometry = endpoint_stripe_yellow_21
    ? new THREE.CylinderGeometry(endpoint_stripe_yellow_21.endRadius, endpoint_stripe_yellow_21.baseRadius, endpoint_stripe_yellow_21.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1});
  if (!endpoint_stripe_yellow_21) {
    mesh_stripe_yellow_21Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_stripe_yellow_21 = new THREE.Mesh(
    mesh_stripe_yellow_21Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stripe_yellow_21.name = "stripe-yellow";
  if (endpoint_stripe_yellow_21) {
    mesh_stripe_yellow_21.position.copy(endpoint_stripe_yellow_21.midpoint);
    mesh_stripe_yellow_21.quaternion.copy(endpoint_stripe_yellow_21.quaternion);
  }
  mesh_stripe_yellow_21.castShadow = options.castShadow ?? true;
  mesh_stripe_yellow_21.receiveShadow = options.receiveShadow ?? true;
  mesh_stripe_yellow_21.userData.sculptComponent = {"id": "stripe-yellow", "name": "stripe-yellow", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-yellow-mount", "localStart": [-0.04999999999999999, 0, 0], "localEnd": [-0.04999999999999999, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.04999999999999999, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-yellow", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 201, 60, 1)", "secondaryAlbedo": "rgba(243, 201, 60, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_yellow_21.add(mesh_stripe_yellow_21);
  meshes["stripe-yellow"] = mesh_stripe_yellow_21;
  colliders["stripe-yellow"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stripe-yellow"] ??= [];
  destructionGroups["stripe-yellow"].push(node_stripe_yellow_21);

  const endpoint_stripe_green_22 = makeAttachmentEndpoint(null);
  const node_stripe_green_22 = new THREE.Group();
  node_stripe_green_22.name = "stripe-green__pivot";
  node_stripe_green_22.scale.set(1, 1, 1);
  if (endpoint_stripe_green_22) {
    node_stripe_green_22.position.copy(endpoint_stripe_green_22.start);
    node_stripe_green_22.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_stripe_green_22.position.set(0.050000000000000044, 0.0, 0.0);
    node_stripe_green_22.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_stripe_green_22.userData.sculptComponent = {"id": "stripe-green", "name": "stripe-green", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-green-mount", "localStart": [0.050000000000000044, 0, 0], "localEnd": [0.050000000000000044, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.050000000000000044, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-green", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green", "materialLayers": ["green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 141, 99, 1)", "secondaryAlbedo": "rgba(80, 141, 99, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_green_22.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-green", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_stripe_green_22);
  nodes["stripe-green"] = node_stripe_green_22;
  const mesh_stripe_green_22Geometry = endpoint_stripe_green_22
    ? new THREE.CylinderGeometry(endpoint_stripe_green_22.endRadius, endpoint_stripe_green_22.baseRadius, endpoint_stripe_green_22.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1});
  if (!endpoint_stripe_green_22) {
    mesh_stripe_green_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_stripe_green_22 = new THREE.Mesh(
    mesh_stripe_green_22Geometry,
    materialMap["green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stripe_green_22.name = "stripe-green";
  if (endpoint_stripe_green_22) {
    mesh_stripe_green_22.position.copy(endpoint_stripe_green_22.midpoint);
    mesh_stripe_green_22.quaternion.copy(endpoint_stripe_green_22.quaternion);
  }
  mesh_stripe_green_22.castShadow = options.castShadow ?? true;
  mesh_stripe_green_22.receiveShadow = options.receiveShadow ?? true;
  mesh_stripe_green_22.userData.sculptComponent = {"id": "stripe-green", "name": "stripe-green", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-green-mount", "localStart": [0.050000000000000044, 0, 0], "localEnd": [0.050000000000000044, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.050000000000000044, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-green", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green", "materialLayers": ["green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 141, 99, 1)", "secondaryAlbedo": "rgba(80, 141, 99, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_green_22.add(mesh_stripe_green_22);
  meshes["stripe-green"] = mesh_stripe_green_22;
  colliders["stripe-green"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stripe-green"] ??= [];
  destructionGroups["stripe-green"].push(node_stripe_green_22);

  const endpoint_stripe_blue_23 = makeAttachmentEndpoint(null);
  const node_stripe_blue_23 = new THREE.Group();
  node_stripe_blue_23.name = "stripe-blue__pivot";
  node_stripe_blue_23.scale.set(1, 1, 1);
  if (endpoint_stripe_blue_23) {
    node_stripe_blue_23.position.copy(endpoint_stripe_blue_23.start);
    node_stripe_blue_23.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_stripe_blue_23.position.set(0.15000000000000002, 0.0, 0.0);
    node_stripe_blue_23.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_stripe_blue_23.userData.sculptComponent = {"id": "stripe-blue", "name": "stripe-blue", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-blue-mount", "localStart": [0.15000000000000002, 0, 0], "localEnd": [0.15000000000000002, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.15000000000000002, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-blue", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "blue", "materialLayers": ["blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(43, 127, 171, 1)", "secondaryAlbedo": "rgba(43, 127, 171, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_blue_23.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-blue", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_stripe_blue_23);
  nodes["stripe-blue"] = node_stripe_blue_23;
  const mesh_stripe_blue_23Geometry = endpoint_stripe_blue_23
    ? new THREE.CylinderGeometry(endpoint_stripe_blue_23.endRadius, endpoint_stripe_blue_23.baseRadius, endpoint_stripe_blue_23.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1});
  if (!endpoint_stripe_blue_23) {
    mesh_stripe_blue_23Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_stripe_blue_23 = new THREE.Mesh(
    mesh_stripe_blue_23Geometry,
    materialMap["blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stripe_blue_23.name = "stripe-blue";
  if (endpoint_stripe_blue_23) {
    mesh_stripe_blue_23.position.copy(endpoint_stripe_blue_23.midpoint);
    mesh_stripe_blue_23.quaternion.copy(endpoint_stripe_blue_23.quaternion);
  }
  mesh_stripe_blue_23.castShadow = options.castShadow ?? true;
  mesh_stripe_blue_23.receiveShadow = options.receiveShadow ?? true;
  mesh_stripe_blue_23.userData.sculptComponent = {"id": "stripe-blue", "name": "stripe-blue", "level": "meso", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.655, 0.12], [-0.655, -0.02], [-1.285, -0.42], [-1.285, -0.66], [-1.291, -0.66], [-1.291, -0.416], [-0.661, -0.016], [-0.661, 0.12]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "stripe-blue-mount", "localStart": [0.15000000000000002, 0, 0], "localEnd": [0.15000000000000002, 0, 0.02], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.15000000000000002, 0, 0], "rotation": [0, 1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stripe-blue", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "blue", "materialLayers": ["blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(43, 127, 171, 1)", "secondaryAlbedo": "rgba(43, 127, 171, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stripe_blue_23.add(mesh_stripe_blue_23);
  meshes["stripe-blue"] = mesh_stripe_blue_23;
  colliders["stripe-blue"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stripe-blue"] ??= [];
  destructionGroups["stripe-blue"].push(node_stripe_blue_23);

  const endpoint_lens_ring_0_24 = makeAttachmentEndpoint(null);
  const node_lens_ring_0_24 = new THREE.Group();
  node_lens_ring_0_24.name = "lens-ring-0__pivot";
  node_lens_ring_0_24.scale.set(1, 1, 1);
  if (endpoint_lens_ring_0_24) {
    node_lens_ring_0_24.position.copy(endpoint_lens_ring_0_24.start);
    node_lens_ring_0_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_0_24.position.set(0.0, 0.47, 1.075);
    node_lens_ring_0_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_0_24.userData.sculptComponent = {"id": "lens-ring-0", "name": "lens-ring-0", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-0-mount", "localStart": [0, 0.47, 1.075], "localEnd": [0, 0.47, 1.095], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.34, "height": 1.34, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.075], "rotation": [0, 0, 0], "scale": [1.34, 1.34, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_0_24.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_0_24);
  nodes["lens-ring-0"] = node_lens_ring_0_24;
  const mesh_lens_ring_0_24Geometry = endpoint_lens_ring_0_24
    ? new THREE.CylinderGeometry(endpoint_lens_ring_0_24.endRadius, endpoint_lens_ring_0_24.baseRadius, endpoint_lens_ring_0_24.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_0_24) {
    mesh_lens_ring_0_24Geometry.scale(1.34, 1.34, 1.0);
  }
  const mesh_lens_ring_0_24 = new THREE.Mesh(
    mesh_lens_ring_0_24Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_0_24.name = "lens-ring-0";
  if (endpoint_lens_ring_0_24) {
    mesh_lens_ring_0_24.position.copy(endpoint_lens_ring_0_24.midpoint);
    mesh_lens_ring_0_24.quaternion.copy(endpoint_lens_ring_0_24.quaternion);
  }
  mesh_lens_ring_0_24.castShadow = options.castShadow ?? true;
  mesh_lens_ring_0_24.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_0_24.userData.sculptComponent = {"id": "lens-ring-0", "name": "lens-ring-0", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-0-mount", "localStart": [0, 0.47, 1.075], "localEnd": [0, 0.47, 1.095], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.34, "height": 1.34, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.075], "rotation": [0, 0, 0], "scale": [1.34, 1.34, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_0_24.add(mesh_lens_ring_0_24);
  meshes["lens-ring-0"] = mesh_lens_ring_0_24;
  colliders["lens-ring-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-0"] ??= [];
  destructionGroups["lens-ring-0"].push(node_lens_ring_0_24);

  const endpoint_lens_ring_1_25 = makeAttachmentEndpoint(null);
  const node_lens_ring_1_25 = new THREE.Group();
  node_lens_ring_1_25.name = "lens-ring-1__pivot";
  node_lens_ring_1_25.scale.set(1, 1, 1);
  if (endpoint_lens_ring_1_25) {
    node_lens_ring_1_25.position.copy(endpoint_lens_ring_1_25.start);
    node_lens_ring_1_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_1_25.position.set(0.0, 0.47, 1.069);
    node_lens_ring_1_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_1_25.userData.sculptComponent = {"id": "lens-ring-1", "name": "lens-ring-1", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-1-mount", "localStart": [0, 0.47, 1.069], "localEnd": [0, 0.47, 1.089], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.2670000000000001, "height": 1.2670000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.069], "rotation": [0, 0, 0], "scale": [1.2670000000000001, 1.2670000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_1_25.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_1_25);
  nodes["lens-ring-1"] = node_lens_ring_1_25;
  const mesh_lens_ring_1_25Geometry = endpoint_lens_ring_1_25
    ? new THREE.CylinderGeometry(endpoint_lens_ring_1_25.endRadius, endpoint_lens_ring_1_25.baseRadius, endpoint_lens_ring_1_25.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_1_25) {
    mesh_lens_ring_1_25Geometry.scale(1.2670000000000001, 1.2670000000000001, 1.0);
  }
  const mesh_lens_ring_1_25 = new THREE.Mesh(
    mesh_lens_ring_1_25Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_1_25.name = "lens-ring-1";
  if (endpoint_lens_ring_1_25) {
    mesh_lens_ring_1_25.position.copy(endpoint_lens_ring_1_25.midpoint);
    mesh_lens_ring_1_25.quaternion.copy(endpoint_lens_ring_1_25.quaternion);
  }
  mesh_lens_ring_1_25.castShadow = options.castShadow ?? true;
  mesh_lens_ring_1_25.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_1_25.userData.sculptComponent = {"id": "lens-ring-1", "name": "lens-ring-1", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-1-mount", "localStart": [0, 0.47, 1.069], "localEnd": [0, 0.47, 1.089], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.2670000000000001, "height": 1.2670000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.069], "rotation": [0, 0, 0], "scale": [1.2670000000000001, 1.2670000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_1_25.add(mesh_lens_ring_1_25);
  meshes["lens-ring-1"] = mesh_lens_ring_1_25;
  colliders["lens-ring-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-1"] ??= [];
  destructionGroups["lens-ring-1"].push(node_lens_ring_1_25);

  const endpoint_lens_ring_2_26 = makeAttachmentEndpoint(null);
  const node_lens_ring_2_26 = new THREE.Group();
  node_lens_ring_2_26.name = "lens-ring-2__pivot";
  node_lens_ring_2_26.scale.set(1, 1, 1);
  if (endpoint_lens_ring_2_26) {
    node_lens_ring_2_26.position.copy(endpoint_lens_ring_2_26.start);
    node_lens_ring_2_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_2_26.position.set(0.0, 0.47, 1.063);
    node_lens_ring_2_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_2_26.userData.sculptComponent = {"id": "lens-ring-2", "name": "lens-ring-2", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-2-mount", "localStart": [0, 0.47, 1.063], "localEnd": [0, 0.47, 1.083], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.1940000000000002, "height": 1.1940000000000002, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.063], "rotation": [0, 0, 0], "scale": [1.1940000000000002, 1.1940000000000002, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_2_26.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_2_26);
  nodes["lens-ring-2"] = node_lens_ring_2_26;
  const mesh_lens_ring_2_26Geometry = endpoint_lens_ring_2_26
    ? new THREE.CylinderGeometry(endpoint_lens_ring_2_26.endRadius, endpoint_lens_ring_2_26.baseRadius, endpoint_lens_ring_2_26.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_2_26) {
    mesh_lens_ring_2_26Geometry.scale(1.1940000000000002, 1.1940000000000002, 1.0);
  }
  const mesh_lens_ring_2_26 = new THREE.Mesh(
    mesh_lens_ring_2_26Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_2_26.name = "lens-ring-2";
  if (endpoint_lens_ring_2_26) {
    mesh_lens_ring_2_26.position.copy(endpoint_lens_ring_2_26.midpoint);
    mesh_lens_ring_2_26.quaternion.copy(endpoint_lens_ring_2_26.quaternion);
  }
  mesh_lens_ring_2_26.castShadow = options.castShadow ?? true;
  mesh_lens_ring_2_26.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_2_26.userData.sculptComponent = {"id": "lens-ring-2", "name": "lens-ring-2", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-2-mount", "localStart": [0, 0.47, 1.063], "localEnd": [0, 0.47, 1.083], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.1940000000000002, "height": 1.1940000000000002, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.063], "rotation": [0, 0, 0], "scale": [1.1940000000000002, 1.1940000000000002, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_2_26.add(mesh_lens_ring_2_26);
  meshes["lens-ring-2"] = mesh_lens_ring_2_26;
  colliders["lens-ring-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-2"] ??= [];
  destructionGroups["lens-ring-2"].push(node_lens_ring_2_26);

  const endpoint_lens_ring_3_27 = makeAttachmentEndpoint(null);
  const node_lens_ring_3_27 = new THREE.Group();
  node_lens_ring_3_27.name = "lens-ring-3__pivot";
  node_lens_ring_3_27.scale.set(1, 1, 1);
  if (endpoint_lens_ring_3_27) {
    node_lens_ring_3_27.position.copy(endpoint_lens_ring_3_27.start);
    node_lens_ring_3_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_3_27.position.set(0.0, 0.47, 1.057);
    node_lens_ring_3_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_3_27.userData.sculptComponent = {"id": "lens-ring-3", "name": "lens-ring-3", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-3-mount", "localStart": [0, 0.47, 1.057], "localEnd": [0, 0.47, 1.077], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.121, "height": 1.121, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.057], "rotation": [0, 0, 0], "scale": [1.121, 1.121, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_3_27.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_3_27);
  nodes["lens-ring-3"] = node_lens_ring_3_27;
  const mesh_lens_ring_3_27Geometry = endpoint_lens_ring_3_27
    ? new THREE.CylinderGeometry(endpoint_lens_ring_3_27.endRadius, endpoint_lens_ring_3_27.baseRadius, endpoint_lens_ring_3_27.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_3_27) {
    mesh_lens_ring_3_27Geometry.scale(1.121, 1.121, 1.0);
  }
  const mesh_lens_ring_3_27 = new THREE.Mesh(
    mesh_lens_ring_3_27Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_3_27.name = "lens-ring-3";
  if (endpoint_lens_ring_3_27) {
    mesh_lens_ring_3_27.position.copy(endpoint_lens_ring_3_27.midpoint);
    mesh_lens_ring_3_27.quaternion.copy(endpoint_lens_ring_3_27.quaternion);
  }
  mesh_lens_ring_3_27.castShadow = options.castShadow ?? true;
  mesh_lens_ring_3_27.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_3_27.userData.sculptComponent = {"id": "lens-ring-3", "name": "lens-ring-3", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-3-mount", "localStart": [0, 0.47, 1.057], "localEnd": [0, 0.47, 1.077], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.121, "height": 1.121, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.057], "rotation": [0, 0, 0], "scale": [1.121, 1.121, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_3_27.add(mesh_lens_ring_3_27);
  meshes["lens-ring-3"] = mesh_lens_ring_3_27;
  colliders["lens-ring-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-3"] ??= [];
  destructionGroups["lens-ring-3"].push(node_lens_ring_3_27);

  const endpoint_lens_ring_4_28 = makeAttachmentEndpoint(null);
  const node_lens_ring_4_28 = new THREE.Group();
  node_lens_ring_4_28.name = "lens-ring-4__pivot";
  node_lens_ring_4_28.scale.set(1, 1, 1);
  if (endpoint_lens_ring_4_28) {
    node_lens_ring_4_28.position.copy(endpoint_lens_ring_4_28.start);
    node_lens_ring_4_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_4_28.position.set(0.0, 0.47, 1.051);
    node_lens_ring_4_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_4_28.userData.sculptComponent = {"id": "lens-ring-4", "name": "lens-ring-4", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-4-mount", "localStart": [0, 0.47, 1.051], "localEnd": [0, 0.47, 1.071], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.048, "height": 1.048, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.051], "rotation": [0, 0, 0], "scale": [1.048, 1.048, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_4_28.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_4_28);
  nodes["lens-ring-4"] = node_lens_ring_4_28;
  const mesh_lens_ring_4_28Geometry = endpoint_lens_ring_4_28
    ? new THREE.CylinderGeometry(endpoint_lens_ring_4_28.endRadius, endpoint_lens_ring_4_28.baseRadius, endpoint_lens_ring_4_28.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_4_28) {
    mesh_lens_ring_4_28Geometry.scale(1.048, 1.048, 1.0);
  }
  const mesh_lens_ring_4_28 = new THREE.Mesh(
    mesh_lens_ring_4_28Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_4_28.name = "lens-ring-4";
  if (endpoint_lens_ring_4_28) {
    mesh_lens_ring_4_28.position.copy(endpoint_lens_ring_4_28.midpoint);
    mesh_lens_ring_4_28.quaternion.copy(endpoint_lens_ring_4_28.quaternion);
  }
  mesh_lens_ring_4_28.castShadow = options.castShadow ?? true;
  mesh_lens_ring_4_28.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_4_28.userData.sculptComponent = {"id": "lens-ring-4", "name": "lens-ring-4", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-4-mount", "localStart": [0, 0.47, 1.051], "localEnd": [0, 0.47, 1.071], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.048, "height": 1.048, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.051], "rotation": [0, 0, 0], "scale": [1.048, 1.048, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_4_28.add(mesh_lens_ring_4_28);
  meshes["lens-ring-4"] = mesh_lens_ring_4_28;
  colliders["lens-ring-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-4"] ??= [];
  destructionGroups["lens-ring-4"].push(node_lens_ring_4_28);

  const endpoint_lens_ring_5_29 = makeAttachmentEndpoint(null);
  const node_lens_ring_5_29 = new THREE.Group();
  node_lens_ring_5_29.name = "lens-ring-5__pivot";
  node_lens_ring_5_29.scale.set(1, 1, 1);
  if (endpoint_lens_ring_5_29) {
    node_lens_ring_5_29.position.copy(endpoint_lens_ring_5_29.start);
    node_lens_ring_5_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_5_29.position.set(0.0, 0.47, 1.045);
    node_lens_ring_5_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_5_29.userData.sculptComponent = {"id": "lens-ring-5", "name": "lens-ring-5", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-5-mount", "localStart": [0, 0.47, 1.045], "localEnd": [0, 0.47, 1.065], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.9750000000000001, "height": 0.9750000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.045], "rotation": [0, 0, 0], "scale": [0.9750000000000001, 0.9750000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_5_29.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_5_29);
  nodes["lens-ring-5"] = node_lens_ring_5_29;
  const mesh_lens_ring_5_29Geometry = endpoint_lens_ring_5_29
    ? new THREE.CylinderGeometry(endpoint_lens_ring_5_29.endRadius, endpoint_lens_ring_5_29.baseRadius, endpoint_lens_ring_5_29.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_5_29) {
    mesh_lens_ring_5_29Geometry.scale(0.9750000000000001, 0.9750000000000001, 1.0);
  }
  const mesh_lens_ring_5_29 = new THREE.Mesh(
    mesh_lens_ring_5_29Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_5_29.name = "lens-ring-5";
  if (endpoint_lens_ring_5_29) {
    mesh_lens_ring_5_29.position.copy(endpoint_lens_ring_5_29.midpoint);
    mesh_lens_ring_5_29.quaternion.copy(endpoint_lens_ring_5_29.quaternion);
  }
  mesh_lens_ring_5_29.castShadow = options.castShadow ?? true;
  mesh_lens_ring_5_29.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_5_29.userData.sculptComponent = {"id": "lens-ring-5", "name": "lens-ring-5", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-5-mount", "localStart": [0, 0.47, 1.045], "localEnd": [0, 0.47, 1.065], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.9750000000000001, "height": 0.9750000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.045], "rotation": [0, 0, 0], "scale": [0.9750000000000001, 0.9750000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_5_29.add(mesh_lens_ring_5_29);
  meshes["lens-ring-5"] = mesh_lens_ring_5_29;
  colliders["lens-ring-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-5"] ??= [];
  destructionGroups["lens-ring-5"].push(node_lens_ring_5_29);

  const endpoint_lens_ring_6_30 = makeAttachmentEndpoint(null);
  const node_lens_ring_6_30 = new THREE.Group();
  node_lens_ring_6_30.name = "lens-ring-6__pivot";
  node_lens_ring_6_30.scale.set(1, 1, 1);
  if (endpoint_lens_ring_6_30) {
    node_lens_ring_6_30.position.copy(endpoint_lens_ring_6_30.start);
    node_lens_ring_6_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_6_30.position.set(0.0, 0.47, 1.039);
    node_lens_ring_6_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_6_30.userData.sculptComponent = {"id": "lens-ring-6", "name": "lens-ring-6", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-6-mount", "localStart": [0, 0.47, 1.039], "localEnd": [0, 0.47, 1.059], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.9020000000000001, "height": 0.9020000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.039], "rotation": [0, 0, 0], "scale": [0.9020000000000001, 0.9020000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_6_30.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_6_30);
  nodes["lens-ring-6"] = node_lens_ring_6_30;
  const mesh_lens_ring_6_30Geometry = endpoint_lens_ring_6_30
    ? new THREE.CylinderGeometry(endpoint_lens_ring_6_30.endRadius, endpoint_lens_ring_6_30.baseRadius, endpoint_lens_ring_6_30.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_6_30) {
    mesh_lens_ring_6_30Geometry.scale(0.9020000000000001, 0.9020000000000001, 1.0);
  }
  const mesh_lens_ring_6_30 = new THREE.Mesh(
    mesh_lens_ring_6_30Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_6_30.name = "lens-ring-6";
  if (endpoint_lens_ring_6_30) {
    mesh_lens_ring_6_30.position.copy(endpoint_lens_ring_6_30.midpoint);
    mesh_lens_ring_6_30.quaternion.copy(endpoint_lens_ring_6_30.quaternion);
  }
  mesh_lens_ring_6_30.castShadow = options.castShadow ?? true;
  mesh_lens_ring_6_30.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_6_30.userData.sculptComponent = {"id": "lens-ring-6", "name": "lens-ring-6", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-6-mount", "localStart": [0, 0.47, 1.039], "localEnd": [0, 0.47, 1.059], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.9020000000000001, "height": 0.9020000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.039], "rotation": [0, 0, 0], "scale": [0.9020000000000001, 0.9020000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_6_30.add(mesh_lens_ring_6_30);
  meshes["lens-ring-6"] = mesh_lens_ring_6_30;
  colliders["lens-ring-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-6"] ??= [];
  destructionGroups["lens-ring-6"].push(node_lens_ring_6_30);

  const endpoint_lens_ring_7_31 = makeAttachmentEndpoint(null);
  const node_lens_ring_7_31 = new THREE.Group();
  node_lens_ring_7_31.name = "lens-ring-7__pivot";
  node_lens_ring_7_31.scale.set(1, 1, 1);
  if (endpoint_lens_ring_7_31) {
    node_lens_ring_7_31.position.copy(endpoint_lens_ring_7_31.start);
    node_lens_ring_7_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_ring_7_31.position.set(0.0, 0.47, 1.033);
    node_lens_ring_7_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_ring_7_31.userData.sculptComponent = {"id": "lens-ring-7", "name": "lens-ring-7", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-7-mount", "localStart": [0, 0.47, 1.033], "localEnd": [0, 0.47, 1.053], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.8290000000000001, "height": 0.8290000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.033], "rotation": [0, 0, 0], "scale": [0.8290000000000001, 0.8290000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_7_31.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lens_ring_7_31);
  nodes["lens-ring-7"] = node_lens_ring_7_31;
  const mesh_lens_ring_7_31Geometry = endpoint_lens_ring_7_31
    ? new THREE.CylinderGeometry(endpoint_lens_ring_7_31.endRadius, endpoint_lens_ring_7_31.baseRadius, endpoint_lens_ring_7_31.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_lens_ring_7_31) {
    mesh_lens_ring_7_31Geometry.scale(0.8290000000000001, 0.8290000000000001, 1.0);
  }
  const mesh_lens_ring_7_31 = new THREE.Mesh(
    mesh_lens_ring_7_31Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_ring_7_31.name = "lens-ring-7";
  if (endpoint_lens_ring_7_31) {
    mesh_lens_ring_7_31.position.copy(endpoint_lens_ring_7_31.midpoint);
    mesh_lens_ring_7_31.quaternion.copy(endpoint_lens_ring_7_31.quaternion);
  }
  mesh_lens_ring_7_31.castShadow = options.castShadow ?? true;
  mesh_lens_ring_7_31.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_ring_7_31.userData.sculptComponent = {"id": "lens-ring-7", "name": "lens-ring-7", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-ring-7-mount", "localStart": [0, 0.47, 1.033], "localEnd": [0, 0.47, 1.053], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.8290000000000001, "height": 0.8290000000000001, "depth": 1.0, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.47, 1.033], "rotation": [0, 0, 0], "scale": [0.8290000000000001, 0.8290000000000001, 1.0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-ring-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lens_ring_7_31.add(mesh_lens_ring_7_31);
  meshes["lens-ring-7"] = mesh_lens_ring_7_31;
  colliders["lens-ring-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lens-ring-7"] ??= [];
  destructionGroups["lens-ring-7"].push(node_lens_ring_7_31);

  const endpoint_flash_rib_0_32 = makeAttachmentEndpoint(null);
  const node_flash_rib_0_32 = new THREE.Group();
  node_flash_rib_0_32.name = "flash-rib-0__pivot";
  node_flash_rib_0_32.scale.set(1, 1, 1);
  if (endpoint_flash_rib_0_32) {
    node_flash_rib_0_32.position.copy(endpoint_flash_rib_0_32.start);
    node_flash_rib_0_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_0_32.position.set(-1.5368, 0.82, 0.849);
    node_flash_rib_0_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_0_32.userData.sculptComponent = {"id": "flash-rib-0", "name": "flash-rib-0", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-0-mount", "localStart": [-1.5368, 0.82, 0.849], "localEnd": [-1.5368, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.5368, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_0_32.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_0_32);
  nodes["flash-rib-0"] = node_flash_rib_0_32;
  const mesh_flash_rib_0_32Geometry = endpoint_flash_rib_0_32
    ? new THREE.CylinderGeometry(endpoint_flash_rib_0_32.endRadius, endpoint_flash_rib_0_32.baseRadius, endpoint_flash_rib_0_32.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_0_32) {
    mesh_flash_rib_0_32Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_0_32 = new THREE.Mesh(
    mesh_flash_rib_0_32Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_0_32.name = "flash-rib-0";
  if (endpoint_flash_rib_0_32) {
    mesh_flash_rib_0_32.position.copy(endpoint_flash_rib_0_32.midpoint);
    mesh_flash_rib_0_32.quaternion.copy(endpoint_flash_rib_0_32.quaternion);
  }
  mesh_flash_rib_0_32.castShadow = options.castShadow ?? true;
  mesh_flash_rib_0_32.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_0_32.userData.sculptComponent = {"id": "flash-rib-0", "name": "flash-rib-0", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-0-mount", "localStart": [-1.5368, 0.82, 0.849], "localEnd": [-1.5368, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.5368, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_0_32.add(mesh_flash_rib_0_32);
  meshes["flash-rib-0"] = mesh_flash_rib_0_32;
  colliders["flash-rib-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-0"] ??= [];
  destructionGroups["flash-rib-0"].push(node_flash_rib_0_32);

  const endpoint_flash_rib_1_33 = makeAttachmentEndpoint(null);
  const node_flash_rib_1_33 = new THREE.Group();
  node_flash_rib_1_33.name = "flash-rib-1__pivot";
  node_flash_rib_1_33.scale.set(1, 1, 1);
  if (endpoint_flash_rib_1_33) {
    node_flash_rib_1_33.position.copy(endpoint_flash_rib_1_33.start);
    node_flash_rib_1_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_1_33.position.set(-1.47465, 0.82, 0.849);
    node_flash_rib_1_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_1_33.userData.sculptComponent = {"id": "flash-rib-1", "name": "flash-rib-1", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-1-mount", "localStart": [-1.47465, 0.82, 0.849], "localEnd": [-1.47465, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.47465, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_1_33.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_1_33);
  nodes["flash-rib-1"] = node_flash_rib_1_33;
  const mesh_flash_rib_1_33Geometry = endpoint_flash_rib_1_33
    ? new THREE.CylinderGeometry(endpoint_flash_rib_1_33.endRadius, endpoint_flash_rib_1_33.baseRadius, endpoint_flash_rib_1_33.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_1_33) {
    mesh_flash_rib_1_33Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_1_33 = new THREE.Mesh(
    mesh_flash_rib_1_33Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_1_33.name = "flash-rib-1";
  if (endpoint_flash_rib_1_33) {
    mesh_flash_rib_1_33.position.copy(endpoint_flash_rib_1_33.midpoint);
    mesh_flash_rib_1_33.quaternion.copy(endpoint_flash_rib_1_33.quaternion);
  }
  mesh_flash_rib_1_33.castShadow = options.castShadow ?? true;
  mesh_flash_rib_1_33.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_1_33.userData.sculptComponent = {"id": "flash-rib-1", "name": "flash-rib-1", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-1-mount", "localStart": [-1.47465, 0.82, 0.849], "localEnd": [-1.47465, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.47465, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_1_33.add(mesh_flash_rib_1_33);
  meshes["flash-rib-1"] = mesh_flash_rib_1_33;
  colliders["flash-rib-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-1"] ??= [];
  destructionGroups["flash-rib-1"].push(node_flash_rib_1_33);

  const endpoint_flash_rib_2_34 = makeAttachmentEndpoint(null);
  const node_flash_rib_2_34 = new THREE.Group();
  node_flash_rib_2_34.name = "flash-rib-2__pivot";
  node_flash_rib_2_34.scale.set(1, 1, 1);
  if (endpoint_flash_rib_2_34) {
    node_flash_rib_2_34.position.copy(endpoint_flash_rib_2_34.start);
    node_flash_rib_2_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_2_34.position.set(-1.4124999999999999, 0.82, 0.849);
    node_flash_rib_2_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_2_34.userData.sculptComponent = {"id": "flash-rib-2", "name": "flash-rib-2", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-2-mount", "localStart": [-1.4124999999999999, 0.82, 0.849], "localEnd": [-1.4124999999999999, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.4124999999999999, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_2_34.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_2_34);
  nodes["flash-rib-2"] = node_flash_rib_2_34;
  const mesh_flash_rib_2_34Geometry = endpoint_flash_rib_2_34
    ? new THREE.CylinderGeometry(endpoint_flash_rib_2_34.endRadius, endpoint_flash_rib_2_34.baseRadius, endpoint_flash_rib_2_34.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_2_34) {
    mesh_flash_rib_2_34Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_2_34 = new THREE.Mesh(
    mesh_flash_rib_2_34Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_2_34.name = "flash-rib-2";
  if (endpoint_flash_rib_2_34) {
    mesh_flash_rib_2_34.position.copy(endpoint_flash_rib_2_34.midpoint);
    mesh_flash_rib_2_34.quaternion.copy(endpoint_flash_rib_2_34.quaternion);
  }
  mesh_flash_rib_2_34.castShadow = options.castShadow ?? true;
  mesh_flash_rib_2_34.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_2_34.userData.sculptComponent = {"id": "flash-rib-2", "name": "flash-rib-2", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-2-mount", "localStart": [-1.4124999999999999, 0.82, 0.849], "localEnd": [-1.4124999999999999, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.4124999999999999, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_2_34.add(mesh_flash_rib_2_34);
  meshes["flash-rib-2"] = mesh_flash_rib_2_34;
  colliders["flash-rib-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-2"] ??= [];
  destructionGroups["flash-rib-2"].push(node_flash_rib_2_34);

  const endpoint_flash_rib_3_35 = makeAttachmentEndpoint(null);
  const node_flash_rib_3_35 = new THREE.Group();
  node_flash_rib_3_35.name = "flash-rib-3__pivot";
  node_flash_rib_3_35.scale.set(1, 1, 1);
  if (endpoint_flash_rib_3_35) {
    node_flash_rib_3_35.position.copy(endpoint_flash_rib_3_35.start);
    node_flash_rib_3_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_3_35.position.set(-1.35035, 0.82, 0.849);
    node_flash_rib_3_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_3_35.userData.sculptComponent = {"id": "flash-rib-3", "name": "flash-rib-3", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-3-mount", "localStart": [-1.35035, 0.82, 0.849], "localEnd": [-1.35035, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.35035, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_3_35.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_3_35);
  nodes["flash-rib-3"] = node_flash_rib_3_35;
  const mesh_flash_rib_3_35Geometry = endpoint_flash_rib_3_35
    ? new THREE.CylinderGeometry(endpoint_flash_rib_3_35.endRadius, endpoint_flash_rib_3_35.baseRadius, endpoint_flash_rib_3_35.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_3_35) {
    mesh_flash_rib_3_35Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_3_35 = new THREE.Mesh(
    mesh_flash_rib_3_35Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_3_35.name = "flash-rib-3";
  if (endpoint_flash_rib_3_35) {
    mesh_flash_rib_3_35.position.copy(endpoint_flash_rib_3_35.midpoint);
    mesh_flash_rib_3_35.quaternion.copy(endpoint_flash_rib_3_35.quaternion);
  }
  mesh_flash_rib_3_35.castShadow = options.castShadow ?? true;
  mesh_flash_rib_3_35.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_3_35.userData.sculptComponent = {"id": "flash-rib-3", "name": "flash-rib-3", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-3-mount", "localStart": [-1.35035, 0.82, 0.849], "localEnd": [-1.35035, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.35035, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_3_35.add(mesh_flash_rib_3_35);
  meshes["flash-rib-3"] = mesh_flash_rib_3_35;
  colliders["flash-rib-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-3"] ??= [];
  destructionGroups["flash-rib-3"].push(node_flash_rib_3_35);

  const endpoint_flash_rib_4_36 = makeAttachmentEndpoint(null);
  const node_flash_rib_4_36 = new THREE.Group();
  node_flash_rib_4_36.name = "flash-rib-4__pivot";
  node_flash_rib_4_36.scale.set(1, 1, 1);
  if (endpoint_flash_rib_4_36) {
    node_flash_rib_4_36.position.copy(endpoint_flash_rib_4_36.start);
    node_flash_rib_4_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_4_36.position.set(-1.2882, 0.82, 0.849);
    node_flash_rib_4_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_4_36.userData.sculptComponent = {"id": "flash-rib-4", "name": "flash-rib-4", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-4-mount", "localStart": [-1.2882, 0.82, 0.849], "localEnd": [-1.2882, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.2882, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_4_36.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_4_36);
  nodes["flash-rib-4"] = node_flash_rib_4_36;
  const mesh_flash_rib_4_36Geometry = endpoint_flash_rib_4_36
    ? new THREE.CylinderGeometry(endpoint_flash_rib_4_36.endRadius, endpoint_flash_rib_4_36.baseRadius, endpoint_flash_rib_4_36.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_4_36) {
    mesh_flash_rib_4_36Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_4_36 = new THREE.Mesh(
    mesh_flash_rib_4_36Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_4_36.name = "flash-rib-4";
  if (endpoint_flash_rib_4_36) {
    mesh_flash_rib_4_36.position.copy(endpoint_flash_rib_4_36.midpoint);
    mesh_flash_rib_4_36.quaternion.copy(endpoint_flash_rib_4_36.quaternion);
  }
  mesh_flash_rib_4_36.castShadow = options.castShadow ?? true;
  mesh_flash_rib_4_36.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_4_36.userData.sculptComponent = {"id": "flash-rib-4", "name": "flash-rib-4", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-4-mount", "localStart": [-1.2882, 0.82, 0.849], "localEnd": [-1.2882, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.2882, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_4_36.add(mesh_flash_rib_4_36);
  meshes["flash-rib-4"] = mesh_flash_rib_4_36;
  colliders["flash-rib-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-4"] ??= [];
  destructionGroups["flash-rib-4"].push(node_flash_rib_4_36);

  const endpoint_flash_rib_5_37 = makeAttachmentEndpoint(null);
  const node_flash_rib_5_37 = new THREE.Group();
  node_flash_rib_5_37.name = "flash-rib-5__pivot";
  node_flash_rib_5_37.scale.set(1, 1, 1);
  if (endpoint_flash_rib_5_37) {
    node_flash_rib_5_37.position.copy(endpoint_flash_rib_5_37.start);
    node_flash_rib_5_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_5_37.position.set(-1.2260499999999999, 0.82, 0.849);
    node_flash_rib_5_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_5_37.userData.sculptComponent = {"id": "flash-rib-5", "name": "flash-rib-5", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-5-mount", "localStart": [-1.2260499999999999, 0.82, 0.849], "localEnd": [-1.2260499999999999, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.2260499999999999, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_5_37.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_5_37);
  nodes["flash-rib-5"] = node_flash_rib_5_37;
  const mesh_flash_rib_5_37Geometry = endpoint_flash_rib_5_37
    ? new THREE.CylinderGeometry(endpoint_flash_rib_5_37.endRadius, endpoint_flash_rib_5_37.baseRadius, endpoint_flash_rib_5_37.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_5_37) {
    mesh_flash_rib_5_37Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_5_37 = new THREE.Mesh(
    mesh_flash_rib_5_37Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_5_37.name = "flash-rib-5";
  if (endpoint_flash_rib_5_37) {
    mesh_flash_rib_5_37.position.copy(endpoint_flash_rib_5_37.midpoint);
    mesh_flash_rib_5_37.quaternion.copy(endpoint_flash_rib_5_37.quaternion);
  }
  mesh_flash_rib_5_37.castShadow = options.castShadow ?? true;
  mesh_flash_rib_5_37.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_5_37.userData.sculptComponent = {"id": "flash-rib-5", "name": "flash-rib-5", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-5-mount", "localStart": [-1.2260499999999999, 0.82, 0.849], "localEnd": [-1.2260499999999999, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.2260499999999999, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_5_37.add(mesh_flash_rib_5_37);
  meshes["flash-rib-5"] = mesh_flash_rib_5_37;
  colliders["flash-rib-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-5"] ??= [];
  destructionGroups["flash-rib-5"].push(node_flash_rib_5_37);

  const endpoint_flash_rib_6_38 = makeAttachmentEndpoint(null);
  const node_flash_rib_6_38 = new THREE.Group();
  node_flash_rib_6_38.name = "flash-rib-6__pivot";
  node_flash_rib_6_38.scale.set(1, 1, 1);
  if (endpoint_flash_rib_6_38) {
    node_flash_rib_6_38.position.copy(endpoint_flash_rib_6_38.start);
    node_flash_rib_6_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_6_38.position.set(-1.1639, 0.82, 0.849);
    node_flash_rib_6_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_6_38.userData.sculptComponent = {"id": "flash-rib-6", "name": "flash-rib-6", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-6-mount", "localStart": [-1.1639, 0.82, 0.849], "localEnd": [-1.1639, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_6_38.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_6_38);
  nodes["flash-rib-6"] = node_flash_rib_6_38;
  const mesh_flash_rib_6_38Geometry = endpoint_flash_rib_6_38
    ? new THREE.CylinderGeometry(endpoint_flash_rib_6_38.endRadius, endpoint_flash_rib_6_38.baseRadius, endpoint_flash_rib_6_38.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_6_38) {
    mesh_flash_rib_6_38Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_6_38 = new THREE.Mesh(
    mesh_flash_rib_6_38Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_6_38.name = "flash-rib-6";
  if (endpoint_flash_rib_6_38) {
    mesh_flash_rib_6_38.position.copy(endpoint_flash_rib_6_38.midpoint);
    mesh_flash_rib_6_38.quaternion.copy(endpoint_flash_rib_6_38.quaternion);
  }
  mesh_flash_rib_6_38.castShadow = options.castShadow ?? true;
  mesh_flash_rib_6_38.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_6_38.userData.sculptComponent = {"id": "flash-rib-6", "name": "flash-rib-6", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-6-mount", "localStart": [-1.1639, 0.82, 0.849], "localEnd": [-1.1639, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_6_38.add(mesh_flash_rib_6_38);
  meshes["flash-rib-6"] = mesh_flash_rib_6_38;
  colliders["flash-rib-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-6"] ??= [];
  destructionGroups["flash-rib-6"].push(node_flash_rib_6_38);

  const endpoint_flash_rib_7_39 = makeAttachmentEndpoint(null);
  const node_flash_rib_7_39 = new THREE.Group();
  node_flash_rib_7_39.name = "flash-rib-7__pivot";
  node_flash_rib_7_39.scale.set(1, 1, 1);
  if (endpoint_flash_rib_7_39) {
    node_flash_rib_7_39.position.copy(endpoint_flash_rib_7_39.start);
    node_flash_rib_7_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_7_39.position.set(-1.10175, 0.82, 0.849);
    node_flash_rib_7_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_7_39.userData.sculptComponent = {"id": "flash-rib-7", "name": "flash-rib-7", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-7-mount", "localStart": [-1.10175, 0.82, 0.849], "localEnd": [-1.10175, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.10175, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_7_39.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_7_39);
  nodes["flash-rib-7"] = node_flash_rib_7_39;
  const mesh_flash_rib_7_39Geometry = endpoint_flash_rib_7_39
    ? new THREE.CylinderGeometry(endpoint_flash_rib_7_39.endRadius, endpoint_flash_rib_7_39.baseRadius, endpoint_flash_rib_7_39.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_7_39) {
    mesh_flash_rib_7_39Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_7_39 = new THREE.Mesh(
    mesh_flash_rib_7_39Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_7_39.name = "flash-rib-7";
  if (endpoint_flash_rib_7_39) {
    mesh_flash_rib_7_39.position.copy(endpoint_flash_rib_7_39.midpoint);
    mesh_flash_rib_7_39.quaternion.copy(endpoint_flash_rib_7_39.quaternion);
  }
  mesh_flash_rib_7_39.castShadow = options.castShadow ?? true;
  mesh_flash_rib_7_39.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_7_39.userData.sculptComponent = {"id": "flash-rib-7", "name": "flash-rib-7", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-7-mount", "localStart": [-1.10175, 0.82, 0.849], "localEnd": [-1.10175, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.10175, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_7_39.add(mesh_flash_rib_7_39);
  meshes["flash-rib-7"] = mesh_flash_rib_7_39;
  colliders["flash-rib-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-7"] ??= [];
  destructionGroups["flash-rib-7"].push(node_flash_rib_7_39);

  const endpoint_flash_rib_8_40 = makeAttachmentEndpoint(null);
  const node_flash_rib_8_40 = new THREE.Group();
  node_flash_rib_8_40.name = "flash-rib-8__pivot";
  node_flash_rib_8_40.scale.set(1, 1, 1);
  if (endpoint_flash_rib_8_40) {
    node_flash_rib_8_40.position.copy(endpoint_flash_rib_8_40.start);
    node_flash_rib_8_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_8_40.position.set(-1.0396, 0.82, 0.849);
    node_flash_rib_8_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_8_40.userData.sculptComponent = {"id": "flash-rib-8", "name": "flash-rib-8", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-8-mount", "localStart": [-1.0396, 0.82, 0.849], "localEnd": [-1.0396, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.0396, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_8_40.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_8_40);
  nodes["flash-rib-8"] = node_flash_rib_8_40;
  const mesh_flash_rib_8_40Geometry = endpoint_flash_rib_8_40
    ? new THREE.CylinderGeometry(endpoint_flash_rib_8_40.endRadius, endpoint_flash_rib_8_40.baseRadius, endpoint_flash_rib_8_40.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_8_40) {
    mesh_flash_rib_8_40Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_8_40 = new THREE.Mesh(
    mesh_flash_rib_8_40Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_8_40.name = "flash-rib-8";
  if (endpoint_flash_rib_8_40) {
    mesh_flash_rib_8_40.position.copy(endpoint_flash_rib_8_40.midpoint);
    mesh_flash_rib_8_40.quaternion.copy(endpoint_flash_rib_8_40.quaternion);
  }
  mesh_flash_rib_8_40.castShadow = options.castShadow ?? true;
  mesh_flash_rib_8_40.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_8_40.userData.sculptComponent = {"id": "flash-rib-8", "name": "flash-rib-8", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-8-mount", "localStart": [-1.0396, 0.82, 0.849], "localEnd": [-1.0396, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.0396, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_8_40.add(mesh_flash_rib_8_40);
  meshes["flash-rib-8"] = mesh_flash_rib_8_40;
  colliders["flash-rib-8"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-8"] ??= [];
  destructionGroups["flash-rib-8"].push(node_flash_rib_8_40);

  const endpoint_flash_rib_9_41 = makeAttachmentEndpoint(null);
  const node_flash_rib_9_41 = new THREE.Group();
  node_flash_rib_9_41.name = "flash-rib-9__pivot";
  node_flash_rib_9_41.scale.set(1, 1, 1);
  if (endpoint_flash_rib_9_41) {
    node_flash_rib_9_41.position.copy(endpoint_flash_rib_9_41.start);
    node_flash_rib_9_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_9_41.position.set(-0.97745, 0.82, 0.849);
    node_flash_rib_9_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_9_41.userData.sculptComponent = {"id": "flash-rib-9", "name": "flash-rib-9", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-9-mount", "localStart": [-0.97745, 0.82, 0.849], "localEnd": [-0.97745, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.97745, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_9_41.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_9_41);
  nodes["flash-rib-9"] = node_flash_rib_9_41;
  const mesh_flash_rib_9_41Geometry = endpoint_flash_rib_9_41
    ? new THREE.CylinderGeometry(endpoint_flash_rib_9_41.endRadius, endpoint_flash_rib_9_41.baseRadius, endpoint_flash_rib_9_41.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_9_41) {
    mesh_flash_rib_9_41Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_9_41 = new THREE.Mesh(
    mesh_flash_rib_9_41Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_9_41.name = "flash-rib-9";
  if (endpoint_flash_rib_9_41) {
    mesh_flash_rib_9_41.position.copy(endpoint_flash_rib_9_41.midpoint);
    mesh_flash_rib_9_41.quaternion.copy(endpoint_flash_rib_9_41.quaternion);
  }
  mesh_flash_rib_9_41.castShadow = options.castShadow ?? true;
  mesh_flash_rib_9_41.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_9_41.userData.sculptComponent = {"id": "flash-rib-9", "name": "flash-rib-9", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-9-mount", "localStart": [-0.97745, 0.82, 0.849], "localEnd": [-0.97745, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.97745, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_9_41.add(mesh_flash_rib_9_41);
  meshes["flash-rib-9"] = mesh_flash_rib_9_41;
  colliders["flash-rib-9"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-9"] ??= [];
  destructionGroups["flash-rib-9"].push(node_flash_rib_9_41);

  const endpoint_flash_rib_10_42 = makeAttachmentEndpoint(null);
  const node_flash_rib_10_42 = new THREE.Group();
  node_flash_rib_10_42.name = "flash-rib-10__pivot";
  node_flash_rib_10_42.scale.set(1, 1, 1);
  if (endpoint_flash_rib_10_42) {
    node_flash_rib_10_42.position.copy(endpoint_flash_rib_10_42.start);
    node_flash_rib_10_42.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_10_42.position.set(-0.9153, 0.82, 0.849);
    node_flash_rib_10_42.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_10_42.userData.sculptComponent = {"id": "flash-rib-10", "name": "flash-rib-10", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-10-mount", "localStart": [-0.9153, 0.82, 0.849], "localEnd": [-0.9153, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.9153, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_10_42.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_10_42);
  nodes["flash-rib-10"] = node_flash_rib_10_42;
  const mesh_flash_rib_10_42Geometry = endpoint_flash_rib_10_42
    ? new THREE.CylinderGeometry(endpoint_flash_rib_10_42.endRadius, endpoint_flash_rib_10_42.baseRadius, endpoint_flash_rib_10_42.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_10_42) {
    mesh_flash_rib_10_42Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_10_42 = new THREE.Mesh(
    mesh_flash_rib_10_42Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_10_42.name = "flash-rib-10";
  if (endpoint_flash_rib_10_42) {
    mesh_flash_rib_10_42.position.copy(endpoint_flash_rib_10_42.midpoint);
    mesh_flash_rib_10_42.quaternion.copy(endpoint_flash_rib_10_42.quaternion);
  }
  mesh_flash_rib_10_42.castShadow = options.castShadow ?? true;
  mesh_flash_rib_10_42.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_10_42.userData.sculptComponent = {"id": "flash-rib-10", "name": "flash-rib-10", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-10-mount", "localStart": [-0.9153, 0.82, 0.849], "localEnd": [-0.9153, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.9153, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_10_42.add(mesh_flash_rib_10_42);
  meshes["flash-rib-10"] = mesh_flash_rib_10_42;
  colliders["flash-rib-10"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-10"] ??= [];
  destructionGroups["flash-rib-10"].push(node_flash_rib_10_42);

  const endpoint_flash_rib_11_43 = makeAttachmentEndpoint(null);
  const node_flash_rib_11_43 = new THREE.Group();
  node_flash_rib_11_43.name = "flash-rib-11__pivot";
  node_flash_rib_11_43.scale.set(1, 1, 1);
  if (endpoint_flash_rib_11_43) {
    node_flash_rib_11_43.position.copy(endpoint_flash_rib_11_43.start);
    node_flash_rib_11_43.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_11_43.position.set(-0.8531500000000001, 0.82, 0.849);
    node_flash_rib_11_43.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_11_43.userData.sculptComponent = {"id": "flash-rib-11", "name": "flash-rib-11", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-11-mount", "localStart": [-0.8531500000000001, 0.82, 0.849], "localEnd": [-0.8531500000000001, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.8531500000000001, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_11_43.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_11_43);
  nodes["flash-rib-11"] = node_flash_rib_11_43;
  const mesh_flash_rib_11_43Geometry = endpoint_flash_rib_11_43
    ? new THREE.CylinderGeometry(endpoint_flash_rib_11_43.endRadius, endpoint_flash_rib_11_43.baseRadius, endpoint_flash_rib_11_43.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_11_43) {
    mesh_flash_rib_11_43Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_11_43 = new THREE.Mesh(
    mesh_flash_rib_11_43Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_11_43.name = "flash-rib-11";
  if (endpoint_flash_rib_11_43) {
    mesh_flash_rib_11_43.position.copy(endpoint_flash_rib_11_43.midpoint);
    mesh_flash_rib_11_43.quaternion.copy(endpoint_flash_rib_11_43.quaternion);
  }
  mesh_flash_rib_11_43.castShadow = options.castShadow ?? true;
  mesh_flash_rib_11_43.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_11_43.userData.sculptComponent = {"id": "flash-rib-11", "name": "flash-rib-11", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-11-mount", "localStart": [-0.8531500000000001, 0.82, 0.849], "localEnd": [-0.8531500000000001, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.8531500000000001, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_11_43.add(mesh_flash_rib_11_43);
  meshes["flash-rib-11"] = mesh_flash_rib_11_43;
  colliders["flash-rib-11"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-11"] ??= [];
  destructionGroups["flash-rib-11"].push(node_flash_rib_11_43);

  const endpoint_flash_rib_12_44 = makeAttachmentEndpoint(null);
  const node_flash_rib_12_44 = new THREE.Group();
  node_flash_rib_12_44.name = "flash-rib-12__pivot";
  node_flash_rib_12_44.scale.set(1, 1, 1);
  if (endpoint_flash_rib_12_44) {
    node_flash_rib_12_44.position.copy(endpoint_flash_rib_12_44.start);
    node_flash_rib_12_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_rib_12_44.position.set(-0.791, 0.82, 0.849);
    node_flash_rib_12_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_rib_12_44.userData.sculptComponent = {"id": "flash-rib-12", "name": "flash-rib-12", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-12-mount", "localStart": [-0.791, 0.82, 0.849], "localEnd": [-0.791, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.791, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_12_44.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_rib_12_44);
  nodes["flash-rib-12"] = node_flash_rib_12_44;
  const mesh_flash_rib_12_44Geometry = endpoint_flash_rib_12_44
    ? new THREE.CylinderGeometry(endpoint_flash_rib_12_44.endRadius, endpoint_flash_rib_12_44.baseRadius, endpoint_flash_rib_12_44.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_rib_12_44) {
    mesh_flash_rib_12_44Geometry.scale(0.012, 0.48, 0.013);
  }
  const mesh_flash_rib_12_44 = new THREE.Mesh(
    mesh_flash_rib_12_44Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_rib_12_44.name = "flash-rib-12";
  if (endpoint_flash_rib_12_44) {
    mesh_flash_rib_12_44.position.copy(endpoint_flash_rib_12_44.midpoint);
    mesh_flash_rib_12_44.quaternion.copy(endpoint_flash_rib_12_44.quaternion);
  }
  mesh_flash_rib_12_44.castShadow = options.castShadow ?? true;
  mesh_flash_rib_12_44.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_rib_12_44.userData.sculptComponent = {"id": "flash-rib-12", "name": "flash-rib-12", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-rib-12-mount", "localStart": [-0.791, 0.82, 0.849], "localEnd": [-0.791, 0.82, 0.869], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.012, "height": 0.48, "depth": 0.013, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.791, 0.82, 0.849], "rotation": [0, 0, 0], "scale": [0.012, 0.48, 0.013]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-rib-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_rib_12_44.add(mesh_flash_rib_12_44);
  meshes["flash-rib-12"] = mesh_flash_rib_12_44;
  colliders["flash-rib-12"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-rib-12"] ??= [];
  destructionGroups["flash-rib-12"].push(node_flash_rib_12_44);

  const endpoint_flash_cross_0_45 = makeAttachmentEndpoint(null);
  const node_flash_cross_0_45 = new THREE.Group();
  node_flash_cross_0_45.name = "flash-cross-0__pivot";
  node_flash_cross_0_45.scale.set(1, 1, 1);
  if (endpoint_flash_cross_0_45) {
    node_flash_cross_0_45.position.copy(endpoint_flash_cross_0_45.start);
    node_flash_cross_0_45.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_cross_0_45.position.set(-1.1639, 0.63, 0.855);
    node_flash_cross_0_45.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_cross_0_45.userData.sculptComponent = {"id": "flash-cross-0", "name": "flash-cross-0", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-0-mount", "localStart": [-1.1639, 0.63, 0.855], "localEnd": [-1.1639, 0.63, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.63, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_0_45.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_cross_0_45);
  nodes["flash-cross-0"] = node_flash_cross_0_45;
  const mesh_flash_cross_0_45Geometry = endpoint_flash_cross_0_45
    ? new THREE.CylinderGeometry(endpoint_flash_cross_0_45.endRadius, endpoint_flash_cross_0_45.baseRadius, endpoint_flash_cross_0_45.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_cross_0_45) {
    mesh_flash_cross_0_45Geometry.scale(0.71, 0.013, 0.018);
  }
  const mesh_flash_cross_0_45 = new THREE.Mesh(
    mesh_flash_cross_0_45Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_cross_0_45.name = "flash-cross-0";
  if (endpoint_flash_cross_0_45) {
    mesh_flash_cross_0_45.position.copy(endpoint_flash_cross_0_45.midpoint);
    mesh_flash_cross_0_45.quaternion.copy(endpoint_flash_cross_0_45.quaternion);
  }
  mesh_flash_cross_0_45.castShadow = options.castShadow ?? true;
  mesh_flash_cross_0_45.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_cross_0_45.userData.sculptComponent = {"id": "flash-cross-0", "name": "flash-cross-0", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-0-mount", "localStart": [-1.1639, 0.63, 0.855], "localEnd": [-1.1639, 0.63, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.63, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_0_45.add(mesh_flash_cross_0_45);
  meshes["flash-cross-0"] = mesh_flash_cross_0_45;
  colliders["flash-cross-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-cross-0"] ??= [];
  destructionGroups["flash-cross-0"].push(node_flash_cross_0_45);

  const endpoint_flash_cross_1_46 = makeAttachmentEndpoint(null);
  const node_flash_cross_1_46 = new THREE.Group();
  node_flash_cross_1_46.name = "flash-cross-1__pivot";
  node_flash_cross_1_46.scale.set(1, 1, 1);
  if (endpoint_flash_cross_1_46) {
    node_flash_cross_1_46.position.copy(endpoint_flash_cross_1_46.start);
    node_flash_cross_1_46.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_cross_1_46.position.set(-1.1639, 0.754, 0.855);
    node_flash_cross_1_46.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_cross_1_46.userData.sculptComponent = {"id": "flash-cross-1", "name": "flash-cross-1", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-1-mount", "localStart": [-1.1639, 0.754, 0.855], "localEnd": [-1.1639, 0.754, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.754, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_1_46.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_cross_1_46);
  nodes["flash-cross-1"] = node_flash_cross_1_46;
  const mesh_flash_cross_1_46Geometry = endpoint_flash_cross_1_46
    ? new THREE.CylinderGeometry(endpoint_flash_cross_1_46.endRadius, endpoint_flash_cross_1_46.baseRadius, endpoint_flash_cross_1_46.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_cross_1_46) {
    mesh_flash_cross_1_46Geometry.scale(0.71, 0.013, 0.018);
  }
  const mesh_flash_cross_1_46 = new THREE.Mesh(
    mesh_flash_cross_1_46Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_cross_1_46.name = "flash-cross-1";
  if (endpoint_flash_cross_1_46) {
    mesh_flash_cross_1_46.position.copy(endpoint_flash_cross_1_46.midpoint);
    mesh_flash_cross_1_46.quaternion.copy(endpoint_flash_cross_1_46.quaternion);
  }
  mesh_flash_cross_1_46.castShadow = options.castShadow ?? true;
  mesh_flash_cross_1_46.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_cross_1_46.userData.sculptComponent = {"id": "flash-cross-1", "name": "flash-cross-1", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-1-mount", "localStart": [-1.1639, 0.754, 0.855], "localEnd": [-1.1639, 0.754, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.754, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_1_46.add(mesh_flash_cross_1_46);
  meshes["flash-cross-1"] = mesh_flash_cross_1_46;
  colliders["flash-cross-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-cross-1"] ??= [];
  destructionGroups["flash-cross-1"].push(node_flash_cross_1_46);

  const endpoint_flash_cross_2_47 = makeAttachmentEndpoint(null);
  const node_flash_cross_2_47 = new THREE.Group();
  node_flash_cross_2_47.name = "flash-cross-2__pivot";
  node_flash_cross_2_47.scale.set(1, 1, 1);
  if (endpoint_flash_cross_2_47) {
    node_flash_cross_2_47.position.copy(endpoint_flash_cross_2_47.start);
    node_flash_cross_2_47.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_cross_2_47.position.set(-1.1639, 0.878, 0.855);
    node_flash_cross_2_47.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_cross_2_47.userData.sculptComponent = {"id": "flash-cross-2", "name": "flash-cross-2", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-2-mount", "localStart": [-1.1639, 0.878, 0.855], "localEnd": [-1.1639, 0.878, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.878, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_2_47.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_cross_2_47);
  nodes["flash-cross-2"] = node_flash_cross_2_47;
  const mesh_flash_cross_2_47Geometry = endpoint_flash_cross_2_47
    ? new THREE.CylinderGeometry(endpoint_flash_cross_2_47.endRadius, endpoint_flash_cross_2_47.baseRadius, endpoint_flash_cross_2_47.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_cross_2_47) {
    mesh_flash_cross_2_47Geometry.scale(0.71, 0.013, 0.018);
  }
  const mesh_flash_cross_2_47 = new THREE.Mesh(
    mesh_flash_cross_2_47Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_cross_2_47.name = "flash-cross-2";
  if (endpoint_flash_cross_2_47) {
    mesh_flash_cross_2_47.position.copy(endpoint_flash_cross_2_47.midpoint);
    mesh_flash_cross_2_47.quaternion.copy(endpoint_flash_cross_2_47.quaternion);
  }
  mesh_flash_cross_2_47.castShadow = options.castShadow ?? true;
  mesh_flash_cross_2_47.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_cross_2_47.userData.sculptComponent = {"id": "flash-cross-2", "name": "flash-cross-2", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-2-mount", "localStart": [-1.1639, 0.878, 0.855], "localEnd": [-1.1639, 0.878, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 0.878, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_2_47.add(mesh_flash_cross_2_47);
  meshes["flash-cross-2"] = mesh_flash_cross_2_47;
  colliders["flash-cross-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-cross-2"] ??= [];
  destructionGroups["flash-cross-2"].push(node_flash_cross_2_47);

  const endpoint_flash_cross_3_48 = makeAttachmentEndpoint(null);
  const node_flash_cross_3_48 = new THREE.Group();
  node_flash_cross_3_48.name = "flash-cross-3__pivot";
  node_flash_cross_3_48.scale.set(1, 1, 1);
  if (endpoint_flash_cross_3_48) {
    node_flash_cross_3_48.position.copy(endpoint_flash_cross_3_48.start);
    node_flash_cross_3_48.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_flash_cross_3_48.position.set(-1.1639, 1.002, 0.855);
    node_flash_cross_3_48.rotation.set(0.0, 0.0, 0.0);
  }
  node_flash_cross_3_48.userData.sculptComponent = {"id": "flash-cross-3", "name": "flash-cross-3", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-3-mount", "localStart": [-1.1639, 1.002, 0.855], "localEnd": [-1.1639, 1.002, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 1.002, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_3_48.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_flash_cross_3_48);
  nodes["flash-cross-3"] = node_flash_cross_3_48;
  const mesh_flash_cross_3_48Geometry = endpoint_flash_cross_3_48
    ? new THREE.CylinderGeometry(endpoint_flash_cross_3_48.endRadius, endpoint_flash_cross_3_48.baseRadius, endpoint_flash_cross_3_48.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_flash_cross_3_48) {
    mesh_flash_cross_3_48Geometry.scale(0.71, 0.013, 0.018);
  }
  const mesh_flash_cross_3_48 = new THREE.Mesh(
    mesh_flash_cross_3_48Geometry,
    materialMap["flash"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_flash_cross_3_48.name = "flash-cross-3";
  if (endpoint_flash_cross_3_48) {
    mesh_flash_cross_3_48.position.copy(endpoint_flash_cross_3_48.midpoint);
    mesh_flash_cross_3_48.quaternion.copy(endpoint_flash_cross_3_48.quaternion);
  }
  mesh_flash_cross_3_48.castShadow = options.castShadow ?? true;
  mesh_flash_cross_3_48.receiveShadow = options.receiveShadow ?? true;
  mesh_flash_cross_3_48.userData.sculptComponent = {"id": "flash-cross-3", "name": "flash-cross-3", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "flash-cross-3-mount", "localStart": [-1.1639, 1.002, 0.855], "localEnd": [-1.1639, 1.002, 0.875], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.71, "height": 0.013, "depth": 0.018, "units": "relative", "confidence": 0.9}, "transform": {"position": [-1.1639, 1.002, 0.855], "rotation": [0, 0, 0], "scale": [0.71, 0.013, 0.018]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "flash-cross-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "flash", "materialLayers": ["flash"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 229, 219, 1)", "secondaryAlbedo": "rgba(232, 229, 219, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_flash_cross_3_48.add(mesh_flash_cross_3_48);
  meshes["flash-cross-3"] = mesh_flash_cross_3_48;
  colliders["flash-cross-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["flash-cross-3"] ??= [];
  destructionGroups["flash-cross-3"].push(node_flash_cross_3_48);

  const endpoint_rear_latch_49 = makeAttachmentEndpoint(null);
  const node_rear_latch_49 = new THREE.Group();
  node_rear_latch_49.name = "rear-latch__pivot";
  node_rear_latch_49.scale.set(1, 1, 1);
  if (endpoint_rear_latch_49) {
    node_rear_latch_49.position.copy(endpoint_rear_latch_49.start);
    node_rear_latch_49.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_latch_49.position.set(1.3899, 0.05, -1.15);
    node_rear_latch_49.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_latch_49.userData.sculptComponent = {"id": "rear-latch", "name": "rear-latch", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "rear-latch-mount", "localStart": [1.3899, 0.05, -1.15], "localEnd": [1.3899, 0.05, -1.13], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.33, "depth": 0.1, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.3899, 0.05, -1.15], "rotation": [0, 0, 0], "scale": [0.16, 0.33, 0.1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-latch", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rear_latch_49.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-latch", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_rear_latch_49);
  nodes["rear-latch"] = node_rear_latch_49;
  const mesh_rear_latch_49Geometry = endpoint_rear_latch_49
    ? new THREE.CylinderGeometry(endpoint_rear_latch_49.endRadius, endpoint_rear_latch_49.baseRadius, endpoint_rear_latch_49.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rear_latch_49) {
    mesh_rear_latch_49Geometry.scale(0.16, 0.33, 0.1);
  }
  const mesh_rear_latch_49 = new THREE.Mesh(
    mesh_rear_latch_49Geometry,
    materialMap["black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_latch_49.name = "rear-latch";
  if (endpoint_rear_latch_49) {
    mesh_rear_latch_49.position.copy(endpoint_rear_latch_49.midpoint);
    mesh_rear_latch_49.quaternion.copy(endpoint_rear_latch_49.quaternion);
  }
  mesh_rear_latch_49.castShadow = options.castShadow ?? true;
  mesh_rear_latch_49.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_latch_49.userData.sculptComponent = {"id": "rear-latch", "name": "rear-latch", "level": "micro", "role": "panel", "importance": 0.75, "confidence": 0.9, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Discrete manufactured rigid surface with defined edges and independent material.", "geometryDescriptor": {"topologyIntent": "closed rigid product part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "rear-latch-mount", "localStart": [1.3899, 0.05, -1.15], "localEnd": [1.3899, 0.05, -1.13], "embedDepth": 0.025, "overlap": 0.025, "contactType": "overlap", "gapTolerance": 0.015, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.33, "depth": 0.1, "units": "relative", "confidence": 0.9}, "transform": {"position": [1.3899, 0.05, -1.15], "rotation": [0, 0, 0], "scale": [0.16, 0.33, 0.1]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-latch", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black", "materialLayers": ["black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "smooth", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface response per material family; no arbitrary weathering."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(16, 19, 24, 1)", "secondaryAlbedo": "rgba(16, 19, 24, 1)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rear_latch_49.add(mesh_rear_latch_49);
  meshes["rear-latch"] = mesh_rear_latch_49;
  colliders["rear-latch"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-latch"] ??= [];
  destructionGroups["rear-latch"].push(node_rear_latch_49);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createInstantCameraLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Instant Camera look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"type": "key light", "position": [-3, 6, 6], "color": "#fff3de", "intensity": 4}, {"type": "fill light", "position": [5, 2, 3], "color": "#dbe6ff", "intensity": 2}, {"type": "rim or environment light", "position": [0, 4, -3], "intensity": 3}, {"exposure": 1, "toneMapping": "ACESFilmic", "background": "#d6d5d2", "contactShadow": "soft floor shadow", "contact shadow": "soft studio ground shadow; broad key, darker under base"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createInstantCameraEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameInstantCameraCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createInstantCameraPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureInstantCameraRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createInstantCameraInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
