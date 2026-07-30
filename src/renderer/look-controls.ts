import { SparkControls } from "@sparkjsdev/spark";
import * as THREE from "three";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SCREEN_UP = new THREE.Vector3();

export function createSpatialLookControls(canvas: HTMLCanvasElement): SparkControls {
  const controls = new SparkControls({ canvas });
  controls.fpsMovement.moveSpeed = 1.4;
  controls.fpsMovement.shiftMultiplier = 3;
  controls.pointerControls.scrollSpeed = 0.8;
  controls.pointerControls.moveInertia = 0.82;
  controls.pointerControls.rotateInertia = 0.78;
  return controls;
}

/**
 * Spark's pointer controller applies deltas through world-Y Euler angles. For
 * imported poses whose visible screen-up points into the world-down hemisphere,
 * its default signs invert both horizontal and vertical look gestures.
 */
export function alignPointerLookToScreen(
  controls: SparkControls,
  camera: THREE.PerspectiveCamera,
): void {
  SCREEN_UP.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  controls.pointerControls.reverseRotate = SCREEN_UP.dot(WORLD_UP) < 0;
}
