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

export function isRendererOverlayLayoutMessage(
  value: unknown,
): value is RendererOverlayLayoutMessage {
  const message = recordValue(value);
  if (
    !message
    || Reflect.get(message, "source") !== "spatial-spark"
    || Reflect.get(message, "type") !== "overlay-layout"
  ) return false;

  const viewport = recordValue(Reflect.get(message, "viewport"));
  const zones = recordValue(Reflect.get(message, "zones"));
  if (!viewport || !zones) return false;
  const width = Reflect.get(viewport, "width");
  const height = Reflect.get(viewport, "height");
  if (!positiveFiniteNumber(width) || !positiveFiniteNumber(height)) return false;

  return ["toolbar", "status", "help", "movement", "altitude"]
    .every((key) => nullableOverlayRect(Reflect.get(zones, key)));
}

function nullableOverlayRect(value: unknown): boolean {
  if (value === null) return true;
  const rect = recordValue(value);
  if (!rect) return false;
  const left = Reflect.get(rect, "left");
  const right = Reflect.get(rect, "right");
  const top = Reflect.get(rect, "top");
  const bottom = Reflect.get(rect, "bottom");
  return finiteNumber(left)
    && finiteNumber(right)
    && finiteNumber(top)
    && finiteNumber(bottom)
    && right >= left
    && bottom >= top;
}

function recordValue(value: unknown): object | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function positiveFiniteNumber(value: unknown): value is number {
  return finiteNumber(value) && value > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
