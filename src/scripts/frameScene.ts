import { gsap } from "gsap";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

type FrameSide = "top" | "bottom" | "left" | "right";

interface SvgAsset {
  paths: SourcePath[];
  motifs: SourceMotif[];
  width: number;
  height: number;
  viewBoxX: number;
  viewBoxY: number;
}

interface SourcePath {
  geometries: THREE.ShapeGeometry[];
  material: THREE.MeshBasicMaterial;
  bounds: THREE.Box2;
}

interface SourceMotif {
  paths: SourcePath[];
  bounds: THREE.Box2;
}

interface FramePath {
  id: string;
  side: FrameSide;
  tileIndex: number;
  sourcePathIndex: number;
  sourceMotifIndex: number;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  baseScale: THREE.Vector3;
  bounds: THREE.Box2;
  center: THREE.Vector2;
  influence: number;
  targetPointer?: THREE.Vector2;
  timeline?: gsap.core.Timeline;
}

interface FramePathTransform {
  x?: number;
  y?: number;
  z?: number;
  rotationZ?: number;
  scaleX?: number;
  scaleY?: number;
}

interface FramePathAnimation {
  duration?: number;
  ease?: string;
  position?: gsap.TweenVars;
  rotation?: gsap.TweenVars;
  scale?: gsap.TweenVars;
}

interface GardenFrameApi {
  paths: FramePath[];
  getPath: (id: string) => FramePath | undefined;
  setPathTransform: (id: string, transform: FramePathTransform) => void;
  animatePath: (id: string, vars: FramePathAnimation) => void;
  resetPath: (id: string) => void;
  setEnabled: (enabled: boolean) => void;
}

declare global {
  interface Window {
    gardenFrame?: GardenFrameApi;
  }
}

const TOP_BOTTOM_URL = "/top-bottom.svg";
const LEFT_RIGHT_URL = "/left-right.svg";
const MOTIF_PATH_COUNT = 18;
const MAX_DPR = 2;
const HOVER_RADIUS = 150;

const clamp = (min: number, value: number, max: number) =>
  Math.min(Math.max(value, min), max);

const parseNumber = (value: string | null) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseCssColor = (value: string | null | undefined) => {
  if (!value || value === "none") {
    return null;
  }

  try {
    return new THREE.Color(value);
  } catch {
    return null;
  }
};

const readStopColor = (stop: SVGStopElement) => {
  const style = stop.getAttribute("style") ?? "";
  const styleColor = style.match(/stop-color\s*:\s*([^;]+)/)?.[1];
  return parseCssColor(stop.getAttribute("stop-color") ?? styleColor);
};

const readGradientColors = (document: Document) => {
  const gradients = new Map<string, THREE.Color>();

  document
    .querySelectorAll<SVGGradientElement>("linearGradient, radialGradient")
    .forEach((gradient) => {
      const id = gradient.id;

      if (!id) {
        return;
      }

      const colors = Array.from(gradient.querySelectorAll("stop"))
        .map(readStopColor)
        .filter((color): color is THREE.Color => Boolean(color));

      if (!colors.length) {
        return;
      }

      const mixed = colors.reduce(
        (current, color) => current.add(color),
        new THREE.Color(0, 0, 0),
      );

      gradients.set(id, mixed.multiplyScalar(1 / colors.length));
    });

  return gradients;
};

const readPathColor = (
  element: SVGPathElement | undefined,
  fallback: THREE.Color,
  gradients: Map<string, THREE.Color>,
) => {
  const fill = element?.getAttribute("fill");
  const gradientId = fill?.match(/^url\(#(.+)\)$/)?.[1];

  if (gradientId) {
    return gradients.get(gradientId)?.clone() ?? fallback.clone();
  }

  return parseCssColor(fill) ?? fallback.clone();
};

const readPathOpacity = (element: SVGPathElement | undefined) => {
  const style = element?.getAttribute("style") ?? "";
  const styleOpacity = style.match(/(?:^|;)opacity\s*:\s*([^;]+)/)?.[1];
  const styleFillOpacity = style.match(/fill-opacity\s*:\s*([^;]+)/)?.[1];
  const opacity =
    parseNumber(element?.getAttribute("opacity") ?? styleOpacity ?? null) || 1;
  const fillOpacity =
    parseNumber(
      element?.getAttribute("fill-opacity") ?? styleFillOpacity ?? null,
    ) || 1;

  return opacity * fillOpacity;
};

const readSvgDimensions = (root: SVGSVGElement) => {
  const viewBox = root.viewBox.baseVal;
  const width = viewBox?.width || parseNumber(root.getAttribute("width"));
  const height = viewBox?.height || parseNumber(root.getAttribute("height"));

  return {
    width,
    height,
    viewBoxX: viewBox?.x || 0,
    viewBoxY: viewBox?.y || 0,
  };
};

const readGeometryBounds = (geometries: THREE.ShapeGeometry[]) => {
  const bounds = new THREE.Box2();

  geometries.forEach((geometry) => {
    geometry.computeBoundingBox();

    const geometryBounds = geometry.boundingBox;

    if (!geometryBounds) {
      return;
    }

    bounds.expandByPoint(
      new THREE.Vector2(geometryBounds.min.x, geometryBounds.min.y),
    );
    bounds.expandByPoint(
      new THREE.Vector2(geometryBounds.max.x, geometryBounds.max.y),
    );
  });

  return bounds;
};

const readMotifBounds = (paths: SourcePath[]) => {
  const bounds = new THREE.Box2();

  paths.forEach((path) => {
    bounds.union(path.bounds);
  });

  return bounds;
};

const groupSourcePathsIntoMotifs = (paths: SourcePath[]) => {
  const motifs: SourceMotif[] = [];

  for (let index = 0; index < paths.length; index += MOTIF_PATH_COUNT) {
    const motifPaths = paths.slice(index, index + MOTIF_PATH_COUNT);

    if (!motifPaths.length) {
      continue;
    }

    motifs.push({
      paths: motifPaths,
      bounds: readMotifBounds(motifPaths),
    });
  }

  return motifs;
};

const loadSvgAsset = async (url: string): Promise<SvgAsset> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to load ${url}`);
  }

  const source = await response.text();
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement as unknown as SVGSVGElement;
  const dimensions = readSvgDimensions(root);
  const gradients = readGradientColors(document);
  const loader = new SVGLoader();
  const result = loader.parse(source);
  const elements = Array.from(document.querySelectorAll("path"));

  const paths = result.paths.flatMap((path, sourcePathIndex) => {
    const shapes = SVGLoader.createShapes(path);
    const geometries = shapes.map((shape) => new THREE.ShapeGeometry(shape));

    if (!geometries.length) {
      return [];
    }

    const element = elements[sourcePathIndex];
    const opacity = readPathOpacity(element);
    const material = new THREE.MeshBasicMaterial({
      color: readPathColor(element, path.color, gradients),
      depthWrite: false,
      opacity,
      side: THREE.DoubleSide,
      transparent: opacity < 1,
    });

    return [
      {
        geometries,
        material,
        bounds: readGeometryBounds(geometries),
      },
    ];
  });

  return {
    ...dimensions,
    paths,
    motifs: groupSourcePathsIntoMotifs(paths),
  };
};

class GardenFrameScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly pointer = new THREE.Vector2(Number.NaN, Number.NaN);
  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly canHover = window.matchMedia(
    "(hover: hover) and (pointer: fine)",
  );
  private resizeObserver?: ResizeObserver;
  private frame = 0;
  private enabled = true;
  private topBottom?: SvgAsset;
  private leftRight?: SvgAsset;

  readonly paths: FramePath[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  async init() {
    [this.topBottom, this.leftRight] = await Promise.all([
      loadSvgAsset(TOP_BOTTOM_URL),
      loadSvgAsset(LEFT_RIGHT_URL),
    ]);

    this.rebuild();
    this.bindEvents();
    this.render();
  }

  getPath(id: string) {
    return this.paths.find((path) => path.id === id);
  }

  setPathTransform(id: string, transform: FramePathTransform) {
    const path = this.getPath(id);

    if (!path) {
      return;
    }

    path.timeline?.kill();
    path.timeline = undefined;

    if (transform.x !== undefined) path.group.position.x = transform.x;
    if (transform.y !== undefined) path.group.position.y = transform.y;
    if (transform.z !== undefined) path.group.position.z = transform.z;
    if (transform.rotationZ !== undefined) {
      path.group.rotation.z = transform.rotationZ;
    }
    if (transform.scaleX !== undefined) path.group.scale.x = transform.scaleX;
    if (transform.scaleY !== undefined) path.group.scale.y = transform.scaleY;
  }

  animatePath(id: string, vars: FramePathAnimation) {
    const path = this.getPath(id);

    if (!path) {
      return;
    }

    const defaults = {
      duration: vars.duration ?? 0.3,
      ease: vars.ease ?? "sine.inOut",
    };

    path.timeline?.kill();
    path.timeline = gsap.timeline();

    if (vars.position)
      path.timeline.to(
        path.group.position,
        { ...defaults, ...vars.position },
        0,
      );
    if (vars.rotation)
      path.timeline.to(
        path.group.rotation,
        { ...defaults, ...vars.rotation },
        0,
      );
    if (vars.scale)
      path.timeline.to(path.group.scale, { ...defaults, ...vars.scale }, 0);
  }

  resetPath(id: string) {
    const path = this.getPath(id);

    if (path) {
      this.releasePath(path);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;

    if (!enabled) {
      this.releaseAll();
    }
  }

  private bindEvents() {
    window.addEventListener("pointermove", this.handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerleave", this.handlePointerLeave);
    window.addEventListener("resize", this.rebuild);

    this.resizeObserver = new ResizeObserver(this.rebuild);
    this.resizeObserver.observe(this.canvas);
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (
      event.pointerType === "touch" ||
      this.reducedMotion.matches ||
      !this.canHover.matches ||
      !this.enabled
    ) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(event.clientX - rect.left, event.clientY - rect.top);
    this.updateHover();
  };

  private readonly handlePointerLeave = () => {
    this.pointer.set(Number.NaN, Number.NaN);
    this.releaseAll();
  };

  private readonly rebuild = () => {
    if (!this.topBottom || !this.leftRight) {
      return;
    }

    this.clearScene();

    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);

    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = 0;
    this.camera.bottom = height;
    this.camera.position.set(0, 0, 10);
    this.camera.updateProjectionMatrix();

    const { edgeHeight, sideWidth } = this.readFrameMetrics();

    this.tileHorizontal("top", this.topBottom, 0, edgeHeight, width);
    this.tileHorizontal(
      "bottom",
      this.topBottom,
      height - edgeHeight,
      edgeHeight,
      width,
    );
    const verticalTileY = edgeHeight;
    const verticalTileHeight = Math.max(0, height - edgeHeight * 2);

    this.tileVertical(
      "left",
      this.leftRight,
      0,
      sideWidth,
      verticalTileHeight,
      verticalTileY,
    );
    this.tileVertical(
      "right",
      this.leftRight,
      width - sideWidth,
      sideWidth,
      verticalTileHeight,
      verticalTileY,
    );
  };

  private readFrameMetrics() {
    const isMobile = window.matchMedia("(max-width: 700px)").matches;

    return {
      edgeHeight: isMobile
        ? clamp(72, window.innerWidth * 0.24, 96)
        : clamp(108, window.innerWidth * 0.14, 180),
      sideWidth: isMobile
        ? clamp(42, window.innerWidth * 0.12, 54)
        : clamp(72, window.innerWidth * 0.09, 112),
    };
  }

  private tileHorizontal(
    side: Extract<FrameSide, "top" | "bottom">,
    asset: SvgAsset,
    y: number,
    targetHeight: number,
    frameWidth: number,
  ) {
    const scale = targetHeight / asset.height;
    const tileWidth = asset.width * scale;
    const count = Math.ceil(frameWidth / tileWidth) + 1;

    for (let tileIndex = 0; tileIndex < count; tileIndex += 1) {
      this.addTile({
        asset,
        side,
        tileIndex,
        x: tileIndex * tileWidth,
        y,
        scale,
      });
    }
  }

  private tileVertical(
    side: Extract<FrameSide, "left" | "right">,
    asset: SvgAsset,
    x: number,
    targetWidth: number,
    frameHeight: number,
    yOffset = 0,
  ) {
    const scale = targetWidth / asset.width;
    const tileHeight = asset.height * scale;
    const count = Math.floor(frameHeight / tileHeight);

    for (let tileIndex = 0; tileIndex < count; tileIndex += 1) {
      this.addTile({
        asset,
        side,
        tileIndex,
        x,
        y: yOffset + tileIndex * tileHeight,
        scale,
      });
    }
  }

  private addTile(options: {
    asset: SvgAsset;
    side: FrameSide;
    tileIndex: number;
    x: number;
    y: number;
    scale: number;
  }) {
    const { asset, side, tileIndex, x, y, scale } = options;

    asset.motifs.forEach((motif, sourceMotifIndex) => {
      const group = new THREE.Group();
      const meshes = motif.paths.flatMap((source) => {
        const material = source.material.clone();

        return source.geometries.map((geometry) => {
          const mesh = new THREE.Mesh(geometry, material);
          group.add(mesh);
          return mesh;
        });
      });

      group.position.set(
        x - asset.viewBoxX * scale,
        y - asset.viewBoxY * scale,
        0,
      );
      group.scale.set(scale, scale, 1);
      this.scene.add(group);

      const bounds = new THREE.Box2(
        new THREE.Vector2(
          group.position.x + motif.bounds.min.x * scale,
          group.position.y + motif.bounds.min.y * scale,
        ),
        new THREE.Vector2(
          group.position.x + motif.bounds.max.x * scale,
          group.position.y + motif.bounds.max.y * scale,
        ),
      );

      this.paths.push({
        id: `${side}-${tileIndex}-${sourceMotifIndex}`,
        side,
        tileIndex,
        sourcePathIndex: sourceMotifIndex,
        sourceMotifIndex,
        group,
        meshes,
        basePosition: group.position.clone(),
        baseRotation: group.rotation.clone(),
        baseScale: group.scale.clone(),
        bounds,
        center: bounds.getCenter(new THREE.Vector2()),
        influence: 0,
      });
    });
  }

  private updateHover() {
    if (!Number.isFinite(this.pointer.x) || !Number.isFinite(this.pointer.y)) {
      this.releaseAll();
      return;
    }

    let hasInfluence = false;

    this.paths.forEach((path) => {
      const distance = path.center.distanceTo(this.pointer);
      const influence = clamp(0, 1 - distance / HOVER_RADIUS, 1);

      if (influence <= 0.06) {
        this.releasePath(path);
        return;
      }

      hasInfluence = true;

      const targetDrift =
        path.targetPointer?.distanceTo(this.pointer) ??
        Number.POSITIVE_INFINITY;

      if (
        Math.abs(influence - path.influence) < 0.12 &&
        targetDrift < 24 &&
        path.timeline
      ) {
        return;
      }

      this.animateHoverPath(path, influence);
    });

    if (!hasInfluence) {
      this.releaseAll();
    }
  }

  private animateHoverPath(path: FramePath, influence: number) {
    const directionX = clamp(
      -1,
      (path.center.x - this.pointer.x) / HOVER_RADIUS,
      1,
    );
    const directionY = clamp(
      -1,
      (path.center.y - this.pointer.y) / HOVER_RADIUS,
      1,
    );
    const pushX = directionX * 5 * influence;
    const pushY = (Math.abs(directionY) * 2 + 2.5) * influence;
    const rotationZ = directionX * 0.055 * influence;
    const scale = 1 + 0.018 * influence;

    path.influence = influence;
    path.targetPointer = this.pointer.clone();
    path.timeline?.kill();
    path.timeline = gsap.timeline({
      repeat: -1,
      yoyo: true,
      defaults: {
        ease: "sine.inOut",
      },
    });

    path.timeline
      .to(
        path.group.position,
        {
          duration: 1.1,
          x: path.basePosition.x + pushX,
          y: path.basePosition.y + pushY,
        },
        0,
      )
      .to(
        path.group.rotation,
        {
          duration: 1.1,
          z: path.baseRotation.z + rotationZ,
        },
        0,
      )
      .to(
        path.group.scale,
        {
          duration: 1.1,
          x: path.baseScale.x * scale,
          y: path.baseScale.y * scale,
        },
        0,
      )
      .to(path.group.position, {
        duration: 2.2,
        x: path.basePosition.x + pushX * 0.68,
        y: path.basePosition.y + pushY * 0.72,
      })
      .to(
        path.group.rotation,
        {
          duration: 2.2,
          z: path.baseRotation.z - rotationZ * 0.45,
        },
        "<",
      );
  }

  private releasePath(path: FramePath) {
    if (!path.timeline && path.influence === 0) {
      return;
    }

    path.timeline?.kill();
    path.timeline = undefined;
    path.influence = 0;
    path.targetPointer = undefined;

    gsap.to(path.group.position, {
      duration: 0.8,
      ease: "sine.out",
      x: path.basePosition.x,
      y: path.basePosition.y,
      z: path.basePosition.z,
    });
    gsap.to(path.group.rotation, {
      duration: 0.8,
      ease: "sine.out",
      x: path.baseRotation.x,
      y: path.baseRotation.y,
      z: path.baseRotation.z,
    });
    gsap.to(path.group.scale, {
      duration: 0.8,
      ease: "sine.out",
      x: path.baseScale.x,
      y: path.baseScale.y,
      z: path.baseScale.z,
    });
  }

  private releaseAll() {
    this.paths.forEach((path) => this.releasePath(path));
  }

  private clearScene() {
    const disposedMaterials = new Set<THREE.Material>();

    this.paths.forEach((path) => {
      path.timeline?.kill();
      gsap.killTweensOf(path.group.position);
      gsap.killTweensOf(path.group.rotation);
      gsap.killTweensOf(path.group.scale);
      path.meshes.forEach((mesh) => {
        const material = mesh.material;

        if (Array.isArray(material)) {
          material.forEach((item) => {
            if (!disposedMaterials.has(item)) {
              item.dispose();
              disposedMaterials.add(item);
            }
          });
        } else if (!disposedMaterials.has(material)) {
          material.dispose();
          disposedMaterials.add(material);
        }
      });
    });
    this.paths.splice(0);
    this.scene.clear();
  }

  private render = () => {
    this.renderer.render(this.scene, this.camera);
    this.frame = window.requestAnimationFrame(this.render);
  };

  destroy() {
    window.cancelAnimationFrame(this.frame);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerleave", this.handlePointerLeave);
    window.removeEventListener("resize", this.rebuild);
    this.resizeObserver?.disconnect();
    this.clearScene();
    this.renderer.dispose();
  }
}

export const initGardenFrame = () => {
  const shells = Array.from(
    document.querySelectorAll<HTMLElement>(".page-shell"),
  );
  const scenes = shells.flatMap((shell) => {
    const canvas = shell.querySelector<HTMLCanvasElement>(".frame-scene");

    if (!canvas) {
      return [];
    }

    const scene = new GardenFrameScene(canvas);
    void scene.init().catch((error) => {
      console.error("Unable to initialize garden frame", error);
    });
    return [scene];
  });

  const firstScene = scenes[0];

  if (!firstScene) {
    return;
  }

  window.gardenFrame = {
    paths: firstScene.paths,
    getPath: (id) => firstScene.getPath(id),
    setPathTransform: (id, transform) =>
      firstScene.setPathTransform(id, transform),
    animatePath: (id, vars) => firstScene.animatePath(id, vars),
    resetPath: (id) => firstScene.resetPath(id),
    setEnabled: (enabled) => firstScene.setEnabled(enabled),
  };
};
