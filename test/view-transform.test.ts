import { describe, expect, it } from 'vitest';
import {
  canvasBackingSize,
  CELL_PX,
  clampZoom,
  fitZoom,
  viewTransform,
  layerOffset,
  lastGlyphCounts,
  layoutBounds,
  panForAnchoredZoom,
  renderFactory,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../src/ui/canvas.ts';
import type { FactoryModel } from '../src/engine/factory.ts';

/**
 * A canvas context that accepts every call.
 *
 * Deliberately a Proxy rather than a hand-written stub: the hand-written jsdom stub has twice
 * gone stale and broken the renderer when a new canvas method was introduced (`lineCap`,
 * `quadraticCurveTo`, `arc`...), and a Proxy cannot go stale.
 */
function stubContext(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'canvas') return { width: 800, height: 600 };
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

/** Build a minimal model with the given node centres and footprints. */
function modelOf(nodes: Array<{ x: number; y: number; w?: number; h?: number }>): FactoryModel {
  return {
    nodes: nodes.map((n, i) => ({
      index: i,
      kind: 'producer',
      buildingKey: null,
      buildingName: 'x',
      itemId: 0,
      category: 'production',
      x: n.x,
      y: n.y,
      z: 0,
      yaw: 0,
      footprint: { w: n.w ?? 1, h: n.h ?? 1 },
      recipeKey: null,
      inputsFrom: [],
      outputsTo: [],
    })),
    // `renderFactory` draws a legend that lists unrecognised prototypes, so the field has to
    // exist for the pan tests even though they assert on the transform only.
    unknown: [],
  } as unknown as FactoryModel;
}

describe('view transform', () => {
  it('centres the layout in the canvas', () => {
    const model = modelOf([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const view = viewTransform(model, 800, 600, 1);
    const bounds = layoutBounds(model);
    const centreX = view.offsetX + ((bounds.minX + bounds.maxX) / 2) * view.scale;
    // The horizontal centre of the content lands near the middle of the canvas.
    expect(centreX).toBeCloseTo(400, 0);
  });

  it('keeps the drawing anchored when zooming, instead of pushing it off-canvas', () => {
    const model = modelOf([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 4 }]);
    const width = 800;
    const height = 600;
    const base = viewTransform(model, width, height, 1);
    const bounds = layoutBounds(model);
    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreY = (bounds.minY + bounds.maxY) / 2;

    for (const zoom of [0.5, 1, 1.5, 2, 4]) {
      const view = viewTransform(model, width, height, zoom);
      // Zoom must scale the fit linearly.
      expect(view.scale).toBeCloseTo(base.scale * zoom, 6);
      // The layout centre stays at the canvas centre regardless of zoom, so the
      // visible region grows around it symmetrically.
      expect(view.offsetX + centreX * view.scale).toBeCloseTo(width / 2, 4);
      // The layout must not be flung wholly off one side: at least part of it is
      // on canvas even at high zoom.
      const left = view.offsetX + bounds.minX * view.scale;
      const right = view.offsetX + bounds.maxX * view.scale;
      expect(right).toBeGreaterThan(0);
      expect(left).toBeLessThan(width);
    }
  });

  it('fits the whole layout inside the canvas at the zoom `fitZoom` computes', () => {
    const width = 800;
    const height = 600;
    // Both a small layout and one far larger than the canvas: the fitting zoom has to adapt,
    // which is exactly what 100% no longer does.
    for (const nodes of [
      [{ x: 0, y: 0, w: 3, h: 3 }, { x: 12, y: 9, w: 5, h: 5 }],
      [{ x: 0, y: 0 }, { x: 220, y: 140 }],
    ]) {
      const model = modelOf(nodes);
      const view = viewTransform(model, width, height, fitZoom(model, width, height));
      const bounds = layoutBounds(model);
      const left = view.offsetX + bounds.minX * view.scale;
      const right = view.offsetX + bounds.maxX * view.scale;
      const top = view.offsetY + bounds.minY * view.scale;
      const bottom = view.offsetY + bounds.maxY * view.scale;
      expect(left).toBeGreaterThanOrEqual(-0.001);
      expect(right).toBeLessThanOrEqual(width + 0.001);
      expect(top).toBeGreaterThanOrEqual(-0.001);
      expect(bottom).toBeLessThanOrEqual(height + 0.001);
    }
  });

  it('draws a cell at the same size for every layout at a given zoom', () => {
    // The regression this pins. The zoom used to be a *multiple of the fit*: the layout was
    // scaled to fill the canvas and the slider scaled that result. A large blueprint therefore
    // shrank the fit, and with it every building — the same percentage produced visibly smaller
    // blocks, which made the slider meaningless as a size control and contradicted the view's
    // own claim that 1 cell is 1 metre.
    const small = modelOf([{ x: 0, y: 0 }, { x: 3, y: 3 }]);
    const huge = modelOf([{ x: 0, y: 0 }, { x: 400, y: 300 }]);

    for (const zoom of [0.05, 0.1, 0.5, 1, 4, 8]) {
      const a = viewTransform(small, 900, 500, zoom);
      const b = viewTransform(huge, 900, 500, zoom);
      expect(a.scale, `zoom ${zoom}`).toBeCloseTo(b.scale, 9);
      // And that shared scale is the documented absolute one.
      expect(a.scale, `zoom ${zoom}`).toBeCloseTo(CELL_PX * zoom, 9);
    }
  });

  it('clamps the fitting zoom into the range the controls offer', () => {
    // A single building wants a zoom far above the slider's maximum; a planet-sized layout wants
    // one below its minimum. Both must come back inside the range rather than producing a
    // transform the slider cannot represent.
    const tiny = modelOf([{ x: 0, y: 0 }]);
    const vast = modelOf([{ x: 0, y: 0 }, { x: 20000, y: 0 }]);
    expect(fitZoom(tiny, 900, 500)).toBeLessThanOrEqual(ZOOM_MAX);
    expect(fitZoom(vast, 900, 500)).toBeGreaterThanOrEqual(ZOOM_MIN);

    for (const model of [tiny, vast, modelOf([])]) {
      const z = fitZoom(model, 900, 500);
      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThan(0);
      expect(clampZoom(z)).toBe(z);
    }
  });

  it('returns a finite transform for a degenerate layout', () => {
    const view = viewTransform(modelOf([]), 800, 600, 1);
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(view.scale).toBeGreaterThan(0);
    expect(Number.isFinite(view.offsetX)).toBe(true);
    expect(Number.isFinite(view.offsetY)).toBe(true);
  });
});

describe('canvas sizing', () => {
  it('is a fixed point, so a redraw cannot change the size', () => {
    // This is the property whose absence was a real bug: sizing read `clientHeight` (content
    // box, excludes the canvas's 1px border) and wrote it back as an inline height (border
    // box under the page's `box-sizing: border-box`), shrinking the canvas by 2px per draw.
    // Drag-to-pan redraws on every pointermove, which collapsed the view in seconds.
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const rect of [
        { width: 780, height: 452 },
        { width: 900, height: 520 },
        { width: 1200, height: 700 },
      ]) {
        const first = canvasBackingSize(rect, dpr);
        const second = canvasBackingSize({ width: first.cssWidth, height: first.cssHeight }, dpr);
        expect(second, `dpr ${dpr}, rect ${rect.width}x${rect.height}`).toEqual(first);
        // ...and again, so it is a fixed point rather than a two-cycle.
        const third = canvasBackingSize({ width: second.cssWidth, height: second.cssHeight }, dpr);
        expect(third).toEqual(first);
      }
    }
  });

  it('scales the backing store by the device pixel ratio', () => {
    const size = canvasBackingSize({ width: 800, height: 500 }, 2);
    expect(size.pixelWidth).toBe(1600);
    expect(size.pixelHeight).toBe(1000);
  });

  it('falls back to a sensible height before the canvas has been laid out', () => {
    // `height: auto` on a canvas with no measured height yet: derive it from the width.
    const size = canvasBackingSize({ width: 900, height: 0 }, 1);
    expect(size.cssHeight).toBe(522);
    expect(size.cssWidth).toBe(900);
  });

  it('keeps a usable floor for a collapsed or unmeasured canvas', () => {
    const size = canvasBackingSize({ width: 0, height: 0 }, 1);
    expect(size.cssWidth).toBeGreaterThanOrEqual(320);
    expect(size.cssHeight).toBeGreaterThanOrEqual(240);
    expect(size.pixelWidth).toBeGreaterThan(0);
    expect(size.pixelHeight).toBeGreaterThan(0);
  });
});

describe('anchored wheel zoom', () => {
  const model = modelOf([{ x: 0, y: 0 }, { x: 40, y: 24 }, { x: 18, y: 9 }]);
  const width = 800;
  const height = 600;

  /** The screen position of the world point that sits under `screen` at `state`. */
  function worldUnder(state: { zoom: number; panX?: number; panY?: number; layerSeparation?: number }, screenX: number, screenY: number) {
    const view = viewTransform(model, width, height, state.zoom);
    return {
      x: (screenX - (view.offsetX + (state.panX ?? 0))) / view.scale,
      y: (screenY - (view.offsetY + (state.panY ?? 0))) / view.scale,
    };
  }

  it('keeps the world point under the cursor fixed, checked against what was drawn', () => {
    const state = { zoom: 1, panX: 60, panY: -35 };
    const anchorX = 300;
    const anchorY = 220;
    const world = worldUnder(state, anchorX, anchorY);

    const pan = panForAnchoredZoom(model, width, height, state, anchorX, anchorY, 2);
    // Asserted through the transform the renderer actually returns, not a copy of the algebra.
    const drawn = renderFactory(stubContext(), model, width, height, { zoom: 2, panX: pan.x, panY: pan.y });
    expect(drawn.offsetX + world.x * drawn.scale).toBeCloseTo(anchorX, 6);
    expect(drawn.offsetY + world.y * drawn.scale).toBeCloseTo(anchorY, 6);
  });

  it('anchors at the cursor rather than the centre, which is the point of the gesture', () => {
    const state = { zoom: 1, panX: 0, panY: 0 };
    const anchorX = 120;
    const anchorY = 480;
    const pan = panForAnchoredZoom(model, width, height, state, anchorX, anchorY, 2.5);
    // A centre-anchored zoom would leave the pan at zero; an off-centre cursor must not.
    expect(Math.hypot(pan.x, pan.y)).toBeGreaterThan(1);

    const world = worldUnder(state, anchorX, anchorY);
    const drawn = renderFactory(stubContext(), model, width, height, { zoom: 2.5, panX: pan.x, panY: pan.y });
    expect(drawn.offsetX + world.x * drawn.scale).toBeCloseTo(anchorX, 6);
    expect(drawn.offsetY + world.y * drawn.scale).toBeCloseTo(anchorY, 6);
  });

  it('anchors when zooming out as well as in', () => {
    const state = { zoom: 3, panX: -80, panY: 44 };
    const anchorX = 640;
    const anchorY = 110;
    const world = worldUnder(state, anchorX, anchorY);
    const pan = panForAnchoredZoom(model, width, height, state, anchorX, anchorY, 1);
    const drawn = renderFactory(stubContext(), model, width, height, { zoom: 1, panX: pan.x, panY: pan.y });
    expect(drawn.scale).toBeLessThan(viewTransform(model, width, height, 3).scale);
    expect(drawn.offsetX + world.x * drawn.scale).toBeCloseTo(anchorX, 6);
    expect(drawn.offsetY + world.y * drawn.scale).toBeCloseTo(anchorY, 6);
  });

  it('holds with the exploded-layer offset applied', () => {
    // The layer offset shifts every node, so the anchor has to be solved with it in place.
    const state = { zoom: 1, panX: 25, panY: 15, layerSeparation: 0.45 };
    const anchorX = 500;
    const anchorY = 300;
    const pan = panForAnchoredZoom(model, width, height, state, anchorX, anchorY, 2);
    const before = viewTransform(model, width, height, 1, layerOffset(model, 0.45));
    const worldX = (anchorX - (before.offsetX + state.panX)) / before.scale;
    const worldY = (anchorY - (before.offsetY + state.panY)) / before.scale;
    const after = renderFactory(stubContext(), model, width, height, {
      zoom: 2,
      panX: pan.x,
      panY: pan.y,
      layerSeparation: 0.45,
    });
    expect(after.offsetX + worldX * after.scale).toBeCloseTo(anchorX, 4);
    expect(after.offsetY + worldY * after.scale).toBeCloseTo(anchorY, 4);
  });

  it('returns a finite pan for a degenerate layout', () => {
    const empty = modelOf([]);
    const pan = panForAnchoredZoom(empty, width, height, { zoom: 1 }, 100, 100, 2);
    expect(Number.isFinite(pan.x)).toBe(true);
    expect(Number.isFinite(pan.y)).toBe(true);
  });
});

describe('hiding belts', () => {
  /** A model with belts, sorters and a producer, so the filter has something to leave alone. */
  function mixedModel(): FactoryModel {
    const base = (index: number, kind: string, x: number) => ({
      index,
      kind,
      buildingKey: null,
      buildingName: kind,
      itemId: 0,
      category: 'production',
      x,
      y: 0,
      z: 0,
      yaw: 0,
      footprint: { w: 1, h: 1 },
      recipeKey: null,
      inputsFrom: [],
      outputsTo: [],
    });
    return {
      nodes: [base(0, 'belt', 0), base(1, 'sorter', 1), base(2, 'belt', 2), base(3, 'producer', 3)],
      unknown: [],
    } as unknown as FactoryModel;
  }

  it('draws no belts when the filter is on, and still draws everything else', () => {
    const model = mixedModel();
    renderFactory(stubContext(), model, 800, 600, {});
    const withBelts = lastGlyphCounts();
    expect(withBelts.belts).toBe(2);
    expect(withBelts.sorters).toBe(1);

    renderFactory(stubContext(), model, 800, 600, { hideBelts: true });
    const hidden = lastGlyphCounts();
    expect(hidden.belts).toBe(0);
    // The filter is about belts only; sorters must be untouched.
    expect(hidden.sorters).toBe(1);
  });

  it('keeps the fitted transform unchanged, so the view does not jump when toggled', () => {
    // Bounds are computed from every node on purpose: hiding belts must not re-fit the layout
    // and slide the remaining buildings out from under the cursor.
    const model = mixedModel();
    const shown = renderFactory(stubContext(), model, 800, 600, {});
    const hidden = renderFactory(stubContext(), model, 800, 600, { hideBelts: true });
    expect(hidden.scale).toBeCloseTo(shown.scale, 9);
    expect(hidden.offsetX).toBeCloseTo(shown.offsetX, 9);
    expect(hidden.offsetY).toBeCloseTo(shown.offsetY, 9);
  });

  it('accepts the flag explicitly and defaults to showing belts', () => {
    const model = mixedModel();
    renderFactory(stubContext(), model, 800, 600, { hideBelts: false });
    expect(lastGlyphCounts().belts).toBe(2);
    renderFactory(stubContext(), model, 800, 600, {});
    expect(lastGlyphCounts().belts).toBe(2);
  });
});

describe('drag to pan', () => {
  const model = modelOf([{ x: 0, y: 0 }, { x: 20, y: 12 }]);

  it('translates the drawn view by exactly the pan delta', () => {
    const plain = renderFactory(stubContext(), model, 800, 600, {});
    const panned = renderFactory(stubContext(), model, 800, 600, { panX: 40, panY: -25 });
    expect(panned.offsetX - plain.offsetX).toBeCloseTo(40, 6);
    expect(panned.offsetY - plain.offsetY).toBeCloseTo(-25, 6);
  });

  it('keeps the fit as the baseline, so a zero pan is the fitted view', () => {
    const fitted = viewTransform(model, 800, 600, 1);
    const drawn = renderFactory(stubContext(), model, 800, 600, { panX: 0, panY: 0 });
    expect(drawn.offsetX).toBeCloseTo(fitted.offsetX, 6);
    expect(drawn.offsetY).toBeCloseTo(fitted.offsetY, 6);
  });

  it('pans without changing the scale, which stays the fitted zoom', () => {
    const plain = renderFactory(stubContext(), model, 800, 600, { zoom: 2 });
    const panned = renderFactory(stubContext(), model, 800, 600, { zoom: 2, panX: 123, panY: 456 });
    expect(panned.scale).toBeCloseTo(plain.scale, 9);
    expect(panned.scale).toBeCloseTo(viewTransform(model, 800, 600, 2).scale, 9);
  });

  it('returns the transform it actually drew, so panning twice accumulates', () => {
    const once = renderFactory(stubContext(), model, 800, 600, { panX: 30, panY: 10 });
    const twice = renderFactory(stubContext(), model, 800, 600, { panX: 30 + 15, panY: 10 + 5 });
    expect(twice.offsetX - once.offsetX).toBeCloseTo(15, 6);
    expect(twice.offsetY - once.offsetY).toBeCloseTo(5, 6);
  });
});
