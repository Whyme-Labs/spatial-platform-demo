import * as THREE from "three";
import type { Vector3Tuple } from "../shared/navigation-runtime";
import { isCaptureQualifiedTraversalEvidenceReceipt } from "../shared/traversal-evidence";
import type {
  AuthoredTraversalFrame,
  AuthoredTraversalKind,
  AuthoredTraversalLink,
} from "./authored-traversal";

export type AuthoredTraversalOverlayState = {
  connectionId: string;
  traversalKind: AuthoredTraversalKind;
  label: string;
  adapter: string;
  manifestSha256: string;
  reviewGeneration: number;
  radius: number;
  path: Vector3Tuple[];
  markerPosition: Vector3Tuple;
};

export function authoredTraversalOverlayState(
  links: readonly AuthoredTraversalLink[],
  eyeHeight: number,
  frame: AuthoredTraversalFrame | null,
): AuthoredTraversalOverlayState | null {
  if (!frame || frame.phase === "completed") return null;
  const link = links.find((candidate) => candidate.id === frame.connectionId);
  if (!link ||
    !isCaptureQualifiedTraversalEvidenceReceipt(link.evidenceReceipt) ||
    !isCaptureQualifiedTraversalEvidenceReceipt(frame.evidenceReceipt)) return null;
  if (
    link.evidenceReceipt.manifestId !== frame.evidenceReceipt.manifestId ||
    link.evidenceReceipt.manifestSha256 !== frame.evidenceReceipt.manifestSha256 ||
    link.evidenceReceipt.adapter !== frame.evidenceReceipt.adapter ||
    link.evidenceReceipt.reviewGeneration !== frame.evidenceReceipt.reviewGeneration
  ) return null;
  return {
    connectionId: link.id,
    traversalKind: link.traversalKind,
    label: link.label,
    adapter: link.evidenceReceipt.adapter!,
    manifestSha256: link.evidenceReceipt.manifestSha256!,
    reviewGeneration: link.evidenceReceipt.reviewGeneration!,
    radius: link.radius,
    path: [
      [...link.startPosition],
      ...link.controlPoints.map((point) => [...point] as Vector3Tuple),
      [...link.endPosition],
    ],
    markerPosition: [
      frame.position[0],
      frame.position[1] - eyeHeight,
      frame.position[2],
    ],
  };
}

/**
 * Draws a navigation overlay, not scene geometry. The line and marker appear
 * only while an evidence-linked traversal owns camera movement.
 */
export class AuthoredTraversalOverlay {
  readonly #scene: THREE.Scene;
  readonly #links: readonly AuthoredTraversalLink[];
  readonly #eyeHeight: number;
  readonly #group = new THREE.Group();
  readonly #pathGeometry = new THREE.BufferGeometry();
  readonly #pathMaterial = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 0.82,
    depthTest: false,
    depthWrite: false,
  });
  readonly #markerGeometry = new THREE.BoxGeometry();
  readonly #markerMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    wireframe: true,
  });
  readonly #path = new THREE.Line(this.#pathGeometry, this.#pathMaterial);
  readonly #marker = new THREE.Mesh(this.#markerGeometry, this.#markerMaterial);
  #connectionId: string | null = null;

  constructor(
    scene: THREE.Scene,
    links: readonly AuthoredTraversalLink[],
    eyeHeight: number,
  ) {
    this.#scene = scene;
    this.#links = links;
    this.#eyeHeight = eyeHeight;
    this.#path.renderOrder = 1;
    this.#marker.renderOrder = 1;
    this.#group.add(this.#path, this.#marker);
    this.#group.visible = false;
    this.#scene.add(this.#group);
  }

  update(frame: AuthoredTraversalFrame | null): AuthoredTraversalOverlayState | null {
    const state = authoredTraversalOverlayState(this.#links, this.#eyeHeight, frame);
    if (!state) {
      this.#group.visible = false;
      this.#connectionId = null;
      return null;
    }
    if (this.#connectionId !== state.connectionId) {
      this.#pathGeometry.setFromPoints(
        state.path.map((point) => new THREE.Vector3().fromArray(point)),
      );
      this.#connectionId = state.connectionId;
    }
    this.#marker.position.fromArray(state.markerPosition);
    this.#marker.scale.setScalar(state.radius * 2);
    const colour = traversalColour(state.traversalKind);
    this.#pathMaterial.color.setHex(colour);
    this.#markerMaterial.color.setHex(colour);
    this.#group.visible = true;
    return state;
  }

  destroy(): void {
    this.#scene.remove(this.#group);
    this.#pathGeometry.dispose();
    this.#pathMaterial.dispose();
    this.#markerGeometry.dispose();
    this.#markerMaterial.dispose();
  }
}

function traversalColour(kind: AuthoredTraversalKind): number {
  if (kind === "elevator") return 0xcaff3f;
  if (kind === "ladder") return 0x55d8ff;
  return 0xffb454;
}
