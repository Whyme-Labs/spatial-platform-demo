export type OverlayRect = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

export type RendererOverlayLayoutMessage = Readonly<{
  source: "spatial-spark";
  type: "overlay-layout";
  viewport: Readonly<{ width: number; height: number }>;
  zones: Readonly<{
    toolbar: OverlayRect | null;
    status: OverlayRect | null;
    help: OverlayRect | null;
    movement: OverlayRect | null;
    altitude: OverlayRect | null;
  }>;
}>;

export type RendererOuterOverlayMode = "none" | "navigator" | "review";

export type RendererOverlayModeMessage = Readonly<{
  source: "spatial-host";
  type: "set-outer-overlay-mode";
  mode: RendererOuterOverlayMode;
}>;
