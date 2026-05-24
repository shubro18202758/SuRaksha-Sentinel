import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { BrainCircuit, Camera, Filter, Pause, Play, RotateCcw } from 'lucide-react';
import { requestQwenFlowBrief } from './lib/api';
import type { EntityGraph3d, FlowLink3d, FlowNode3d, FlowParticle3d, FundFlowGraph3d, SentinelCase, SentinelSnapshot } from './types';

type SceneGraph = {
  nodes: FlowNode3d[];
  links: FlowLink3d[];
  particles?: FlowParticle3d[];
};

type ThreeCanvasProps = {
  graph: SceneGraph;
  selectedId?: string;
  paused?: boolean;
  riskFloor?: number;
  mode: 'fund' | 'entity';
  onSelect?: (id: string) => void;
};

type SceneViewState = {
  rotationX: number;
  rotationY: number;
  zoom: number;
  panX: number;
  panZ: number;
  userControlled: boolean;
};

const sceneViewMemory = new Map<string, SceneViewState>();

export function FundFlow3DPanel({ snapshot, selectedCase, compact = false }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase; compact?: boolean }) {
  const [paused, setPaused] = useState(false);
  const [riskFloor, setRiskFloor] = useState(35);
  const [selectedPathId, setSelectedPathId] = useState('');
  const flowSelection = useMemo(() => {
    const events = snapshot.transactionFlow.events.filter((event) => event.caseId === selectedCase.id && event.riskScore >= riskFloor);
    const eventIds = new Set(events.map((event) => event.id));
    const nodeIds = new Set(events.flatMap((event) => [event.fromNode, event.toNode]));
    const pathRows = snapshot.transactionFlow.paths
      .filter((path) => path.caseId === selectedCase.id && path.riskScore >= riskFloor)
      .slice(0, compact ? 5 : 9);
    return {
      events,
      paths: pathRows,
      graph: {
        nodes: snapshot.fundFlowGraph3d.nodes.filter((node) => node.caseId === selectedCase.id && nodeIds.has(node.id)),
        links: snapshot.fundFlowGraph3d.links.filter((link) => link.caseId === selectedCase.id && link.risk >= riskFloor && nodeIds.has(link.source) && nodeIds.has(link.target)),
        particles: snapshot.fundFlowGraph3d.particles.filter((particle) => particle.caseId === selectedCase.id && particle.risk >= riskFloor && eventIds.has(particle.eventId)),
      } satisfies SceneGraph,
    };
  }, [
    compact,
    riskFloor,
    selectedCase.id,
    snapshot.fundFlowGraph3d.links,
    snapshot.fundFlowGraph3d.nodes,
    snapshot.fundFlowGraph3d.particles,
    snapshot.transactionFlow.events,
    snapshot.transactionFlow.paths,
  ]);
  const paths = flowSelection.paths;
  const selectedPath = paths.find((path) => path.id === selectedPathId) ?? paths[0];
  const caseEvents = flowSelection.events;
  const filteredGraph = flowSelection.graph;
  const [brief, setBrief] = useState<string>(snapshot.qwenFlowBrief.summary);
  const [briefStatus, setBriefStatus] = useState(snapshot.qwenFlowBrief.mode);

  useEffect(() => {
    if (selectedPathId && !paths.some((path) => path.id === selectedPathId)) setSelectedPathId('');
  }, [paths, selectedPathId]);

  const explainPath = async () => {
    if (!selectedPath) return;
    setBriefStatus('requesting local Qwen');
    try {
      const response = await requestQwenFlowBrief({ caseId: selectedCase.id, pathId: selectedPath.id }) as { output?: { summary?: string; headline?: string }; mode?: string };
      setBrief(response.output?.summary || response.output?.headline || snapshot.qwenFlowBrief.summary);
      setBriefStatus(response.mode || 'active');
    } catch (error) {
      setBrief(error instanceof Error ? error.message : snapshot.qwenFlowBrief.summary);
      setBriefStatus('fallback');
    }
  };

  return (
    <section className={`panel panel-wide flow3d-panel ${compact ? 'compact-3d' : ''}`}>
      <div className="flow3d-header">
        <div>
          <p>Real-time demo finance scenario</p>
          <h2>3D live fund-flow tracker</h2>
          <span>{snapshot.transactionFlow.provenance.detail}</span>
        </div>
        <div className="flow3d-actions">
          <button type="button" onClick={() => setPaused((current) => !current)}>{paused ? <Play size={16} /> : <Pause size={16} />}{paused ? 'Resume' : 'Pause'}</button>
          <button type="button" onClick={() => setRiskFloor(35)}><RotateCcw size={16} /> Reset</button>
          <button type="button" onClick={explainPath}><BrainCircuit size={16} /> Qwen explain</button>
        </div>
      </div>
      <div className="flow3d-layout">
        <div className="flow3d-stage">
          <ThreeFlowCanvas graph={filteredGraph} mode="fund" paused={paused} riskFloor={riskFloor} selectedId={selectedPath?.id} />
          <div className="flow3d-overlay">
            <span><Camera size={14} /> drag rotate | wheel zoom</span>
            <span>{caseEvents.length} events</span>
            <span>{paths.length} paths</span>
          </div>
        </div>
        <aside className="flow3d-side">
          <div className="flow-filter">
            <label><Filter size={15} /> Risk floor {riskFloor}</label>
            <input type="range" min="0" max="90" value={riskFloor} onChange={(event) => setRiskFloor(Number(event.target.value))} />
          </div>
          <div className="flow-path-list">
            {paths.length ? paths.map((path) => (
              <button className={path.id === selectedPath?.id ? 'active' : ''} type="button" key={path.id} onClick={() => setSelectedPathId(path.id)}>
                <strong>{path.label}</strong>
                <span>{formatInr(path.totalAmountInr)} | {path.riskScore} risk</span>
                <i style={{ width: `${Math.max(8, path.riskScore)}%` }} />
              </button>
            )) : <div className="flow-list-empty">No paths above the selected risk floor.</div>}
          </div>
          <div className="qwen-flow-brief">
            <span>{briefStatus}</span>
            <p>{brief}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function EntityGraph3DPanel({ snapshot, selectedCase, compact = false }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase; compact?: boolean }) {
  const [selectedNodeId, setSelectedNodeId] = useState(selectedCase.id);
  const [riskFloor, setRiskFloor] = useState(0);
  const graph = useMemo<SceneGraph>(() => {
    const nodes = snapshot.entityGraph3d.nodes.filter((node) => node.risk >= riskFloor || node.caseId === selectedCase.id);
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      links: snapshot.entityGraph3d.links.filter((link) => link.risk >= riskFloor && nodeIds.has(link.source) && nodeIds.has(link.target)),
    };
  }, [riskFloor, selectedCase.id, snapshot.entityGraph3d.links, snapshot.entityGraph3d.nodes]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0];
  const ranked = [...graph.nodes].sort((left, right) => right.risk - left.risk).slice(0, compact ? 5 : 8);

  return (
    <section className={`panel panel-wide flow3d-panel entity3d-panel ${compact ? 'compact-3d' : ''}`}>
      <div className="flow3d-header">
        <div>
          <p>Entity intelligence</p>
          <h2>3D evidence relationship graph</h2>
          <span>Case, applicant, branch, public-source, document, and collateral entities rendered from the live snapshot.</span>
        </div>
        <div className="flow3d-actions">
          <label className="compact-range">Risk {riskFloor}<input type="range" min="0" max="90" value={riskFloor} onChange={(event) => setRiskFloor(Number(event.target.value))} /></label>
        </div>
      </div>
      <div className="flow3d-layout">
        <div className="flow3d-stage">
          <ThreeFlowCanvas graph={graph} mode="entity" riskFloor={riskFloor} selectedId={selectedNode?.id} onSelect={setSelectedNodeId} />
          <div className="flow3d-overlay">
            <span><Camera size={14} /> drag rotate | click nodes</span>
            <span>{graph.nodes.length} nodes</span>
            <span>{graph.links.length} links</span>
          </div>
        </div>
        <aside className="flow3d-side">
          <div className="entity-node-focus">
            <span>{selectedNode?.type || 'node'}</span>
            <strong>{selectedNode?.label || selectedCase.id}</strong>
            <small>{selectedNode?.risk ?? 0} risk | {selectedNode?.sourceUrl ? sourceLabel(selectedNode.sourceUrl) : selectedCase.stage}</small>
          </div>
          <div className="flow-path-list">
            {ranked.map((node) => (
              <button className={node.id === selectedNode?.id ? 'active' : ''} type="button" key={node.id} onClick={() => setSelectedNodeId(node.id)}>
                <strong>{node.label}</strong>
                <span>{node.type} | {node.risk} risk</span>
                <i style={{ width: `${Math.max(8, node.risk)}%` }} />
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ThreeFlowCanvas({ graph, selectedId, paused = false, mode, onSelect }: ThreeCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hasWebGL = useMemo(() => canUseWebGL(), []);
  const selectedIdRef = useRef(selectedId);
  const pausedRef = useRef(paused);
  const onSelectRef = useRef(onSelect);
  const sceneSignature = useMemo(() => createSceneSignature(graph, mode), [graph, mode]);
  const viewKey = useMemo(() => `${mode}:${graph.nodes.map((node) => node.id).sort().join('|')}`, [graph.nodes, mode]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!hostRef.current || !hasWebGL) return undefined;
    const host = hostRef.current;
    const viewState = getSceneViewState(viewKey);
    const scene = new THREE.Scene();
    const background = mode === 'fund' ? 0x06111f : 0x061720;
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.Fog(background, 78, 170);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 900, host.clientHeight || 420);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(renderer.domElement);

    const root = new THREE.Group();
    root.position.y = mode === 'fund' ? 4.4 : 3.6;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0x9fc8f2, 0.54));
    const keyLight = new THREE.PointLight(0xffffff, 1.55, 180);
    keyLight.position.set(-18, 34, 30);
    scene.add(keyLight);
    const warmLight = new THREE.PointLight(0xffcc29, 0.85, 140);
    warmLight.position.set(26, 20, -22);
    scene.add(warmLight);
    const grid = new THREE.GridHelper(86, 24, 0x2f88bf, 0x123a55);
    grid.position.y = -1.2;
    root.add(grid);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(43, 96),
      new THREE.MeshBasicMaterial({ color: 0x082c46, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.25;
    root.add(floor);
    for (let radius = 11; radius <= 38; radius += 9) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.04, radius + 0.04, 96),
        new THREE.MeshBasicMaterial({ color: 0x1c75bc, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -1.18;
      root.add(ring);
    }
    root.add(createBackdropPoints(mode));

    const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    const meshByNode = new Map<string, THREE.Mesh>();
    const positions = layoutPositions(graph.nodes, mode);
    const particleMeshes: Array<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; particle: FlowParticle3d }> = [];
    fitCamera(camera, positions, mode);
    const baseCameraPosition = camera.position.clone();
    const cameraTarget = new THREE.Vector3(0, mode === 'fund' ? 6.2 : 6.8, 0);
    root.rotation.x = viewState.rotationX;
    root.rotation.y = viewState.rotationY;

    const applyCameraView = () => {
      camera.position.set(
        baseCameraPosition.x * viewState.zoom + viewState.panX,
        baseCameraPosition.y * viewState.zoom,
        baseCameraPosition.z * viewState.zoom + viewState.panZ,
      );
      camera.lookAt(cameraTarget.x + viewState.panX, cameraTarget.y, cameraTarget.z + viewState.panZ);
    };
    applyCameraView();

    for (const link of graph.links) {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target) continue;
      const sourcePosition = positions.get(source.id);
      const targetPosition = positions.get(target.id);
      if (!sourcePosition || !targetPosition) continue;
      const curve = flowCurve(sourcePosition, targetPosition, link.risk);
      const selected = link.id === selectedIdRef.current;
      const geometry = new THREE.TubeGeometry(curve, 54, mode === 'fund' ? 0.07 + link.risk / 1100 : 0.05 + link.risk / 1500, 10, false);
      const material = new THREE.MeshStandardMaterial({
        color: riskColor(link.risk),
        emissive: riskColor(link.risk),
        emissiveIntensity: selected ? 0.48 : 0.15,
        transparent: true,
        opacity: selected ? 0.98 : Math.max(0.44, Math.min(0.76, link.risk / 112)),
        roughness: 0.28,
        metalness: 0.28,
      });
      const tube = new THREE.Mesh(geometry, material);
      root.add(tube);
      const glow = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 32, mode === 'fund' ? 0.18 + link.risk / 700 : 0.14 + link.risk / 900, 8, false),
        new THREE.MeshBasicMaterial({ color: riskColor(link.risk), transparent: true, opacity: selected ? 0.2 : 0.07, blending: THREE.AdditiveBlending }),
      );
      root.add(glow);
      root.add(createArrowHead(curve, link.risk, selected));
    }

    for (const node of graph.nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const size = node.type === 'case' ? 2.15 : 0.95 + node.risk / 120;
      const geometry = new THREE.SphereGeometry(size, 32, 20);
      const material = new THREE.MeshStandardMaterial({ color: riskColor(node.risk), emissive: riskColor(node.risk), emissiveIntensity: node.id === selectedIdRef.current ? 0.45 : 0.13, roughness: 0.24, metalness: 0.34 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.userData.nodeId = node.id;
      meshByNode.set(node.id, mesh);
      root.add(mesh);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(size * 1.35, size * 1.72, 48),
        new THREE.MeshBasicMaterial({ color: riskColor(node.risk), transparent: true, opacity: node.id === selectedIdRef.current ? 0.5 : 0.24, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      halo.position.copy(position);
      halo.rotation.x = Math.PI / 2;
      root.add(halo);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, Math.max(0.4, position.y + 1.15), 8),
        new THREE.MeshBasicMaterial({ color: riskColor(node.risk), transparent: true, opacity: 0.34 }),
      );
      stem.position.set(position.x, (position.y - 1.2) / 2, position.z);
      root.add(stem);
      if (shouldShowNodeLabel(node, graph.nodes.length, selectedIdRef.current)) {
        const label = createTextSprite(shortLabel(node.label), riskColor(node.risk));
        label.position.set(position.x, position.y + size + 0.9, position.z);
        root.add(label);
      }
    }

    for (const particle of graph.particles || []) {
      const source = nodeMap.get(particle.source);
      const target = nodeMap.get(particle.target);
      if (!source || !target) continue;
      const sourcePosition = positions.get(source.id);
      const targetPosition = positions.get(target.id);
      if (!sourcePosition || !targetPosition) continue;
      const curve = flowCurve(sourcePosition, targetPosition, particle.risk);
      const geometry = new THREE.SphereGeometry(0.34 + Math.min(0.52, particle.risk / 165), 18, 14);
      const material = new THREE.MeshStandardMaterial({ color: riskColor(particle.risk), emissive: riskColor(particle.risk), emissiveIntensity: 0.42 });
      const mesh = new THREE.Mesh(geometry, material);
      root.add(mesh);
      particleMeshes.push({ mesh, curve, particle });
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = false;
    let pointerMoved = 0;
    let panDrag = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true;
      pointerMoved = 0;
      panDrag = event.shiftKey || event.button === 1 || event.button === 2;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.style.cursor = panDrag ? 'move' : 'grabbing';
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerDown) return;
      event.preventDefault();
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      pointerMoved += Math.abs(dx) + Math.abs(dy);
      lastX = event.clientX;
      lastY = event.clientY;
      viewState.userControlled = true;
      if (panDrag) {
        viewState.panX = THREE.MathUtils.clamp(viewState.panX - dx * 0.045 * viewState.zoom, -18, 18);
        viewState.panZ = THREE.MathUtils.clamp(viewState.panZ - dy * 0.045 * viewState.zoom, -18, 18);
        applyCameraView();
      } else {
        viewState.rotationY += dx * 0.006;
        viewState.rotationX = THREE.MathUtils.clamp(viewState.rotationX + dy * 0.003, -0.55, 0.55);
        root.rotation.x = viewState.rotationX;
        root.rotation.y = viewState.rotationY;
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerDown = false;
      renderer.domElement.style.cursor = 'grab';
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      if (pointerMoved > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(Array.from(meshByNode.values()), false)[0];
      const nodeId = hit?.object.userData.nodeId;
      if (nodeId && onSelectRef.current) onSelectRef.current(String(nodeId));
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      viewState.userControlled = true;
      viewState.zoom = THREE.MathUtils.clamp(viewState.zoom * (1 + event.deltaY * 0.0012), 0.58, 1.88);
      applyCameraView();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    const motionScale = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.38 : 1;
    let lastTime = performance.now();
    let elapsed = 0;
    let raf = 0;
    const animate = (now = performance.now()) => {
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += deltaSeconds * motionScale;
      if (!pausedRef.current && !viewState.userControlled) {
        viewState.rotationY += (mode === 'fund' ? 0.144 : 0.108) * deltaSeconds * motionScale;
        root.rotation.y = viewState.rotationY;
      }
      for (const { mesh, curve, particle } of particleMeshes) {
        const phase = pausedRef.current ? particle.phase : (particle.phase + elapsed * particle.speed * 7.2) % 1;
        mesh.position.copy(curve.getPoint(phase));
      }
      for (const [nodeId, mesh] of meshByNode) {
        const selected = nodeId === selectedIdRef.current;
        const scale = selected ? 1.24 + Math.sin(elapsed * 4) * 0.04 : 1;
        mesh.scale.setScalar(scale);
      }
      applyCameraView();
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(animate);
    };
    animate();

    const resize = new ResizeObserver(() => {
      const width = host.clientWidth || 900;
      const height = host.clientHeight || 420;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      applyCameraView();
    });
    resize.observe(host);

    return () => {
      window.cancelAnimationFrame(raf);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as (THREE.Material & { map?: THREE.Texture }) | Array<THREE.Material & { map?: THREE.Texture }> | undefined;
        if (Array.isArray(material)) {
          material.forEach((item) => {
            item.map?.dispose?.();
            item.dispose();
          });
        } else {
          material?.map?.dispose?.();
          material?.dispose?.();
        }
      });
      renderer.dispose();
      host.replaceChildren();
    };
  }, [hasWebGL, mode, sceneSignature, viewKey]);

  if (!hasWebGL) {
    return (
      <div className="flow3d-fallback">
        <strong>2D fallback active</strong>
        <p>WebGL is unavailable, so the live graph is shown as ranked flow paths and entity lists.</p>
        {graph.links.slice(0, 8).map((link) => <span key={link.id}>{link.id} | {link.risk} risk</span>)}
      </div>
    );
  }

  if (!graph.nodes.length) {
    return (
      <div className="flow3d-empty">
        <strong>No 3D graph above this filter</strong>
        <p>Lower the risk floor to bring more fund-flow or entity relationships back into the scene.</p>
      </div>
    );
  }

  return <div className="three-host" ref={hostRef} />;
}

function riskColor(risk: number) {
  if (risk >= 76) return 0xe43d12;
  if (risk >= 55) return 0xffcc29;
  if (risk >= 35) return 0x18a8b8;
  return 0x1c75bc;
}

function getSceneViewState(key: string): SceneViewState {
  const existing = sceneViewMemory.get(key);
  if (existing) return existing;
  const initial: SceneViewState = {
    rotationX: 0,
    rotationY: 0,
    zoom: 1,
    panX: 0,
    panZ: 0,
    userControlled: false,
  };
  sceneViewMemory.set(key, initial);
  return initial;
}

function createSceneSignature(graph: SceneGraph, mode: 'fund' | 'entity') {
  const nodes = graph.nodes
    .map((node) => `${node.id}:${node.type}:${Math.round(node.risk / 4)}`)
    .sort()
    .join(',');
  const links = graph.links
    .map((link) => `${link.id}:${link.source}->${link.target}:${Math.round(link.risk / 4)}`)
    .sort()
    .join(',');
  const particleCount = graph.particles?.length ?? 0;
  return `${mode}|${nodes}|${links}|p${particleCount}`;
}

function layoutPositions(nodes: FlowNode3d[], mode: 'fund' | 'entity') {
  const result = new Map<string, THREE.Vector3>();
  if (!nodes.length) return result;
  if (mode === 'fund') {
    const byType = (type: string) => nodes.filter((node) => node.type === type).sort((left, right) => right.risk - left.risk || left.label.localeCompare(right.label));
    const assigned = new Set<string>();
    const placeRows = (rows: FlowNode3d[], x: number, zStep: number, yBase: number) => {
      rows.forEach((node, index) => {
        const offset = index - (rows.length - 1) / 2;
        result.set(node.id, new THREE.Vector3(x, yBase + Math.min(6, node.risk / 28), offset * zStep));
        assigned.add(node.id);
      });
    };
    placeRows(byType('applicant'), -26, 7, 2.2);
    placeRows(byType('counterparty'), -4, 10, 1.6);
    placeRows(byType('branch'), 23, 9, 2);
    placeRows(byType('collateral'), 25, 9, 3.2);
    const remaining = nodes.filter((node) => !assigned.has(node.id));
    remaining.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(remaining.length, 1);
      result.set(node.id, new THREE.Vector3(Math.cos(angle) * 13, 2 + Math.min(5, node.risk / 34), Math.sin(angle) * 16));
    });
    return result;
  }

  const caseNodes = nodes.filter((node) => node.type === 'case');
  const applicantNodes = nodes.filter((node) => node.type === 'applicant');
  const sourceNodes = nodes.filter((node) => node.id.startsWith('source-') || ['osint', 'socmint', 'cybint', 'techint'].includes(node.type));
  const otherNodes = nodes.filter((node) => !caseNodes.includes(node) && !applicantNodes.includes(node) && !sourceNodes.includes(node));
  caseNodes.forEach((node) => result.set(node.id, new THREE.Vector3(0, 7, 0)));
  const placeRing = (rows: FlowNode3d[], radius: number, yBase: number, phase = 0) => {
    rows.forEach((node, index) => {
      const angle = phase + (Math.PI * 2 * index) / Math.max(rows.length, 1);
      result.set(node.id, new THREE.Vector3(Math.cos(angle) * radius, yBase + Math.min(5, node.risk / 42), Math.sin(angle) * radius));
    });
  };
  placeRing(applicantNodes, 14, 2.2, -Math.PI / 2);
  placeRing(otherNodes, 18, 2.6, -Math.PI / 3);
  placeRing(sourceNodes, 23, 3.4, Math.PI / 8);
  for (const node of nodes) {
    if (!result.has(node.id)) result.set(node.id, new THREE.Vector3(node.x, 2 + Math.min(6, node.risk / 35), node.z));
  }
  return result;
}

function flowCurve(source: THREE.Vector3, target: THREE.Vector3, risk: number) {
  const midpoint = source.clone().lerp(target, 0.5);
  const distance = source.distanceTo(target);
  midpoint.y += Math.min(9, Math.max(3.2, distance * 0.12 + risk / 32));
  return new THREE.QuadraticBezierCurve3(source, midpoint, target);
}

function fitCamera(camera: THREE.PerspectiveCamera, positions: Map<string, THREE.Vector3>, mode: 'fund' | 'entity') {
  const box = new THREE.Box3();
  positions.forEach((position) => box.expandByPoint(position));
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z, 28);
  camera.position.set(mode === 'fund' ? 2 : 0, mode === 'fund' ? 46 : 36, Math.max(mode === 'fund' ? 52 : 64, maxDim * (mode === 'fund' ? 1.05 : 1.42)));
  camera.lookAt(0, mode === 'fund' ? 6.2 : 6.8, 0);
}

function createArrowHead(curve: THREE.QuadraticBezierCurve3, risk: number, selected: boolean) {
  const point = curve.getPoint(0.9);
  const tangent = curve.getTangent(0.9).normalize();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(selected ? 0.62 : 0.46, selected ? 1.65 : 1.28, 18),
    new THREE.MeshStandardMaterial({ color: riskColor(risk), emissive: riskColor(risk), emissiveIntensity: selected ? 0.36 : 0.2, roughness: 0.3, metalness: 0.25 }),
  );
  cone.position.copy(point);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  return cone;
}

function createTextSprite(label: string, color: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(4, 19, 34, 0.82)';
    roundedRect(context, 34, 30, 444, 64, 12);
    context.fill();
    context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.lineWidth = 3;
    roundedRect(context, 34, 30, 444, 64, 12);
    context.stroke();
    context.font = '800 25px Segoe UI, Arial, sans-serif';
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 256, 62, 380);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(7.2, 1.8, 1);
  return sprite;
}

function shouldShowNodeLabel(node: FlowNode3d, count: number, selectedId?: string) {
  return count <= 8 || node.id === selectedId || node.type === 'case' || node.type === 'applicant' || node.risk >= 74;
}

function createBackdropPoints(mode: 'fund' | 'entity') {
  const count = 140;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = Math.sin(index * 7.13) * 48;
    positions[index * 3 + 1] = 4 + Math.abs(Math.cos(index * 3.71)) * 24;
    positions[index * 3 + 2] = Math.cos(index * 5.27) * 48;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: mode === 'fund' ? 0x40bde8 : 0xffcc29, size: 0.08, transparent: true, opacity: 0.46 });
  return new THREE.Points(geometry, material);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function shortLabel(value: string) {
  return value.length > 24 ? `${value.slice(0, 22)}...` : value;
}

function canUseWebGL() {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

function formatInr(value: number) {
  if (value >= 10000000) return `INR ${(value / 10000000).toFixed(2)} cr`;
  if (value >= 100000) return `INR ${(value / 100000).toFixed(1)} lakh`;
  return `INR ${value.toLocaleString('en-IN')}`;
}

function sourceLabel(url?: string) {
  if (!url) return 'snapshot evidence';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
