export type Provenance = {
  connectorId: string;
  connectorStatus: string;
  sourceUrl: string;
  retrievedAt: string;
};

export type SourceMedia = {
  id: string;
  kind: 'image' | 'video' | 'pdf';
  title: string;
  url: string;
  previewUrl: string;
  embedUrl?: string;
  contentType: string;
  role: string;
  confidence: number;
};

export type SourceMediaResolution = {
  sourceUrl: string;
  retrievedAt: string;
  status: 'live' | 'stale' | 'empty' | 'degraded';
  detail: string;
  items: SourceMedia[];
};

export type CaseMedia = {
  id: string;
  type: 'document' | 'video';
  kind: 'document' | 'image' | 'video' | 'pdf';
  title: string;
  url: string;
  previewUrl?: string;
  streamState: string;
  integrityScore: number;
  ocrConfidence: number;
  tamperHeat: number;
  framesAnalyzed: number;
  detector: string;
  provenance?: Provenance;
};

export type ForensicCheck = {
  label: string;
  score: number;
  verdict: 'critical' | 'elevated' | 'clear';
};

export type CaseTimelineStep = {
  stage: string;
  state: string;
  score: number;
};

export type FinancialPoint = {
  month: string;
  inflow: number;
  outflow: number;
  anomaly: number;
};

export type SentinelCase = {
  id: string;
  applicant: string;
  loanType: string;
  loanAmount: string;
  branch: string;
  location: string;
  lat: number;
  lng: number;
  riskScore: number;
  riskDelta: number;
  status: string;
  stage: string;
  anomalies: string[];
  lastUpdated: string;
  media: CaseMedia[];
  documentsProcessed: number;
  evidenceCount: number;
  priority: string;
  owner: string;
  slaMinutes: number;
  nextAction: string;
  forensicChecks: ForensicCheck[];
  timeline: CaseTimelineStep[];
  financialSeries: FinancialPoint[];
  provenance?: Provenance;
};

export type Signal = {
  id: string;
  source: string;
  type: 'OSINT' | 'SOCMINT' | 'CYBINT' | 'TECHINT';
  title: string;
  severity: string;
  summary: string;
  confidence: number;
  observedAt: string;
  retrievedAt?: string;
  sourceUrl?: string;
  previewUrl: string;
  sourceMedia?: SourceMedia[];
  provenance?: Provenance;
};

export type ConnectorStatus = {
  id: string;
  name: string;
  type: string;
  status: 'live' | 'stale' | 'degraded' | 'local';
  detail: string;
  sourceUrl: string;
  retrievedAt: string;
  latencyMs: number;
  items: Array<{ title: string; summary: string; sourceUrl: string; publishedAt: string; severity: string; confidence: number }>;
};

export type TrendPoint = {
  time: string;
  document: number;
  financial: number;
  external: number;
};

export type CategoryScore = {
  name: string;
  score: number;
};

export type GeoSignal = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  risk: number;
  status: string;
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  risk: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  label: string;
};

export type SourceHealth = {
  name: string;
  freshness: number;
  latencyMs: number;
  status?: string;
  detail?: string;
  sourceUrl?: string;
  retrievedAt?: string;
};

export type QwenRuntime = {
  model: string;
  runtime: string;
  endpoint: string;
  mode: 'active' | 'connected' | 'standby' | 'degraded' | 'fallback';
  availabilityDetail: string;
  quantization: string;
  requestedContextWindow?: number;
  contextWindow: number;
  effectiveContextWindow?: number;
  reservedOutputTokens: number;
  promptBudgetTokens: number;
  gpuLayers: number;
  threads: number;
  batchSize: number;
  mmap: boolean;
  flashAttention: boolean;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  cachePolicy: string;
  promptPacking: string;
  healthScore: number;
  tokensPerSecond: number;
  latencyMs: number;
  cacheHitRate: number;
  gpu?: {
    available: boolean;
    name?: string;
    memoryTotalMb?: number;
    memoryUsedMb?: number;
    memoryFreeMb?: number;
    utilizationPct?: number;
    detail: string;
  };
  residency?: {
    loaded: boolean;
    processor: string;
    contextWindow: number;
    until?: string;
    size?: number;
    detail: string;
  };
  pipeline: Array<{ stage: string; role: string }>;
  maxOutChecklist: string[];
};

export type QwenBrief = {
  headline: string;
  summary: string;
  recommendedAction: string;
  confidence: number;
  materialityScore: number;
  evidenceCitations: Array<{ id: string; label: string; weight: string }>;
  reviewerPrompts: string[];
  guardrails: string[];
};

export type AnomalyMatrixRow = {
  category: string;
  detector: number;
  qwen: number;
  external: number;
  consensus: number;
};

export type FlowEvent = {
  id: string;
  caseId: string;
  timestamp: string;
  month: string;
  fromNode: string;
  toNode: string;
  fromEntity: string;
  toEntity: string;
  fromAccountType: string;
  toAccountType: string;
  amountInr: number;
  channel: string;
  riskScore: number;
  riskReason: string;
  geo: { lat: number; lng: number; label: string };
  evidenceIds: string[];
  sourceIds: string[];
  provenance: {
    mode: 'demo-simulated' | 'dossier-derived';
    derivedFrom?: string[];
    sourceUrl: string;
    retrievedAt: string;
    detail?: string;
  };
};

export type FlowPath = {
  id: string;
  caseId: string;
  source: string;
  target: string;
  label: string;
  totalAmountInr: number;
  eventCount: number;
  riskScore: number;
  channelMix: string[];
  eventIds: string[];
  evidenceIds: string[];
};

export type FlowSummary = {
  caseId: string;
  eventCount: number;
  totalAmountInr: number;
  highRiskEvents: number;
  peakRisk: number;
  peakEventId: string;
  channels: string[];
};

export type FlowSourceFactor = {
  id: string;
  type: string;
  source: string;
  title: string;
  confidence: number;
  sourceUrl: string;
  status: string;
};

export type TransactionFlow = {
  mode: 'demo-simulated';
  generatedAt: string;
  selectedCaseId: string;
  summary: FlowSummary;
  caseSummaries: Array<FlowSummary & { applicant: string; riskScore: number; status: string }>;
  events: FlowEvent[];
  paths: FlowPath[];
  sourceFactors: FlowSourceFactor[];
  provenance: {
    mode: 'demo-simulated';
    sourceUrl: string;
    retrievedAt: string;
    detail: string;
  };
};

export type FlowNode3d = {
  id: string;
  caseId: string;
  label: string;
  type: string;
  risk: number;
  x: number;
  y: number;
  z: number;
  sourceUrl?: string;
};

export type FlowLink3d = {
  id: string;
  caseId?: string;
  source: string;
  target: string;
  risk: number;
  amountInr?: number;
  eventCount?: number;
  channels?: string[];
  label?: string;
};

export type FlowParticle3d = {
  id: string;
  eventId: string;
  caseId: string;
  source: string;
  target: string;
  risk: number;
  amountInr: number;
  phase: number;
  speed: number;
};

export type FundFlowGraph3d = {
  mode: string;
  layout: string;
  nodes: FlowNode3d[];
  links: FlowLink3d[];
  particles: FlowParticle3d[];
  legend: Array<{ label: string; meaning: string }>;
};

export type EntityGraph3d = {
  mode: string;
  focusCaseId: string;
  nodes: FlowNode3d[];
  links: FlowLink3d[];
};

export type CanaraBenchmarkSystem = {
  id: string;
  name: string;
  publicSource: string;
  sourceUrl: string;
  publicCapability: string;
  prototypeInnovation: string;
  deliverableFit: string;
  prototypeCoverage: number;
  status: string;
};

export type CanaraBenchmark = {
  researchBoundary: string;
  retrievedAt: string;
  systems: CanaraBenchmarkSystem[];
  sourceCount: number;
  themeCoverage: Array<{ area: string; status: string; evidence: string }>;
  liveSourcePressure: number;
};

export type ControlChecklistItem = {
  id: string;
  label: string;
  themeArea: string;
  reviewQuestion: string;
  score: number;
  status: 'critical' | 'review' | 'clear';
  evidenceIds: string[];
  sourceUrls: string[];
  updatedAt: string;
};

export type QwenFlowBrief = {
  mode: string;
  headline: string;
  summary: string;
  recommendedAction: string;
  confidence: number;
  materialityScore: number;
  citations: Array<{ id: string; label: string; sourceUrl: string }>;
  nextChecks: string[];
  guardrails: string[];
};

export type LoanProfile = {
  id: string;
  label: string;
  roleContext: string;
  branchContext: string;
  segment: string;
  defaultCasePattern: string;
  thresholds: { approveBelow: number; holdFrom: number; escalateFrom: number };
  riskWeights: Array<{ id: string; label: string; weight: number }>;
  requiredDocuments: string[];
  checks: string[];
  qwenFocus: string;
};

export type DocumentIntelDocument = {
  id: string;
  title: string;
  kind: string;
  category: string;
  pageCount: number;
  status: string;
  sourceType: string;
};

export type DocumentAnomaly = {
  id: string;
  stream: 'visualIntegrity' | 'dataConsistency' | 'financialAnomaly';
  documentId: string;
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
  severity: 'critical' | 'high' | 'medium' | 'low' | string;
  confidence: number;
  title: string;
  why: string;
  observed: string;
  baseline: string;
  microViz: { type: string; label: string; value: number; referenceValue: number; unit: string };
  sourceTrace: Array<{ id: string; label: string; source: string; status: string }>;
  evidenceIds: string[];
  attentionPath: Array<{ x: number; y: number; w: number; h: number; durationMs: number; label: string }>;
  counterfactualRiskDelta: number;
};

export type IngestionJob = {
  id: string;
  caseId: string;
  profileId: string;
  profileLabel: string;
  status: string;
  progress: number;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  steps: Array<{ id: string; label: string; state: 'complete' | 'active' | 'queued'; progress: number }>;
};

export type RiskDecomposition = {
  compositeScore: number;
  decision: string;
  weightsTotal: number;
  items: Array<{ id: string; label: string; weight: number; score: number; drivers: string[]; anomalyIds: string[] }>;
};

export type AuditTrail = {
  mode: string;
  caseId: string;
  chainValid: boolean;
  eventCount: number;
  lastHash: string;
  events: Array<{
    sequence: number;
    timestamp: string;
    caseId?: string;
    eventType: string;
    label: string;
    actor: string;
    detail: string;
    evidenceIds: string[];
    previousHash: string;
    hash: string;
  }>;
};

export type DocumentWorkflow = {
  caseId: string;
  profileId: string;
  profileLabel: string;
  roleContext: string;
  branchContext: string;
  scenario: string;
  dataMode: string;
  sourcePressure: {
    topSignalId: string;
    topSignalTitle: string;
    topSignalConfidence: number;
    liveConnectors: number;
    totalConnectors: number;
  };
  ingestionJob: IngestionJob;
  documents: DocumentIntelDocument[];
  streams: Array<{ id: DocumentAnomaly['stream']; label: string; count: number; maxConfidence: number; averageConfidence: number; status: string; anomalyIds: string[] }>;
  anomalies: DocumentAnomaly[];
  selectedAnomalyId: string;
  riskDecomposition: RiskDecomposition;
  memo: string;
  nextActions: string[];
  auditTrail: AuditTrail;
  overrides: Array<{ id: string; decision: string; rationale: string; actor: string; createdAt: string; anomalyId?: string }>;
  requirements: string[];
  checks: string[];
};

export type DocumentIntelligence = {
  mode: string;
  dataBoundary: string;
  selectedCaseId: string;
  selectedLoanProfileId: string;
  generatedAt: string;
  current: DocumentWorkflow;
  workflows: Record<string, DocumentWorkflow>;
  registryBoundary: string;
};

export type FraudContext = {
  provenance: { title: string; sourceUrl: string; retrievedAt: string; status: string; note: string };
  nationalSignals: Array<{ label: string; value: string; detail: string }>;
  documentCategories: Array<{ category: string; share: number; trend: string; examples: string; risk: string }>;
  stateRisks: Array<{ state: string; rank: number; volume2024: string; primaryRisk: string; dominantManipulation: string }>;
  legalRegime: { transitionDate: string; legacy: string; current: string; modelingUse: string };
  criticalFindings: string[];
};

export type ExplanationSettings = {
  language: string;
  granularity: string;
  supportedLanguages: Array<{ id: string; label: string }>;
  supportedGranularity: Array<{ id: string; label: string }>;
};

export type SentinelSnapshot = {
  generatedAt: string;
  portfolio: {
    programName: string;
    theme: string;
    institution: string;
    noticeTicker: string[];
    regions: Array<{ name: string; risk: number; branchLoad: number; lat: number; lng: number }>;
  };
  overview: {
    activeCases: number;
    highRiskCases: number;
    averageRisk: number;
    freshSignals: number;
    sourceFreshness: number;
    qwenStatus: string;
  };
  activeCase: SentinelCase;
  cases: SentinelCase[];
  riskTrend: TrendPoint[];
  categoryScores: CategoryScore[];
  signals: Signal[];
  geoSignals: GeoSignal[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    relatedCases: string[];
  };
  sourceHealth: SourceHealth[];
  connectorStatus: ConnectorStatus[];
  financialSeries: FinancialPoint[];
  qwenRuntime: QwenRuntime;
  qwenBrief: QwenBrief;
  anomalyMatrix: AnomalyMatrixRow[];
  loanProfiles: LoanProfile[];
  selectedLoanProfile: LoanProfile;
  documentIntelligence: DocumentIntelligence;
  riskDecomposition: RiskDecomposition;
  fraudContext: FraudContext;
  auditTrail: AuditTrail;
  explanationSettings: ExplanationSettings;
  transactionFlow: TransactionFlow;
  fundFlowGraph3d: FundFlowGraph3d;
  entityGraph3d: EntityGraph3d;
  canaraBenchmark: CanaraBenchmark;
  controlChecklist: ControlChecklistItem[];
  qwenFlowBrief: QwenFlowBrief;
  windowState: { open: string[]; minimized: string[]; active: string };
  agentTrace: string[];
};

export type AgentAction = {
  type: string;
  target: string;
  label: string;
  payload: Record<string, unknown>;
};

export type AgentTurn = {
  mode: string;
  model?: string;
  answer: string;
  actions: AgentAction[];
  citations: Array<{ id: string; label: string; sourceUrl: string }>;
  trace: string[];
  latencyMs?: number;
  note?: string;
};
