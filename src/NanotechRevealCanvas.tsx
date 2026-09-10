import { useEffect, useRef } from "react";
import type { PlaneGeometry, ShaderMaterial, Texture, WebGLRenderer } from "three";

const TRAIL_POINT_COUNT = 16;

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uArmor;
  uniform sampler2D uHuman;
  uniform vec2 uTrail[16];
  uniform float uTrailStrength[16];
  uniform float uTime;
  uniform float uAspect;

  float hash(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  vec4 hexCell(vec2 point) {
    vec2 scale = vec2(1.0, 1.7320508);
    vec4 centers = floor(vec4(point, point - vec2(0.5, 1.0)) / scale.xyxy) + 0.5;
    vec4 offsets = vec4(point - centers.xy * scale, point - (centers.zw + 0.5) * scale);
    return dot(offsets.xy, offsets.xy) < dot(offsets.zw, offsets.zw)
      ? vec4(offsets.xy, centers.xy)
      : vec4(offsets.zw, centers.zw + 0.5);
  }

  float hexDistance(vec2 point) {
    point = abs(point);
    return max(dot(point, normalize(vec2(1.0, 1.7320508))), point.x);
  }

  void main() {
    vec4 armor = texture2D(uArmor, vUv);
    vec4 human = texture2D(uHuman, vUv);

    vec2 hexUv = vec2(vUv.x * uAspect, vUv.y);
    vec4 hex = hexCell(hexUv * 70.0);
    float plateShape = hexDistance(hex.xy);
    float plateId = hash(hex.zw);
    float plateEdge = smoothstep(0.43, 0.49, plateShape);
    float plateDelay = (plateId - 0.5) * 0.032;

    float waveDistance = 10.0;
    float distanceFromOrigin = 0.0;
    vec2 delta = vec2(0.0);

    for (int trailIndex = 0; trailIndex < 16; trailIndex++) {
      vec2 trailDelta = vUv - uTrail[trailIndex];
      trailDelta.x *= uAspect;
      float trailDistance = length(trailDelta);
      float angle = atan(trailDelta.y, trailDelta.x);
      float sectorPosition = (angle + 3.14159265) / 6.2831853 * 14.0;
      float sectorIndex = mod(floor(sectorPosition), 14.0);
      float nextSectorIndex = mod(sectorIndex + 1.0, 14.0);
      float sectorBlend = smoothstep(0.0, 1.0, fract(sectorPosition));
      float trailSeed = float(trailIndex) * 7.13;
      float contourNoise = mix(
        hash(vec2(sectorIndex, 31.7 + trailSeed)),
        hash(vec2(nextSectorIndex, 31.7 + trailSeed)),
        sectorBlend
      );
      float contourMorph = sin(angle * 7.0 + uTime * 0.9 + trailSeed) * 0.008
        + sin(angle * 13.0 - uTime * 0.55 + trailSeed * 0.37) * 0.004;
      float facetedContour = (contourNoise - 0.5) * 0.042 + contourMorph;
      float waveRadius = 0.086 * uTrailStrength[trailIndex];
      float candidateDistance = trailDistance + facetedContour + plateDelay - waveRadius;
      candidateDistance = mix(10.0, candidateDistance, step(0.001, uTrailStrength[trailIndex]));

      if (candidateDistance < waveDistance) {
        waveDistance = candidateDistance;
        distanceFromOrigin = trailDistance;
        delta = trailDelta;
      }
    }

    float revealedPlate = 1.0 - smoothstep(-0.008, 0.012, waveDistance);
    float activeBand = 1.0 - smoothstep(0.010, 0.040, abs(waveDistance));

    vec2 radialDirection = normalize(delta + vec2(0.0001));
    radialDirection.x /= uAspect;
    float lift = activeBand * (0.007 + plateId * 0.009);
    vec2 displacedUv = vUv - radialDirection * lift;
    vec4 liftedArmor = texture2D(uArmor, displacedUv);

    vec4 color = mix(liftedArmor, human, revealedPlate);
    float visibleSurface = max(armor.a, human.a);
    float seamEnergy = plateEdge * activeBand * visibleSurface;
    float plateSpark = step(0.91, hash(hex.zw + 17.3)) * activeBand * visibleSurface;
    float radialPulse = 0.5 + 0.5 * sin(distanceFromOrigin * 150.0 - uTime * 5.2);
    radialPulse = radialPulse * radialPulse * radialPulse;
    float energyLevel = 0.58 + radialPulse * 0.42;
    vec3 goldEnergy = mix(vec3(0.34, 0.20, 0.04), vec3(1.0, 0.80, 0.32), energyLevel);
    color.rgb += goldEnergy * (seamEnergy * (0.58 + radialPulse * 0.52) + plateSpark * (0.28 + radialPulse * 0.62));
    color.a = mix(liftedArmor.a, human.a, revealedPlate);

    gl_FragColor = color;
    #include <colorspace_fragment>
  }
`;

type NanotechRevealCanvasProps = {
  reducedMotion: boolean;
};

export function NanotechRevealCanvas({ reducedMotion }: NanotechRevealCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.closest<HTMLElement>(".identity-reveal-stage");
    if (!canvas || !stage || typeof WebGLRenderingContext === "undefined") return;

    let cancelled = false;
    let frame = 0;
    let renderer: WebGLRenderer | undefined;
    let material: ShaderMaterial | undefined;
    let geometry: PlaneGeometry | undefined;
    let armorTexture: Texture | undefined;
    let humanTexture: Texture | undefined;
    let trailCursor = -1;
    let activeTrail = -1;
    let lastTrailSample = 0;
    let tracking = false;
    let userInteracted = false;
    const trailBirths = Array<number>(TRAIL_POINT_COUNT).fill(Number.NEGATIVE_INFINITY);
    const trailTouches = Array<number>(TRAIL_POINT_COUNT).fill(Number.NEGATIVE_INFINITY);

    const initialize = async () => {
      try {
        const THREE = await import("three");
        if (cancelled) return undefined;
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

        const loader = new THREE.TextureLoader();
        [armorTexture, humanTexture] = await Promise.all([
          loader.loadAsync("/images/generated/android-black-gold-powered-armor-cropped.webp"),
          loader.loadAsync("/images/generated/android-reveal-human-blue-cropped.webp"),
        ]);
        if (cancelled || !renderer) return;

        for (const texture of [armorTexture, humanTexture]) {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
        }

        const trailPositions = Array.from({ length: TRAIL_POINT_COUNT }, () => new THREE.Vector2(-10, -10));
        const trailStrengths = new Float32Array(TRAIL_POINT_COUNT);
        const uniforms = {
          uArmor: { value: armorTexture },
          uHuman: { value: humanTexture },
          uTrail: { value: trailPositions },
          uTrailStrength: { value: trailStrengths },
          uTime: { value: 0 },
          uAspect: { value: 696 / 920 },
        };

        material = new THREE.ShaderMaterial({
          fragmentShader,
          transparent: true,
          uniforms,
          vertexShader,
        });
        geometry = new THREE.PlaneGeometry(2, 2);
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(geometry, material));
        const camera = new THREE.Camera();

        const resize = () => {
          if (!renderer || !material) return;
          const bounds = canvas.getBoundingClientRect();
          renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
          material.uniforms.uAspect.value = bounds.width / Math.max(1, bounds.height);
        };

        const recordTrailPoint = (x: number, y: number, time: number, forceNew = false) => {
          if (activeTrail < 0 || forceNew || time - lastTrailSample >= 150) {
            trailCursor = (trailCursor + 1) % TRAIL_POINT_COUNT;
            activeTrail = trailCursor;
            lastTrailSample = time;
            trailBirths[activeTrail] = time;
          }
          trailPositions[activeTrail].set(x, y);
          trailTouches[activeTrail] = time;
        };

        const move = (event: PointerEvent) => {
          if (!material) return;
          const canvasBounds = canvas.getBoundingClientRect();
          const stageBounds = stage.getBoundingClientRect();
          const stageX = event.clientX - stageBounds.left;
          const insideCanvas = event.clientX >= canvasBounds.left
            && event.clientX <= canvasBounds.right
            && event.clientY >= canvasBounds.top
            && event.clientY <= canvasBounds.bottom;
          const isStackedLayout = window.matchMedia("(max-width: 1160px)").matches;
          if (insideCanvas && (isStackedLayout || stageX > stageBounds.width * 0.47)) {
            const startedTracking = !tracking;
            tracking = true;
            recordTrailPoint(
              (event.clientX - canvasBounds.left) / canvasBounds.width,
              1 - (event.clientY - canvasBounds.top) / canvasBounds.height,
              event.timeStamp,
              startedTracking,
            );
          } else {
            tracking = false;
            activeTrail = -1;
          }
        };

        const close = () => {
          tracking = false;
          activeTrail = -1;
        };
        const startTouch = (event: PointerEvent) => {
          if (event.pointerType === "mouse") return;
          userInteracted = true;
          move(event);
        };
        const endTouch = (event: PointerEvent) => {
          if (event.pointerType !== "mouse") close();
        };
        const focus = (event: FocusEvent) => {
          tracking = true;
          trailCursor = (trailCursor + 1) % TRAIL_POINT_COUNT;
          activeTrail = trailCursor;
          lastTrailSample = event.timeStamp;
          trailBirths[activeTrail] = event.timeStamp;
          trailTouches[activeTrail] = event.timeStamp;
          trailPositions[activeTrail].set(0.78, 0.55);
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();

        const previewTimers: number[] = [];
        let previewObserver: IntersectionObserver | undefined;
        const isTouchFirst = window.matchMedia("(hover: none), (pointer: coarse)").matches;
        if (isTouchFirst && !reducedMotion && typeof IntersectionObserver !== "undefined") {
          previewObserver = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting) || userInteracted) return;
            previewObserver?.disconnect();
            const previewPath = [
              [0.67, 0.34],
              [0.72, 0.39],
              [0.78, 0.45],
              [0.83, 0.51],
              [0.79, 0.58],
            ] as const;
            previewPath.forEach(([x, y], index) => {
              previewTimers.push(window.setTimeout(() => {
                if (userInteracted) return;
                const now = window.performance.now();
                recordTrailPoint(x, y, now, true);
                tracking = false;
                activeTrail = -1;
              }, 180 + index * 170));
            });
          }, { threshold: 0.45 });
          previewObserver.observe(stage);
        }

        const render = (time: number) => {
          if (!renderer || !material) return;
          if (tracking && activeTrail >= 0) trailTouches[activeTrail] = time;
          for (let trailIndex = 0; trailIndex < TRAIL_POINT_COUNT; trailIndex += 1) {
            if (reducedMotion) {
              trailStrengths[trailIndex] = tracking && trailIndex === activeTrail ? 1 : 0;
              continue;
            }
            const growth = Math.min(1, Math.max(0, (time - trailBirths[trailIndex]) / 220));
            const idleTime = time - trailTouches[trailIndex];
            const recovery = idleTime <= 1900 ? 1 : Math.max(0, 1 - (idleTime - 1900) / 700);
            trailStrengths[trailIndex] = growth * recovery;
          }
          if (!reducedMotion) material.uniforms.uTime.value = time / 1000;
          renderer.render(scene, camera);
          frame = requestAnimationFrame(render);
        };

        stage.addEventListener("pointermove", move);
        stage.addEventListener("pointerdown", startTouch);
        stage.addEventListener("pointerup", endTouch);
        stage.addEventListener("pointercancel", endTouch);
        stage.addEventListener("pointerleave", close);
        stage.addEventListener("focus", focus);
        stage.addEventListener("blur", close);
        stage.classList.add("has-webgl-reveal");
        frame = requestAnimationFrame(render);

        return () => {
          resizeObserver.disconnect();
          previewObserver?.disconnect();
          previewTimers.forEach((timer) => window.clearTimeout(timer));
          stage.removeEventListener("pointermove", move);
          stage.removeEventListener("pointerdown", startTouch);
          stage.removeEventListener("pointerup", endTouch);
          stage.removeEventListener("pointercancel", endTouch);
          stage.removeEventListener("pointerleave", close);
          stage.removeEventListener("focus", focus);
          stage.removeEventListener("blur", close);
        };
      } catch {
        return undefined;
      }
    };

    let removeListeners: (() => void) | undefined;
    void initialize().then((cleanup) => {
      if (cancelled) cleanup?.();
      else removeListeners = cleanup;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      removeListeners?.();
      stage.classList.remove("has-webgl-reveal");
      geometry?.dispose();
      material?.dispose();
      armorTexture?.dispose();
      humanTexture?.dispose();
      renderer?.dispose();
    };
  }, [reducedMotion]);

  return <canvas className="identity-webgl-layer" ref={canvasRef} aria-hidden="true" />;
}
