import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ProceduralModelRuntime } from "./createInstantCameraModel";

function roundedRectangle(w: number, h: number, r: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return shape;
}

export function refineInstantCameraForm(runtime: ProceduralModelRuntime) {
  for (const [id, mesh] of Object.entries(runtime.meshes)) {
    const component = mesh.parent?.userData.sculptComponent;
    if (!component || id === "root") { if (id === "root") mesh.visible = false; continue; }
    let geometry: THREE.BufferGeometry | undefined;
    if (component.primitive === "box") {
      const { width, height, depth } = component.dimensions;
      geometry = new RoundedBoxGeometry(width, height, depth, 3, Math.min(.075, width * .12, height * .12, depth * .3));
    }
    if (component.primitive === "extrude") {
      let points = component.geometryDescriptor.profile2D.points as number[][];
      const stripe = id.startsWith("stripe-");
      if (stripe) points = [[-.698,.12],[-.698,.011],[-1.328,-.389],[-1.328,-.72],[-1.334,-.72],[-1.334,-.385],[-.704,.014],[-.704,.12]];
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
      geometry = new THREE.ExtrudeGeometry(shape, { depth: component.geometryDescriptor.profile2D.depth, steps: 1, bevelEnabled: !stripe, bevelSize: .055, bevelThickness: .085, bevelSegments: 5, curveSegments: 10 });
    }
    if (id === "film-base") {
      const { width, height, depth } = component.dimensions;
      const shape = roundedRectangle(width - .12, height - .09, .12);
      const hole = new THREE.Path(roundedRectangle(3.06, .20, .045).getPoints(12));
      shape.holes.push(hole);
      geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - .08, bevelEnabled: true, bevelSize: .025, bevelThickness: .04, bevelSegments: 4, curveSegments: 16 });
      geometry.translate(0, 0, -(depth - .08) / 2);
    }
    if (id === "film-slot") {
      // Dark interior backing sits behind the physical opening; the print passes in front of it.
      mesh.parent!.position.z = 1.16;
    }
    if (id === "lens-seat" || id === "shutter-button" || id === "shutter-trim") {
      const { baseRadius, endRadius, localStart, localEnd } = component.attachment;
      geometry = new THREE.CylinderGeometry(endRadius, baseRadius, Math.abs(localEnd[2] - localStart[2]), 64, 1);
    }
    if (id === "lens-barrel") {
      geometry = new THREE.LatheGeometry([[.63,0],[.67,.025],[.68,.055],[.68,.115],[.67,.15],[.645,.18],[.63,.26],[.615,.285],[.615,.32],[.60,.34],[.305,.34],[.285,.32],[.27,.27],[.255,.14],[.255,0],[.63,0]].map(([x,y]) => new THREE.Vector2(x,y)), 80);
    }
    if (component.primitive === "torus") {
      mesh.parent!.position.z = 1.098;
      const width = component.dimensions.width;
      geometry = new THREE.TorusGeometry(.45 * width, .0045, 6, 96);
    }
    if (id === "shutter-button" || id === "shutter-trim") {
      const radius = component.attachment.baseRadius;
      const h = id === "shutter-button" ? .045 : .035;
      // The existing cylinder pivot is rotated onto +Z; retain its attachment and travel axis.
      geometry = new THREE.LatheGeometry([[0,-h/2],[radius-.014,-h/2],[radius,-h/2+.01],[radius,h/2-.01],[radius-.012,h/2],[0,h/2+.003]].map(([x,y])=>new THREE.Vector2(x,y)),64);
      mesh.parent!.position.z = id === "shutter-button" ? .709 : .663;
      mesh.parent!.position.y = .23;
    }
    if (id === "finder-frame" || id === "flash-frame") {
      const { width, height, depth } = component.dimensions;
      const shape = roundedRectangle(width-.035, height-.035, .055);
      shape.holes.push(new THREE.Path(roundedRectangle(width-.14,height-.14,.035).getPoints(12)));
      geometry = new THREE.ExtrudeGeometry(shape,{depth:depth-.025,bevelEnabled:true,bevelSize:.012,bevelThickness:.012,bevelSegments:3,curveSegments:12});
      geometry.translate(0,0,-(depth-.025)/2);
    }
    if (id === "finder-glass") {
      mesh.parent!.position.z = .736;
      geometry = new RoundedBoxGeometry(.48,.46,.035,4,.015);
    }
    if (id === "flash-panel") mesh.parent!.position.z = .742;
    if (id.startsWith("flash-rib-") || id.startsWith("flash-cross-")) mesh.parent!.position.z -= .045;
    if (id === "lens-glass") {
      geometry = new THREE.SphereGeometry(.265,64,32);
      geometry.scale(1,1,.17);
      mesh.parent!.position.z = 1.072;
    }
    if (geometry) {
      if (geometry instanceof THREE.ExtrudeGeometry) {
        const smooth = toCreasedNormals(geometry,Math.PI/3); geometry.dispose(); geometry = smooth;
      }
      mesh.geometry.dispose(); mesh.geometry = geometry;
    }
    if (component.level === "micro" || id.startsWith("stripe-")) mesh.userData.explodeWithParent = true;
    if (id.endsWith("glass") || id.startsWith("flash-rib-") || id.startsWith("flash-cross-")) mesh.receiveShadow = false;
    mesh.castShadow = !id.startsWith("stripe-") && !id.endsWith("glass") && !id.startsWith("flash-rib-") && !id.startsWith("flash-cross-");
  }
}
