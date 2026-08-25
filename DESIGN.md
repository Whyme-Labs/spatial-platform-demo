---
version: alpha
name: Spatial Studio
description: A daylight fieldbook and dark operational instrument for evidence-bound spatial production.
colors:
  survey-lime: "#d4ff58"
  accent-ink: "#11150b"
  field-black: "#0d0f0e"
  work-surface: "#101210"
  select-surface: "#101210"
  file-input-surface: "#101210"
  field-panel: "#151815"
  field-glass: "rgba(19, 22, 20, 0.88)"
  control-surface: "#0f120f"
  control-surface-deep: "#0f110f"
  utility-card-surface: "#0f110f"
  raised-surface: "#111311"
  inset-surface: "#0e100f"
  dialog-chrome-surface: "#101310"
  popover-surface: "#0b0d0c"
  code-surface: "#0b0d0c"
  select-option-surface: "#151915"
  surface-tint-subtle: "rgba(255, 255, 255, 0.018)"
  archive-ivory: "#f4efe1"
  evidence-muted: "#aaa99e"
  field-label: "#c4c9c1"
  placeholder-text: "#858b83"
  field-line: "rgba(244, 239, 225, 0.13)"
  field-line-strong: "rgba(244, 239, 225, 0.24)"
  verified-mint: "#8ecbb7"
  decision-clay: "#cf775d"
  decision-border: "rgba(207, 119, 93, 0.42)"
  state-clay-border: "rgba(207, 119, 93, 0.38)"
  state-mint-border: "rgba(142, 203, 183, 0.38)"
  state-lime-border: "rgba(214, 255, 75, 0.38)"
  focus-border: "rgba(212, 255, 88, 0.72)"
  focus-halo: "rgba(212, 255, 88, 0.10)"
  focus-border-quiet: "rgba(212, 255, 88, 0.60)"
  focus-halo-quiet: "rgba(212, 255, 88, 0.08)"
  active-step-surface: "rgba(212, 255, 88, 0.08)"
  daylight-paper: "#eef0ec"
  daylight-surface: "#e4e7e2"
  daylight-surface-strong: "#d9ddd7"
  daylight-ink: "#121511"
  daylight-muted: "#555d55"
  daylight-lime: "#a8d61f"
  daylight-line: "rgba(18, 21, 17, 0.17)"
typography:
  marketing-display:
    fontFamily: '"Manrope Variable", "Avenir Next", Arial, sans-serif'
    fontWeight: 645
    lineHeight: 0.9
    letterSpacing: "-0.07em"
  studio-headline:
    fontFamily: '"Manrope Variable", "Avenir Next", ui-sans-serif, system-ui, sans-serif'
    fontWeight: 630
    lineHeight: 1.05
    letterSpacing: "-0.045em"
  section-title:
    fontFamily: '"Manrope Variable", "Avenir Next", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.25rem"
    fontWeight: 630
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  viewer-title:
    fontFamily: "Georgia, serif"
    fontWeight: 400
    lineHeight: 1.06
  ui:
    fontFamily: '"Manrope Variable", "Avenir Next", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 480
    lineHeight: 1.45
  body:
    fontFamily: '"Manrope Variable", "Avenir Next", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 480
    lineHeight: 1.45
  label:
    fontFamily: '"Manrope Variable", "Avenir Next", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 620
    lineHeight: 1.4
  caption-mono:
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace'
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
  studio-caption-mono:
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace'
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  control: "10px"
  surface: "16px"
  dialog: "22px"
  viewer: "24px"
  full: "999px"
spacing:
  micro: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.survey-lime}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  button-quiet:
    backgroundColor: "rgba(255, 255, 255, 0.035)"
    textColor: "{colors.archive-ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  marketing-cta:
    backgroundColor: "{colors.daylight-lime}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "0 20px"
    height: "46px"
  input-field:
    backgroundColor: "{colors.control-surface}"
    textColor: "{colors.archive-ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "44px"
  section-nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.evidence-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  section-nav-item-active:
    backgroundColor: "rgba(255, 255, 255, 0.055)"
    textColor: "{colors.archive-ivory}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  journey-nav-item-active:
    backgroundColor: "{colors.survey-lime}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.evidence-muted}"
    typography: "{typography.studio-caption-mono}"
    rounded: "{rounded.full}"
    padding: "5px 8px"
  portfolio-overview:
    backgroundColor: "transparent"
    textColor: "{colors.archive-ivory}"
    padding: "14px 16px"
  portfolio-refinement:
    backgroundColor: "rgba(255, 255, 255, 0.018)"
    textColor: "{colors.archive-ivory}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  disclosure-surface:
    backgroundColor: "{colors.control-surface}"
    textColor: "{colors.archive-ivory}"
    rounded: "{rounded.surface}"
    padding: "0px"
  viewer-glass:
    backgroundColor: "{colors.field-glass}"
    textColor: "{colors.archive-ivory}"
    rounded: "20px"
    padding: "20px"
---

# Design System: Spatial Studio

`DESIGN.md` is the canonical visual contract. `.impeccable/design.json` is its
generated live-panel extension and must be regenerated whenever this document
changes; it does not independently define product values or visual rules.

## Overview

**Creative North Star: "The Spatial Fieldbook"**

Spatial Studio behaves like a field notebook that moves between two working conditions. The public surface is the daylight brief: mineral paper, architectural scale, exact captions, and spatial imagery. The Studio and viewer are the dark instrument: warm black-green planes, fine evidence lines, compact controls, and signals that remain quiet until a decision matters.

The system is precise, architectural, and quietly confident. Spatial artifacts are allowed to command attention; interface chrome frames, labels, and verifies them. It rejects the generic rounded-card SaaS dashboard: containment is earned by a workflow, state boundary, or spatial overlay rather than applied uniformly to every section.

**Key Characteristics:**

- One identity expressed under daylight and field-dark conditions.
- Acidic lime reserved for primary action, active state, and live process.
- Warm mineral neutrals instead of pure black, white, or blue-gray.
- Manrope for contemporary structure, IBM Plex Mono for evidence, and Georgia only for restrained viewer narration.
- Fine rules and tonal layers at rest; shadow and blur appear only when an element genuinely floats.

## Colors

The palette pairs survey-marker lime with warm mineral neutrals, then assigns mint and clay to evidence states rather than decoration.

### Primary

- **Survey Lime** (`survey-lime`): the operational signal for the primary action, active section, live progress, and current processing state.
- **Daylight Survey Lime** (`daylight-lime`): the slightly deeper daylight counterpart used by marketing calls to action and highlighted proof surfaces.

### Secondary

- **Verified Mint** (`verified-mint`): completed, accepted, published, or otherwise positively verified evidence.
- **Decision Clay** (`decision-clay`): blocked, rejected, destructive, privacy-sensitive, or correction-required states.

### Neutral

- **Field Black**, **Work Surface**, and **Field Panel** (`field-black`, `work-surface`, `field-panel`): the deep rail, primary Studio working plane, and first containment layer.
- **Field Glass** (`field-glass`): translucent viewer overlays that must preserve scene context beneath them.
- **Archive Ivory** and **Evidence Muted** (`archive-ivory`, `evidence-muted`): primary operational text and subordinate evidence text.
- **Daylight Paper**, **Daylight Surface**, and **Daylight Surface Strong** (`daylight-paper`, `daylight-surface`, `daylight-surface-strong`): the public site's paper-like background and tonal sections.
- **Daylight Ink** and **Daylight Muted** (`daylight-ink`, `daylight-muted`): public-site text and supporting copy.
- **Field Line**, **Field Line Strong**, and **Daylight Line** (`field-line`, `field-line-strong`, `daylight-line`): low-contrast structure, focusable boundaries, and dividers.

### Named Rules

**The Two Light Conditions Rule.** Public storytelling uses the daylight palette; production work and immersive viewing use the field-dark palette. Preserve the shared typography, lime signal, warm neutrals, and linework instead of forcing both contexts into one background.

**The Evidence Color Rule.** Lime means active or next, mint means verified or complete, and clay means attention or blocked. Never use these three colors interchangeably. Repeated control, nested, navigation, field-label, focus, and decision-boundary roles resolve through shared semantic tokens; geometry and evidence visualizations may retain local colors.

**The Signal Rarity Rule.** Give Survey Lime to the single consequential action, active path, or focal proof surface in a region; equal lime emphasis across neighboring controls destroys its meaning.

## Typography

**Display Font:** Manrope Variable (with Avenir Next and system sans fallbacks)

**Body Font:** Manrope Variable (with Avenir Next and system sans fallbacks)

**Label/Mono Font:** IBM Plex Mono (with system monospace fallback)

**Character:** Manrope supplies the architectural clarity and compact operational rhythm. IBM Plex Mono marks provenance, technical labels, indices, and machine-readable evidence. Georgia is a narrow exception for small narrative headings inside the immersive viewer, where it distinguishes place-oriented interpretation from operational control.

### Hierarchy

- **Marketing Display** (weight 620–645, `clamp(56px, 5.6vw, 92px)`, line-height 0.9–0.96): short public claims with compressed tracking and a strong first-viewport silhouette.
- **Studio Headline** (weight 630, `clamp(2rem, 3.4vw, 2.75rem)`, line-height 1.05): workflow orientation and project-level context, capped at a readable line length.
- **Section Title** (weight 630, 1.25rem, line-height 1.2): operational regions, dialogs, and grouped evidence.
- **UI / Body** (weight 480–680, 0.8125–0.875rem, line-height 1.45): controls, table rows, explanatory copy, and status text.
- **Label** (weight 620, 0.75rem, line-height 1.4): control labels and compact action text.
- **Evidence Caption** (weight 600, 0.6875rem, letter-spacing 0.08em): non-essential public/viewer metadata and provenance.
- **Studio Evidence Label** (weight 600, 0.75rem, letter-spacing 0.08em): every visible operational caption, status, sequence label, and provenance record in the Studio.

### Named Rules

**The Mono-as-Evidence Rule.** Use IBM Plex Mono only where the text behaves like a label, measurement, index, file fact, or provenance record; never use it for ordinary paragraphs.

**The Studio Operational Floor Rule.** Visible Studio evidence text resolves to the 0.75rem Studio Evidence Label. The smaller Evidence Caption is never interactive or operational and has no Studio exception.

**The Compressed-Claim Rule.** Large public headlines may be tightly tracked and closely led because they are short; operational instructions and evidence copy retain comfortable line-height and ordinary tracking.

## Layout

The public site uses a wide fixed-max canvas: primary navigation and the hero reach 1500px with 24px minimum side margins, while long-form sections settle at 1320px. Desktop compositions are deliberately asymmetric—copy beside imagery, workflow controls beside proof, or a strong 1.3/0.7 split—then collapse to one column at 760px. Section rhythm is expansive, commonly 96–160px, so each product claim reads like a fieldbook spread.

The Studio uses a 260px fixed operational rail beside a fluid workspace capped at 1680px. Its content is denser: 12–24px gaps, an integrated portfolio readout, compact tables, and progressive disclosures. At 960px the rail becomes a horizontal header; at 640px forms, action groups, and workflow grids collapse to one column; at 480px low-priority header actions may disappear to protect the primary task.

The viewer occupies the full dynamic viewport. Scene content is the base layer; navigation, review, and release information sit in safe-area-aware overlays. Coarse pointers receive at least 44px targets, and short landscape screens move controls to opposing side rails rather than shrinking them.

**The Working Plane Rule.** Marketing pages may use expansive editorial whitespace, but operational pages must keep the next action, current state, and blocking evidence within one scannable working plane.

## Elevation & Depth

The system is line-led and layered. At rest, hierarchy comes from small tonal shifts, fine borders, sectional spacing, and the scene itself—not from a stack of floating cards. The daylight site is almost entirely flat. Studio dialogs and true popovers receive deep, diffuse shadows because they interrupt the working plane. Viewer HUD panels may combine the field-glass surface with 22px backdrop blur so they remain legible without hiding spatial context.

### Shadow Vocabulary

- **Field Float** (`0 18px 70px rgba(0, 0, 0, 0.38)`): viewer glass, toasts, and rare floating operational surfaces.
- **Dialog Isolation** (`0 30px 120px rgba(0, 0, 0, 0.72)`): modal work that must clearly detach from the Studio.
- **Compact Popover** (`0 18px 50px rgba(0, 0, 0, 0.36)`): small anchored menus and transient detail panels.
- **Signal Glow** (`0 0 18px rgba(199, 239, 69, 0.72)`): tiny live indicators only, never a general decorative aura.

### Named Rules

**The Line-Before-Shadow Rule.** Use a tonal shift or one-pixel boundary before introducing elevation; shadow is reserved for an actual change in plane.

**The Scene-Through-Glass Rule.** Blur belongs to immersive viewer controls that sit over spatial content, not to ordinary Studio cards or marketing sections.

## Shapes

Operational controls use gently squared 10px corners. Standard cards and bounded sections use 16px corners; dialogs expand to 22px and the full viewer viewport may reach 24px. Circular forms belong to status dots, compact icon controls, and the three-bar Spatial Studio mark. The system favors simple rectangles and disciplined clipping over decorative silhouettes.

**The Pill Exception Rule.** Full pills are reserved for statuses, compact filters, and public calls to action. Do not turn ordinary operational buttons, inputs, panels, or every card into capsules.

## Components

Components remain quiet until consequential: neutral controls recede into the working plane, while active state and primary action receive the lime signal.

### Buttons

- **Shape:** operational buttons use the control radius and a 42px minimum height; coarse-pointer contexts rise to at least 44px.
- **Primary:** Survey Lime with Accent Ink, semibold Manrope, and horizontal 16px padding. Hover lifts by one pixel; active state presses by one pixel.
- **Quiet:** a transparent-white field over Field Black with a Field Line border; hover strengthens both surface and border without changing hierarchy.
- **Marketing CTA:** Daylight Survey Lime, a full pill, 46px minimum height, and 20px horizontal padding.
- **Focus:** a two-pixel Survey Lime outline with clear offset; forced-colors mode replaces it with the system Highlight color.

### Chips

- **Style:** full pills with compact label or mono text, transparent backgrounds, and evidence-line borders.
- **State:** selected filters may invert to Archive Ivory on Field Black; semantic status uses lime, mint, or clay according to the Evidence Color Rule.

### Cards / Containers

- **Corner Style:** 16px for standard surfaces; 18–20px appears only on large workspaces and viewer assemblies.
- **Background:** Field Panel for operational containment; tonal paper surfaces for public storytelling.
- **Shadow Strategy:** flat at rest; refer to the Elevation section for overlays.
- **Border:** one-pixel Field Line or Daylight Line, strengthened only for focus, selection, or a verified boundary.
- **Internal Padding:** typically 16–24px, reduced only for compact rows and evidence lists.

### Portfolio Overview

Portfolio health is a flat definition list inside the Current production surface, not a separate metric-card tier. Four facts share one ruled row on wider screens and a compact two-column grid below 640px. Individual facts have no radius, shadow, or independent surface treatment; only the Active releases value receives Survey Lime.

### Portfolio Refinement

The default project list exposes Current, search, and one Refine disclosure. Secondary statuses, sort order, capture source, delivery classification, and saved views share that single surface. The closed summary names active refinements; Current resets the complete filter state without discarding bulk selection.

### Inputs / Fields

- **Style:** Control Surface, a one-pixel Field Line border, 10px corners, 44px minimum height, and 10px by 12px internal padding.
- **Focus:** border changes to translucent Survey Lime with a restrained three-pixel focus halo.
- **Error / Disabled:** Decision Clay carries actionable error text and boundaries; disabled controls retain legibility at reduced emphasis and become explicit in forced-colors mode.

### Navigation

Studio navigation uses 44px rows, 10px corners, and restrained Manrope labels. A project exposes three primary journey lanes—Work, Evidence, and Publish—with Survey Lime marking the active lane. Work and Evidence reveal a quieter local section row; Publish opens directly. Expert tools sit in a separate advanced disclosure and never compete as a fourth journey. Below 900px, one labeled select preserves the same Work, Evidence, Publish, and Advanced grouping rather than compressing the controls.

### Progressive Disclosure

Advanced evidence, diagnostics, and secondary details use bordered disclosures with a simple plus/minus indicator. Dense routine refinement may use the 44px control height; evidence disclosures retain a 54px summary row. Disclosure is a hierarchy tool, not a hiding place for prerequisites or blocking work.

### Viewer Glass Panel

Viewer overlays use Field Glass, a Field Line border, diffuse Field Float shadow, and 22px backdrop blur. They stay compact, safe-area-aware, and subordinate to the spatial scene.

## Do's and Don'ts

### Do:

- **Do** preserve the daylight-versus-field-dark division while keeping the lime signal, warm neutrals, and typography recognizably shared.
- **Do** reserve Survey Lime for the current path, primary action, live process, or one focal proof surface.
- **Do** use mono captions to identify evidence and provenance, then return to Manrope for explanations and actions.
- **Do** use one-pixel boundaries, tonal shifts, and spacing before adding shadow.
- **Do** keep controls at least 44px tall for coarse pointers and preserve forced-colors and reduced-motion behavior.

### Don't:

- **Don't** distribute every section into interchangeable rounded cards; containment must correspond to a real workflow, state, or overlay boundary.
- **Don't** introduce blue-gray SaaS neutrals, neon sci-fi glows, or arbitrary rainbow status colors.
- **Don't** use mint, clay, and lime as decorative accents outside their evidence meanings.
- **Don't** apply viewer glass and backdrop blur to ordinary Studio panels or public content sections.
- **Don't** shrink operational metadata below the established caption scale or use mono text for ordinary paragraphs.
