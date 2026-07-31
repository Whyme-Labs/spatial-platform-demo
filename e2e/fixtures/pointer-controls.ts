import * as THREE from "three";
import { createSpatialLookControls } from "../../src/renderer/look-controls";

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
controls.align(camera);
const fixtureParameters = new URL(location.href).searchParams;
const requestedBoundary = fixtureParameters.get("boundary");
if (requestedBoundary) {
  const padding = new THREE.Vector3(0.2, 0.2, 0.2);
  const boundary = {
    min: camera.position.clone().sub(padding),
    max: camera.position.clone().add(padding),
  };
  if (requestedBoundary === "flat-floor") {
    boundary.min.y = camera.position.y - 1.6;
    boundary.max.y = boundary.min.y;
  }
  controls.setNavigationBounds([boundary]);
  document.body.dataset.navigationBounds = JSON.stringify({
    min: boundary.min.toArray(),
    max: boundary.max.toArray(),
  });
}
if (fixtureParameters.get("translation") === "disabled") {
  controls.setTranslationEnabled(false);
}

function cameraState(): {
  position: number[];
  direction: number[];
  up: number[];
  right: number[];
} {
  return {
    position: camera.position.toArray(),
    direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray(),
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).toArray(),
  };
}

function updateProbe(): void {
  controls.update(camera, 1 / 60);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const delta = direction.sub(initialDirection);
  document.body.dataset.lookProbe = JSON.stringify({
    up: delta.dot(screenUp),
    right: delta.dot(screenRight),
  });
  document.body.dataset.cameraState = JSON.stringify(cameraState());
  requestAnimationFrame(updateProbe);
}

document.body.dataset.lookProbe = JSON.stringify({ up: 0, right: 0 });
document.body.dataset.cameraState = JSON.stringify(cameraState());
requestAnimationFrame(updateProbe);
