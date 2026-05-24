import { useEffect, useRef } from 'react';
import type { FlowLink3d, FlowNode3d, SentinelSnapshot } from './types';

type BackdropNode = {
  id: string;
  label: string;
  risk: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  drift: number;
};

type BackdropEdge = {
  source: string;
  target: string;
  risk: number;
  phase: number;
};

type BackdropParticle = {
  edgeIndex: number;
  phase: number;
  speed: number;
  risk: number;
};

type BackdropGraph = {
  nodes: BackdropNode[];
  edges: BackdropEdge[];
  particles: BackdropParticle[];
  intensity: number;
};

export function GraphTheoryBackdrop({ snapshot, activeView }: { snapshot: SentinelSnapshot; activeView: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<BackdropGraph | null>(null);
  if (!graphRef.current) {
    graphRef.current = buildBackdropGraph(snapshot, activeView);
  }

  useEffect(() => {
    const nextGraph = buildBackdropGraph(snapshot, activeView);
    const currentGraph = graphRef.current;
    if (!currentGraph) {
      graphRef.current = nextGraph;
      return;
    }
    syncBackdropGraph(currentGraph, nextGraph);
  }, [snapshot, activeView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return undefined;

    const motionScale = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;
    let width = 0;
    let height = 0;
    let elapsed = 0;
    let lastTime = performance.now();
    let raf = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now = performance.now()) => {
      const graph = graphRef.current;
      if (!graph) return;
      const nodes = graph.nodes;
      const particles = graph.particles;
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += deltaSeconds * motionScale;

      context.clearRect(0, 0, width, height);
      const dark = document.documentElement.dataset.theme === 'dark';
      drawMatrixGrid(context, width, height, dark, graph.intensity, elapsed);
      drawEdges(context, nodes, graph.edges, width, height, dark, elapsed);
      drawParticles(context, nodes, graph.edges, particles, width, height, dark, elapsed);
      drawNodes(context, nodes, width, height, dark, elapsed);

      if (motionScale > 0) {
        const frameScale = deltaSeconds * 60 * motionScale;
        const targetEase = 1 - Math.pow(0.9935, frameScale);
        for (const node of nodes) {
          const driftX = Math.sin(elapsed * 0.52 + node.drift) * 0.00018;
          const driftY = Math.cos(elapsed * 0.43 + node.drift * 0.7) * 0.00015;
          node.x += (node.targetX - node.x) * targetEase + (node.vx + driftX) * frameScale;
          node.y += (node.targetY - node.y) * targetEase + (node.vy + driftY) * frameScale;
          if (node.x < 0.025 || node.x > 0.975) {
            node.x = Math.max(0.025, Math.min(0.975, node.x));
            node.vx *= -1;
          }
          if (node.y < 0.04 || node.y > 0.96) {
            node.y = Math.max(0.04, Math.min(0.96, node.y));
            node.vy *= -1;
          }
        }
        for (const particle of particles) {
          particle.phase = (particle.phase + particle.speed * frameScale) % 1;
        }
      }
      raf = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas className="graph-theory-backdrop" ref={canvasRef} aria-hidden="true" />;
}

function buildBackdropGraph(snapshot: SentinelSnapshot, activeView: string): BackdropGraph {
  const rawNodes: FlowNode3d[] = [
    ...snapshot.fundFlowGraph3d.nodes,
    ...snapshot.entityGraph3d.nodes,
  ];
  const sourceLinks: FlowLink3d[] = [
    ...snapshot.fundFlowGraph3d.links,
    ...snapshot.entityGraph3d.links,
  ];

  const nodeMap = new Map<string, FlowNode3d>();
  for (const node of rawNodes) {
    const current = nodeMap.get(node.id);
    if (!current || node.risk > current.risk) {
      nodeMap.set(node.id, node);
    }
  }

  const selected = Array.from(nodeMap.values())
    .sort((left, right) => right.risk - left.risk)
    .slice(0, 48)
    .sort((left, right) => stableHash(`${activeView}:${left.id}`) - stableHash(`${activeView}:${right.id}`));
  const selectedIds = new Set(selected.map((node) => node.id));
  const edgeKeys = new Set<string>();
  const edges = sourceLinks
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target) && edge.source !== edge.target)
    .map((edge, index) => {
      const key = `${edge.source}->${edge.target}`;
      edgeKeys.add(key);
      return {
      source: edge.source,
      target: edge.target,
      risk: edge.risk,
        phase: seededUnit(`${key}:${index}:phase`),
      };
    })
    .slice(0, 72);

  const targetEdgeCount = Math.min(92, Math.max(edges.length, selected.length * 2));
  const visualOffsets = [3, 7, 11, 17, 23];
  let offsetCursor = 0;
  for (let index = 0; edges.length < targetEdgeCount && index < selected.length * visualOffsets.length; index += 1) {
    const source = selected[index % selected.length];
    const offset = visualOffsets[offsetCursor % visualOffsets.length];
    offsetCursor += 1;
    const target = selected[(index + offset + (stableHash(activeView) % Math.max(1, selected.length))) % selected.length];
    if (!source || !target || source.id === target.id) continue;
    const key = `${source.id}->${target.id}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      source: source.id,
      target: target.id,
      risk: Math.max(22, Math.round(((source.risk + target.risk) / 2) * 0.78)),
      phase: seededUnit(`${key}:visual-phase`),
    });
  }

  const columnCount = Math.max(4, Math.ceil(Math.sqrt(Math.max(1, selected.length) * 1.5)));
  const rowCount = Math.max(3, Math.ceil(Math.max(1, selected.length) / columnCount));
  const nodes = selected.map((node, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const jitterX = seededUnit(`${activeView}:${node.id}:jx`) - 0.5;
    const jitterY = seededUnit(`${activeView}:${node.id}:jy`) - 0.5;
    const targetX = clampRange(0.035 + ((column + 0.5 + jitterX * 0.72) / columnCount) * 0.93, 0.035, 0.965);
    const targetY = clampRange(0.055 + ((row + 0.5 + jitterY * 0.76) / rowCount) * 0.89, 0.055, 0.945);
    const angle = seededUnit(`${node.id}:${activeView}:angle`) * Math.PI * 2;
    const speed = 0.000055 + Math.min(0.00019, node.risk / 430000);
    return {
      id: node.id,
      label: node.label,
      risk: node.risk,
      x: targetX,
      y: targetY,
      targetX,
      targetY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.82,
      drift: seededUnit(`${activeView}:${node.id}:drift`) * Math.PI * 2,
    };
  });
  const particles = edges.flatMap((edge, edgeIndex) => {
    const count = edge.risk >= 74 ? 3 : 2;
    return Array.from({ length: count }, (_, offset) => ({
      edgeIndex,
      phase: (edge.phase + offset / count) % 1,
      speed: 0.0018 + edge.risk / 76000,
      risk: edge.risk,
    }));
  });
  const averageRisk = snapshot.overview.averageRisk || 55;
  return {
    nodes,
    edges,
    particles,
    intensity: Math.min(1, Math.max(0.35, averageRisk / 100)),
  };
}

function syncBackdropGraph(current: BackdropGraph, next: BackdropGraph) {
  const previousNodes = new Map(current.nodes.map((node) => [node.id, node]));
  current.nodes = next.nodes.map((target) => {
    const existing = previousNodes.get(target.id);
    if (!existing) return { ...target };
    existing.label = target.label;
    existing.risk = target.risk;
    existing.targetX = target.targetX;
    existing.targetY = target.targetY;
    existing.vx = existing.vx * 0.72 + target.vx * 0.28;
    existing.vy = existing.vy * 0.72 + target.vy * 0.28;
    existing.drift = target.drift;
    return existing;
  });
  current.edges = next.edges;
  current.intensity = next.intensity;
  current.particles = next.particles.map((particle, index) => {
    const existing = current.particles[index];
    return existing
      ? { ...particle, phase: existing.phase }
      : { ...particle };
  });
}

function drawMatrixGrid(context: CanvasRenderingContext2D, width: number, height: number, dark: boolean, intensity: number, elapsed: number) {
  const spacing = 72;
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = dark ? `rgba(80, 177, 221, ${0.055 + intensity * 0.035})` : `rgba(0, 60, 123, ${0.045 + intensity * 0.028})`;
  context.beginPath();
  const driftX = Math.sin(elapsed * 0.27) * spacing * 0.16;
  const driftY = Math.cos(elapsed * 0.23) * spacing * 0.12;
  for (let x = -spacing; x <= width + spacing; x += spacing) {
    context.moveTo(x + driftX, 0);
    context.lineTo(x - spacing * 0.35 + driftX, height);
  }
  for (let y = -spacing; y <= height + spacing; y += spacing) {
    context.moveTo(0, y + driftY);
    context.lineTo(width, y - spacing * 0.18 + driftY);
  }
  context.stroke();
  context.restore();
}

function drawEdges(context: CanvasRenderingContext2D, nodes: BackdropNode[], edges: BackdropEdge[], width: number, height: number, dark: boolean, elapsed: number) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  context.save();
  context.lineCap = 'round';
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;
    const sx = source.x * width;
    const sy = source.y * height;
    const tx = target.x * width;
    const ty = target.y * height;
    const { mx, my } = edgeControlPoint(sx, sy, tx, ty, edge, elapsed);
    context.strokeStyle = riskStroke(edge.risk, dark, 0.16);
    context.lineWidth = 0.7 + edge.risk / 92;
    context.beginPath();
    context.moveTo(sx, sy);
    context.quadraticCurveTo(mx, my, tx, ty);
    context.stroke();
    context.strokeStyle = riskStroke(edge.risk, dark, 0.055);
    context.lineWidth = 5 + edge.risk / 24;
    context.beginPath();
    context.moveTo(sx, sy);
    context.quadraticCurveTo(mx, my, tx, ty);
    context.stroke();
  }
  context.restore();
}

function drawParticles(context: CanvasRenderingContext2D, nodes: BackdropNode[], edges: BackdropEdge[], particles: BackdropParticle[], width: number, height: number, dark: boolean, elapsed: number) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  context.save();
  for (const particle of particles) {
    const edge = edges[particle.edgeIndex];
    if (!edge) continue;
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;
    const phase = elapsed ? particle.phase : particle.phase;
    const sx = source.x * width;
    const sy = source.y * height;
    const tx = target.x * width;
    const ty = target.y * height;
    const { mx, my } = edgeControlPoint(sx, sy, tx, ty, edge, elapsed);
    const point = quadraticPoint(sx, sy, mx, my, tx, ty, phase);
    const size = 1.3 + particle.risk / 58;
    const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, size * 4);
    gradient.addColorStop(0, riskStroke(particle.risk, dark, 0.8));
    gradient.addColorStop(1, riskStroke(particle.risk, dark, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.x, point.y, size * 4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = riskStroke(particle.risk, dark, 0.95);
    context.beginPath();
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function edgeControlPoint(sx: number, sy: number, tx: number, ty: number, edge: BackdropEdge, elapsed: number) {
  const dx = tx - sx;
  const dy = ty - sy;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const bend = Math.sin(elapsed * 0.32 + edge.phase * Math.PI * 2) * Math.min(96, distance * 0.18 + edge.risk * 0.3);
  return {
    mx: (sx + tx) / 2 + (-dy / distance) * bend,
    my: (sy + ty) / 2 + (dx / distance) * bend,
  };
}

function drawNodes(context: CanvasRenderingContext2D, nodes: BackdropNode[], width: number, height: number, dark: boolean, elapsed: number) {
  context.save();
  for (const node of nodes) {
    const x = node.x * width;
    const y = node.y * height;
    const pulse = 1 + Math.sin(elapsed * 1.5 + node.risk) * 0.08;
    const radius = (2.8 + node.risk / 32) * pulse;
    context.fillStyle = riskStroke(node.risk, dark, 0.2);
    context.beginPath();
    context.arc(x, y, radius * 3.2, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = riskStroke(node.risk, dark, 0.45);
    context.lineWidth = 1;
    context.beginPath();
    context.arc(x, y, radius * 2, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = riskStroke(node.risk, dark, 0.92);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function riskStroke(risk: number, dark: boolean, alpha: number) {
  if (risk >= 76) return dark ? `rgba(255, 104, 64, ${alpha})` : `rgba(216, 59, 1, ${alpha})`;
  if (risk >= 55) return dark ? `rgba(255, 211, 73, ${alpha})` : `rgba(179, 105, 0, ${alpha})`;
  if (risk >= 35) return dark ? `rgba(45, 206, 215, ${alpha})` : `rgba(0, 139, 146, ${alpha})`;
  return dark ? `rgba(76, 169, 235, ${alpha})` : `rgba(0, 92, 168, ${alpha})`;
}

function quadraticPoint(sx: number, sy: number, mx: number, my: number, tx: number, ty: number, phase: number) {
  const inverse = 1 - phase;
  return {
    x: inverse * inverse * sx + 2 * inverse * phase * mx + phase * phase * tx,
    y: inverse * inverse * sy + 2 * inverse * phase * my + phase * phase * ty,
  };
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function seededUnit(value: string) {
  return (stableHash(value) % 10000) / 10000;
}

function clampRange(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
