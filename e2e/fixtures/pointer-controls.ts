import * as THREE from "three";
import {
  alignPointerLookToScreen,
  createSpatialLookControls,
} from "../../src/renderer/look-controls";

const canvas = document.querySelector<HTMLCanvasElement>("#controlCanvas");
if (!canvas) throw new Error("Missing pointer-control canvas");

const camera = new THREE.PerspectiveCamera();
const conventionalUp = new URL(location.href).searchParams.get("orientation") === "world-up";
if (conventionalUp) {
  camera.position.set(0, 0, 1);
  camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3(0, 0, 0));
} else {
  camera.position.set(
    3.1404339644832393,
    0.18188197960280994,
    -3.563482533678277,
  );
  camera.up.set(
    -0.01146267728441226,
    -0.8718824481262268,
    -0.4895810491419074,
  ).normalize();
  camera.lookAt(new THREE.Vector3(
    3.0776369997372894,
    -0.3061370888964205,
    -2.6929114969444337,
  ));
}

const initialQuaternion = camera.quaternion.clone();
const initialDirection = camera.getWorldDirection(new THREE.Vector3());
const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(initialQuaternion);
const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(initialQuaternion);
const controls = createSpatialLookControls(canvas);
alignPointerLookToScreen(controls, camera);

function updateProbe(): void {
  controls.update(camera);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const delta = direction.sub(initialDirection);
  document.body.dataset.lookProbe = JSON.stringify({
    up: delta.dot(screenUp),
    right: delta.dot(screenRight),
  });
  requestAnimationFrame(updateProbe);
}

document.body.dataset.lookProbe = JSON.stringify({ up: 0, right: 0 });
requestAnimationFrame(updateProbe);
