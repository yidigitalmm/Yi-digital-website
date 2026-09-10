import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createInstantCameraModel, type ProceduralModelRuntime } from "./createInstantCameraModel";

import { refineInstantCameraMaterials } from "./instantCameraMaterials";
import { refineInstantCameraForm } from "./instantCameraForm";

import { addInstantCameraDetails } from "./instantCameraDetails";
import { createInstantPhoto } from "./instantCameraPhoto";

type Options = {
  reducedMotion: boolean;
  onStatus: (status: "idle" | "developing" | "ready" | "error") => void;
  onPhoto: () => void;
  onExplore: (exploded: boolean) => void;
  onPart: (name: string) => void;
};

export function mountInstantCamera(host: HTMLDivElement, options: Options) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: import.meta.env.DEV });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .65;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, .1, 60);
  camera.position.set(4.2, 2.6, 12.2);
  const controls = new OrbitControls(camera, host);
  controls.target.set(0, -.1, 0);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = false;
  controls.minPolarAngle = .4;
  controls.maxPolarAngle = Math.PI * .74;
  controls.rotateSpeed = .7;
  controls.update();
  // Keep touch drags in the viewer so OrbitControls can rotate on both axes.
  host.style.touchAction = "none";
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentRoom = new RoomEnvironment();
  // Large studio softboxes give the curved glass and bevels coherent moving reflections.
  for (const [x,y,z,w,h,power] of [[-3.5,3,4,2.2,3.5,2.4],[4,1,2,1,3,1.3]]) {
    const softbox = new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(power,power,power)}));
    softbox.position.set(x,y,z);softbox.lookAt(0,.3,0);environmentRoom.add(softbox);
  }
  const environment = pmrem.fromScene(environmentRoom, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .6;
  environmentRoom.dispose();
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff3df, 3.7);
  key.position.set(-3, 6, 5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 9; key.shadow.blurSamples = 12; key.shadow.camera.near = .5; key.shadow.camera.far = 18; key.shadow.camera.left = -5; key.shadow.camera.right = 5;
  key.shadow.camera.top = 5; key.shadow.camera.bottom = -5; key.shadow.normalBias = .006;
  const fill = new THREE.DirectionalLight(0xdce9ff, 1.4); fill.position.set(5, 2, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 2); rim.position.set(0, 5, -4);
  scene.add(key, fill, rim);
  const model = createInstantCameraModel({ referenceTextures: false, qualityPriority: "balanced" });
  scene.add(model);
  const runtime = model.userData.sculptRuntime as ProceduralModelRuntime;
  refineInstantCameraForm(runtime);
  const unusedTextures = refineInstantCameraMaterials(runtime);
  addInstantCameraDetails(runtime);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .14 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.342; floor.receiveShadow = true; floor.name = "presentation-ground";
  scene.add(floor);
  let disposed = false;
  let raf = 0;
  let visible = true;
  let busy = false, ready = false, exploded = false, photoLoaded = false, photoFailed = false;
  const print = createInstantPhoto(() => { photoLoaded = true; render(); }, () => { photoFailed = true; busy = false; controls.enabled = true; options.onStatus("error"); });
  scene.add(print.group);
  const flash = new THREE.PointLight(0xffffff, 0, 5); flash.position.set(-1.15, .85, 1.5); scene.add(flash);
  const shutter = runtime.nodes["shutter-button"];
  const shutterZ = shutter.position.z;
  const origins = new Map(Object.entries(runtime.nodes).map(([id, node]) => [id, node.position.clone()]));
  const render = () => { if (!disposed && visible) renderer.render(scene, camera); };
  controls.addEventListener("change", render);
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix(); renderer.setSize(width, height); render();
  };
  const observer = new ResizeObserver(resize); observer.observe(host);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) render(); });
  visibility.observe(host);
  const frameCamera = () => {
    camera.fov = 28; camera.position.set(4.2, 2.6, 12.2);
    if (camera.aspect < .9) camera.position.multiplyScalar(1.15);
    controls.target.set(0, -.1, 0); camera.updateProjectionMatrix(); controls.update();
  };
  const assemble = () => {
    for (const [id, node] of Object.entries(runtime.nodes)) node.position.copy(origins.get(id)!);
    exploded = false; options.onExplore(false); options.onPart("");
  };
  const reset = () => {
    cancelAnimationFrame(raf); busy = false; ready = false; controls.enabled = true;
    print.group.visible = false; flash.intensity = 0; assemble(); frameCamera();
    options.onStatus(photoFailed ? "error" : "idle"); render();
  };
  const shoot = () => {
    if (busy || disposed || photoFailed) return;
    assemble(); frameCamera(); busy = true; ready = false; controls.enabled = false;
    options.onStatus("developing"); print.group.visible = false;
    let elapsed = 0, previous = performance.now();
    const tick = (now: number) => {
      if (disposed) return;
      const dt = Math.min((now - previous) / 1000, .1); previous = now;
      if (visible && !document.hidden && photoLoaded) elapsed += dt;
      if (options.reducedMotion && photoLoaded) elapsed = 4.5;
      shutter.position.z = shutterZ - (elapsed < .2 ? .035 * Math.sin(elapsed / .2 * Math.PI) : 0);
      flash.intensity = !options.reducedMotion && elapsed > .08 && elapsed < .16 ? 8 : 0;
      if (elapsed > .2) print.pose(elapsed);
      render();
      if (elapsed >= 4.5) {
        busy = false; ready = true; controls.enabled = true; flash.intensity = 0;
        options.onStatus("ready"); render();
      } else if (!photoFailed) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const explore = () => {
    if (busy) return;
    if (exploded) { assemble(); render(); return; }
    print.group.visible = false; ready = false; options.onStatus("idle");
    for (const [id, node] of Object.entries(runtime.nodes)) {
      if (id === "root") continue;
      let offset: [number, number, number];
      if (id.startsWith("lens-")) offset = [0, .1, 1.15];
      else if (id.startsWith("flash-")) offset = [-.65, .35, .3];
      else if (id.startsWith("finder-") || id === "sensor") offset = [.65, .2, .3];
      else if (id.startsWith("shutter-")) offset = [-.6, 0, .75];
      else if (id === "cream-shell" || id.startsWith("stripe-") || id === "top-plate") offset = [0, .7, 0];
      else if (id.startsWith("rear-")) offset = [0, 0, -.7];
      else offset = [0, -.45, 0];
      node.position.copy(origins.get(id)!).add(new THREE.Vector3(...offset));
    }
    exploded = true; options.onExplore(true); render();
  };
  const raycaster = new THREE.Raycaster();
  let pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
  const pointerdown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const pointermove = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 6) pointer.moved = true;

  };
  const pointerup = (event: PointerEvent) => {
    const click = pointer && pointer.id === event.pointerId && !pointer.moved; pointer = null;
    if (!click || busy) return;
    const rect = host.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hits = raycaster.intersectObjects([model, ...(ready ? [print.group] : [])], true).filter(hit => hit.object.visible);
    const hit = hits[0]?.object;
    if (!hit) return;
    if (hit.parent === print.group) { options.onPhoto(); return; }
    const id = hit.userData.partId as string | undefined ?? Object.entries(runtime.meshes).find(([, mesh]) => mesh === hit)?.[0];
    if (id?.startsWith("shutter-") && !exploded) shoot();
    else if (id) options.onPart(id.replace(/-\d+$/, "").replace(/-/g, " "));
  };
  const pointercancel = () => { pointer = null; };
  host.addEventListener("pointerdown", pointerdown); host.addEventListener("pointermove", pointermove);
  host.addEventListener("pointerup", pointerup); host.addEventListener("pointercancel", pointercancel);
  const keydown = (event: KeyboardEvent) => {
    if (busy) return;
    const movement = { ArrowLeft: -.15, ArrowRight: .15, ArrowUp: -.12, ArrowDown: .12 }[event.key];
    if (movement === undefined) return;
    event.preventDefault();
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") spherical.theta += movement;
    else spherical.phi = THREE.MathUtils.clamp(spherical.phi + movement, .4, Math.PI * .74);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical)); controls.update(); render();
  };
  host.addEventListener("keydown", keydown);
  const contextLost = (event: Event) => { event.preventDefault(); photoFailed = true; cancelAnimationFrame(raf); controls.enabled = false; options.onStatus("error"); };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  resize(); frameCamera(); render(); options.onStatus("idle");
  if (import.meta.env.DEV) {
    (window as unknown as { __instantCameraReview: unknown }).__instantCameraReview = {
      model, scene, camera, renderer, runtime,
      view: (azimuth: number, elevation = 14, r = 7.5, fov = 36, targetY = -.4) => {
        camera.fov = fov; camera.updateProjectionMatrix();
        const a = THREE.MathUtils.degToRad(azimuth), e = THREE.MathUtils.degToRad(elevation);
        controls.target.set(0, targetY, 0);
        camera.position.set(r * Math.sin(a) * Math.cos(e), r * Math.sin(e), r * Math.cos(a) * Math.cos(e));
        controls.update(); render();
      },
      render, shoot, explore, reset,
    };
  }
  return {
    shoot, explore,
    reset,
    dispose: () => {
      disposed = true; print.dispose(); cancelAnimationFrame(raf); observer.disconnect(); visibility.disconnect(); controls.dispose();
      host.removeEventListener("pointerdown", pointerdown); host.removeEventListener("pointermove", pointermove);
      host.removeEventListener("pointerup", pointerup); host.removeEventListener("pointercancel", pointercancel);
      host.removeEventListener("keydown", keydown); renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()); unusedTextures.forEach(texture => texture.dispose());
      key.shadow.dispose(); environment.dispose(); renderer.dispose(); renderer.domElement.remove();
      if (import.meta.env.DEV) delete (window as unknown as { __instantCameraReview?: unknown }).__instantCameraReview;
    },
  };
}
