import * as THREE from "three";
import type { ProceduralModelRuntime } from "./createInstantCameraModel";

export function refineInstantCameraMaterials(runtime: ProceduralModelRuntime) {
  const size = 1024;
  const normalData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);
  let seed = 173;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const gridSize = 128;
  const cells = Float32Array.from({length:gridSize*gridSize}, noise);
  const heights = new Float32Array(size*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const gx=x/8, gy=y/8, ix=Math.floor(gx), iy=Math.floor(gy), u=gx-ix, v=gy-iy;
    const at=(dx:number,dy:number)=>cells[((iy+dy)%gridSize)*gridSize+(ix+dx)%gridSize];
    const h=THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(0,0),at(1,0),u),THREE.MathUtils.lerp(at(0,1),at(1,1),u),v);
    heights[y*size+x]=h*.82+noise()*.18;
  }
  const normalVector = new THREE.Vector3();
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const i=y*size+x;
    const dx=(heights[y*size+(x+1)%size]-heights[y*size+(x+size-1)%size])*2.3;
    const dy=(heights[((y+1)%size)*size+x]-heights[((y+size-1)%size)*size+x])*2.3;
    const n=normalVector.set(-dx,-dy,1).normalize();
    normalData.set([(n.x*.5+.5)*255,(n.y*.5+.5)*255,(n.z*.5+.5)*255,255],i*4);
    const r=215+noise()*40;
    roughData.set([r,r,r,255],i*4);
  }
  const normal = new THREE.DataTexture(normalData, size, size);
  const roughness = new THREE.DataTexture(roughData, size, size);
  for (const texture of [normal, roughness]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  const unusedTextures = new Set<THREE.Texture>();
  const materials = new Set<THREE.MeshPhysicalMaterial>();
  for (const mesh of Object.values(runtime.meshes)) materials.add(mesh.material as THREE.MeshPhysicalMaterial);
  for (const material of materials) {
    const spec = material.userData.sculptMaterial;
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) unusedTextures.add(value);
    material.map = null; material.roughnessMap = null; material.normalMap = null;
    material.aoMap = null; material.bumpMap = null; material.displacementMap = null;
    material.color.set(spec.baseColor);
    material.roughness = spec.id === "cream" ? .46 : spec.id === "charcoal" ? .64 : spec.roughness.base;
    material.envMapIntensity = .7;
    if (spec.id === "glass") {
      material.color.set("#506274"); material.roughness = .055; material.metalness = 0;
      material.transmission = 0; material.thickness = 0; material.transparent = true; material.opacity = .22; material.depthWrite = false; material.ior = 1.52;
      material.attenuationColor.set("#5d678e"); material.attenuationDistance = .4;
      material.clearcoat = 1; material.clearcoatRoughness = .06;
      material.iridescence = .15; material.iridescenceIOR = 1.35; material.iridescenceThicknessRange = [180, 340];
      material.envMapIntensity = 1.5;
    }
    if (spec.id === "black") { material.roughness = .60; material.metalness = .04; }
    if (spec.id === "red") { material.color.set("#b82920"); material.roughness=.34; material.clearcoat = .5; material.clearcoatRoughness = .2; }
    if (spec.id === "flash") { material.color.set("#d7dddc"); material.roughness = .15; material.metalness = .12; material.clearcoat=1; material.clearcoatRoughness=.09; }
    if (spec.id === "orange") material.color.set("#df5f08");
    if (spec.id === "yellow") material.color.set("#e4a218");
    if (["cream", "charcoal", "black"].includes(spec.id)) {
      material.normalMap = normal; material.normalScale.setScalar(spec.id === "cream" ? .20 : spec.id === "charcoal" ? .40 : .045);
      material.roughnessMap = roughness;
    }
    material.needsUpdate = true;
  }
  const originalFlash = runtime.meshes["flash-panel"].material as THREE.MeshPhysicalMaterial;
  const flashPanel = originalFlash.clone();
  flashPanel.color.set("#bfc5c8"); flashPanel.metalness=.82; flashPanel.roughness=.22;
  runtime.meshes["flash-panel"].material=flashPanel;
  const prisms = new THREE.MeshPhysicalMaterial({color:"#d9e0e1",roughness:.12,metalness:.08,clearcoat:1,clearcoatRoughness:.08,transparent:true,opacity:.66,depthWrite:false});
  for(const [id,mesh] of Object.entries(runtime.meshes)) {
    if(id.startsWith("flash-rib-") || id.startsWith("flash-cross-"))mesh.material=prisms;
  }
  if (!Object.values(runtime.meshes).some(mesh => mesh.material === originalFlash)) originalFlash.dispose();
  return unusedTextures;
}
