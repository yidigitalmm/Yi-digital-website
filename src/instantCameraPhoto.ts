import * as THREE from "three";

export function createInstantPhoto(onLoad: () => void, onError: () => void) {
  const group = new THREE.Group();
  group.name = "instant-print";
  group.visible = false;
  const paper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.3, .025), new THREE.MeshStandardMaterial({ color: "#fff8e8", roughness: .82 }));
  paper.name = "print-paper"; paper.castShadow = true;
  group.add(paper);
  let disposed = false;
  const texture = new THREE.TextureLoader().load("/images/generated/cafe-counter.webp", loaded => {
    if (disposed) { loaded.dispose(); return; }
    const ratio = loaded.image.width / loaded.image.height;
    if (ratio > 1) { loaded.repeat.x = 1 / ratio; loaded.offset.x = (1 - loaded.repeat.x) / 2; }
    else { loaded.repeat.y = ratio; loaded.offset.y = (1 - ratio) / 2; }
    onLoad();
  }, undefined, () => { if (!disposed) onError(); });
  texture.colorSpace = THREE.SRGBColorSpace;
  const imageMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, toneMapped: false });
  const blank = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 1.65), new THREE.MeshBasicMaterial({ color: "#302f2b", toneMapped: false }));
  blank.position.set(0, .17, .014); blank.name = "undeveloped-print";
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 1.65), imageMaterial);
  picture.position.set(0, .17, .016); picture.name = "developed-print";
  group.add(blank, picture);
  const smooth = (t: number) => THREE.MathUtils.smoothstep(t, 0, 1);
  return {
    group,
    pose(seconds: number) {
      group.visible = true;
      const eject = smooth((seconds - .2) / 1.8);
      const lift = smooth((seconds - 2) / 1.2);
      group.position.set(1.1 * lift, -1.02 + 1.12 * lift, -.1 + 2.85 * eject);
      group.rotation.set(-Math.PI / 2 + (Math.PI / 2 - .1) * lift, -.12 * lift, -.08 * lift);
      imageMaterial.opacity = smooth((seconds - 2.1) / 2.1);
    },
    dispose() { disposed = true; texture.dispose(); },
  };
}
