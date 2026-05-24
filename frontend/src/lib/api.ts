import type { AgentAction, AgentTurn, SentinelSnapshot, SourceMediaResolution } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? window.location.origin;
const WS_BASE = API_BASE.replace(/^http/, 'ws');

export async function fetchSnapshot(): Promise<SentinelSnapshot> {
  const response = await fetch(`${API_BASE}/api/snapshot`);
  if (!response.ok) {
    throw new Error(`Snapshot request failed with ${response.status}`);
  }
  return response.json();
}

export async function fetchFlowLive(caseId?: string): Promise<unknown> {
  const params = new URLSearchParams();
  if (caseId) params.set('case_id', caseId);
  const query = params.toString();
  const response = await fetch(`${API_BASE}/api/flow/live${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error(`Flow request failed with ${response.status}`);
  }
  return response.json();
}

export async function refreshConnectors(): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/connectors/refresh`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Connector refresh failed with ${response.status}`);
  }
  return response.json();
}

export async function warmQwenModel(): Promise<{ mode: string; detail: string }> {
  const response = await fetch(`${API_BASE}/api/qwen/warm`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Qwen warm request failed with ${response.status}`);
  }
  return response.json();
}

export async function requestQwenFlowBrief(payload: { caseId?: string; pathId?: string; eventId?: string }): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/qwen/flow-brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Qwen flow brief failed with ${response.status}`);
  }
  return response.json();
}

export async function ingestDocumentSet(payload: {
  caseId: string;
  profileId?: string;
  language?: string;
  granularity?: string;
}): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/document-intel/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Document ingestion failed with ${response.status}`);
  }
  return response.json();
}

export async function explainDocumentAnomaly(payload: {
  caseId: string;
  anomalyId: string;
  language: string;
  granularity: string;
}): Promise<{ mode: string; output?: Record<string, unknown>; note?: string }> {
  const response = await fetch(`${API_BASE}/api/document-intel/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Document explanation failed with ${response.status}`);
  }
  return response.json();
}

export async function runDocumentCounterfactual(payload: {
  caseId: string;
  anomalyId: string;
  language?: string;
  granularity?: string;
}): Promise<{ mode: string; output?: Record<string, unknown>; note?: string }> {
  const response = await fetch(`${API_BASE}/api/document-intel/counterfactual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Counterfactual request failed with ${response.status}`);
  }
  return response.json();
}

export async function submitUnderwritingOverride(payload: {
  caseId: string;
  anomalyId?: string;
  decision: string;
  rationale: string;
}): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/underwriting/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Underwriting override failed with ${response.status}`);
  }
  return response.json();
}

export async function exportAuditReport(caseId: string): Promise<{ filename: string; html: string; report: Record<string, unknown> }> {
  const params = new URLSearchParams({ case_id: caseId });
  const response = await fetch(`${API_BASE}/api/audit/export?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Audit export failed with ${response.status}`);
  }
  return response.json();
}

export async function sendAgentTurn(payload: {
  message: string;
  activeView: string;
  selectedCaseId: string;
  signalFilter: string;
  openWindows: Array<{ id: string; type: string; title: string; minimized: boolean; maximized: boolean }>;
  selectedFlowPathId?: string;
  selectedEntityNodeId?: string;
  selectedDocumentId?: string;
  selectedAnomalyId?: string;
  explanationLanguage?: string;
  explanationGranularity?: string;
}): Promise<AgentTurn> {
  const response = await fetch(`${API_BASE}/api/agent/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Agent request failed with ${response.status}`);
  }
  return response.json();
}

export async function validateAgentAction(action: AgentAction): Promise<{ accepted: boolean; detail: string; action: AgentAction | null }> {
  const response = await fetch(`${API_BASE}/api/agent/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    throw new Error(`Agent action validation failed with ${response.status}`);
  }
  return response.json();
}

export async function uploadMedia(file: File, caseId: string): Promise<unknown> {
  const body = new FormData();
  body.append('file', file);
  body.append('case_id', caseId);
  const response = await fetch(`${API_BASE}/api/media/upload`, { method: 'POST', body });
  if (!response.ok) {
    throw new Error(`Media upload failed with ${response.status}`);
  }
  return response.json();
}

export async function resolveSourceMedia(url: string, title = ''): Promise<SourceMediaResolution> {
  const params = new URLSearchParams({ url });
  if (title) params.set('title', title);
  const response = await fetch(`${API_BASE}/api/source-media/resolve?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Source media resolve failed with ${response.status}`);
  }
  return response.json();
}

export function toAssetUrl(path: string): string {
  if (path.startsWith('http') || path.startsWith('blob:')) {
    return path;
  }
  return `${API_BASE}${path}`;
}

export function connectLiveStream(onMessage: (snapshot: SentinelSnapshot) => void, onError: () => void): WebSocket {
  const socket = new WebSocket(`${WS_BASE}/ws/live`);
  socket.onmessage = (event) => onMessage(JSON.parse(event.data));
  socket.onerror = onError;
  socket.onclose = onError;
  return socket;
}
