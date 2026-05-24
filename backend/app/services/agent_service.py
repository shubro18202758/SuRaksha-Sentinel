from __future__ import annotations

import json
from typing import Any

from .qwen_adapter import generate_qwen_text


ALLOWED_ACTIONS = {
    "selectCase",
    "switchTab",
    "filterSignals",
    "openWindow",
    "pinWindow",
    "refreshConnectors",
    "warmQwen",
    "draftReport",
    "explainChart",
    "selectFlowPath",
    "setFlowRiskFilter",
    "toggleFlowPlayback",
    "open3DWindow",
    "explainFlow",
    "explainEntityPath",
    "selectLoanProfile",
    "selectDocument",
    "selectAnomaly",
    "setExplanationGranularity",
    "setExplanationLanguage",
    "runAttentionReplay",
    "runCounterfactual",
    "createOverride",
    "openAuditEvent",
    "exportAuditReport",
}

AGENT_PROMPT_ACTIONS = [
    "selectAnomaly",
    "openAuditEvent",
    "runAttentionReplay",
    "runCounterfactual",
    "open3DWindow",
    "explainFlow",
    "refreshConnectors",
    "warmQwen",
    "draftReport",
    "exportAuditReport",
]


def run_agent_turn(payload: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message", "")).strip()
    if not message:
        return {
            "mode": "fallback",
            "answer": "Ask a case, evidence, connector, chart, or Qwen runtime question and I will use the current workspace context.",
            "actions": [],
            "citations": [],
            "trace": ["empty-message"],
        }

    context = _agent_context(payload, snapshot)
    prompt = _build_agent_prompt(message, context)
    qwen = generate_qwen_text(prompt, output_tokens=560, task="agent", json_mode=True)
    parsed = _parse_agent_json(qwen.get("text", ""))
    fallback = _deterministic_agent(message, context)
    response = parsed or fallback
    response["actions"] = [_sanitize_action(action) for action in response.get("actions", [])]
    response["actions"] = [action for action in response["actions"] if action]
    response["citations"] = _sanitize_citations(response.get("citations", []), context)
    response["mode"] = qwen.get("mode", "fallback") if parsed else "fallback"
    response["model"] = qwen.get("model", "")
    response["latencyMs"] = qwen.get("latencyMs", 0)
    response["note"] = qwen.get("note", "deterministic response")
    response["trace"] = [
        f"activeView={context['activeView']}",
        f"selectedCase={context['selectedCase']['id']}",
        f"openWindows={len(context['openWindows'])}",
        f"connectors={len(context['connectorStatus'])}",
    ]
    return response


def validate_agent_action(payload: dict[str, Any]) -> dict[str, Any]:
    action_type = str(payload.get("type", ""))
    if action_type not in ALLOWED_ACTIONS:
        return {"accepted": False, "detail": f"Unsupported agent action: {action_type}", "action": None}
    return {"accepted": True, "detail": "Action is allowlisted for frontend execution", "action": _sanitize_action(payload)}


def _agent_context(payload: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    selected_case_id = payload.get("selectedCaseId") or snapshot["activeCase"]["id"]
    selected_case = next((case for case in snapshot["cases"] if case["id"] == selected_case_id), snapshot["activeCase"])
    return {
        "activeView": payload.get("activeView", "command"),
        "selectedCase": selected_case,
        "signalFilter": payload.get("signalFilter", "ALL"),
        "openWindows": payload.get("openWindows", []),
        "qwenRuntime": snapshot["qwenRuntime"],
        "qwenBrief": snapshot["qwenBrief"],
        "topSignals": snapshot["signals"][:4],
        "connectorStatus": snapshot.get("connectorStatus", []),
        "anomalyMatrix": snapshot["anomalyMatrix"],
        "transactionFlow": snapshot.get("transactionFlow", {}),
        "fundFlowGraph3d": snapshot.get("fundFlowGraph3d", {}),
        "entityGraph3d": snapshot.get("entityGraph3d", {}),
        "canaraBenchmark": snapshot.get("canaraBenchmark", {}),
        "controlChecklist": snapshot.get("controlChecklist", []),
        "selectedFlowPathId": payload.get("selectedFlowPathId", ""),
        "selectedEntityNodeId": payload.get("selectedEntityNodeId", ""),
        "selectedDocumentId": payload.get("selectedDocumentId", ""),
        "selectedAnomalyId": payload.get("selectedAnomalyId", ""),
        "explanationLanguage": payload.get("explanationLanguage", "en"),
        "explanationGranularity": payload.get("explanationGranularity", "standard"),
        "documentIntelligence": snapshot.get("documentIntelligence", {}),
        "riskDecomposition": snapshot.get("riskDecomposition", {}),
        "auditTrail": snapshot.get("auditTrail", {}),
    }


def _build_agent_prompt(message: str, context: dict[str, Any]) -> str:
    compact_context = {
        "activeView": context["activeView"],
        "selectedCase": {
            "id": context["selectedCase"]["id"],
            "applicant": context["selectedCase"]["applicant"],
            "riskScore": context["selectedCase"]["riskScore"],
            "status": context["selectedCase"]["status"],
            "stage": context["selectedCase"]["stage"],
            "anomalies": context["selectedCase"]["anomalies"][:2],
        },
        "qwen": {
            "mode": context["qwenRuntime"]["mode"],
            "model": context["qwenRuntime"]["model"],
            "effectiveContextWindow": context["qwenRuntime"].get("effectiveContextWindow"),
            "residencyLoaded": context["qwenRuntime"].get("residency", {}).get("loaded"),
            "processor": context["qwenRuntime"].get("residency", {}).get("processor"),
        },
        "topSignals": [
            {
                "id": signal["id"],
                "title": signal["title"],
                "source": signal["source"],
                "sourceUrl": signal.get("sourceUrl", ""),
                "status": signal.get("provenance", {}).get("connectorStatus", ""),
            }
            for signal in context["topSignals"][:3]
        ],
        "openWindows": context["openWindows"],
        "flow": {
            "summary": _compact_flow_summary(context.get("transactionFlow", {})),
            "topPaths": _compact_flow_paths(context.get("transactionFlow", {}).get("paths", [])[:3]),
            "selectedFlowPathId": context.get("selectedFlowPathId", ""),
        },
        "controls": [
            {"id": item.get("id", ""), "label": item.get("label", ""), "status": item.get("status", "")}
            for item in context.get("controlChecklist", [])[:4]
        ],
        "canaraBenchmark": [
            {
                "id": system.get("id", ""),
                "name": system.get("name", ""),
                "sourceUrl": system.get("sourceUrl", ""),
                "prototypeCoverage": system.get("prototypeCoverage", 0),
            }
            for system in context.get("canaraBenchmark", {}).get("systems", [])[:3]
        ],
        "documentIntelligence": _compact_document_context(context),
    }
    return f"""/no_think
You are SuRaksha Sentinel's local investigation copilot. Answer with compact JSON only.
Schema: {{"answer": string, "actions": [{{"type": string, "target": string, "label": string, "payload": object}}], "citations": [{{"id": string, "label": string, "sourceUrl": string}}]}}
Use these action types unless the user explicitly asks another supported workflow: {AGENT_PROMPT_ACTIONS}.
Do not invent facts. Use only this context. Keep answer under 60 words. Include at most two actions and three citations. Do not include markdown.
Return citations only from case IDs, anomaly IDs, audit hashes, source IDs, or flow path IDs present in context.
For case IDs, anomaly IDs, audit hashes, and flow path IDs, sourceUrl must be "".

User message: {message}
Workspace context:
{json.dumps(compact_context, ensure_ascii=True)}
"""


def _parse_agent_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(_repair_agent_json(text[start : end + 1]))
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict) or "answer" not in parsed:
        return None
    return parsed


def _repair_agent_json(text: str) -> str:
    repaired = text.strip()
    repaired = repaired.replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'")
    while ",}" in repaired or ",]" in repaired:
        repaired = repaired.replace(",}", "}").replace(",]", "]")
    return repaired


def _deterministic_agent(message: str, context: dict[str, Any]) -> dict[str, Any]:
    case = context["selectedCase"]
    runtime = context["qwenRuntime"]
    top_signal = context["topSignals"][0] if context["topSignals"] else {}
    lowered = message.lower()
    actions: list[dict[str, Any]] = []
    if "graph" in lowered or "relationship" in lowered:
        actions.append({"type": "openWindow", "target": "graph", "label": "Open graph explorer", "payload": {"windowType": "graph"}})
    if "anomaly" in lowered or "document" in lowered or "why" in lowered:
        workflow = _current_workflow(context)
        anomaly_id = context.get("selectedAnomalyId") or workflow.get("selectedAnomalyId", "")
        actions.append({"type": "selectAnomaly", "target": anomaly_id, "label": "Select anomaly", "payload": {"anomalyId": anomaly_id, "caseId": case["id"]}})
    if "attention" in lowered or "replay" in lowered:
        actions.append({"type": "runAttentionReplay", "target": context.get("selectedAnomalyId", ""), "label": "Replay attention", "payload": {"caseId": case["id"], "anomalyId": context.get("selectedAnomalyId", "")}})
    if "counterfactual" in lowered or "what if" in lowered:
        actions.append({"type": "runCounterfactual", "target": context.get("selectedAnomalyId", ""), "label": "Run counterfactual", "payload": {"caseId": case["id"], "anomalyId": context.get("selectedAnomalyId", "")}})
    if "audit" in lowered or "hash" in lowered or "timeline" in lowered:
        actions.append({"type": "openAuditEvent", "target": "audit", "label": "Open audit trail", "payload": {"caseId": case["id"]}})
    if "3d" in lowered or "flow" in lowered or "fund" in lowered or "transaction" in lowered:
        actions.append({"type": "open3DWindow", "target": "flow3d", "label": "Open 3D fund flow", "payload": {"windowType": "flow3d"}})
    if "entity" in lowered and ("3d" in lowered or "path" in lowered):
        actions.append({"type": "open3DWindow", "target": "entity3d", "label": "Open 3D entity graph", "payload": {"windowType": "entity3d"}})
    if "report" in lowered or "export" in lowered:
        actions.append({"type": "draftReport", "target": case["id"], "label": "Draft report", "payload": {"caseId": case["id"]}})
        actions.append({"type": "exportAuditReport", "target": case["id"], "label": "Export audit report", "payload": {"caseId": case["id"]}})
    if "source" in lowered or "connector" in lowered or "refresh" in lowered:
        actions.append({"type": "refreshConnectors", "target": "connectors", "label": "Refresh live sources", "payload": {}})
    if "qwen" in lowered or "model" in lowered or "gpu" in lowered:
        actions.append({"type": "warmQwen", "target": "qwen", "label": "Warm Qwen", "payload": {}})

    answer = (
        f"{case['id']} is at {case['riskScore']} risk in {case['stage']}. "
        f"The strongest current case facts are: {', '.join(case['anomalies'][:2])}. "
        f"Qwen is {runtime['mode']} on {runtime['model']} with effective context {runtime.get('effectiveContextWindow', runtime['contextWindow'])}. "
    )
    if top_signal:
        answer += f"Top live source signal is {top_signal['source']}: {top_signal['title']}."
    flow = context.get("transactionFlow", {})
    case_paths = [path for path in flow.get("paths", []) if path.get("caseId") == case["id"]]
    top_path = max(case_paths or flow.get("paths", []) or [{}], key=lambda item: item.get("riskScore", 0))
    if top_path:
        answer += f" Highest-risk demo fund path is {top_path.get('id')} at {top_path.get('riskScore')} risk."
    workflow = _current_workflow(context)
    if workflow:
        decomposition = workflow.get("riskDecomposition", {})
        answer += f" Document workflow is {workflow.get('profileLabel', 'underwriting')} with composite risk {decomposition.get('compositeScore', 0)} and {len(workflow.get('anomalies', []))} explainable anomalies."

    citations = [
        {"id": f"CASE-{case['id']}", "label": case["applicant"], "sourceUrl": ""},
    ]
    if top_signal:
        citations.append({"id": top_signal["id"], "label": top_signal["title"], "sourceUrl": top_signal.get("sourceUrl", "")})
    if top_path:
        citations.append({"id": top_path.get("id", "PATH"), "label": top_path.get("label", "Top fund-flow path"), "sourceUrl": ""})
    return {"answer": answer, "actions": actions, "citations": citations}


def _sanitize_action(action: dict[str, Any]) -> dict[str, Any] | None:
    action_type = str(action.get("type", ""))
    if action_type not in ALLOWED_ACTIONS:
        return None
    payload = action.get("payload", {}) if isinstance(action.get("payload", {}), dict) else {}
    label = str(action.get("label", action_type))
    target = str(action.get("target", ""))
    if action_type == "open3DWindow":
        if "entity" in target.lower() or "entity" in label.lower():
            payload = {**payload, "windowType": "entity3d"}
        else:
            payload = {**payload, "windowType": "flow3d"}
    if action_type == "openWindow" and "windowType" not in payload:
        lowered = f"{label} {target}".lower()
        if "graph" in lowered:
            payload = {**payload, "windowType": "graph"}
        elif "source" in lowered or "connector" in lowered:
            payload = {**payload, "windowType": "sources"}
        elif "media" in lowered or "evidence" in lowered:
            payload = {**payload, "windowType": "media"}
        elif "qwen" in lowered or "model" in lowered:
            payload = {**payload, "windowType": "qwen"}
        elif "report" in lowered:
            payload = {**payload, "windowType": "report"}
        else:
            payload = {**payload, "windowType": "case"}
    if action_type in {"selectAnomaly", "runAttentionReplay", "runCounterfactual"} and "anomalyId" not in payload:
        payload = {**payload, "anomalyId": target}
    if action_type == "selectDocument" and "documentId" not in payload:
        payload = {**payload, "documentId": target}
    if action_type == "selectLoanProfile" and "profileId" not in payload:
        payload = {**payload, "profileId": target}
    if action_type in {"openAuditEvent", "exportAuditReport"} and "caseId" not in payload:
        payload = {**payload, "caseId": target}
    return {
        "type": action_type,
        "target": target,
        "label": label,
        "payload": payload,
    }


def _sanitize_citations(citations: Any, context: dict[str, Any]) -> list[dict[str, str]]:
    case = context["selectedCase"]
    workflow = _current_workflow(context)
    lookup: dict[str, dict[str, str]] = {
        case["id"]: {"id": case["id"], "label": case["applicant"], "sourceUrl": ""},
        f"CASE-{case['id']}": {"id": f"CASE-{case['id']}", "label": case["applicant"], "sourceUrl": ""},
    }
    for anomaly in workflow.get("anomalies", []):
        anomaly_id = str(anomaly.get("id", ""))
        if anomaly_id:
            lookup[anomaly_id] = {"id": anomaly_id, "label": str(anomaly.get("title", "Anomaly")), "sourceUrl": ""}
    for event in workflow.get("auditTrail", {}).get("events", []):
        event_hash = str(event.get("hash", ""))
        event_id = str(event.get("id", ""))
        label = str(event.get("label") or event.get("event") or "Audit event")
        if event_hash:
            lookup[event_hash] = {"id": event_hash, "label": label, "sourceUrl": ""}
        if event_id:
            lookup[event_id] = {"id": event_id, "label": label, "sourceUrl": ""}
    for signal in context.get("topSignals", []):
        signal_id = str(signal.get("id", ""))
        if signal_id:
            lookup[signal_id] = {"id": signal_id, "label": str(signal.get("title", "Source signal")), "sourceUrl": str(signal.get("sourceUrl", ""))}
    for path in context.get("transactionFlow", {}).get("paths", []):
        path_id = str(path.get("id", ""))
        if path_id:
            lookup[path_id] = {"id": path_id, "label": str(path.get("label", "Fund-flow path")), "sourceUrl": ""}

    rows = citations if isinstance(citations, list) else []
    sanitized: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        citation_id = str(row.get("id", "")) if isinstance(row, dict) else str(row)
        if citation_id not in lookup or citation_id in seen:
            continue
        seen.add(citation_id)
        sanitized.append(lookup[citation_id])
    if not sanitized:
        sanitized.append(lookup[case["id"]])
    return sanitized[:3]


def _compact_flow_summary(flow: dict[str, Any]) -> dict[str, Any]:
    summary = flow.get("summary", {})
    return {
        "caseId": summary.get("caseId", flow.get("selectedCaseId", "")),
        "eventCount": summary.get("eventCount", len(flow.get("events", []))),
        "highRiskCount": summary.get("highRiskCount", 0),
        "peakRisk": summary.get("peakRisk", 0),
        "mode": flow.get("mode", ""),
    }


def _compact_flow_paths(paths: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": path.get("id", ""),
            "label": path.get("label", ""),
            "riskScore": path.get("riskScore", 0),
            "eventIds": path.get("eventIds", [])[:3],
        }
        for path in paths
    ]


def _current_workflow(context: dict[str, Any]) -> dict[str, Any]:
    doc_intel = context.get("documentIntelligence", {})
    selected_case_id = context.get("selectedCase", {}).get("id", "")
    workflows = doc_intel.get("workflows", {})
    return workflows.get(selected_case_id) or doc_intel.get("current", {})


def _compact_document_context(context: dict[str, Any]) -> dict[str, Any]:
    workflow = _current_workflow(context)
    anomalies = workflow.get("anomalies", [])
    audit_events = workflow.get("auditTrail", {}).get("events", [])
    return {
        "caseId": workflow.get("caseId", ""),
        "profile": workflow.get("profileLabel", ""),
        "selectedDocumentId": context.get("selectedDocumentId", ""),
        "selectedAnomalyId": context.get("selectedAnomalyId") or workflow.get("selectedAnomalyId", ""),
        "language": context.get("explanationLanguage", "en"),
        "granularity": context.get("explanationGranularity", "standard"),
        "risk": workflow.get("riskDecomposition", {}),
        "topAnomalies": [
            {
                "id": item.get("id", ""),
                "title": item.get("title", ""),
                "stream": item.get("stream", ""),
                "confidence": item.get("confidence", 0),
                "evidenceIds": item.get("evidenceIds", [])[:3],
            }
            for item in sorted(anomalies, key=lambda row: row.get("confidence", 0), reverse=True)[:4]
        ],
        "audit": {
            "mode": workflow.get("auditTrail", {}).get("mode", ""),
            "chainValid": workflow.get("auditTrail", {}).get("chainValid", False),
            "lastHash": workflow.get("auditTrail", {}).get("lastHash", ""),
            "latestEvent": audit_events[-1] if audit_events else {},
        },
    }
