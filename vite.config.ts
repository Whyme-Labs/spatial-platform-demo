import { resolve } from "node:path";
import {
  css as superSplatViewerCss,
  html as superSplatViewerHtml,
  js as superSplatViewerJs,
} from "@playcanvas/supersplat-viewer";
import { defineConfig, type Plugin } from "vite";

const playCanvasViewerVersion = "1.28.0";

function playCanvasViewerPlugin(): Plugin {
  const modulePattern = /<script type="module">([\s\S]*?)<\/script>/g;
  const inlineModules = [...superSplatViewerHtml.matchAll(modulePattern)];
  if (inlineModules.length !== 2 || !inlineModules[0]?.[1] || !inlineModules[1]?.[1]) {
    throw new Error("The bundled SuperSplat viewer HTML no longer has the expected two module scripts");
  }
  const bootstrapModule = inlineModules[0][1].trim();
  const applicationModule = inlineModules[1][1]
    .replace(
      "const viewer = await main(canvas, settingsJson, config);",
      "window.spatialViewer = await main(canvas, settingsJson, config);",
    )
    .trim();
  if (!applicationModule.includes("window.spatialViewer = await main")) {
    throw new Error("The bundled SuperSplat viewer application bootstrap could not be bridged");
  }
  const viewerHtml = superSplatViewerHtml
    .replace(inlineModules[0][0], '<script type="module" src="./bootstrap.js"></script>')
    .replace(inlineModules[1][0], '<script type="module" src="./application.js"></script>')
    .replace(
      "</head>",
      '<script src="./spatial-bridge.js"></script>\n    </head>',
    )
    .replace(
      "</body>",
      `${playCanvasToolbarMarkup()}\n    </body>`,
    );

  return {
    name: "spatial-playcanvas-viewer",
    generateBundle() {
      const files = {
        "playcanvas-renderer/index.html": viewerHtml,
        "playcanvas-renderer/index.css": `${superSplatViewerCss}\n${playCanvasToolbarCss()}`,
        "playcanvas-renderer/index.js": superSplatViewerJs,
        "playcanvas-renderer/bootstrap.js": bootstrapModule,
        "playcanvas-renderer/application.js": applicationModule,
        "playcanvas-renderer/spatial-bridge.js": playCanvasBridgeScript(),
      };
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}

function playCanvasToolbarMarkup(): string {
  return `
        <section id="spatialNativeToolbar" class="spatial-native-toolbar" aria-label="Scene controls" hidden>
            <span class="spatial-native-runtime"><i aria-hidden="true"></i>PlayCanvas · Native SOG</span>
            <span class="spatial-native-actions">
                <button id="spatialNativeReset" type="button">Reset view</button>
                <button id="spatialNativeHelp" type="button" aria-expanded="false" aria-controls="spatialNativeHelpPanel">Controls</button>
                <button id="spatialNativeFullscreen" type="button">Full screen</button>
            </span>
            <span id="spatialNativeHelpPanel" class="spatial-native-help" hidden>
                Drag to look · scroll or two-finger swipe to travel · WASD or arrow keys to fly.
                This visual-only demo has no authored collision or walkable navmesh.
            </span>
        </section>`;
}

function playCanvasToolbarCss(): string {
  return `
.spatial-native-toolbar {
    position: fixed;
    z-index: 20;
    left: max(16px, env(safe-area-inset-left));
    right: max(16px, env(safe-area-inset-right));
    bottom: max(16px, env(safe-area-inset-bottom));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 54px;
    padding: 8px 10px 8px 16px;
    color: #f4f2e9;
    background: rgba(13, 17, 15, 0.9);
    border: 1px solid rgba(244, 242, 233, 0.18);
    border-radius: 18px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    font: 600 14px/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.spatial-native-runtime {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: rgba(244, 242, 233, 0.72);
    white-space: nowrap;
}
.spatial-native-runtime i {
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #c9ff43;
    box-shadow: 0 0 18px rgba(201, 255, 67, 0.52);
}
.spatial-native-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.spatial-native-actions button {
    min-height: 38px;
    padding: 0 13px;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 12px;
    font: inherit;
    cursor: pointer;
}
.spatial-native-actions button:hover,
.spatial-native-actions button:focus-visible {
    color: #0b110e;
    background: #c9ff43;
    outline: none;
}
.spatial-native-help {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    width: min(360px, calc(100vw - 32px));
    padding: 16px 18px;
    color: rgba(244, 242, 233, 0.82);
    background: rgba(13, 17, 15, 0.94);
    border: 1px solid rgba(244, 242, 233, 0.18);
    border-radius: 16px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
}
html.spatial-poster #spatialNativeToolbar {
    display: none;
}
@media (max-width: 620px) {
    .spatial-native-toolbar {
        left: max(8px, env(safe-area-inset-left));
        right: max(8px, env(safe-area-inset-right));
        bottom: max(8px, env(safe-area-inset-bottom));
        gap: 6px;
        padding-left: 12px;
    }
    .spatial-native-runtime {
        max-width: 92px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .spatial-native-actions {
        gap: 0;
    }
    .spatial-native-actions button {
        min-height: 40px;
        padding: 0 9px;
        font-size: 13px;
    }
}`;
}

function playCanvasBridgeScript(): string {
  return `(() => {
    const startedAt = performance.now();
    const movementCodes = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];
    const keyValues = {
      KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d",
      ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
      ShiftLeft: "Shift", ShiftRight: "Shift"
    };
    const post = (message) => parent.postMessage({ source: "spatial-playcanvas", ...message }, location.origin);
    const viewer = () => window.spatialViewer;
    const cameraPose = () => {
      const active = viewer();
      if (!active?.cameraManager) return null;
      const camera = active.cameraManager.camera;
      const forward = active.global.camera.forward;
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [
          camera.position.x + forward.x * camera.distance,
          camera.position.y + forward.y * camera.distance,
          camera.position.z + forward.z * camera.distance
        ],
        up: [0, 1, 0],
        fovDegrees: camera.fov
      };
    };
    const setCamera = (pose) => {
      const active = viewer();
      if (!active?.cameraManager || !pose?.position || !pose?.target) return false;
      const entity = active.global.camera;
      entity.setPosition(...pose.position);
      entity.lookAt(...pose.target);
      const angles = entity.getEulerAngles();
      const camera = active.cameraManager.camera;
      camera.position.set(...pose.position);
      camera.angles.copy(angles);
      camera.distance = Math.hypot(
        pose.target[0] - pose.position[0],
        pose.target[1] - pose.position[1],
        pose.target[2] - pose.position[2]
      );
      camera.fov = Number.isFinite(pose.fovDegrees) ? pose.fovDegrees : camera.fov;
      active.cameraManager.snap();
      return true;
    };
    const dispatchMovement = (code, pressed) => {
      if (!movementCodes.includes(code)) return;
      window.dispatchEvent(new KeyboardEvent(pressed ? "keydown" : "keyup", {
        code,
        key: keyValues[code] || code,
        bubbles: true
      }));
    };
    const visibleSceneReady = async () => {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        if (typeof window.captureFrame === "function") {
          try {
            const frame = await window.captureFrame({ width: 96, height: 54, supersample: 1 });
            const bytes = Uint8Array.from(atob(frame.data), (value) => value.charCodeAt(0));
            let changed = 0;
            let minimumLuminance = 255;
            let maximumLuminance = 0;
            for (let index = 0; index < bytes.length; index += 4) {
              const red = bytes[index];
              const green = bytes[index + 1];
              const blue = bytes[index + 2];
              const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
              minimumLuminance = Math.min(minimumLuminance, luminance);
              maximumLuminance = Math.max(maximumLuminance, luminance);
              if (Math.abs(red - 11) + Math.abs(green - 17) + Math.abs(blue - 14) > 30) changed += 1;
            }
            if (changed > frame.width * frame.height * 0.05 && maximumLuminance - minimumLuminance > 24) {
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return true;
            }
          } catch {
            // The capture hook can be momentarily busy while streamed LODs settle.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return false;
    };

    if (new URL(location.href).searchParams.has("spatialPoster")) {
      document.documentElement.classList.add("spatial-poster");
    }
    window.firstFrame = () => {
      void visibleSceneReady().then((ready) => {
        if (!ready) {
          post({
            type: "error",
            code: "PLAYCANVAS_EMPTY_FRAME",
            message: "The native SOG decoded, but no visible scene frame became ready."
          });
          return;
        }
        document.getElementById("spatialNativeToolbar")?.removeAttribute("hidden");
        post({
          type: "ready",
          runtime: "playcanvas",
          version: "${playCanvasViewerVersion}",
          timeToFirstFrameMs: Math.round(performance.now() - startedAt),
          format: new URL(location.href).searchParams.get("format") || "sog",
          splatBudget: Math.round(Number(new URL(location.href).searchParams.get("budget") || 0) * 1000000)
        });
      });
    };
    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin || event.source !== parent || !event.data || event.data.source !== "spatial-host") return;
      const message = event.data;
      if (message.type === "reset-view") {
        viewer()?.global.events.fire("inputEvent", "reset");
      } else if (message.type === "capture-camera") {
        const pose = cameraPose();
        if (pose) post({ type: "camera", requestId: message.requestId, cameraPose: pose });
      } else if (message.type === "set-camera") {
        const accepted = setCamera(message.cameraPose);
        post({
          type: "camera-set",
          requestId: message.requestId,
          accepted,
          message: accepted ? undefined : "The native SOG renderer is not ready.",
          cameraPose: cameraPose() || message.cameraPose
        });
      } else if (message.type === "movement-key") {
        dispatchMovement(message.code, Boolean(message.pressed));
      } else if (message.type === "movement-keys-clear") {
        movementCodes.forEach((code) => dispatchMovement(code, false));
      }
    });
    window.addEventListener("DOMContentLoaded", () => {
      const reset = document.getElementById("spatialNativeReset");
      const help = document.getElementById("spatialNativeHelp");
      const helpPanel = document.getElementById("spatialNativeHelpPanel");
      const fullscreen = document.getElementById("spatialNativeFullscreen");
      reset?.addEventListener("click", () => viewer()?.global.events.fire("inputEvent", "reset"));
      help?.addEventListener("click", () => {
        const expanded = help.getAttribute("aria-expanded") === "true";
        help.setAttribute("aria-expanded", String(!expanded));
        if (helpPanel) helpPanel.hidden = expanded;
      });
      fullscreen?.addEventListener("click", () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      });
      post({ type: "progress", progress: 8, detail: "Loading native SOG scene" });
    });
    window.addEventListener("error", (event) => {
      post({ type: "error", code: "PLAYCANVAS_RUNTIME_ERROR", message: event.message || "The native SOG viewer failed." });
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "The native SOG viewer failed.");
      post({ type: "error", code: "PLAYCANVAS_RUNTIME_ERROR", message: reason });
    });
  })();`;
}

export default defineConfig(({ mode }) => {
  const isTest = mode === "test";
  return {
    plugins: [playCanvasViewerPlugin()],
    define: {
      __SPATIAL_E2E__: JSON.stringify(isTest),
    },
    build: {
      target: "es2022",
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          viewer: resolve(import.meta.dirname, "index.html"),
          studio: resolve(import.meta.dirname, "studio.html"),
          renderer: resolve(import.meta.dirname, "renderer/index.html"),
          ...(isTest
            ? {
                pointerControls: resolve(
                  import.meta.dirname,
                  "e2e/fixtures/pointer-controls.html",
                ),
              }
            : {}),
        },
      },
    },
  };
});
