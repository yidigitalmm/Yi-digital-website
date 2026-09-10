import * as THREE from "three";
import type { ProceduralModelRuntime } from "./createInstantCameraModel";

/** Integral optical surfaces travel with their named, selectable parent assembly. */
export function addInstantCameraDetails(runtime: ProceduralModelRuntime) {
  const integral = (part: string, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.position.z = z;
    mesh.userData.partId = part; mesh.userData.integral = true;
    runtime.nodes[part].add(mesh);
    return mesh;
  };
  const interior = new THREE.MeshBasicMaterial({color:"#030508"});
  const blades = new THREE.MeshStandardMaterial({color:"#15191d",metalness:.2,roughness:.44});
  integral("lens-glass","optical-chamber",new THREE.CircleGeometry(.252,64),interior,-.105);
  integral("lens-glass","six-blade-aperture",new THREE.RingGeometry(.075,.24,6),blades,-.09).rotation.z = .18;
  const marks = new THREE.MeshStandardMaterial({color:"#090b10",roughness:.72});
  for (let i=0;i<6;i++) {
    const g = new THREE.PlaneGeometry(.003,.15);
    const line = integral("lens-glass",`aperture-seam-${i}`,g,marks,-.088);
    const a=i*Math.PI/3+.18;
    line.position.x=Math.sin(a)*.16; line.position.y=Math.cos(a)*.16; line.rotation.z=-a+.42;
  }
  integral("finder-glass","viewfinder-interior",new THREE.PlaneGeometry(.45,.43),interior,-.023);
  const finderElement = new THREE.MeshPhysicalMaterial({color:"#26353d",roughness:.12,metalness:.15,clearcoat:1,envMapIntensity:1.5});
  const finderLens = integral("finder-glass","viewfinder-element",new THREE.SphereGeometry(.16,32,16),finderElement,-.02);
  finderLens.scale.set(1.1,.9,.13);

  const canvas=document.createElement("canvas"); canvas.width=canvas.height=1024;
  const ctx=canvas.getContext("2d")!;
  ctx.translate(512,512); ctx.fillStyle="#adafa8"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.font="500 20px Arial";
  const label="I N S T A N T   O P T I C S";
  for(let i=0;i<label.length;i++) {
    ctx.save();ctx.rotate((i-(label.length-1)/2)*.04);ctx.fillText(label[i],0,-295);ctx.restore();
  }
  ctx.fillStyle="#777d80";
  for(let i=0;i<13;i++) {ctx.save();ctx.rotate(Math.PI+(i-6)*.055);ctx.fillRect(-1,289,2,i%3===0?10:5);ctx.restore();}
  const ink=new THREE.CanvasTexture(canvas); ink.colorSpace=THREE.SRGBColorSpace; ink.anisotropy=4;
  const material=new THREE.MeshBasicMaterial({map:ink,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,toneMapped:false});
  // The barrel's +Y axis maps to +Z; the engraving plane is placed in the unrotated glass group.
  integral("lens-glass","lens-engraving",new THREE.PlaneGeometry(1.22,1.22),material,.027);
}
