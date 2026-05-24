import { Fragment as ReactFragment, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import L, { type LayerGroup, type Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  AlertTriangle,
  Banknote,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  FileScan,
  Fingerprint,
  Globe2,
  Landmark,
  Layers,
  Link2,
  LucideIcon,
  MapPinned,
  Network,
  PanelTopOpen,
  RadioTower,
  ShieldCheck,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { exportAuditReport, explainDocumentAnomaly, ingestDocumentSet, resolveSourceMedia, runDocumentCounterfactual, submitUnderwritingOverride, toAssetUrl } from './lib/api';
import type {
  CaseMedia,
  ConnectorStatus,
  DocumentAnomaly,
  DocumentIntelDocument,
  DocumentWorkflow,
  GeoSignal,
  SentinelCase,
  SentinelSnapshot,
  Signal,
  SourceMedia,
  SourceMediaResolution,
} from './types';

export type ViewKey = 'command' | 'workbench' | 'signals' | 'graph' | 'financials' | 'qwen' | 'report';
export type SignalFilter = Signal['type'] | 'ALL';

const chartMargins = { top: 18, right: 22, bottom: 14, left: 8 };
const compactChartMargins = { top: 14, right: 18, bottom: 8, left: 8 };
const axisTick = { fontSize: 11, fill: '#63738a', fontWeight: 800 };

function IndustrialTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="industrial-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={`${item.dataKey ?? item.name}-${item.value}`}>
          <i style={{ background: item.color }} />
          {item.name ?? item.dataKey}: {typeof item.value === 'number' ? item.value.toLocaleString('en-IN') : item.value}
        </span>
      ))}
    </div>
  );
}

function shortChartLabel(value: string, max = 16) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

type WorkspaceProps = {
  activeView: ViewKey;
  snapshot: SentinelSnapshot;
  selectedCase: SentinelCase;
  filteredSignals: Signal[];
  signalFilter: SignalFilter;
  onSignalFilterChange: (filter: SignalFilter) => void;
  onOpenWindow: (type: string, title: string) => void;
  onRefresh: () => Promise<void>;
  selectedDocumentId: string;
  selectedAnomalyId: string;
  explanationLanguage: string;
  explanationGranularity: string;
  onDocumentChange: (documentId: string) => void;
  onAnomalyChange: (anomalyId: string) => void;
  onExplanationLanguageChange: (language: string) => void;
  onExplanationGranularityChange: (granularity: string) => void;
};

type ChartFrameSize = { width: number; height: number };

function MeasuredChartFrame({
  children,
  className = '',
  minHeight,
}: {
  children: (size: ChartFrameSize) => ReactNode;
  className?: string;
  minHeight: number;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ChartFrameSize>({ width: 0, height: minHeight });

  useLayoutEffect(() => {
    if (!frameRef.current) return undefined;
    const node = frameRef.current;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width || node.clientWidth || 0));
      const height = Math.max(minHeight, Math.floor(rect.height || node.clientHeight || minHeight));
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [minHeight]);

  return (
    <div className={`chart-area ${className}`.trim()} ref={frameRef}>
      {size.width > 0 ? children(size) : null}
    </div>
  );
}

const statusTone: Record<string, string> = {
  Escalate: 'danger',
  Hold: 'warning',
  Review: 'notice',
  Proceed: 'good',
};

const FundFlow3DPanel = lazy(() => import('./Flow3DScenes').then((module) => ({ default: module.FundFlow3DPanel })));
const EntityGraph3DPanel = lazy(() => import('./Flow3DScenes').then((module) => ({ default: module.EntityGraph3DPanel })));

function WorkspaceViews({
  activeView,
  snapshot,
  selectedCase,
  filteredSignals,
  signalFilter,
  onSignalFilterChange,
  onOpenWindow,
  onRefresh,
  selectedDocumentId,
  selectedAnomalyId,
  explanationLanguage,
  explanationGranularity,
  onDocumentChange,
  onAnomalyChange,
  onExplanationLanguageChange,
  onExplanationGranularityChange,
}: WorkspaceProps) {
  if (activeView === 'workbench') {
    return (
      <section className="stacked-workspace">
        <CaseWorkbench
          snapshot={snapshot}
          caseItem={selectedCase}
          onOpenWindow={onOpenWindow}
          onRefresh={onRefresh}
          selectedDocumentId={selectedDocumentId}
          selectedAnomalyId={selectedAnomalyId}
          explanationLanguage={explanationLanguage}
          explanationGranularity={explanationGranularity}
          onDocumentChange={onDocumentChange}
          onAnomalyChange={onAnomalyChange}
          onExplanationLanguageChange={onExplanationLanguageChange}
          onExplanationGranularityChange={onExplanationGranularityChange}
        />
        <DueDiligenceControlPanel snapshot={snapshot} />
        <DecisionBrief snapshot={snapshot} />
        <CaseTimelinePanel selectedCase={selectedCase} />
        <CaseQueue snapshot={snapshot} selectedCase={selectedCase} />
      </section>
    );
  }

  if (activeView === 'signals') {
    return (
      <section className="source-page">
        <LiveSourceMediaWall rotationSeed={snapshot.generatedAt} signals={filteredSignals} />
        <div className="source-ops-grid">
          <div className="source-ops-stack">
            <ConnectorHealth connectors={snapshot.connectorStatus} />
            <SourceHealth snapshot={snapshot} />
          </div>
          <GeoRiskMap signals={snapshot.geoSignals} />
        </div>
        <SignalRadar snapshot={snapshot} signals={filteredSignals} filter={signalFilter} onFilterChange={onSignalFilterChange} wide />
      </section>
    );
  }

  if (activeView === 'graph') {
    return (
      <section className="workspace-grid">
        <Suspense fallback={<ThreeLoading title="Loading 3D entity graph" />}>
          <EntityGraph3DPanel snapshot={snapshot} selectedCase={selectedCase} />
        </Suspense>
        <EntityGraph snapshot={snapshot} />
        <GraphPathPanel snapshot={snapshot} />
        <GeoRiskMap signals={snapshot.geoSignals} />
        <CaseQueue snapshot={snapshot} selectedCase={selectedCase} />
      </section>
    );
  }

  if (activeView === 'financials') {
    return (
      <section className="workspace-grid">
        <Suspense fallback={<ThreeLoading title="Loading 3D fund-flow tracker" />}>
          <FundFlow3DPanel snapshot={snapshot} selectedCase={selectedCase} />
        </Suspense>
        <FlowLedger snapshot={snapshot} selectedCase={selectedCase} />
        <FinancialAnalyzer snapshot={snapshot} />
        <FinancialLedger snapshot={snapshot} />
        <ConsensusMatrix snapshot={snapshot} />
        <CategoryPanel snapshot={snapshot} />
      </section>
    );
  }

  if (activeView === 'qwen') {
    return (
      <section className="workspace-grid">
        <QwenPerformance snapshot={snapshot} />
        <QwenGuardrailPanel snapshot={snapshot} />
        <DecisionBrief snapshot={snapshot} />
        <ConsensusMatrix snapshot={snapshot} />
      </section>
    );
  }

  if (activeView === 'report') {
    return <ReportCenter snapshot={snapshot} selectedCase={selectedCase} />;
  }

  return (
    <>
      <CommandHero snapshot={snapshot} selectedCase={selectedCase} onOpenWindow={onOpenWindow} />
      <section className="stacked-workspace command-page">
        <CanaraBenchmarkPanel snapshot={snapshot} />
        <LiveSourceMediaWall rotationSeed={snapshot.generatedAt} signals={snapshot.signals} />
        <RiskTrend snapshot={snapshot} />
        <LiveMediaWall snapshot={snapshot} selectedCase={selectedCase} />
        <CanaraServiceDeck snapshot={snapshot} onOpenWindow={onOpenWindow} />
        <SignalRadar snapshot={snapshot} signals={filteredSignals.slice(0, 4)} filter={signalFilter} onFilterChange={onSignalFilterChange} compact />
        <QwenPerformance snapshot={snapshot} />
        <ConnectorHealth connectors={snapshot.connectorStatus} compact />
        <CategoryPanel snapshot={snapshot} />
      </section>
    </>
  );
}

function CommandHero({ snapshot, selectedCase, onOpenWindow }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase; onOpenWindow: (type: string, title: string) => void }) {
  const metrics = [
    { label: 'Active cases', value: snapshot.overview.activeCases, icon: FileScan },
    { label: 'High risk', value: snapshot.overview.highRiskCases, icon: AlertTriangle },
    { label: 'Source freshness', value: `${snapshot.overview.sourceFreshness}%`, icon: RadioTower },
    { label: 'Qwen context', value: snapshot.qwenRuntime.effectiveContextWindow ?? snapshot.qwenRuntime.contextWindow, icon: Cpu },
  ];
  return (
    <section className="hero-band">
      <div className="hero-copy">
        <p className="eyebrow">{snapshot.portfolio.theme}</p>
        <h2>{selectedCase.applicant} is driving a {selectedCase.riskScore} Sentinel Risk Index.</h2>
        <p>
          {selectedCase.nextAction} The desk is correlating {snapshot.signals.length} source signals, {selectedCase.media.length} evidence objects,{' '}
          {snapshot.connectorStatus.length} live connectors, and local Qwen reasoning.
        </p>
        <div className="hero-actions">
          <button type="button" onClick={() => onOpenWindow('case', `${selectedCase.id} dossier`)}>Open dossier</button>
          <button type="button" onClick={() => onOpenWindow('agent', 'Investigation copilot')}>Ask copilot</button>
          <button type="button" onClick={() => onOpenWindow('sources', 'Live source feed')}>Source feed</button>
        </div>
      </div>
      <div className="risk-orb" aria-label={`Sentinel Risk Index ${selectedCase.riskScore}`}>
        <span>{selectedCase.riskScore}</span>
        <small>Sentinel Risk Index</small>
      </div>
      <div className="metric-strip">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <metric.icon size={20} />
            <span>{metric.value}</span>
            <small>{metric.label}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function CanaraServiceDeck({ snapshot, onOpenWindow }: { snapshot: SentinelSnapshot; onOpenWindow: (type: string, title: string) => void }) {
  const rows = [
    { label: 'Fraud desk', value: snapshot.overview.highRiskCases, icon: ShieldCheck, type: 'case' },
    { label: 'Live source room', value: snapshot.connectorStatus.filter((item) => item.status === 'live').length, icon: RadioTower, type: 'sources' },
    { label: 'Regional map', value: snapshot.geoSignals.length, icon: MapPinned, type: 'map' },
    { label: '3D fund flow', value: snapshot.transactionFlow.summary.eventCount, icon: Banknote, type: 'flow3d' },
    { label: '3D entity graph', value: snapshot.entityGraph3d.nodes.length, icon: Network, type: 'entity3d' },
    { label: 'Report builder', value: snapshot.qwenBrief.confidence, icon: Download, type: 'report' },
  ];
  return (
    <section className="panel panel-wide">
      <PanelTitle icon={Landmark} eyebrow="Canara-style quick access" title="Service and security console" />
      <div className="quick-service-grid">
        {rows.map((row) => (
          <button type="button" key={row.label} onClick={() => onOpenWindow(row.type, row.label)}>
            <row.icon size={22} />
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function CaseWorkbench({
  snapshot,
  caseItem,
  onOpenWindow,
  onRefresh,
  selectedDocumentId,
  selectedAnomalyId,
  explanationLanguage,
  explanationGranularity,
  onDocumentChange,
  onAnomalyChange,
  onExplanationLanguageChange,
  onExplanationGranularityChange,
}: {
  snapshot: SentinelSnapshot;
  caseItem: SentinelCase;
  onOpenWindow: (type: string, title: string) => void;
  onRefresh: () => Promise<void>;
  selectedDocumentId: string;
  selectedAnomalyId: string;
  explanationLanguage: string;
  explanationGranularity: string;
  onDocumentChange: (documentId: string) => void;
  onAnomalyChange: (anomalyId: string) => void;
  onExplanationLanguageChange: (language: string) => void;
  onExplanationGranularityChange: (granularity: string) => void;
}) {
  const workflow = getDocumentWorkflow(snapshot, caseItem.id);
  const [profileId, setProfileId] = useState(workflow.profileId);
  const [explanation, setExplanation] = useState<Record<string, unknown> | null>(null);
  const [counterfactual, setCounterfactual] = useState<Record<string, unknown> | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [replay, setReplay] = useState(false);
  const [overrideDecision, setOverrideDecision] = useState('Escalate for physical verification');
  const [overrideRationale, setOverrideRationale] = useState('');
  const selectedDocument = workflow.documents.find((document) => document.id === selectedDocumentId) ?? workflow.documents[0];
  const documentAnomalies = workflow.anomalies.filter((anomaly) => anomaly.documentId === selectedDocument?.id);
  const selectedAnomaly =
    workflow.anomalies.find((anomaly) => anomaly.id === selectedAnomalyId) ??
    documentAnomalies[0] ??
    workflow.anomalies[0];

  useEffect(() => {
    setProfileId(workflow.profileId);
    if (workflow.documents[0] && !workflow.documents.some((document) => document.id === selectedDocumentId)) {
      onDocumentChange(workflow.documents[0].id);
    }
    if (workflow.selectedAnomalyId && !workflow.anomalies.some((anomaly) => anomaly.id === selectedAnomalyId)) {
      onAnomalyChange(workflow.selectedAnomalyId);
    }
  }, [workflow.caseId, workflow.profileId, selectedDocumentId, selectedAnomalyId, onDocumentChange, onAnomalyChange]);

  const runIngestion = async (nextProfileId = profileId) => {
    setBusyAction('ingest');
    try {
      await ingestDocumentSet({
        caseId: caseItem.id,
        profileId: nextProfileId,
        language: explanationLanguage,
        granularity: explanationGranularity,
      });
      await onRefresh();
    } finally {
      setBusyAction('');
    }
  };

  const requestExplanation = async () => {
    if (!selectedAnomaly) return;
    setBusyAction('explain');
    try {
      const response = await explainDocumentAnomaly({
        caseId: caseItem.id,
        anomalyId: selectedAnomaly.id,
        language: explanationLanguage,
        granularity: explanationGranularity,
      });
      setExplanation(response.output ?? null);
    } finally {
      setBusyAction('');
    }
  };

  const requestCounterfactual = async () => {
    if (!selectedAnomaly) return;
    setBusyAction('counterfactual');
    try {
      const response = await runDocumentCounterfactual({
        caseId: caseItem.id,
        anomalyId: selectedAnomaly.id,
        language: explanationLanguage,
        granularity: explanationGranularity,
      });
      setCounterfactual(response.output ?? null);
    } finally {
      setBusyAction('');
    }
  };

  const submitOverride = async () => {
    if (!selectedAnomaly || !overrideRationale.trim()) return;
    setBusyAction('override');
    try {
      await submitUnderwritingOverride({
        caseId: caseItem.id,
        anomalyId: selectedAnomaly.id,
        decision: overrideDecision,
        rationale: overrideRationale,
      });
      setOverrideRationale('');
      await onRefresh();
    } finally {
      setBusyAction('');
    }
  };

  const downloadAudit = async () => {
    setBusyAction('audit');
    try {
      const report = await exportAuditReport(caseItem.id);
      const blob = new Blob([report.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = report.filename || `${caseItem.id}-audit-report.html`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <section className="document-workbench">
      <section className="panel panel-wide document-stage stage-ingest">
        <PanelTitle icon={Fingerprint} eyebrow="Stage 1 - Unified document ingestion" title="Canara explainable underwriting workbench" />
        <div className="doc-intel-hero">
          <div>
            <p className="eyebrow">{workflow.roleContext || 'Canara underwriter'} | {workflow.branchContext || caseItem.branch}</p>
            <h2>{caseItem.id} | {caseItem.applicant}</h2>
            <p>{workflow.scenario || caseItem.nextAction}</p>
            <small>{snapshot.documentIntelligence.dataBoundary}</small>
          </div>
          <div className="doc-risk-gauge" style={{ ['--risk' as string]: `${workflow.riskDecomposition.compositeScore}%` }}>
            <span>{workflow.riskDecomposition.compositeScore}</span>
            <small>Composite risk</small>
          </div>
        </div>
        <div className="loan-profile-row">
          <label>
            Loan category
            <select
              value={profileId}
              onChange={(event) => {
                setProfileId(event.target.value);
                void runIngestion(event.target.value);
              }}
            >
              {snapshot.loanProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
          </label>
          <div className="profile-requirements">
            {workflow.requirements.slice(0, 5).map((requirement) => <span key={requirement}>{requirement}</span>)}
          </div>
          <button type="button" disabled={busyAction === 'ingest'} onClick={() => runIngestion()}>
            <FileScan size={16} /> {busyAction === 'ingest' ? 'Streaming checks' : 'Run ingestion'}
          </button>
        </div>
        <div className="ingestion-stream">
          <div>
            <strong>{workflow.ingestionJob.currentStep}</strong>
            <span>{workflow.ingestionJob.progress}% complete | {workflow.ingestionJob.profileLabel}</span>
          </div>
          <progress value={workflow.ingestionJob.progress} max="100" />
          <div className="ingestion-steps">
            {workflow.ingestionJob.steps.map((step) => (
              <article className={step.state} key={step.id}>
                {step.state === 'complete' ? <CheckCircle2 size={15} /> : <Activity size={15} />}
                <span>{step.label}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel panel-wide document-stage stage-detect">
        <PanelTitle icon={Eye} eyebrow="Stage 2 - Embedded explainability" title="Real-time anomaly detection with synchronized reasoning" />
        <div className="stream-summary-row">
          {workflow.streams.map((stream) => (
            <button
              className={stream.anomalyIds.includes(selectedAnomaly?.id ?? '') ? 'active' : ''}
              key={stream.id}
              type="button"
              onClick={() => {
                const next = workflow.anomalies.find((anomaly) => anomaly.stream === stream.id);
                if (next) {
                  onAnomalyChange(next.id);
                  onDocumentChange(next.documentId);
                }
              }}
            >
              <span>{stream.label}</span>
              <strong>{stream.count}</strong>
              <small>{stream.averageConfidence}% avg</small>
            </button>
          ))}
        </div>
        <div className="document-detection-layout">
          <DocumentAnomalyViewer
            anomalies={workflow.anomalies}
            documents={workflow.documents}
            replay={replay}
            selectedAnomaly={selectedAnomaly}
            selectedDocument={selectedDocument}
            onAnomalyChange={onAnomalyChange}
            onDocumentChange={onDocumentChange}
          />
          <ReasoningEnginePanel
            busyAction={busyAction}
            counterfactual={counterfactual}
            explanation={explanation}
            granularity={explanationGranularity}
            language={explanationLanguage}
            replay={replay}
            selectedAnomaly={selectedAnomaly}
            settings={snapshot.explanationSettings}
            onCounterfactual={requestCounterfactual}
            onExplain={requestExplanation}
            onGranularityChange={onExplanationGranularityChange}
            onLanguageChange={onExplanationLanguageChange}
            onReplayToggle={() => setReplay((current) => !current)}
          />
        </div>
      </section>

      <RiskDecisionPanel
        busyAction={busyAction}
        caseItem={caseItem}
        counterfactual={counterfactual}
        onOpenWindow={onOpenWindow}
        onOverride={submitOverride}
        overrideDecision={overrideDecision}
        overrideRationale={overrideRationale}
        selectedAnomaly={selectedAnomaly}
        setOverrideDecision={setOverrideDecision}
        setOverrideRationale={setOverrideRationale}
        workflow={workflow}
      />

      <AuditTrailPanel workflow={workflow} onDownload={downloadAudit} busy={busyAction === 'audit'} />
      <FraudContextPanel snapshot={snapshot} />
    </section>
  );
}

function DocumentAnomalyViewer({
  documents,
  anomalies,
  selectedDocument,
  selectedAnomaly,
  replay,
  onDocumentChange,
  onAnomalyChange,
}: {
  documents: DocumentIntelDocument[];
  anomalies: DocumentAnomaly[];
  selectedDocument?: DocumentIntelDocument;
  selectedAnomaly?: DocumentAnomaly;
  replay: boolean;
  onDocumentChange: (documentId: string) => void;
  onAnomalyChange: (anomalyId: string) => void;
}) {
  const visibleAnomalies = anomalies.filter((anomaly) => anomaly.documentId === selectedDocument?.id);
  return (
    <div className="document-viewer-shell">
      <div className="document-tabs" role="tablist" aria-label="Detected documents">
        {documents.map((documentItem) => (
          <button
            className={documentItem.id === selectedDocument?.id ? 'active' : ''}
            key={documentItem.id}
            type="button"
            onClick={() => onDocumentChange(documentItem.id)}
          >
            <FileScan size={14} />
            <span>{documentItem.title}</span>
            <small>{documentItem.status}</small>
          </button>
        ))}
      </div>
      <div className={`document-canvas ${selectedDocument?.status ?? 'review'}`}>
        <div className="doc-page">
          <div className="doc-letterhead">
            <span>Canara underwriting evidence copy</span>
            <strong>{selectedDocument?.category ?? 'Document'}</strong>
          </div>
          <div className="doc-grid-lines">
            {Array.from({ length: 9 }).map((_, index) => <i key={index} />)}
          </div>
          <div className="doc-body-lines">
            {Array.from({ length: 16 }).map((_, index) => <span key={index} style={{ width: `${68 + ((index * 13) % 24)}%` }} />)}
          </div>
          <div className="doc-stamp">REG</div>
          {visibleAnomalies.map((anomaly) => (
            <button
              className={`anomaly-overlay ${anomaly.severity} ${selectedAnomaly?.id === anomaly.id ? 'selected' : ''}`}
              key={anomaly.id}
              onClick={() => onAnomalyChange(anomaly.id)}
              style={{
                left: `${anomaly.bbox.x}%`,
                top: `${anomaly.bbox.y}%`,
                width: `${anomaly.bbox.w}%`,
                height: `${anomaly.bbox.h}%`,
              }}
              type="button"
              title={anomaly.title}
            >
              <span>{anomaly.confidence}%</span>
            </button>
          ))}
          {replay && selectedAnomaly?.attentionPath.map((step, index) => (
            <span
              className="attention-replay"
              key={`${selectedAnomaly.id}-${step.label}-${index}`}
              style={{
                left: `${step.x}%`,
                top: `${step.y}%`,
                width: `${step.w}%`,
                height: `${step.h}%`,
                animationDelay: `${index * 0.42}s`,
              }}
            >
              {step.label}
            </span>
          ))}
        </div>
        <div className="document-legend">
          <span><i className="critical" /> critical</span>
          <span><i className="high" /> high</span>
          <span><i className="low" /> low</span>
          <strong>{visibleAnomalies.length} active overlays</strong>
        </div>
      </div>
    </div>
  );
}

function ReasoningEnginePanel({
  selectedAnomaly,
  settings,
  language,
  granularity,
  explanation,
  counterfactual,
  replay,
  busyAction,
  onLanguageChange,
  onGranularityChange,
  onExplain,
  onCounterfactual,
  onReplayToggle,
}: {
  selectedAnomaly?: DocumentAnomaly;
  settings: SentinelSnapshot['explanationSettings'];
  language: string;
  granularity: string;
  explanation: Record<string, unknown> | null;
  counterfactual: Record<string, unknown> | null;
  replay: boolean;
  busyAction: string;
  onLanguageChange: (language: string) => void;
  onGranularityChange: (granularity: string) => void;
  onExplain: () => Promise<void>;
  onCounterfactual: () => Promise<void>;
  onReplayToggle: () => void;
}) {
  if (!selectedAnomaly) {
    return <aside className="reasoning-panel empty">No anomaly selected.</aside>;
  }
  const explanationAnswer = String(explanation?.answer ?? selectedAnomaly.why);
  const explanationMode = String(explanation?.mode ?? 'detector facts');
  return (
    <aside className="reasoning-panel">
      <div className="reasoning-header">
        <div>
          <p className="eyebrow">AI reasoning engine</p>
          <h3>{selectedAnomaly.title}</h3>
        </div>
        <strong>{selectedAnomaly.confidence}%</strong>
      </div>
      <div className="explain-controls">
        <label>
          Language
          <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
            {settings.supportedLanguages.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Detail
          <select value={granularity} onChange={(event) => onGranularityChange(event.target.value)}>
            {settings.supportedGranularity.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <div className={`confidence-spectrum ${selectedAnomaly.severity}`}>
        <span style={{ width: `${selectedAnomaly.confidence}%` }} />
      </div>
      <article className="why-card">
        <span>Why this?</span>
        <p>{explanationAnswer}</p>
        <small>{explanationMode} | {selectedAnomaly.severity}</small>
      </article>
      <div className="observed-baseline-grid">
        <article>
          <span>What the model observed</span>
          <p>{String(explanation?.observed ?? selectedAnomaly.observed)}</p>
        </article>
        <article>
          <span>Expected baseline</span>
          <p>{String(explanation?.baseline ?? selectedAnomaly.baseline)}</p>
        </article>
      </div>
      <div className="micro-viz">
        <div>
          <span>{selectedAnomaly.microViz.label}</span>
          <strong>{selectedAnomaly.microViz.value}{selectedAnomaly.microViz.unit}</strong>
          <small>baseline {selectedAnomaly.microViz.referenceValue}{selectedAnomaly.microViz.unit}</small>
        </div>
        <i style={{ width: `${Math.max(4, Math.min(100, Number(selectedAnomaly.microViz.value)))}%` }} />
      </div>
      <div className="source-trace-list">
        {selectedAnomaly.sourceTrace.map((trace) => (
          <article key={trace.id}>
            <span>{trace.status}</span>
            <strong>{trace.label}</strong>
            <small>{trace.source}</small>
          </article>
        ))}
      </div>
      {counterfactual && (
        <article className="counterfactual-card">
          <span>Counterfactual</span>
          <p>{String(counterfactual.summary ?? '')}</p>
          <strong>{String(counterfactual.currentRisk ?? '')}{' -> '}{String(counterfactual.counterfactualRisk ?? '')}</strong>
        </article>
      )}
      <div className="reasoning-actions">
        <button type="button" disabled={busyAction === 'explain'} onClick={onExplain}><BrainCircuit size={15} /> Explain this</button>
        <button type="button" onClick={onReplayToggle}><Activity size={15} /> {replay ? 'Stop replay' : 'Attention replay'}</button>
        <button type="button" disabled={busyAction === 'counterfactual'} onClick={onCounterfactual}><AlertTriangle size={15} /> Counterfactual</button>
      </div>
    </aside>
  );
}

function RiskDecisionPanel({
  workflow,
  caseItem,
  selectedAnomaly,
  counterfactual,
  overrideDecision,
  overrideRationale,
  busyAction,
  setOverrideDecision,
  setOverrideRationale,
  onOverride,
  onOpenWindow,
}: {
  workflow: DocumentWorkflow;
  caseItem: SentinelCase;
  selectedAnomaly?: DocumentAnomaly;
  counterfactual: Record<string, unknown> | null;
  overrideDecision: string;
  overrideRationale: string;
  busyAction: string;
  setOverrideDecision: (decision: string) => void;
  setOverrideRationale: (rationale: string) => void;
  onOverride: () => Promise<void>;
  onOpenWindow: (type: string, title: string) => void;
}) {
  return (
    <section className="panel panel-wide document-stage stage-decision">
      <PanelTitle icon={BrainCircuit} eyebrow="Stage 3 - Explainable risk scoring" title={workflow.riskDecomposition.decision} />
      <div className="decision-layout">
        <div className="risk-breakdown">
          <div className="doc-risk-gauge large" style={{ ['--risk' as string]: `${workflow.riskDecomposition.compositeScore}%` }}>
            <span>{workflow.riskDecomposition.compositeScore}</span>
            <small>Composite risk</small>
          </div>
          <div className="risk-components">
            {workflow.riskDecomposition.items.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.weight}% weight</span>
                </div>
                <b>{item.score}</b>
                <i style={{ width: `${item.score}%` }} />
                <small>{item.drivers.join(' | ')}</small>
              </article>
            ))}
          </div>
        </div>
        <div className="underwriting-memo">
          <p className="eyebrow">Synthetic narrative</p>
          <h3>{caseItem.loanType} | {workflow.profileLabel}</h3>
          <p>{workflow.memo}</p>
          {counterfactual && <small>Counterfactual risk movement: {String(counterfactual.currentRisk ?? '')}{' -> '}{String(counterfactual.counterfactualRisk ?? '')}</small>}
          <div className="next-action-list">
            {workflow.nextActions.map((action) => <span key={action}>{action}</span>)}
          </div>
          <button type="button" onClick={() => onOpenWindow('flow3d', `${caseItem.id} 3D fund flow`)}><Network size={16} /> Correlate in 3D flow</button>
        </div>
        <div className="override-box">
          <p className="eyebrow">Human-in-the-loop override</p>
          <select value={overrideDecision} onChange={(event) => setOverrideDecision(event.target.value)}>
            <option>Escalate for physical verification</option>
            <option>Hold for enhanced verification</option>
            <option>Proceed with reviewer caveat</option>
            <option>Dismiss selected anomaly</option>
          </select>
          <textarea
            value={overrideRationale}
            onChange={(event) => setOverrideRationale(event.target.value)}
            placeholder={`Reviewer rationale for ${selectedAnomaly?.id ?? 'selected anomaly'}`}
          />
          <button type="button" disabled={!overrideRationale.trim() || busyAction === 'override'} onClick={onOverride}>
            <ShieldCheck size={15} /> Log override
          </button>
          <div className="override-history">
            {workflow.overrides.length ? workflow.overrides.map((override) => (
              <article key={override.id}>
                <strong>{override.decision}</strong>
                <p>{override.rationale}</p>
                <small>{formatDateTime(override.createdAt)}</small>
              </article>
            )) : <span>No override logged for this case.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditTrailPanel({ workflow, onDownload, busy }: { workflow: DocumentWorkflow; onDownload: () => Promise<void>; busy: boolean }) {
  return (
    <section className="panel panel-wide document-stage stage-audit">
      <PanelTitle icon={ShieldCheck} eyebrow="Stage 4 - Immutable audit trail" title="Local hash-chain compliance replay" />
      <div className="audit-summary">
        <MetricLine label="Mode" value={workflow.auditTrail.mode} />
        <MetricLine label="Events" value={workflow.auditTrail.eventCount} />
        <MetricLine label="Chain valid" value={workflow.auditTrail.chainValid ? 'true' : 'false'} />
        <MetricLine label="Last hash" value={workflow.auditTrail.lastHash.slice(0, 14)} />
        <button type="button" disabled={busy} onClick={onDownload}><Download size={16} /> Export audit pack</button>
      </div>
      <div className="audit-timeline">
        {workflow.auditTrail.events.map((event) => (
          <article key={`${event.sequence}-${event.hash}`}>
            <span>{event.sequence}</span>
            <div>
              <strong>{event.label}</strong>
              <p>{event.detail}</p>
              <small>{event.actor} | {formatDateTime(event.timestamp)} | hash {event.hash.slice(0, 18)}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FraudContextPanel({ snapshot }: { snapshot: SentinelSnapshot }) {
  const context = snapshot.fraudContext;
  return (
    <section className="panel panel-wide fraud-context-panel">
      <PanelTitle icon={Landmark} eyebrow="India present-day criticality" title="Report-derived document fraud context" />
      <p className="benchmark-boundary">{context.provenance.note}</p>
      <div className="fraud-kpi-row">
        {context.nationalSignals.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
      <div className="fraud-context-grid">
        <div>
          <h3>Document category risk</h3>
          {context.documentCategories.map((category) => (
            <article key={category.category}>
              <span>{category.category}</span>
              <strong>{category.share}% | {category.trend}</strong>
              <p>{category.risk}</p>
              <i style={{ width: `${category.share}%` }} />
            </article>
          ))}
        </div>
        <div>
          <h3>State exposure and legal regime</h3>
          {context.stateRisks.map((state) => (
            <article key={state.state}>
              <span>Rank {state.rank}</span>
              <strong>{state.state}</strong>
              <p>{state.volume2024} | {state.primaryRisk}</p>
            </article>
          ))}
          <article className="legal-regime-card">
            <strong>BNS transition: {context.legalRegime.transitionDate}</strong>
            <p>{context.legalRegime.modelingUse}</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function LiveMediaPreview({
  item,
  caseItem,
  generatedAt,
  compact = false,
  sourceSignals = [],
  rotationSeed = '',
}: {
  item: CaseMedia;
  caseItem: SentinelCase;
  generatedAt: string;
  compact?: boolean;
  sourceSignals?: Signal[];
  rotationSeed?: string;
}) {
  const hasUploadedAsset = isUploadedAsset(item);
  const sourceSignal = useMemo(() => selectEvidenceSourceSignal(item, sourceSignals, rotationSeed), [item.id, item.kind, rotationSeed, sourceSignals]);
  const sourceResolution = useResolvedSourceMedia(hasUploadedAsset ? undefined : sourceSignal);
  const hasLiveFallback = Boolean(!hasUploadedAsset && sourceSignal);
  return (
    <figure className={`media-preview ${item.kind} ${compact ? 'compact' : ''}`}>
      <div className={`media-frame ${hasUploadedAsset ? 'asset-backed' : 'metadata-backed'}`}>
        {hasUploadedAsset && item.kind === 'video' ? (
          <video src={toAssetUrl(item.url)} controls muted />
        ) : hasUploadedAsset && item.kind === 'pdf' ? (
          <object data={toAssetUrl(item.url)} type="application/pdf" aria-label={`${item.title} PDF preview`} />
        ) : hasUploadedAsset ? (
          <img src={toAssetUrl(item.previewUrl || item.url)} alt={`${item.title} uploaded evidence preview`} />
        ) : hasLiveFallback && sourceSignal ? (
          <EvidenceSourceBackedPreview compact={compact} item={item} resolution={sourceResolution} signal={sourceSignal} />
        ) : (
          <EvidenceMetadataPreview caseItem={caseItem} compact={compact} generatedAt={generatedAt} item={item} />
        )}
        {hasUploadedAsset && (
          <>
            <span className="live-badge">{item.streamState}</span>
            <div className="media-hud">
              <span>Heat {item.tamperHeat}%</span>
              <span>OCR {item.ocrConfidence}%</span>
              <span>{item.framesAnalyzed} frames</span>
            </div>
            <div className="media-reticle" />
          </>
        )}
      </div>
      <figcaption>
        <div>
          <span>{item.title}</span>
          <small>{item.detector} | {hasLiveFallback && sourceSignal ? `source-backed: ${sourceLabel(sourceSignal.sourceUrl)}` : sourceLabel(item.provenance?.sourceUrl)}</small>
        </div>
        <strong>{hasUploadedAsset ? `${item.integrityScore}% integrity` : hasLiveFallback ? 'live corroboration' : 'metadata only'}</strong>
      </figcaption>
    </figure>
  );
}

function EvidenceSourceBackedPreview({
  item,
  signal,
  resolution,
  compact = false,
}: {
  item: CaseMedia;
  signal: Signal;
  resolution: SourceMediaState;
  compact?: boolean;
}) {
  const selected = selectEvidenceMedia(item, resolution.data?.items ?? []);
  return (
    <div className={`evidence-live-source ${compact ? 'compact' : ''}`}>
      {selected ? <SourceMediaAsset item={selected} /> : <SourceSignalFallback detail={resolution.data?.detail || resolution.error} signal={signal} compact />}
      <div className="evidence-source-band">
        <span>{signal.type} | {sourceLabel(signal.sourceUrl)}</span>
        <strong>{signal.title}</strong>
        <small>{selected ? `${selected.kind.toUpperCase()} | ${selected.role}` : 'Resolving live source media'}</small>
      </div>
    </div>
  );
}

function EvidenceMetadataPreview({
  item,
  caseItem,
  generatedAt,
  compact = false,
}: {
  item: CaseMedia;
  caseItem: SentinelCase;
  generatedAt: string;
  compact?: boolean;
}) {
  const metrics = [
    { label: 'Tamper heat', value: `${item.tamperHeat}%`, width: item.tamperHeat },
    { label: 'OCR confidence', value: `${item.ocrConfidence}%`, width: item.ocrConfidence },
    { label: 'Case risk', value: `${caseItem.riskScore}%`, width: caseItem.riskScore },
  ];
  if (compact) {
    return (
      <div className="evidence-placeholder compact-evidence">
        <div className="evidence-header">
          <span>{item.kind.toUpperCase()}</span>
          <strong>Indexed dossier asset</strong>
        </div>
        <div className="compact-evidence-meta">
          <span><small>Case</small><strong>{caseItem.id}</strong></span>
          <span><small>Retrieved</small><strong>{formatShortDate(item.provenance?.retrievedAt || generatedAt)}</strong></span>
          <span><small>Source</small><strong>{sourceLabel(item.provenance?.sourceUrl)}</strong></span>
        </div>
        <div className="compact-evidence-scores">
          {metrics.map((metric) => (
            <span key={metric.label}>
              <small>{metric.label.replace(' confidence', '')}</small>
              <strong>{metric.value}</strong>
              <i style={{ width: `${Math.max(6, Math.min(100, Number(metric.width)))}%` }} />
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="evidence-placeholder">
      <div className="evidence-header">
        <span>{item.kind.toUpperCase()}</span>
        <strong>Source file not attached</strong>
      </div>
      <dl className="evidence-ledger">
        <div>
          <dt>Case</dt>
          <dd>{caseItem.id}</dd>
        </div>
        <div>
          <dt>Retrieved</dt>
          <dd>{formatDateTime(item.provenance?.retrievedAt || generatedAt)}</dd>
        </div>
        <div>
          <dt>Provenance</dt>
          <dd>{sourceLabel(item.provenance?.sourceUrl)}</dd>
        </div>
      </dl>
      <div className="evidence-meters">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <i style={{ width: `${Math.max(6, Math.min(100, Number(metric.width)))}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveMediaWall({ snapshot, selectedCase }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase }) {
  const mediaItems = useMemo(() => {
    const selectedRows = selectedCase.media.map((item) => ({ caseItem: selectedCase, item }));
    const portfolioRows = snapshot.cases
      .filter((caseItem) => caseItem.id !== selectedCase.id)
      .flatMap((caseItem) => caseItem.media.map((item) => ({ caseItem, item })));
    return [...selectedRows, ...portfolioRows].slice(0, 18);
  }, [selectedCase, snapshot.cases]);
  return (
    <section className="panel panel-wide media-wall-panel">
      <PanelTitle icon={PanelTopOpen} eyebrow="Evidence media catalog" title="Live image/video/PDF evidence preview matrix" />
      <div className="media-wall-lead">
        <strong>{selectedCase.id}</strong>
        <span>{selectedCase.media.length} selected-case assets | {mediaItems.length} portfolio assets indexed</span>
      </div>
      <div className="media-wall">
        {mediaItems.map(({ caseItem, item }) => (
          <LiveMediaPreview caseItem={caseItem} compact generatedAt={snapshot.generatedAt} item={item} key={`${caseItem.id}-${item.id}`} rotationSeed={snapshot.generatedAt} sourceSignals={snapshot.signals} />
        ))}
      </div>
    </section>
  );
}

function LiveSourceMediaWall({ signals, rotationSeed }: { signals: Signal[]; rotationSeed: string }) {
  const previewSignals = useMemo(() => selectMediaWallSignals(signals, 18, rotationSeed), [rotationSeed, signals]);
  return (
    <section className="panel live-source-media-panel">
      <PanelTitle icon={Globe2} eyebrow="Live source media" title="Expanded active image, PDF, and video previews" />
      <div className="source-media-wall">
        {previewSignals.map((signal) => (
          <SourceMediaTile key={signal.id} signal={signal} />
        ))}
      </div>
    </section>
  );
}

function SourceMediaTile({ signal }: { signal: Signal }) {
  const resolution = useResolvedSourceMedia(signal);
  const items = sortPreviewMedia(resolution.data?.items ?? []);
  const primary = selectPrimaryMedia(items);
  const showSourceProfile = !primary || (primary.role.includes('screenshot') && sourceLabel(primary.url).includes('rbi.org.in'));
  const mosaicItems = items
    .filter((item) => item.id !== primary?.id && !(item.role.includes('screenshot') && sourceLabel(item.url).includes('rbi.org.in')))
    .slice(0, 5);
  return (
    <article className={`source-media-tile ${resolution.data?.status ?? resolution.status}`}>
      <div className="source-media-stage">
        {showSourceProfile ? <SourceSignalFallback detail={resolution.data?.detail || resolution.error} signal={signal} /> : <SourceMediaAsset item={primary} />}
      </div>
      <div className={`source-media-mosaic ${mosaicItems.length ? '' : 'empty'}`}>
        {mosaicItems.length ? mosaicItems.map((item) => <SourceMediaAsset item={item} key={item.id} />) : (
          <SourceSignalFallback detail={resolution.data?.detail || resolution.error || 'No additional embedded media exposed'} signal={signal} compact />
        )}
      </div>
      <div className="source-media-copy">
        <span>{signal.type} | {sourceLabel(signal.sourceUrl)}</span>
        <strong>{signal.title}</strong>
        <small>
          {items.length ? `${items.filter((item) => item.kind === 'video').length} video | ${items.filter((item) => item.kind === 'image').length} image | ${items.filter((item) => item.kind === 'pdf').length} PDF assets` : 'SOURCE PROFILE | live connector evidence'}
        </small>
      </div>
    </article>
  );
}

function SignalRadar({ snapshot, signals, filter = 'ALL', onFilterChange, compact = false, wide = false }: {
  snapshot: SentinelSnapshot;
  signals?: Signal[];
  filter?: SignalFilter;
  onFilterChange?: (filter: SignalFilter) => void;
  compact?: boolean;
  wide?: boolean;
}) {
  const visibleSignals = signals ?? snapshot.signals;
  const signalTypes: SignalFilter[] = ['OSINT', 'SOCMINT', 'CYBINT', 'TECHINT'];
  return (
    <section className={`panel panel-tall ${compact ? 'compact-panel' : ''} ${wide ? 'signal-feed-panel' : ''}`}>
      <PanelTitle icon={Globe2} eyebrow="Live public-source layer" title="OSINT / SOCMINT / CYBINT / TECHINT" />
      <div className="signal-summary">
        {signalTypes.map((type) => {
          const typeSignals = snapshot.signals.filter((signal) => signal.type === type);
          const averageConfidence = typeSignals.length ? Math.round(typeSignals.reduce((sum, signal) => sum + signal.confidence, 0) / typeSignals.length) : 0;
          return (
            <article key={type}>
              <span>{type}</span>
              <strong>{typeSignals.length}</strong>
              <small>{averageConfidence}% avg confidence</small>
            </article>
          );
        })}
      </div>
      {onFilterChange && (
        <div className="filter-row" aria-label="Signal type filter">
          {(['ALL', 'OSINT', 'SOCMINT', 'CYBINT', 'TECHINT'] as SignalFilter[]).map((item) => (
            <button className={filter === item ? 'active' : ''} key={item} onClick={() => onFilterChange(item)} type="button">
              {item}
            </button>
          ))}
        </div>
      )}
      <div className="signal-list">
        {visibleSignals.map((signal) => (
          <article className="signal-card" key={signal.id}>
            <SourcePreview signal={signal} />
            <div>
              <div className="signal-meta">
                <span>{signal.type}</span>
                <strong>{signal.confidence}%</strong>
              </div>
              <h3>{signal.title}</h3>
              <p>{signal.summary}</p>
              <small>{signal.source} | {signal.severity} | {signal.provenance?.connectorStatus ?? 'source'}</small>
              {signal.sourceUrl && (
                <a href={signal.sourceUrl} target="_blank" rel="noreferrer">
                  <Link2 size={13} /> source
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SourcePreview({ signal }: { signal: Signal }) {
  const connectorStatus = signal.provenance?.connectorStatus ?? 'source';
  const resolution = useResolvedSourceMedia(signal);
  return (
    <div className={`source-preview ${connectorStatus}`}>
      <div className="source-preview-head">
        <span>{signal.type}</span>
        <strong>{sourceLabel(signal.sourceUrl)}</strong>
      </div>
      <SourceMediaStrip resolution={resolution} signal={signal} />
      <div className="source-preview-score" aria-label={`${signal.confidence}% confidence`}>
        <i style={{ width: `${Math.max(4, Math.min(100, signal.confidence))}%` }} />
      </div>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{connectorStatus}</dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd>{formatDateTime(signal.observedAt)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{signal.source}</dd>
        </div>
      </dl>
    </div>
  );
}

function SourceMediaStrip({ resolution, signal }: { resolution: SourceMediaState; signal: Signal }) {
  const items = sortPreviewMedia(resolution.data?.items ?? []);
  if (!items.length) {
    return <SourceSignalFallback detail={resolution.data?.detail || resolution.error} signal={signal} compact />;
  }
  const screenshot = items.find((item) => item.role.includes('screenshot'));
  const nonScreenshots = items.filter((item) => !item.role.includes('screenshot'));
  if (screenshot && !nonScreenshots.length && sourceLabel(screenshot.url).includes('rbi.org.in')) {
    return <SourceSignalFallback detail="Live RBI source indexed; rendered as source profile to avoid blocked browser screenshots" signal={signal} compact />;
  }
  const visibleItems = nonScreenshots.length ? nonScreenshots.slice(0, 4) : screenshot ? [screenshot] : items.slice(0, 4);
  return (
    <div className={`source-media-strip count-${visibleItems.length} ${visibleItems.length === 1 ? 'single' : ''}`}>
      {visibleItems.map((item) => (
        <SourceMediaAsset item={item} key={item.id} />
      ))}
    </div>
  );
}

function SourceMediaAsset({ item }: { item: SourceMedia }) {
  const assetUrl = toAssetUrl(item.previewUrl || item.url);
  if (item.kind === 'video') {
    if (item.embedUrl) {
      return (
        <a className="source-video-preview" href={item.url} target="_blank" rel="noreferrer" title={item.title}>
          <SourceImage alt={item.title} src={assetUrl} />
          <span>Play video</span>
        </a>
      );
    }
    return <video src={assetUrl} controls muted preload="metadata" title={item.title} />;
  }
  if (item.kind === 'pdf') {
    return (
      <a className="source-pdf-preview visual-pdf-preview" href={toAssetUrl(item.url)} target="_blank" rel="noreferrer" title={item.title}>
        <SourceImage alt={`${item.title} PDF first page`} fallback={<SourceDocumentPreview item={item} />} src={assetUrl} />
        <span>PDF source</span>
      </a>
    );
  }
  return <SourceImage alt={item.title} fallback={item.role.includes('screenshot') ? <SourceDocumentPreview item={item} /> : undefined} src={assetUrl} />;
}

function SourceImage({ src, alt, fallback }: { src: string; alt: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="source-image-fallback">
        <FileScan size={24} />
        <span>Media source reachable</span>
        <strong>{alt}</strong>
      </div>
    );
  }
  return <img alt={alt} decoding="async" loading="eager" onError={() => setFailed(true)} src={src} />;
}

function SourceDocumentPreview({ item }: { item: SourceMedia }) {
  const host = sourceLabel(item.url);
  const words = item.title.split(/\s+/).filter(Boolean).slice(0, 10);
  const accent = sourceAccent(item.id);
  const documentType = classifyDocumentTitle(item.title);
  return (
    <div className="source-document-preview" style={{ '--doc-accent': accent } as CSSProperties}>
      <div className="document-preview-top">
        <FileScan size={22} />
        <span>{documentType}</span>
        <strong>{host}</strong>
      </div>
      <h4>{item.title}</h4>
      <div className="document-preview-lines" aria-hidden="true">
        {words.slice(0, 6).map((word, index) => (
          <i key={`${word}-${index}`} style={{ width: `${Math.min(94, Math.max(28, word.length * 8 + index * 5))}%` }} />
        ))}
      </div>
      <div className="document-preview-footer">
        <span>{item.role}</span>
        <strong>{item.id.slice(0, 8).toUpperCase()}</strong>
      </div>
    </div>
  );
}

function SourceSignalFallback({ signal, detail, compact = false }: { signal: Signal; detail?: string; compact?: boolean }) {
  const item: SourceMedia = {
    id: signal.id,
    kind: 'image',
    title: signal.title,
    url: signal.sourceUrl || '',
    previewUrl: '',
    contentType: 'text/html',
    role: `${signal.type} live source profile`,
    confidence: signal.confidence,
  };
  return (
    <div className={`source-signal-fallback ${compact ? 'compact' : ''}`}>
      <SourceDocumentPreview item={item} />
      {!compact && (
        <div className="source-signal-status">
          <span>{signal.provenance?.connectorStatus ?? 'source'}</span>
          <strong>{Math.round(signal.confidence)}%</strong>
          <small>{detail || signal.source}</small>
        </div>
      )}
    </div>
  );
}

function SourceMediaEmpty({ status, detail, compact = false }: { status: string; detail?: string; compact?: boolean }) {
  return (
    <div className={`source-media-empty ${compact ? 'compact' : ''}`}>
      <span>{status}</span>
      <strong>{detail || 'Resolving live source media'}</strong>
    </div>
  );
}

function sortPreviewMedia(items: SourceMedia[]) {
  const rank: Record<SourceMedia['kind'], number> = { video: 0, image: 1, pdf: 2 };
  return [...items].sort((left, right) => rank[left.kind] - rank[right.kind] || right.confidence - left.confidence);
}

function selectPrimaryMedia(items: SourceMedia[]) {
  return sortPreviewMedia(items)[0];
}

function selectEvidenceMedia(item: CaseMedia, items: SourceMedia[]) {
  if (!items.length) return undefined;
  const sorted = sortPreviewMedia(items);
  if (item.kind === 'video') return sorted.find((media) => media.kind === 'video') ?? sorted[0];
  if (item.kind === 'pdf' || item.kind === 'document') return sorted.find((media) => media.role.includes('screenshot')) ?? sorted.find((media) => media.kind === 'pdf') ?? sorted[0];
  if (item.kind === 'image') return sorted.find((media) => media.kind === 'image') ?? sorted[0];
  return sorted[0];
}

function selectEvidenceSourceSignal(item: CaseMedia, signals: Signal[], rotationSeed = '') {
  const videos = signals.filter((signal) => signal.sourceMedia?.some((media) => media.kind === 'video'));
  const sourceDocuments = signals.filter((signal) => signal.sourceUrl && !signal.sourceMedia?.length);
  const seed = rotationBucket(rotationSeed);
  const pool = rotateItems(item.kind === 'video' ? videos : sourceDocuments.length ? sourceDocuments : videos, seed);
  if (!pool.length) return undefined;
  const index = stableIndex(`${item.id}-${seed}`, pool.length);
  return pool[index];
}

function selectMediaWallSignals(signals: Signal[], limit: number, rotationSeed = '') {
  const seed = rotationBucket(rotationSeed);
  const videoPool = signals.filter((signal) => signal.sourceMedia?.some((media) => media.kind === 'video'));
  const sourceDocumentPool = signals.filter((signal) => signal.sourceUrl && !signal.sourceMedia?.length);
  const liveConnectorPool = signals.filter((signal) => signal.provenance?.connectorStatus === 'live');
  const videos = rotateItems(videoPool, stableIndex(`videos-${seed}`, Math.max(1, videoPool.length)));
  const sourceDocuments = rotateItems(sourceDocumentPool, stableIndex(`documents-${seed}`, Math.max(1, sourceDocumentPool.length)));
  const liveConnectors = rotateItems(liveConnectorPool, stableIndex(`live-${seed}`, Math.max(1, liveConnectorPool.length)));
  const selected: Signal[] = [];
  const max = Math.max(videos.length, sourceDocuments.length, liveConnectors.length, limit * 2);
  for (let index = 0; index < max && selected.length < limit; index += 1) {
    addUniqueSignal(selected, videos[index], limit);
    addUniqueSignal(selected, sourceDocuments[index], limit);
    addUniqueSignal(selected, liveConnectors[index], limit);
  }
  for (const signal of rotateItems(signals, stableIndex(`all-${seed}`, Math.max(1, signals.length)))) {
    if (selected.length >= limit) break;
    if (!selected.some((item) => item.id === signal.id)) selected.push(signal);
  }
  return selected.slice(0, limit);
}

function addUniqueSignal(selected: Signal[], signal: Signal | undefined, limit: number) {
  if (!signal || selected.length >= limit) return;
  if (!selected.some((item) => item.id === signal.id)) selected.push(signal);
}

function rotateItems<T>(items: T[], seed: number) {
  if (items.length <= 1) return items;
  const offset = Math.abs(seed) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function rotationBucket(value: string) {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return stableIndex(value || String(Date.now()), 97);
  return Math.floor(parsed / 11000);
}

function stableIndex(value: string, modulo: number) {
  if (modulo <= 1) return 0;
  const hash = Array.from(value).reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619), 2166136261);
  return Math.abs(hash) % modulo;
}

function getDocumentWorkflow(snapshot: SentinelSnapshot, caseId: string): DocumentWorkflow {
  return snapshot.documentIntelligence.workflows[caseId] ?? snapshot.documentIntelligence.current;
}

function classifyDocumentTitle(title: string) {
  const lowered = title.toLowerCase();
  if (lowered.includes('prudential')) return 'Prudential circular';
  if (lowered.includes('financial statement')) return 'Disclosure circular';
  if (lowered.includes('co-operative')) return 'Co-operative circular';
  if (lowered.includes('rural')) return 'Rural banking circular';
  if (lowered.includes('local area')) return 'Local area bank circular';
  return 'Source circular';
}

function sourceAccent(seed: string) {
  const palette = ['#005ca8', '#008c95', '#d83b01', '#6b7785', '#7a4f01', '#0b6b3a'];
  return palette[stableIndex(seed, palette.length)];
}

function ConnectorHealth({ connectors, compact = false }: { connectors: ConnectorStatus[]; compact?: boolean }) {
  return (
    <section className={`panel ${compact ? '' : 'panel-wide'}`}>
      <PanelTitle icon={RadioTower} eyebrow="Connector observability" title="Live source health" />
      <div className="connector-grid">
        {connectors.map((connector) => (
          <article className={`connector-card ${connector.status}`} key={connector.id}>
            <span>{connector.type}</span>
            <strong>{connector.name}</strong>
            <p>{connector.detail}</p>
            <small>{connector.status} | {connector.latencyMs} ms | {connector.items.length} items</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function CaseQueue({ snapshot, selectedCase }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase }) {
  return (
    <section className="panel">
      <PanelTitle icon={Layers} eyebrow="Dynamic case queue" title="Underwriting windows" />
      <div className="case-queue">
        {snapshot.cases.map((caseItem) => (
          <article className={caseItem.id === selectedCase.id ? 'selected' : ''} key={caseItem.id}>
            <div>
              <strong>{caseItem.id}</strong>
              <p>{caseItem.applicant}</p>
            </div>
            <span className={`status-chip ${statusTone[caseItem.status]}`}>{caseItem.status}</span>
            <progress value={caseItem.riskScore} max="100" aria-label={`${caseItem.id} risk score`} />
          </article>
        ))}
      </div>
    </section>
  );
}

function DecisionBrief({ snapshot }: { snapshot: SentinelSnapshot }) {
  const brief = snapshot.qwenBrief;
  return (
    <section className="panel panel-large decision-brief">
      <PanelTitle icon={BrainCircuit} eyebrow="Evidence-grounded decision support" title={brief.recommendedAction} />
      <div className="brief-grid">
        <div className="brief-main">
          <h3>{brief.headline}</h3>
          <p>{brief.summary}</p>
          <div className="brief-scores">
            <div><span>{brief.confidence}%</span><small>Qwen confidence</small></div>
            <div><span>{brief.materialityScore}</span><small>Materiality</small></div>
          </div>
        </div>
        <div className="citation-list">
          {brief.evidenceCitations.map((citation) => (
            <article key={citation.id}>
              <strong>{citation.id}</strong>
              <p>{citation.label}</p>
              <small>{citation.weight}</small>
            </article>
          ))}
        </div>
      </div>
      <div className="brief-actions">
        {brief.reviewerPrompts.map((prompt) => <span key={prompt}>{prompt}</span>)}
      </div>
    </section>
  );
}

function ReportCenter({ snapshot, selectedCase }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase }) {
  const workflow = getDocumentWorkflow(snapshot, selectedCase.id);
  const report = {
    generatedAt: snapshot.generatedAt,
    case: selectedCase,
    loanProfile: workflow.profileLabel,
    documentIntelligence: workflow,
    riskDecomposition: workflow.riskDecomposition,
    auditTrail: workflow.auditTrail,
    fraudContext: snapshot.fraudContext,
    qwenRuntime: snapshot.qwenRuntime,
    decisionBrief: snapshot.qwenBrief,
    qwenFlowBrief: snapshot.qwenFlowBrief,
    topSignals: snapshot.signals.slice(0, 5),
    anomalyMatrix: snapshot.anomalyMatrix,
    connectors: snapshot.connectorStatus,
    transactionFlow: {
      summary: snapshot.transactionFlow.caseSummaries.find((item) => item.caseId === selectedCase.id) ?? snapshot.transactionFlow.summary,
      topPaths: snapshot.transactionFlow.paths.filter((path) => path.caseId === selectedCase.id).slice(0, 6),
      provenance: snapshot.transactionFlow.provenance,
    },
    canaraBenchmark: snapshot.canaraBenchmark,
    controlChecklist: snapshot.controlChecklist,
  };
  const downloadAudit = async () => {
    const payload = await exportAuditReport(selectedCase.id);
    const blob = new Blob([payload.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = payload.filename || `${selectedCase.id}-audit-report.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedCase.id}-sentinel-report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="stacked-workspace report-workspace">
      <section className="panel panel-large report-panel">
        <PanelTitle icon={Download} eyebrow="Decision package" title="Evidence report center" />
        <div className="report-banner">
          <div>
            <p className="eyebrow">Selected case</p>
            <h2>{selectedCase.id}</h2>
            <p>{selectedCase.applicant} | {selectedCase.loanType} | {selectedCase.location}</p>
          </div>
          <div className="report-actions">
            <button type="button" onClick={downloadReport}><Download size={17} /> Download JSON</button>
            <button type="button" onClick={downloadAudit}><ShieldCheck size={17} /> Audit HTML</button>
          </div>
        </div>
        <div className="report-grid">
          <MetricLine label="Risk score" value={selectedCase.riskScore} />
          <MetricLine label="Explainable risk" value={workflow.riskDecomposition.compositeScore} />
          <MetricLine label="Evidence objects" value={selectedCase.evidenceCount} />
          <MetricLine label="Qwen mode" value={snapshot.qwenRuntime.mode} />
          <MetricLine label="Source freshness" value={`${snapshot.overview.sourceFreshness}%`} />
          <MetricLine label="Audit hash" value={workflow.auditTrail.lastHash.slice(0, 12)} />
        </div>
        <div className="report-section">
          <h3>Explainable anomaly facts</h3>
          {workflow.anomalies.map((item) => <p key={item.id}>{item.id}: {item.title} | {item.confidence}% | {item.why}</p>)}
        </div>
      </section>
      <DecisionBrief snapshot={snapshot} />
      <FlowLedger snapshot={snapshot} selectedCase={selectedCase} />
      <CanaraBenchmarkPanel snapshot={snapshot} />
      <DueDiligenceControlPanel snapshot={snapshot} />
      <ConnectorHealth connectors={snapshot.connectorStatus} />
      <SignalRadar snapshot={snapshot} signals={snapshot.signals.slice(0, 4)} compact />
    </section>
  );
}

function CanaraBenchmarkPanel({ snapshot }: { snapshot: SentinelSnapshot }) {
  return (
    <section className="panel panel-wide benchmark-panel">
      <PanelTitle icon={Landmark} eyebrow="Public Canara-system benchmark" title="Familiarity plus innovation map" />
      <p className="benchmark-boundary">{snapshot.canaraBenchmark.researchBoundary}</p>
      <div className="benchmark-grid">
        {snapshot.canaraBenchmark.systems.map((system) => (
          <article key={system.id}>
            <div>
              <span>{system.publicSource}</span>
              <a href={system.sourceUrl} target="_blank" rel="noreferrer"><Link2 size={14} /> source</a>
            </div>
            <strong>{system.name}</strong>
            <p>{system.publicCapability}</p>
            <small>{system.prototypeInnovation}</small>
            <i style={{ width: `${system.prototypeCoverage}%` }} />
          </article>
        ))}
      </div>
      <div className="theme-coverage-strip">
        {snapshot.canaraBenchmark.themeCoverage.map((item) => (
          <span key={item.area}><strong>{item.area}</strong>{item.evidence}</span>
        ))}
      </div>
    </section>
  );
}

function DueDiligenceControlPanel({ snapshot }: { snapshot: SentinelSnapshot }) {
  return (
    <section className="panel panel-wide control-panel">
      <PanelTitle icon={ShieldCheck} eyebrow="Theme 1 underwriting controls" title="Evidence-linked due-diligence checklist" />
      <div className="control-grid">
        {snapshot.controlChecklist.map((item) => (
          <article className={item.status} key={item.id}>
            <span>{item.themeArea}</span>
            <strong>{item.label}</strong>
            <p>{item.reviewQuestion}</p>
            <div>
              <small>{item.status}</small>
              <b>{item.score}</b>
            </div>
            <i style={{ width: `${item.score}%` }} />
          </article>
        ))}
      </div>
    </section>
  );
}

function FlowLedger({ snapshot, selectedCase }: { snapshot: SentinelSnapshot; selectedCase: SentinelCase }) {
  const events = snapshot.transactionFlow.events.filter((event) => event.caseId === selectedCase.id).slice(0, 10);
  const summary = snapshot.transactionFlow.caseSummaries.find((item) => item.caseId === selectedCase.id) ?? snapshot.transactionFlow.summary;
  return (
    <section className="panel panel-wide flow-ledger-panel">
      <PanelTitle icon={Banknote} eyebrow="Live demo transaction layer" title="Fund-flow anomaly ledger" />
      <div className="flow-ledger-summary">
        <MetricLine label="Events" value={summary.eventCount} />
        <MetricLine label="Total routed" value={formatInr(summary.totalAmountInr)} />
        <MetricLine label="High risk events" value={summary.highRiskEvents} />
        <MetricLine label="Peak risk" value={summary.peakRisk} />
      </div>
      <div className="flow-event-table">
        {events.map((event) => (
          <article key={event.id}>
            <span>{event.channel}</span>
            <strong>{event.fromEntity}{' -> '}{event.toEntity}</strong>
            <p>{event.riskReason}</p>
            <small>{formatInr(event.amountInr)} | {event.riskScore} risk | {event.provenance.mode}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ThreeLoading({ title }: { title: string }) {
  return (
    <section className="panel panel-wide flow3d-loading">
      <PanelTitle icon={Network} eyebrow="3D intelligence module" title={title} />
      <p>Preparing the WebGL investigation surface...</p>
    </section>
  );
}

function CaseTimelinePanel({ selectedCase }: { selectedCase: SentinelCase }) {
  return (
    <section className="panel timeline-panel">
      <PanelTitle icon={Layers} eyebrow="Underwriting flow" title="Case timeline" />
      <div className="timeline-rail">
        {selectedCase.timeline.map((step) => (
          <article className={`timeline-step ${step.state}`} key={step.stage}>
            <span>{step.state}</span>
            <strong>{step.stage}</strong>
            <progress value={step.score} max="100" aria-label={`${step.stage} score`} />
          </article>
        ))}
      </div>
    </section>
  );
}

function GraphPathPanel({ snapshot }: { snapshot: SentinelSnapshot }) {
  const nodeLabels = new Map(snapshot.graph.nodes.map((node) => [node.id, node.label]));
  return (
    <section className="panel graph-path-panel">
      <PanelTitle icon={Network} eyebrow="Correlated paths" title="Entity path review" />
      <div className="path-list">
        {snapshot.graph.edges.map((edge) => (
          <article key={`${edge.source}-${edge.target}`}>
            <span>{nodeLabels.get(edge.source)}</span>
            <strong>{edge.label}</strong>
            <span>{nodeLabels.get(edge.target)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function FinancialLedger({ snapshot }: { snapshot: SentinelSnapshot }) {
  const totalInflow = Math.round(snapshot.financialSeries.reduce((sum, item) => sum + item.inflow, 0));
  const totalOutflow = Math.round(snapshot.financialSeries.reduce((sum, item) => sum + item.outflow, 0));
  const peakAnomaly = snapshot.financialSeries.reduce((peak, item) => (item.anomaly > peak.anomaly ? item : peak), snapshot.financialSeries[0]);
  const anomalyAverage = Math.round(snapshot.financialSeries.reduce((sum, item) => sum + item.anomaly, 0) / Math.max(snapshot.financialSeries.length, 1));
  return (
    <section className="panel ledger-panel">
      <PanelTitle icon={Banknote} eyebrow="Statement intelligence" title="Financial anomaly ledger" />
      <div className="ledger-grid">
        <MetricLine label="Total inflow index" value={totalInflow} />
        <MetricLine label="Total outflow index" value={totalOutflow} />
        <MetricLine label="Peak anomaly month" value={`${peakAnomaly?.month ?? 'n/a'} | ${peakAnomaly?.anomaly ?? 0}`} />
        <MetricLine label="Average anomaly load" value={anomalyAverage} />
      </div>
      <div className="ledger-months">
        {snapshot.financialSeries.map((item) => (
          <article key={item.month}>
            <span>{item.month}</span>
            <progress value={item.anomaly} max="50" aria-label={`${item.month} anomaly load`} />
            <strong>{item.anomaly}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function QwenPerformance({ snapshot }: { snapshot: SentinelSnapshot }) {
  const runtime = snapshot.qwenRuntime;
  return (
    <section className="panel panel-wide qwen-console">
      <PanelTitle icon={Cpu} eyebrow="Local model core" title="Qwen 3.5 4B GPU console" />
      <div className="qwen-layout">
        <div className="qwen-meter">
          <span>{runtime.healthScore}</span>
          <small>Runtime health</small>
        </div>
        <div className="qwen-stats">
          <MetricLine label="Mode" value={runtime.mode} />
          <MetricLine label="Residency" value={runtime.residency?.detail ?? runtime.availabilityDetail} />
          <MetricLine label="GPU" value={runtime.gpu?.detail ?? 'GPU probe unavailable'} />
          <MetricLine label="Requested context" value={runtime.requestedContextWindow ?? runtime.contextWindow} />
          <MetricLine label="Effective context" value={runtime.effectiveContextWindow ?? runtime.contextWindow} />
          <MetricLine label="Prompt budget" value={`${runtime.promptBudgetTokens.toLocaleString()} tokens`} />
          <MetricLine label="Throughput" value={`${runtime.tokensPerSecond} tok/s`} />
          <MetricLine label="Cache hits" value={`${runtime.cacheHitRate}%`} />
        </div>
        <div className="pipeline-list">
          {runtime.pipeline.map((item) => (
            <article key={item.stage}>
              <strong>{item.stage}</strong>
              <p>{item.role}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="maxout-strip">
        {runtime.maxOutChecklist.map((item) => <span key={item}>{item}</span>)}
      </div>
    </section>
  );
}

function QwenGuardrailPanel({ snapshot }: { snapshot: SentinelSnapshot }) {
  return (
    <section className="panel qwen-guardrail-panel">
      <PanelTitle icon={ShieldCheck} eyebrow="Model governance" title="Qwen guardrail desk" />
      <div className="guardrail-grid">
        {snapshot.qwenBrief.guardrails.map((guardrail) => (
          <article key={guardrail}>
            <strong>{guardrail}</strong>
            <span>{snapshot.qwenRuntime.mode} | {snapshot.qwenRuntime.cacheHitRate}% cache hit</span>
          </article>
        ))}
      </div>
      <div className="reviewer-prompts">
        {snapshot.qwenBrief.reviewerPrompts.map((prompt) => <span key={prompt}>{prompt}</span>)}
      </div>
    </section>
  );
}

function RiskTrend({ snapshot }: { snapshot: SentinelSnapshot }) {
  const latest = snapshot.riskTrend[snapshot.riskTrend.length - 1];
  const previous = snapshot.riskTrend[snapshot.riskTrend.length - 2] ?? latest;
  const sourceEvents = snapshot.signals.slice(0, 6);
  const averageDocument = Math.round(snapshot.riskTrend.reduce((sum, point) => sum + point.document, 0) / Math.max(snapshot.riskTrend.length, 1));
  const averageExternal = Math.round(snapshot.riskTrend.reduce((sum, point) => sum + point.external, 0) / Math.max(snapshot.riskTrend.length, 1));
  return (
    <section className="panel">
      <PanelTitle icon={Activity} eyebrow="Streaming anomaly frequency" title="Risk trend" />
      <div className="chart-kpi-row">
        <MetricLine label="Document now" value={latest?.document ?? 0} />
        <MetricLine label="External now" value={latest?.external ?? 0} />
        <MetricLine label="Financial delta" value={latest && previous ? `${(latest.financial - previous.financial).toFixed(1)}` : 0} />
        <MetricLine label="Window avg" value={`${averageDocument}/${averageExternal}`} />
      </div>
      <MeasuredChartFrame minHeight={300}>
        {({ width, height }) => (
          <AreaChart data={snapshot.riskTrend} height={height} margin={chartMargins} width={width}>
            <defs>
              <linearGradient id="document" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1368b7" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#1368b7" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="external" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#d83b01" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#d83b01" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#dbe5f0" strokeDasharray="2 5" vertical={false} />
            <XAxis axisLine={false} dataKey="time" interval={3} tick={axisTick} tickLine={false} />
            <YAxis axisLine={false} domain={[0, 100]} tick={axisTick} tickLine={false} width={34} />
            <Tooltip content={<IndustrialTooltip />} cursor={{ stroke: '#003c7b', strokeOpacity: 0.18 }} />
            <Legend align="right" verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
            <ReferenceLine y={70} stroke="#d83b01" strokeDasharray="4 4" label={{ value: 'review threshold', fill: '#63738a', fontSize: 10 }} />
            <Area animationDuration={950} animationEasing="ease-out" isAnimationActive type="monotone" dataKey="document" name="Document" stroke="#005ca8" fill="url(#document)" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />
            <Area animationDuration={950} animationEasing="ease-out" isAnimationActive type="monotone" dataKey="external" name="External" stroke="#d83b01" fill="url(#external)" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />
            <Line animationDuration={950} animationEasing="ease-out" isAnimationActive type="monotone" dataKey="financial" name="Financial" stroke="#b36900" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        )}
      </MeasuredChartFrame>
      <div className="event-ribbon">
        {sourceEvents.map((signal, index) => (
          <span className={signal.type.toLowerCase()} key={signal.id} style={{ left: `${8 + index * 15}%` }}>
            {signal.type}
          </span>
        ))}
      </div>
    </section>
  );
}

function CategoryPanel({ snapshot }: { snapshot: SentinelSnapshot }) {
  const colors = ['#1368b7', '#ffcc29', '#d83b01', '#00a6a6', '#5b6b7c'];
  const ranked = [...snapshot.categoryScores].sort((left, right) => right.score - left.score);
  return (
    <section className="panel">
      <PanelTitle icon={BrainCircuit} eyebrow="Materiality model" title="Category scores" />
      <div className="category-rank-grid">
        {ranked.map((item, index) => (
          <article key={item.name}>
            <span>#{index + 1}</span>
            <strong>{item.name}</strong>
            <i style={{ width: `${item.score}%`, background: colors[index % colors.length] }} />
            <small>{item.score} materiality</small>
          </article>
        ))}
      </div>
      <MeasuredChartFrame className="compact" minHeight={260}>
        {({ width, height }) => (
          <BarChart data={snapshot.categoryScores} height={height} layout="vertical" margin={{ top: 10, right: 18, bottom: 4, left: 6 }} width={width}>
            <CartesianGrid horizontal={false} stroke="#dbe5f0" strokeDasharray="2 5" />
            <XAxis axisLine={false} domain={[0, 100]} tick={axisTick} tickLine={false} type="number" />
            <YAxis axisLine={false} dataKey="name" tick={{ ...axisTick, fontSize: 10 }} tickFormatter={(value) => shortChartLabel(String(value), 19)} tickLine={false} type="category" width={118} />
            <Tooltip content={<IndustrialTooltip />} cursor={{ fill: 'rgba(0, 60, 123, 0.04)' }} />
            <ReferenceLine x={70} stroke="#d83b01" strokeDasharray="4 4" />
            <Bar animationDuration={900} animationEasing="ease-out" barSize={18} dataKey="score" isAnimationActive name="Materiality" radius={[0, 5, 5, 0]}>
              {snapshot.categoryScores.map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]} />)}
            </Bar>
          </BarChart>
        )}
      </MeasuredChartFrame>
    </section>
  );
}

function GeoRiskMap({ signals }: { signals: GeoSignal[] }) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const [tileFailed, setTileFailed] = useState(false);
  const rankedSignals = useMemo(() => [...signals].sort((left, right) => right.risk - left.risk), [signals]);
  const [selectedSignalId, setSelectedSignalId] = useState(rankedSignals[0]?.id ?? '');
  const selectedSignal = rankedSignals.find((signal) => signal.id === selectedSignalId) ?? rankedSignals[0];
  const hotSignals = rankedSignals.slice(0, 6);
  const peakRisk = signals.length ? Math.round(Math.max(...signals.map((item) => item.risk))) : 0;

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return undefined;
    const map = L.map(mapNodeRef.current, {
      attributionControl: false,
      preferCanvas: false,
      scrollWheelZoom: false,
      zoomControl: false,
      zoomSnap: 0.25,
    }).setView([20.8, 78.9], 5);
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      minZoom: 4,
      crossOrigin: true,
      attribution: '&copy; OpenStreetMap contributors',
    });
    tiles.on('tileerror', () => setTileFailed(true));
    tiles.addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution('&copy; OpenStreetMap contributors').addTo(map);
    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = group;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!rankedSignals.length) return;
    setSelectedSignalId((current) => rankedSignals.some((signal) => signal.id === current) ? current : rankedSignals[0].id);
  }, [rankedSignals]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !signals.length) return;
    layer.clearLayers();
    const peak = rankedSignals[0];
    if (peak) {
      for (const signal of signals.filter((item) => item.id !== peak.id)) {
        L.polyline([[peak.lat, peak.lng], [signal.lat, signal.lng]], {
          color: riskCss(signal.risk),
          weight: Math.max(2, signal.risk / 24),
          opacity: 0.48,
          dashArray: signal.risk >= 70 ? undefined : '7 8',
          className: 'leaflet-risk-corridor',
        }).addTo(layer);
      }
    }
    for (const signal of signals) {
      const radius = 8 + Math.min(18, signal.risk / 5);
      L.circle([signal.lat, signal.lng], {
        radius: 45000 + signal.risk * 1700,
        color: riskCss(signal.risk),
        weight: 1,
        fillColor: riskCss(signal.risk),
        fillOpacity: 0.09,
        opacity: 0.34,
      }).addTo(layer);
      const marker = L.circleMarker([signal.lat, signal.lng], {
        radius,
        color: '#ffffff',
        weight: 3,
        fillColor: riskCss(signal.risk),
        fillOpacity: 0.96,
        className: `leaflet-risk-marker ${riskTier(signal.risk)}`,
      }).addTo(layer);
      marker.bindTooltip(`<strong>${escapeHtml(signal.label)}</strong><br/>${Math.round(signal.risk)} risk | ${escapeHtml(signal.status)}`, {
        direction: 'top',
        opacity: 0.95,
        sticky: true,
      });
      marker.on('click', () => setSelectedSignalId(signal.id));
    }
    if (signals.length > 1) {
      const width = mapNodeRef.current?.clientWidth ?? 900;
      const zoom = width >= 1100 ? 5.25 : width >= 620 ? 4.9 : 4.45;
      map.flyTo([21.1, 78.9], zoom, { animate: true, duration: 0.85, easeLinearity: 0.25 });
    } else {
      map.flyTo([signals[0].lat, signals[0].lng], 6, { animate: true, duration: 0.85, easeLinearity: 0.25 });
    }
  }, [rankedSignals, signals]);

  return (
    <section className="panel map-panel">
      <PanelTitle icon={Landmark} eyebrow="Collateral geography" title="Geo risk map" />
      <div className="map-stat-strip">
        <MetricLine label="Regions" value={signals.length} />
        <MetricLine label="High risk" value={signals.filter((item) => item.risk >= 70).length} />
        <MetricLine label="Peak" value={peakRisk} />
      </div>
      <div className={`professional-map-frame ${tileFailed ? 'tile-fallback' : ''}`}>
        <div className="leaflet-risk-map" ref={mapNodeRef} />
        <div className="map-intel-glass">
          <span>{selectedSignal?.status ?? 'source risk'}</span>
          <strong>{selectedSignal?.label ?? 'No geography selected'}</strong>
          <small>{selectedSignal ? `${Math.round(selectedSignal.risk)} risk | ${selectedSignal.lat.toFixed(3)}, ${selectedSignal.lng.toFixed(3)}` : 'waiting for live signals'}</small>
        </div>
        {tileFailed ? <div className="tile-fallback-banner">Map tiles degraded. Risk geometry remains live from local coordinates.</div> : null}
      </div>
      <div className="geo-risk-table">
        {hotSignals.map((signal) => (
          <article className={signal.id === selectedSignal?.id ? 'selected' : ''} key={signal.id} onClick={() => setSelectedSignalId(signal.id)}>
            <strong>{signal.label}</strong>
            <span>{signal.status}</span>
            <i style={{ width: `${signal.risk}%` }} />
          </article>
        ))}
      </div>
      <div className="map-legend">
        {signals.slice(0, 8).map((signal) => <span key={signal.id}>{signal.label}</span>)}
      </div>
    </section>
  );
}

function EntityGraph({ snapshot }: { snapshot: SentinelSnapshot }) {
  const count = snapshot.graph.nodes.length;
  const positions = Object.fromEntries(snapshot.graph.nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
    const radius = node.id === 'case' ? 0 : node.type === 'osint' || node.type === 'socmint' ? 42 : 33;
    return [node.id, { x: node.id === 'case' ? 50 : 50 + Math.cos(angle) * radius, y: node.id === 'case' ? 50 : 50 + Math.sin(angle) * radius }];
  })) as Record<string, { x: number; y: number }>;
  const topNodes = [...snapshot.graph.nodes].sort((left, right) => right.risk - left.risk).slice(0, 5);
  return (
    <section className="panel">
      <PanelTitle icon={Network} eyebrow="Entity intelligence" title="Evidence graph" />
      <div className="graph-workbench">
        <svg className="graph-canvas" viewBox="0 0 100 100" role="img" aria-label="Case entity graph">
          <defs>
            <filter id="nodeGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor="#1368b7" floodOpacity="0.3" />
            </filter>
          </defs>
          {snapshot.graph.edges.map((edge, index) => {
            const source = positions[edge.source];
            const target = positions[edge.target];
            if (!source || !target) return null;
            const controlX = (source.x + target.x) / 2 + (index % 2 ? 6 : -6);
            const controlY = (source.y + target.y) / 2 - 8;
            return <path className="graph-edge" d={`M${source.x},${source.y} Q${controlX},${controlY} ${target.x},${target.y}`} key={`${edge.source}-${edge.target}`} />;
          })}
          {snapshot.graph.nodes.map((node, index) => {
            const position = positions[node.id];
            return (
              <g className="graph-node-group" key={node.id} transform={`translate(${position.x} ${position.y})`}>
                <circle r={node.id === 'case' ? 9 : 6 + Math.min(4, node.risk / 30)} className={`graph-node ${node.type}`} filter="url(#nodeGlow)" />
                <text className="node-index" y="-1">{String(index + 1).padStart(2, '0')}</text>
                <text className="node-risk" y={node.id === 'case' ? 15 : 14}>{Math.round(node.risk)}</text>
              </g>
            );
          })}
        </svg>
        <div className="graph-side-panel">
          {topNodes.map((node) => (
            <article key={node.id}>
              <span>{node.type}</span>
              <strong>{node.label}</strong>
              <i style={{ width: `${Math.max(8, node.risk)}%` }} />
            </article>
          ))}
        </div>
      </div>
      <div className="graph-note">
        <BrainCircuit size={16} />
        Qwen explanation layer ranks graph paths, source overlap, and relationship materiality with evidence IDs.
      </div>
    </section>
  );
}

function FinancialAnalyzer({ snapshot }: { snapshot: SentinelSnapshot }) {
  const enriched = snapshot.financialSeries.map((point) => ({
    ...point,
    spread: Math.max(0, point.inflow - point.outflow),
    stress: Math.round((point.anomaly / Math.max(point.inflow, 1)) * 100),
  }));
  const peak = enriched.reduce((current, point) => (point.anomaly > current.anomaly ? point : current), enriched[0]);
  return (
    <section className="panel panel-wide">
      <PanelTitle icon={Banknote} eyebrow="Financial statement analyzer" title="Cash-flow and anomaly profile" />
      <div className="financial-intel-grid">
        <MetricLine label="Peak month" value={`${peak?.month ?? 'n/a'} ${peak?.anomaly ?? 0}`} />
        <MetricLine label="Avg stress" value={`${Math.round(enriched.reduce((sum, item) => sum + item.stress, 0) / Math.max(enriched.length, 1))}%`} />
        <MetricLine label="Negative spread" value={enriched.filter((item) => item.spread < item.anomaly / 2).length} />
      </div>
      <MeasuredChartFrame className="financial" minHeight={360}>
        {({ width, height }) => (
          <LineChart data={enriched} height={height} margin={chartMargins} width={width}>
            <CartesianGrid stroke="#dbe5f0" strokeDasharray="2 5" vertical={false} />
            <XAxis axisLine={false} dataKey="month" tick={axisTick} tickLine={false} />
            <YAxis axisLine={false} tick={axisTick} tickLine={false} width={44} />
            <Tooltip content={<IndustrialTooltip />} cursor={{ stroke: '#003c7b', strokeOpacity: 0.18 }} />
            <Legend align="right" verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
            <ReferenceLine y={peak?.anomaly ?? 0} stroke="#d83b01" strokeDasharray="3 4" label={{ value: 'peak anomaly', fill: '#63738a', fontSize: 10 }} />
            <Line animationDuration={1050} animationEasing="ease-out" isAnimationActive type="monotone" dataKey="inflow" name="Inflow" stroke="#005ca8" strokeWidth={2.7} dot={false} activeDot={{ r: 4 }} />
            <Line animationDuration={1050} animationEasing="ease-out" isAnimationActive type="monotone" dataKey="outflow" name="Outflow" stroke="#5b6b7c" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
            <Line animationDuration={1050} animationEasing="ease-out" isAnimationActive type="monotone" dataKey="spread" name="Spread" stroke="#008c95" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
            <Line animationDuration={1050} animationEasing="ease-out" isAnimationActive type="monotone" dataKey="anomaly" name="Anomaly" stroke="#d83b01" strokeWidth={2.8} dot={{ r: 2 }} activeDot={{ r: 5 }} />
          </LineChart>
        )}
      </MeasuredChartFrame>
      <div className="statement-heat-strip">
        {enriched.map((point) => (
          <span key={point.month} style={{ '--stress': `${point.stress}%` } as CSSProperties}>
            <strong>{point.month}</strong>
            <small>{point.stress}% stress</small>
          </span>
        ))}
      </div>
    </section>
  );
}

function ConsensusMatrix({ snapshot }: { snapshot: SentinelSnapshot }) {
  const engines: Array<keyof (typeof snapshot.anomalyMatrix)[number]> = ['detector', 'qwen', 'external', 'consensus'];
  return (
    <section className="panel panel-wide">
      <PanelTitle icon={BrainCircuit} eyebrow="Detector + Qwen + source agreement" title="Anomaly consensus matrix" />
      <div className="consensus-heatmap">
        <div className="heatmap-header" />
        {engines.map((engine) => <strong key={engine}>{String(engine)}</strong>)}
        {snapshot.anomalyMatrix.map((row) => (
          <ReactFragment key={row.category}>
            <span>{row.category}</span>
            {engines.map((engine) => (
              <i className={Number(row[engine]) >= 76 ? 'critical' : Number(row[engine]) >= 55 ? 'elevated' : 'normal'} key={`${row.category}-${String(engine)}`}>
                {Number(row[engine]).toFixed(0)}
              </i>
            ))}
          </ReactFragment>
        ))}
      </div>
      <MeasuredChartFrame className="consensus" minHeight={360}>
        {({ width, height }) => (
          <BarChart data={snapshot.anomalyMatrix} height={height} margin={{ top: 16, right: 18, bottom: 22, left: 4 }} width={width}>
            <CartesianGrid stroke="#dbe5f0" strokeDasharray="2 5" vertical={false} />
            <XAxis axisLine={false} dataKey="category" interval={0} tick={{ ...axisTick, fontSize: 10 }} tickFormatter={(value) => shortChartLabel(String(value), 14)} tickLine={false} />
            <YAxis axisLine={false} domain={[0, 100]} tick={axisTick} tickLine={false} width={34} />
            <Tooltip content={<IndustrialTooltip />} cursor={{ fill: 'rgba(0, 60, 123, 0.04)' }} />
            <Legend align="right" verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
            <ReferenceLine y={70} stroke="#d83b01" strokeDasharray="3 4" />
            <Bar animationDuration={950} animationEasing="ease-out" barSize={12} dataKey="detector" fill="#005ca8" isAnimationActive name="Detector" radius={[3, 3, 0, 0]} />
            <Bar animationDuration={950} animationEasing="ease-out" barSize={12} dataKey="qwen" fill="#b36900" isAnimationActive name="Qwen" radius={[3, 3, 0, 0]} />
            <Bar animationDuration={950} animationEasing="ease-out" barSize={12} dataKey="external" fill="#d83b01" isAnimationActive name="External" radius={[3, 3, 0, 0]} />
            <Bar animationDuration={950} animationEasing="ease-out" barSize={12} dataKey="consensus" fill="#008c95" isAnimationActive name="Consensus" radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </MeasuredChartFrame>
    </section>
  );
}

function SourceHealth({ snapshot }: { snapshot: SentinelSnapshot }) {
  return (
    <section className="panel">
      <PanelTitle icon={RadioTower} eyebrow="Source observability" title="Connector freshness" />
      <div className="source-list">
        {snapshot.sourceHealth.map((source) => (
          <div className="source-row" key={source.name}>
            <div>
              <strong>{source.name}</strong>
              <small>{source.status} | {source.latencyMs} ms</small>
            </div>
            <progress className="freshness-meter" value={source.freshness} max="100" aria-label={`${source.name} freshness`} />
          </div>
        ))}
      </div>
    </section>
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

function riskTier(risk: number) {
  if (risk >= 70) return 'critical';
  if (risk >= 50) return 'elevated';
  return 'normal';
}

function riskCss(risk: number) {
  if (risk >= 70) return '#d83b01';
  if (risk >= 50) return '#b26a00';
  if (risk >= 35) return '#008b92';
  return '#005ca8';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function isUploadedAsset(item: CaseMedia) {
  return Boolean(item.url && item.url.includes('/uploaded/'));
}

type SourceMediaState = {
  status: 'idle' | 'loading' | 'live' | 'stale' | 'empty' | 'degraded' | 'error';
  data?: SourceMediaResolution;
  error?: string;
};

const sourceMediaCache = new Map<string, SourceMediaResolution>();

function useResolvedSourceMedia(signal?: Signal): SourceMediaState {
  const key = useMemo(() => signal ? `${signal.sourceUrl || ''}|${signal.title}` : '', [signal]);
  const attached = useMemo(() => (
    signal?.sourceMedia?.length
      ? {
        sourceUrl: signal.sourceUrl || '',
        retrievedAt: signal.retrievedAt || signal.observedAt,
        status: 'live' as const,
        detail: `${signal.sourceMedia.length} connector-provided media assets`,
        items: signal.sourceMedia,
      }
      : undefined
  ), [signal]);
  const cached = key ? sourceMediaCache.get(key) : undefined;
  const [state, setState] = useState<SourceMediaState>(() => (
    attached ? { status: 'live', data: attached } : cached ? { status: cached.status, data: cached } : { status: signal?.sourceUrl ? 'loading' : 'empty' }
  ));

  useEffect(() => {
    if (!signal) {
      setState({ status: 'empty', error: 'No source URL supplied' });
      return undefined;
    }
    if (attached) {
      setState({ status: 'live', data: attached });
      return undefined;
    }
    if (!signal.sourceUrl) {
      setState({ status: 'empty', error: 'No source URL supplied' });
      return undefined;
    }
    const current = sourceMediaCache.get(key);
    if (current) {
      setState({ status: current.status, data: current });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    resolveSourceMedia(signal.sourceUrl, signal.title)
      .then((payload) => {
        sourceMediaCache.set(key, payload);
        if (!cancelled) setState({ status: payload.status, data: payload });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', error: error instanceof Error ? error.message : 'Source media request failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [attached, key, signal]);

  return state;
}

function sourceLabel(url?: string) {
  if (!url) return 'local dossier';
  if (url.startsWith('data/')) return url;
  if (url.startsWith('file:')) return 'local upload';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatDateTime(value?: string) {
  if (!value) return 'not supplied';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatShortDate(value?: string) {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function formatInr(value: number) {
  if (value >= 10000000) return `INR ${(value / 10000000).toFixed(2)} cr`;
  if (value >= 100000) return `INR ${(value / 100000).toFixed(1)} lakh`;
  return `INR ${value.toLocaleString('en-IN')}`;
}

function PanelTitle({ icon: Icon, eyebrow, title }: { icon: LucideIcon; eyebrow: string; title: string }) {
  return (
    <div className="panel-title">
      <div className="panel-icon"><Icon size={18} /></div>
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

export default WorkspaceViews;
