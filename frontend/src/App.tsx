import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  BrainCircuit,
  Cpu,
  Download,
  FileScan,
  Fingerprint,
  Globe2,
  Landmark,
  Maximize2,
  Minus,
  Network,
  PanelTopOpen,
  RadioTower,
  RefreshCcw,
  Search,
  ShieldCheck,
  SunMoon,
  Upload,
  X,
} from 'lucide-react';
import { connectLiveStream, exportAuditReport, fetchSnapshot, refreshConnectors, sendAgentTurn, toAssetUrl, uploadMedia, validateAgentAction, warmQwenModel } from './lib/api';
import type { AgentAction, AgentTurn, CaseMedia, SentinelCase, SentinelSnapshot, Signal } from './types';
import type { SignalFilter, ViewKey } from './WorkspaceViews';
import { GraphTheoryBackdrop } from './GraphTheoryBackdrop';

const WorkspaceViews = lazy(() => import('./WorkspaceViews'));
const FundFlow3DPanel = lazy(() => import('./Flow3DScenes').then((module) => ({ default: module.FundFlow3DPanel })));
const EntityGraph3DPanel = lazy(() => import('./Flow3DScenes').then((module) => ({ default: module.EntityGraph3DPanel })));

type WindowState = {
  id: string;
  type: string;
  title: string;
  minimized: boolean;
  maximized: boolean;
};

type AgentMessage = {
  role: 'user' | 'agent';
  text: string;
  turn?: AgentTurn;
};

const workspaceTabs: Array<{ key: ViewKey; label: string; description: string; icon: typeof Activity; group: string }> = [
  { key: 'command', label: 'Command Center', description: 'Portfolio posture', icon: Activity, group: 'Observe' },
  { key: 'workbench', label: 'Explainable Detection', description: 'Document anomaly lab', icon: Fingerprint, group: 'Investigate' },
  { key: 'signals', label: 'Signal Radar', description: 'Live sources', icon: Globe2, group: 'Investigate' },
  { key: 'graph', label: 'Entity Graph', description: 'Relationships', icon: Network, group: 'Correlate' },
  { key: 'financials', label: 'Financials', description: 'Statement lab', icon: Banknote, group: 'Correlate' },
  { key: 'qwen', label: 'Qwen Ops', description: 'GPU model core', icon: Cpu, group: 'AI Core' },
  { key: 'report', label: 'Report Center', description: 'Decision package', icon: Download, group: 'Export' },
];

function App() {
  const [snapshot, setSnapshot] = useState<SentinelSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'live' | 'polling'>('connecting');
  const [activeView, setActiveView] = useState<ViewKey>('command');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('ALL');
  const [refreshStatus, setRefreshStatus] = useState('Waiting for live stream');
  const [qwenWarmStatus, setQwenWarmStatus] = useState('Ready');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [selectedFlowPathId, setSelectedFlowPathId] = useState('');
  const [selectedEntityNodeId, setSelectedEntityNodeId] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [selectedAnomalyId, setSelectedAnomalyId] = useState('');
  const [explanationLanguage, setExplanationLanguage] = useState('en');
  const [explanationGranularity, setExplanationGranularity] = useState('standard');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let fallbackTimer: number | undefined;

    const startPolling = () => {
      setConnectionState('polling');
      window.clearInterval(fallbackTimer);
      fetchSnapshot().then(applySnapshot).catch(() => undefined);
      fallbackTimer = window.setInterval(() => {
        fetchSnapshot().then(applySnapshot).catch(() => undefined);
      }, 5000);
    };

    const applySnapshot = (payload: SentinelSnapshot) => {
      setSnapshot(payload);
      setSelectedCaseId((current) => current || payload.activeCase.id);
      setRefreshStatus(`Live update ${new Date(payload.generatedAt).toLocaleTimeString()}`);
    };

    const socket = connectLiveStream(
      (payload) => {
        applySnapshot(payload);
        setConnectionState('live');
        window.clearInterval(fallbackTimer);
      },
      startPolling,
    );

    return () => {
      socket.close();
      window.clearInterval(fallbackTimer);
    };
  }, []);

  const openWindow = (type: string, title: string) => {
    const id = `${type}-${Date.now()}`;
    setWindows((current) => [...current, { id, type, title, minimized: false, maximized: false }]);
  };

  const closeWindow = (id: string) => setWindows((current) => current.filter((item) => item.id !== id));
  const toggleMinimize = (id: string) => setWindows((current) => current.map((item) => (item.id === id ? { ...item, minimized: !item.minimized } : item)));
  const toggleMaximize = (id: string) => setWindows((current) => current.map((item) => (item.id === id ? { ...item, maximized: !item.maximized, minimized: false } : item)));

  if (!snapshot) {
    return <LoadingState connectionState={connectionState} />;
  }

  const selectedCase = snapshot.cases.find((caseItem) => caseItem.id === selectedCaseId) ?? snapshot.activeCase;
  const filteredSignals = signalFilter === 'ALL' ? snapshot.signals : snapshot.signals.filter((signal) => signal.type === signalFilter);

  const refreshNow = async () => {
    const payload = await fetchSnapshot();
    setSnapshot(payload);
    setSelectedCaseId((current) => current || payload.activeCase.id);
    setRefreshStatus(`Manual refresh ${new Date(payload.generatedAt).toLocaleTimeString()}`);
  };

  const refreshLiveSources = async () => {
    setRefreshStatus('Refreshing live connectors...');
    await refreshConnectors();
    await refreshNow();
  };

  const warmQwen = async () => {
    setQwenWarmStatus('Warming local Qwen...');
    try {
      const result = await warmQwenModel();
      setQwenWarmStatus(`${result.mode}: ${result.detail}`);
      await refreshNow();
    } catch (error) {
      setQwenWarmStatus(error instanceof Error ? error.message : 'Qwen warm failed');
    }
  };

  const executeAgentAction = async (action: AgentAction) => {
    const validation = await validateAgentAction(action);
    if (!validation.accepted || !validation.action) {
      return;
    }
    const payload = validation.action.payload;
    if (validation.action.type === 'switchTab' && typeof validation.action.target === 'string' && isViewKey(validation.action.target)) {
      setActiveView(validation.action.target);
    }
    if (validation.action.type === 'selectCase' && typeof payload.caseId === 'string') {
      setSelectedCaseId(payload.caseId);
    }
    if (validation.action.type === 'filterSignals' && typeof payload.filter === 'string') {
      setSignalFilter(payload.filter as SignalFilter);
    }
    if (validation.action.type === 'openWindow' || validation.action.type === 'explainChart') {
      openWindow(String(payload.windowType || validation.action.target || 'case'), validation.action.label);
    }
    if (validation.action.type === 'open3DWindow' || validation.action.type === 'explainFlow' || validation.action.type === 'explainEntityPath') {
      const fallbackWindow = validation.action.type === 'explainEntityPath' ? 'entity3d' : 'flow3d';
      const windowType = String(payload.windowType || fallbackWindow);
      setActiveView(windowType === 'entity3d' ? 'graph' : 'financials');
      openWindow(windowType, validation.action.label);
    }
    if (validation.action.type === 'selectFlowPath' && typeof payload.pathId === 'string') {
      setSelectedFlowPathId(payload.pathId);
      setActiveView('financials');
    }
    if (validation.action.type === 'setFlowRiskFilter' || validation.action.type === 'toggleFlowPlayback') {
      setActiveView('financials');
      openWindow('flow3d', validation.action.label);
    }
    if (validation.action.type === 'explainEntityPath' && typeof payload.nodeId === 'string') {
      setSelectedEntityNodeId(payload.nodeId);
    }
    if (validation.action.type === 'selectLoanProfile') {
      setActiveView('workbench');
    }
    if (validation.action.type === 'selectDocument' && typeof payload.documentId === 'string') {
      setSelectedDocumentId(payload.documentId);
      setActiveView('workbench');
    }
    if (validation.action.type === 'selectAnomaly' && typeof payload.anomalyId === 'string') {
      setSelectedAnomalyId(payload.anomalyId);
      setActiveView('workbench');
    }
    if (validation.action.type === 'setExplanationGranularity' && typeof payload.granularity === 'string') {
      setExplanationGranularity(payload.granularity);
      setActiveView('workbench');
    }
    if (validation.action.type === 'setExplanationLanguage' && typeof payload.language === 'string') {
      setExplanationLanguage(payload.language);
      setActiveView('workbench');
    }
    if (validation.action.type === 'runAttentionReplay' || validation.action.type === 'runCounterfactual') {
      if (typeof payload.anomalyId === 'string') setSelectedAnomalyId(payload.anomalyId);
      setActiveView('workbench');
    }
    if (validation.action.type === 'openAuditEvent') {
      setActiveView('workbench');
      openWindow('audit', `${selectedCase.id} audit trail`);
    }
    if (validation.action.type === 'exportAuditReport') {
      const report = await exportAuditReport(selectedCase.id);
      const blob = new Blob([report.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = report.filename || `${selectedCase.id}-audit-report.html`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    if (validation.action.type === 'refreshConnectors') {
      await refreshLiveSources();
    }
    if (validation.action.type === 'warmQwen') {
      await warmQwen();
    }
    if (validation.action.type === 'draftReport') {
      setActiveView('report');
      openWindow('report', `${selectedCase.id} report draft`);
    }
  };

  return (
    <main className={`app-shell ${agentOpen ? 'agent-open' : ''}`}>
      <GraphTheoryBackdrop snapshot={snapshot} activeView={activeView} />
      <AccessibilityStrip theme={theme} onToggleTheme={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))} />
      <TopBar snapshot={snapshot} connectionState={connectionState} activeView={activeView} onViewChange={setActiveView} />
      <LiveIntelligenceRibbon snapshot={snapshot} selectedCase={selectedCase} />
      <WorkspaceToolbar
        snapshot={snapshot}
        selectedCase={selectedCase}
        selectedCaseId={selectedCase.id}
        onCaseChange={setSelectedCaseId}
        onRefresh={refreshNow}
        onRefreshSources={refreshLiveSources}
        onWarmQwen={warmQwen}
        onOpenWindow={openWindow}
        onUploadComplete={refreshNow}
        refreshStatus={refreshStatus}
        qwenWarmStatus={qwenWarmStatus}
      />
      <Suspense fallback={<section className="panel workspace-loading">Loading workspace modules...</section>}>
        <WorkspaceViews
          activeView={activeView}
          snapshot={snapshot}
          selectedCase={selectedCase}
          filteredSignals={filteredSignals}
          signalFilter={signalFilter}
          onSignalFilterChange={setSignalFilter}
          onOpenWindow={openWindow}
          onRefresh={refreshNow}
          selectedDocumentId={selectedDocumentId}
          selectedAnomalyId={selectedAnomalyId}
          explanationLanguage={explanationLanguage}
          explanationGranularity={explanationGranularity}
          onDocumentChange={setSelectedDocumentId}
          onAnomalyChange={setSelectedAnomalyId}
          onExplanationLanguageChange={setExplanationLanguage}
          onExplanationGranularityChange={setExplanationGranularity}
        />
      </Suspense>
      <WindowManager windows={windows} snapshot={snapshot} selectedCase={selectedCase} onClose={closeWindow} onMinimize={toggleMinimize} onMaximize={toggleMaximize} />
      <AgentDock
        open={agentOpen}
        onToggle={() => setAgentOpen((current) => !current)}
        snapshot={snapshot}
        selectedCase={selectedCase}
        activeView={activeView}
        signalFilter={signalFilter}
        windows={windows}
        selectedFlowPathId={selectedFlowPathId}
        selectedEntityNodeId={selectedEntityNodeId}
        selectedDocumentId={selectedDocumentId}
        selectedAnomalyId={selectedAnomalyId}
        explanationLanguage={explanationLanguage}
        explanationGranularity={explanationGranularity}
        onAction={executeAgentAction}
      />
    </main>
  );
}

function AccessibilityStrip({ theme, onToggleTheme }: { theme: string; onToggleTheme: () => void }) {
  return (
    <section className="accessibility-strip" aria-label="Portal utility controls">
      <span>Skip to main dashboard</span>
      <span>Screen reader friendly</span>
      <span>Text size A- A A+</span>
      <button type="button" onClick={onToggleTheme}>
        <SunMoon size={15} /> {theme === 'light' ? 'Dark' : 'Light'} theme
      </button>
    </section>
  );
}

function TopBar({
  snapshot,
  connectionState,
  activeView,
  onViewChange,
}: {
  snapshot: SentinelSnapshot;
  connectionState: string;
  activeView: ViewKey;
  onViewChange: (view: ViewKey) => void;
}) {
  const groups = Array.from(new Set(workspaceTabs.map((tab) => tab.group)));
  return (
    <header className="topbar">
      <div className="brand-mark"><Landmark size={26} /></div>
      <div className="brand-copy">
        <p className="eyebrow">Canara-inspired hackathon prototype</p>
        <h1>SuRaksha Sentinel</h1>
      </div>
      <nav className="mega-nav" aria-label="Prototype sections">
        {groups.map((group) => (
          <div className="nav-group" key={group}>
            <span>{group}</span>
            <div>
              {workspaceTabs.filter((tab) => tab.group === group).map((tab) => (
                <button className={activeView === tab.key ? 'active' : ''} key={tab.key} onClick={() => onViewChange(tab.key)} type="button">
                  <tab.icon size={15} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className={`stream-pill ${connectionState}`}>
        <RadioTower size={16} />
        {connectionState === 'live' ? 'Live stream' : 'Fallback polling'}
      </div>
      <time>{new Date(snapshot.generatedAt).toLocaleTimeString()}</time>
    </header>
  );
}

function LiveIntelligenceRibbon({ snapshot, selectedCase }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase }) {
  const tickerItems = [
    `Live source review active for ${selectedCase.id}`,
    ...snapshot.portfolio.noticeTicker,
    `${selectedCase.priority} | ${selectedCase.applicant} | ${selectedCase.stage}`,
    `${snapshot.overview.freshSignals} source signals | ${snapshot.overview.sourceFreshness}% source freshness`,
    `Qwen ${snapshot.qwenRuntime.mode} | ${snapshot.qwenRuntime.residency?.loaded ? 'GPU resident' : 'not resident'} | ctx ${snapshot.qwenRuntime.effectiveContextWindow ?? snapshot.qwenRuntime.contextWindow}`,
    `${snapshot.connectorStatus.filter((item) => item.status === 'live').length}/${snapshot.connectorStatus.length} connectors live`,
  ];
  return (
    <section className="intelligence-ribbon" aria-label="Live intelligence ticker">
      <div className="ribbon-lead">
        <span>Live underwriting desk</span>
        <strong>{selectedCase.id}</strong>
      </div>
      <div className="ticker-window">
        <div className="ticker-track">
          {tickerItems.slice(0, 4).map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
        </div>
      </div>
    </section>
  );
}

function WorkspaceToolbar({
  snapshot,
  selectedCase,
  selectedCaseId,
  onCaseChange,
  onRefresh,
  onRefreshSources,
  onWarmQwen,
  onOpenWindow,
  onUploadComplete,
  refreshStatus,
  qwenWarmStatus,
}: {
  snapshot: SentinelSnapshot;
  selectedCase: SentinelCase;
  selectedCaseId: string;
  onCaseChange: (caseId: string) => void;
  onRefresh: () => void;
  onRefreshSources: () => void;
  onWarmQwen: () => void;
  onOpenWindow: (type: string, title: string) => void;
  onUploadComplete: () => void;
  refreshStatus: string;
  qwenWarmStatus: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadStatus, setUploadStatus] = useState('No upload pending');

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadStatus(`Uploading ${file.name}...`);
    try {
      await uploadMedia(file, selectedCase.id);
      setUploadStatus(`Uploaded ${file.name}`);
      await onUploadComplete();
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="workspace-toolbar" aria-label="Workspace controls">
      <div className="case-picker">
        <Search size={17} />
        <label htmlFor="case-select">Active case</label>
        <select id="case-select" value={selectedCaseId} onChange={(event) => onCaseChange(event.target.value)}>
          {snapshot.cases.map((caseItem) => (
            <option key={caseItem.id} value={caseItem.id}>
              {caseItem.id} | {caseItem.applicant} | {caseItem.status}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar-status">
        <span>{selectedCase.stage}</span>
        <span>{refreshStatus}</span>
        <span>Qwen {snapshot.qwenRuntime.mode}: {qwenWarmStatus}</span>
        <span>{uploadStatus}</span>
      </div>
      <div className="toolbar-actions">
        <button type="button" onClick={onRefresh}><RefreshCcw size={16} /> Refresh</button>
        <button type="button" onClick={onRefreshSources}><RadioTower size={16} /> Sources</button>
        <button type="button" onClick={onWarmQwen}><Cpu size={16} /> Warm Qwen</button>
        <button type="button" onClick={() => onOpenWindow('case', `${selectedCase.id} dossier`)}><PanelTopOpen size={16} /> Window</button>
        <button type="button" onClick={() => onOpenWindow('flow3d', `${selectedCase.id} 3D fund flow`)}><Network size={16} /> 3D Flow</button>
        <button type="button" onClick={() => fileRef.current?.click()}><Upload size={16} /> Upload</button>
        <input ref={fileRef} className="hidden-file" type="file" accept="image/*,video/*,application/pdf" onChange={(event) => handleUpload(event.target.files?.[0])} />
      </div>
    </section>
  );
}

function AgentDock({
  open,
  onToggle,
  snapshot,
  selectedCase,
  activeView,
  signalFilter,
  windows,
  selectedFlowPathId,
  selectedEntityNodeId,
  selectedDocumentId,
  selectedAnomalyId,
  explanationLanguage,
  explanationGranularity,
  onAction,
}: {
  open: boolean;
  onToggle: () => void;
  snapshot: SentinelSnapshot;
  selectedCase: SentinelCase;
  activeView: ViewKey;
  signalFilter: SignalFilter;
  windows: WindowState[];
  selectedFlowPathId: string;
  selectedEntityNodeId: string;
  selectedDocumentId: string;
  selectedAnomalyId: string;
  explanationLanguage: string;
  explanationGranularity: string;
  onAction: (action: AgentAction) => Promise<void>;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([
    { role: 'agent', text: 'I am watching the active case, tab, windows, live connectors, and local Qwen runtime. Ask me to explain, open, filter, refresh, warm, or draft.' },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    setBusy(true);
    setMessages((current) => [...current, { role: 'user', text: message }]);
    try {
      const turn = await sendAgentTurn({
        message,
        activeView,
        selectedCaseId: selectedCase.id,
        signalFilter,
        openWindows: windows,
        selectedFlowPathId,
        selectedEntityNodeId,
        selectedDocumentId,
        selectedAnomalyId,
        explanationLanguage,
        explanationGranularity,
      });
      setMessages((current) => [...current, { role: 'agent', text: turn.answer, turn }]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'agent', text: error instanceof Error ? error.message : 'Agent request failed' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={`agent-dock ${open ? 'open' : 'closed'}`} aria-label="Investigation copilot">
      <button className="agent-tab" type="button" onClick={onToggle}>
        <BrainCircuit size={18} /> Copilot
      </button>
      {open && (
        <div className="agent-panel">
          <header>
            <div>
              <p className="eyebrow">Context-aware local Qwen agent</p>
              <h2>Investigation copilot</h2>
            </div>
            <span>{snapshot.qwenRuntime.mode}</span>
          </header>
          <div className="agent-context">
            <span>{activeView}</span>
            <span>{selectedCase.id}</span>
            <span>{windows.length} windows</span>
          </div>
          <div className="agent-messages">
            {messages.map((message, index) => (
              <article className={message.role} key={`${message.role}-${index}`}>
                <p>{message.text}</p>
                {message.turn?.citations?.length ? (
                  <div className="agent-citations">
                    {message.turn.citations.map((citation) => (
                      <span key={citation.id}>{citation.id}</span>
                    ))}
                  </div>
                ) : null}
                {message.turn?.actions?.length ? (
                  <div className="agent-actions">
                    {message.turn.actions.map((action) => (
                      <button key={`${action.type}-${action.target}-${action.label}`} type="button" onClick={() => onAction(action)}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          <div className="agent-input">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this case, source, graph, report, Qwen, or a workflow action" />
            <button type="button" disabled={busy} onClick={submit}>{busy ? 'Working' : 'Send'}</button>
          </div>
        </div>
      )}
    </aside>
  );
}

function WindowManager({
  windows,
  snapshot,
  selectedCase,
  onClose,
  onMinimize,
  onMaximize,
}: {
  windows: WindowState[];
  snapshot: SentinelSnapshot;
  selectedCase: SentinelCase;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
}) {
  return (
    <section className="window-layer" aria-label="Dockable investigation windows">
      {windows.map((windowItem, index) => (
        <article className={`floating-window ${windowItem.minimized ? 'minimized' : ''} ${windowItem.maximized ? 'maximized' : ''}`} key={windowItem.id} style={{ ['--window-index' as string]: index }}>
          <header>
            <strong>{windowItem.title}</strong>
            <div>
              <button type="button" onClick={() => onMinimize(windowItem.id)} aria-label="Minimize window"><Minus size={15} /></button>
              <button type="button" onClick={() => onMaximize(windowItem.id)} aria-label="Maximize window"><Maximize2 size={15} /></button>
              <button type="button" onClick={() => onClose(windowItem.id)} aria-label="Close window"><X size={15} /></button>
            </div>
          </header>
          {!windowItem.minimized && <WindowContent type={windowItem.type} snapshot={snapshot} selectedCase={selectedCase} />}
        </article>
      ))}
    </section>
  );
}

function WindowContent({ type, snapshot, selectedCase }: { type: string; snapshot: SentinelSnapshot; selectedCase: SentinelCase }) {
  if (type === 'flow3d') {
    return (
      <Suspense fallback={<div className="window-scroll">Loading 3D fund-flow tracker...</div>}>
        <FundFlow3DPanel compact snapshot={snapshot} selectedCase={selectedCase} />
      </Suspense>
    );
  }
  if (type === 'entity3d') {
    return (
      <Suspense fallback={<div className="window-scroll">Loading 3D entity graph...</div>}>
        <EntityGraph3DPanel compact snapshot={snapshot} selectedCase={selectedCase} />
      </Suspense>
    );
  }
  if (type === 'sources') {
    return (
      <div className="window-scroll">
        {snapshot.connectorStatus.map((connector) => (
          <article className={`mini-card ${connector.status}`} key={connector.id}>
            <strong>{connector.name}</strong>
            <p>{connector.detail}</p>
            <small>{connector.status} | {connector.latencyMs} ms | {connector.items.length} items</small>
          </article>
        ))}
      </div>
    );
  }
  if (type === 'media') {
    return (
      <div className="window-media-grid">
        {selectedCase.media.map((item) => <MiniMedia item={item} key={item.id} />)}
      </div>
    );
  }
  if (type === 'graph') {
    return (
      <div className="window-scroll">
        {snapshot.graph.edges.map((edge) => <p key={`${edge.source}-${edge.target}`}>{edge.source} - {edge.label} - {edge.target}</p>)}
      </div>
    );
  }
  if (type === 'qwen') {
    return (
      <div className="window-scroll">
        <MetricLine label="Mode" value={snapshot.qwenRuntime.mode} />
        <MetricLine label="Residency" value={snapshot.qwenRuntime.residency?.detail ?? 'not probed'} />
        <MetricLine label="GPU" value={snapshot.qwenRuntime.gpu?.detail ?? 'not probed'} />
        <MetricLine label="Effective context" value={snapshot.qwenRuntime.effectiveContextWindow ?? snapshot.qwenRuntime.contextWindow} />
      </div>
    );
  }
  if (type === 'report') {
    return (
      <div className="window-scroll">
        <h3>{snapshot.qwenBrief.recommendedAction}</h3>
        <p>{snapshot.qwenBrief.summary}</p>
        {snapshot.qwenBrief.evidenceCitations.map((citation) => <p key={citation.id}>{citation.id}: {citation.label}</p>)}
      </div>
    );
  }
  if (type === 'audit') {
    const workflow = snapshot.documentIntelligence.workflows[selectedCase.id] ?? snapshot.documentIntelligence.current;
    return (
      <div className="window-scroll">
        <h3>{workflow.auditTrail.mode}</h3>
        <p>Chain valid: {workflow.auditTrail.chainValid ? 'true' : 'false'} | events: {workflow.auditTrail.eventCount}</p>
        {workflow.auditTrail.events.map((event) => (
          <p key={event.hash}>{event.sequence}. {event.label} | {event.hash.slice(0, 16)}</p>
        ))}
      </div>
    );
  }
  if (type === 'map') {
    return (
      <div className="window-scroll">
        {snapshot.geoSignals.map((signal) => <p key={signal.id}>{signal.label}: {signal.risk} risk | {signal.status}</p>)}
      </div>
    );
  }
  return (
    <div className="window-scroll">
      <h3>{selectedCase.id}</h3>
      <p>{selectedCase.applicant} | {selectedCase.loanType} | {selectedCase.branch}</p>
      <p>{selectedCase.nextAction}</p>
      {selectedCase.anomalies.map((anomaly) => <p key={anomaly}>{anomaly}</p>)}
    </div>
  );
}

function MiniMedia({ item }: { item: CaseMedia }) {
  const hasUploadedAsset = isUploadedAsset(item);
  return (
    <figure className="mini-media">
      {hasUploadedAsset && item.kind === 'video' ? (
        <video src={toAssetUrl(item.url)} controls muted />
      ) : hasUploadedAsset && item.kind === 'pdf' ? (
        <object data={toAssetUrl(item.url)} type="application/pdf" aria-label={`${item.title} PDF preview`} />
      ) : hasUploadedAsset ? (
        <img src={toAssetUrl(item.previewUrl || item.url)} alt={item.title} />
      ) : (
        <div className="mini-media-placeholder">
          <span>{item.kind.toUpperCase()}</span>
          <strong>File not attached</strong>
          <small>{item.streamState}</small>
        </div>
      )}
      <figcaption>{item.title}</figcaption>
    </figure>
  );
}

function MetricLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoadingState({ connectionState }: { connectionState: string }) {
  return (
    <main className="loading-state">
      <div className="loading-card">
        <ShieldCheck size={42} />
        <p className="eyebrow">SuRaksha Sentinel</p>
        <h1>Connecting to real-time anomaly intelligence</h1>
        <p>Backend stream status: {connectionState}</p>
      </div>
    </main>
  );
}

function isViewKey(value: string): value is ViewKey {
  return workspaceTabs.some((tab) => tab.key === value);
}

function isUploadedAsset(item: CaseMedia) {
  return Boolean(item.url && item.url.includes('/uploaded/'));
}

export default App;
