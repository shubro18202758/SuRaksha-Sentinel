from __future__ import annotations

import hashlib
import html
import json
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from .data_provider import DATA_DIR, read_json


LOAN_PROFILES_PATH = DATA_DIR / "loan_profiles.json"
FRAUD_CONTEXT_PATH = DATA_DIR / "india_fraud_context.json"
DOCUMENT_CASES_PATH = DATA_DIR / "document_intelligence_cases.json"
MOCK_REGISTRIES_PATH = DATA_DIR / "mock_registries.json"

STREAM_LABELS = {
    "visualIntegrity": "Visual Integrity Stream",
    "dataConsistency": "Data Consistency Stream",
    "financialAnomaly": "Financial Anomaly Stream",
}

LANGUAGE_LABELS = {
    "en": "English",
    "hi": "Hindi",
    "kn": "Kannada",
}

GRANULARITY_LABELS = {
    "executive": "Executive Summary",
    "standard": "Standard",
    "forensic": "Forensic Detail",
}

_SESSION_STATE: dict[str, Any] = {
    "caseId": "",
    "profileId": "",
    "language": "en",
    "granularity": "standard",
    "overrides": [],
    "lastIngest": None,
}


def load_loan_profiles() -> list[dict[str, Any]]:
    profiles = read_json(LOAN_PROFILES_PATH, [])
    return profiles if isinstance(profiles, list) else []


def build_document_snapshot(
    cases: list[dict[str, Any]],
    active_case: dict[str, Any],
    signals: list[dict[str, Any]],
    connector_status: list[dict[str, Any]],
    epoch: float,
    now: datetime,
) -> dict[str, Any]:
    profiles = load_loan_profiles()
    profile_by_id = {profile.get("id", ""): profile for profile in profiles}
    document_pack = read_json(DOCUMENT_CASES_PATH, {"cases": [], "mode": "demo-local"})
    templates = {
        str(item.get("caseId", "")): item
        for item in document_pack.get("cases", [])
        if isinstance(item, dict) and item.get("caseId")
    }
    case_ids = {case["id"] for case in cases}
    selected_case_id = str(_SESSION_STATE.get("caseId") or active_case["id"])
    if selected_case_id not in case_ids:
        selected_case_id = active_case["id"]

    workflows: dict[str, Any] = {}
    for case in cases:
        template = templates.get(case["id"])
        profile_id = _selected_profile_id(case, template)
        if case["id"] == selected_case_id and _SESSION_STATE.get("profileId"):
            profile_id = str(_SESSION_STATE["profileId"])
        profile = profile_by_id.get(profile_id) or _fallback_profile(profiles)
        workflows[case["id"]] = _build_case_workflow(case, template, profile, signals, connector_status, epoch, now)

    current = workflows.get(selected_case_id) or next(iter(workflows.values()), {})
    selected_profile = profile_by_id.get(current.get("profileId", "")) or _fallback_profile(profiles)
    fraud_context = read_json(FRAUD_CONTEXT_PATH, {})

    return {
        "loanProfiles": profiles,
        "selectedLoanProfile": selected_profile,
        "documentIntelligence": {
            "mode": document_pack.get("mode", "demo-local"),
            "dataBoundary": document_pack.get("dataBoundary", "Demo document intelligence data."),
            "selectedCaseId": selected_case_id,
            "selectedLoanProfileId": selected_profile.get("id", ""),
            "generatedAt": now.isoformat(),
            "current": current,
            "workflows": workflows,
            "registryBoundary": read_json(MOCK_REGISTRIES_PATH, {}).get("boundary", "Local demo registry references only."),
        },
        "riskDecomposition": current.get("riskDecomposition", {}),
        "fraudContext": fraud_context,
        "auditTrail": current.get("auditTrail", {}),
        "explanationSettings": {
            "language": str(_SESSION_STATE.get("language") or "en"),
            "granularity": str(_SESSION_STATE.get("granularity") or "standard"),
            "supportedLanguages": [{"id": key, "label": value} for key, value in LANGUAGE_LABELS.items()],
            "supportedGranularity": [{"id": key, "label": value} for key, value in GRANULARITY_LABELS.items()],
        },
    }


def set_document_context(payload: dict[str, Any]) -> dict[str, Any]:
    case_id = str(payload.get("caseId") or payload.get("case_id") or "").strip()
    profile_id = str(payload.get("profileId") or payload.get("profile_id") or "").strip()
    language = str(payload.get("language") or _SESSION_STATE.get("language") or "en")
    granularity = str(payload.get("granularity") or _SESSION_STATE.get("granularity") or "standard")
    if language not in LANGUAGE_LABELS:
        language = "en"
    if granularity not in GRANULARITY_LABELS:
        granularity = "standard"
    if case_id:
        _SESSION_STATE["caseId"] = case_id
    if profile_id:
        _SESSION_STATE["profileId"] = profile_id
    _SESSION_STATE["language"] = language
    _SESSION_STATE["granularity"] = granularity
    _SESSION_STATE["lastIngest"] = {
        "caseId": _SESSION_STATE.get("caseId", ""),
        "profileId": _SESSION_STATE.get("profileId", ""),
        "language": language,
        "granularity": granularity,
        "acceptedAt": datetime.now(timezone.utc).isoformat(),
    }
    return dict(_SESSION_STATE["lastIngest"])


def record_underwriting_override(payload: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    case_id = str(payload.get("caseId") or snapshot.get("documentIntelligence", {}).get("selectedCaseId") or snapshot["activeCase"]["id"])
    decision = str(payload.get("decision") or "Reviewer override")
    rationale = str(payload.get("rationale") or "No rationale supplied")
    anomaly_id = str(payload.get("anomalyId") or "")
    override = {
        "id": f"OVR-{case_id}-{int(time.time())}",
        "caseId": case_id,
        "decision": decision[:120],
        "rationale": rationale[:600],
        "anomalyId": anomaly_id,
        "actor": str(payload.get("actor") or "Canara underwriter"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "modelRecommendation": snapshot.get("riskDecomposition", {}).get("decision", snapshot.get("qwenBrief", {}).get("recommendedAction", "")),
    }
    overrides = _SESSION_STATE.setdefault("overrides", [])
    overrides.append(override)
    _SESSION_STATE["caseId"] = case_id
    return {"override": override, "storedOverrides": [item for item in overrides if item.get("caseId") == case_id]}


def document_explanation_pack(snapshot: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    anomaly = _find_anomaly(snapshot, payload)
    workflow = _workflow_for_payload(snapshot, payload)
    settings = snapshot.get("explanationSettings", {})
    language = str(payload.get("language") or settings.get("language") or "en")
    granularity = str(payload.get("granularity") or settings.get("granularity") or "standard")
    return {
        "caseId": workflow.get("caseId", ""),
        "loanProfile": snapshot.get("selectedLoanProfile", {}),
        "language": language if language in LANGUAGE_LABELS else "en",
        "granularity": granularity if granularity in GRANULARITY_LABELS else "standard",
        "anomaly": _compact_anomaly(anomaly),
        "riskDecomposition": workflow.get("riskDecomposition", {}),
        "auditTip": (workflow.get("auditTrail", {}).get("events") or [{}])[-1],
        "qwenRuntime": snapshot.get("qwenRuntime", {}),
    }


def deterministic_document_explanation(snapshot: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    pack = document_explanation_pack(snapshot, payload)
    anomaly = pack["anomaly"]
    language = pack["language"]
    granularity = pack["granularity"]
    answer = _localized_explanation(anomaly, language, granularity)
    citations = [
        {"id": evidence_id, "label": "Evidence object", "sourceUrl": ""}
        for evidence_id in anomaly.get("evidenceIds", [])[:3]
    ]
    citations.extend(
        {
            "id": trace.get("id", "SOURCE"),
            "label": trace.get("label", trace.get("source", "Source trace")),
            "sourceUrl": trace.get("source", ""),
        }
        for trace in anomaly.get("sourceTrace", [])[:2]
    )
    return {
        "mode": "deterministic",
        "language": language,
        "granularity": granularity,
        "headline": anomaly.get("title", "Document anomaly"),
        "answer": answer,
        "confidence": anomaly.get("confidence", 0),
        "observed": anomaly.get("observed", ""),
        "baseline": anomaly.get("baseline", ""),
        "microViz": anomaly.get("microViz", {}),
        "attentionPath": anomaly.get("attentionPath", []),
        "citations": citations,
        "guardrails": [
            "Qwen explains supplied detector facts; it is not used as OCR or vision evidence.",
            "Demo-local registry traces are not live Canara or government records.",
        ],
    }


def deterministic_counterfactual(snapshot: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    anomaly = _find_anomaly(snapshot, payload)
    workflow = _workflow_for_payload(snapshot, payload)
    current_score = float(workflow.get("riskDecomposition", {}).get("compositeScore", 0))
    delta = float(anomaly.get("counterfactualRiskDelta", -8))
    new_score = round(max(0, min(100, current_score + delta)), 1)
    return {
        "mode": "deterministic",
        "caseId": workflow.get("caseId", ""),
        "anomalyId": anomaly.get("id", ""),
        "currentRisk": current_score,
        "counterfactualRisk": new_score,
        "delta": round(new_score - current_score, 1),
        "summary": (
            f"If '{anomaly.get('title', 'this anomaly')}' were cleared as genuine, the composite risk "
            f"would move from {current_score} to {new_score}."
        ),
        "citations": [{"id": evidence_id, "label": anomaly.get("title", "Anomaly"), "sourceUrl": ""} for evidence_id in anomaly.get("evidenceIds", [])[:3]],
    }


def build_audit_export(snapshot: dict[str, Any], case_id: str | None = None) -> dict[str, Any]:
    workflows = snapshot.get("documentIntelligence", {}).get("workflows", {})
    target_case_id = case_id or snapshot.get("documentIntelligence", {}).get("selectedCaseId") or snapshot.get("activeCase", {}).get("id", "")
    workflow = workflows.get(target_case_id) or snapshot.get("documentIntelligence", {}).get("current", {})
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "caseId": workflow.get("caseId", target_case_id),
        "loanProfile": workflow.get("profileLabel", ""),
        "scenario": workflow.get("scenario", ""),
        "riskDecomposition": workflow.get("riskDecomposition", {}),
        "memo": workflow.get("memo", ""),
        "auditTrail": workflow.get("auditTrail", {}),
        "overrides": workflow.get("overrides", []),
        "dataBoundary": snapshot.get("documentIntelligence", {}).get("dataBoundary", ""),
        "qwenRuntime": {
            "model": snapshot.get("qwenRuntime", {}).get("model", ""),
            "mode": snapshot.get("qwenRuntime", {}).get("mode", ""),
            "effectiveContextWindow": snapshot.get("qwenRuntime", {}).get("effectiveContextWindow", snapshot.get("qwenRuntime", {}).get("contextWindow", 4096)),
        },
    }
    return {
        "report": report,
        "html": _audit_html(report),
        "contentType": "text/html",
        "filename": f"{report['caseId']}-audit-report.html",
    }


def _build_case_workflow(
    case: dict[str, Any],
    template: dict[str, Any] | None,
    profile: dict[str, Any],
    signals: list[dict[str, Any]],
    connector_status: list[dict[str, Any]],
    epoch: float,
    now: datetime,
) -> dict[str, Any]:
    template = template or _fallback_template(case)
    anomalies = template.get("anomalies", [])
    risk_decomposition = _risk_decomposition(template.get("riskDecomposition", []), case, profile)
    documents = template.get("documents", [])
    streams = _stream_summaries(anomalies)
    audit_trail = _audit_trail(case, template, profile, risk_decomposition, anomalies, now)
    overrides = [item for item in _SESSION_STATE.get("overrides", []) if item.get("caseId") == case["id"]]
    if overrides:
        audit_trail = _append_override_events(audit_trail, overrides)
    active_anomaly = max(anomalies, key=lambda item: item.get("confidence", 0), default={})
    source_pressure = _source_pressure(signals, connector_status)
    return {
        "caseId": case["id"],
        "profileId": profile.get("id", ""),
        "profileLabel": profile.get("label", ""),
        "roleContext": profile.get("roleContext", ""),
        "branchContext": profile.get("branchContext", case.get("branch", "")),
        "scenario": template.get("scenario", ""),
        "dataMode": "demo-local",
        "sourcePressure": source_pressure,
        "ingestionJob": _ingestion_job(case, template, profile, epoch, now),
        "documents": documents,
        "streams": streams,
        "anomalies": anomalies,
        "selectedAnomalyId": active_anomaly.get("id", ""),
        "riskDecomposition": risk_decomposition,
        "memo": template.get("memo", case.get("nextAction", "")),
        "nextActions": template.get("nextActions", [case.get("nextAction", "")]),
        "auditTrail": audit_trail,
        "overrides": overrides,
        "requirements": profile.get("requiredDocuments", []),
        "checks": profile.get("checks", []),
    }


def _selected_profile_id(case: dict[str, Any], template: dict[str, Any] | None) -> str:
    if template and template.get("profileId"):
        return str(template["profileId"])
    lowered = f"{case.get('loanType', '')} {case.get('stage', '')}".lower()
    if "agricultural" in lowered or "land mortgage" in lowered:
        return "agri-land-mortgage"
    if "working capital" in lowered or "msme" in lowered:
        return "msme-working-capital"
    if "home" in lowered or "property" in lowered:
        return "retail-home-loan"
    return "corporate-credit"


def _fallback_profile(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    return profiles[0] if profiles else {"id": "default", "label": "Underwriting Profile", "riskWeights": []}


def _fallback_template(case: dict[str, Any]) -> dict[str, Any]:
    documents = [
        {
            "id": f"doc-{case['id']}-{index + 1}",
            "title": item.get("title", item.get("id", "Evidence")),
            "kind": item.get("kind", "document"),
            "category": "Dossier Evidence",
            "pageCount": 1,
            "status": "review",
            "sourceType": "dossier-derived",
        }
        for index, item in enumerate(case.get("media", []))
    ]
    anomalies = [
        {
            "id": f"ANM-{case['id']}-{index + 1}",
            "stream": "dataConsistency",
            "documentId": documents[index % max(len(documents), 1)]["id"] if documents else f"doc-{case['id']}",
            "page": 1,
            "bbox": {"x": 18 + index * 12, "y": 28 + index * 8, "w": 28, "h": 10},
            "severity": "high" if case.get("riskScore", 0) >= 70 else "medium",
            "confidence": round(min(94, max(48, float(case.get("riskScore", 50)) + index * 4)), 1),
            "title": item,
            "why": item,
            "observed": "Dossier-derived anomaly requires reviewer confirmation.",
            "baseline": "Expected underwriting controls require source-backed consistency.",
            "microViz": {"type": "spectrum", "label": "Detector confidence", "value": case.get("riskScore", 0), "referenceValue": 40, "unit": "%"},
            "sourceTrace": [{"id": "DOSSIER", "label": "Dossier seed data", "source": "data/dossiers.json", "status": "dossier-derived"}],
            "evidenceIds": [f"EV-{case['id']}-{index + 1}"],
            "attentionPath": [{"x": 18 + index * 12, "y": 28 + index * 8, "w": 28, "h": 10, "durationMs": 500, "label": "Dossier field"}],
            "counterfactualRiskDelta": -8,
        }
        for index, item in enumerate(case.get("anomalies", [])[:3])
    ]
    return {
        "caseId": case["id"],
        "profileId": _selected_profile_id(case, None),
        "scenario": case.get("nextAction", ""),
        "documents": documents,
        "ingestionSteps": ["Classifying dossier evidence.", "Running deterministic checks.", "Preparing local Qwen evidence pack."],
        "anomalies": anomalies,
        "memo": case.get("nextAction", ""),
        "nextActions": [case.get("nextAction", "")],
    }


def _risk_decomposition(items: list[dict[str, Any]], case: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    if not items:
        weights = profile.get("riskWeights", [])
        items = [
            {
                "id": weight.get("id", f"risk-{index}"),
                "label": weight.get("label", "Risk"),
                "weight": weight.get("weight", 25),
                "score": round(max(0, min(100, float(case.get("riskScore", 50)) + math.sin(index) * 8)), 1),
                "drivers": [case.get("stage", "Underwriting review")],
                "anomalyIds": [],
            }
            for index, weight in enumerate(weights)
        ]
    total_weight = sum(float(item.get("weight", 0)) for item in items) or 1
    composite = round(sum(float(item.get("score", 0)) * float(item.get("weight", 0)) for item in items) / total_weight, 1)
    thresholds = profile.get("thresholds", {})
    if composite >= float(thresholds.get("escalateFrom", 70)):
        decision = "Escalate to fraud-risk review"
    elif composite >= float(thresholds.get("holdFrom", 50)):
        decision = "Hold for enhanced verification"
    else:
        decision = "Proceed with standard underwriting controls"
    return {"compositeScore": composite, "decision": decision, "items": items, "weightsTotal": round(total_weight, 1)}


def _stream_summaries(anomalies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for stream_id, label in STREAM_LABELS.items():
        stream_anomalies = [item for item in anomalies if item.get("stream") == stream_id]
        confidence = round(sum(float(item.get("confidence", 0)) for item in stream_anomalies) / max(len(stream_anomalies), 1), 1) if stream_anomalies else 0
        rows.append(
            {
                "id": stream_id,
                "label": label,
                "count": len(stream_anomalies),
                "maxConfidence": max([item.get("confidence", 0) for item in stream_anomalies] or [0]),
                "averageConfidence": confidence,
                "status": "critical" if confidence >= 85 else "review" if confidence >= 55 else "clear",
                "anomalyIds": [item.get("id", "") for item in stream_anomalies],
            }
        )
    return rows


def _ingestion_job(case: dict[str, Any], template: dict[str, Any], profile: dict[str, Any], epoch: float, now: datetime) -> dict[str, Any]:
    steps = template.get("ingestionSteps", []) or ["Classifying documents.", "Running anomaly checks.", "Preparing explanation pack."]
    active_index = int(epoch // 4) % len(steps)
    rows = []
    for index, step in enumerate(steps):
        state = "complete" if index < active_index else "active" if index == active_index else "queued"
        rows.append(
            {
                "id": f"ING-{case['id']}-{index + 1}",
                "label": step,
                "state": state,
                "progress": 100 if state == "complete" else round(42 + (epoch % 4) * 12, 1) if state == "active" else 0,
            }
        )
    completed = sum(1 for row in rows if row["state"] == "complete")
    progress = round(((completed + (0.55 if rows[active_index]["state"] == "active" else 0)) / max(len(rows), 1)) * 100, 1)
    return {
        "id": f"INGEST-{case['id']}",
        "caseId": case["id"],
        "profileId": profile.get("id", ""),
        "profileLabel": profile.get("label", ""),
        "status": "streaming",
        "progress": progress,
        "currentStep": rows[active_index]["label"],
        "startedAt": (now - timedelta(seconds=28 + active_index * 7)).isoformat(),
        "updatedAt": now.isoformat(),
        "steps": rows,
    }


def _audit_trail(
    case: dict[str, Any],
    template: dict[str, Any],
    profile: dict[str, Any],
    risk_decomposition: dict[str, Any],
    anomalies: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    seed_events: list[dict[str, Any]] = [
        {
            "eventType": "upload",
            "label": "Document set accepted",
            "actor": "Branch underwriter",
            "detail": f"{len(template.get('documents', []))} documents mapped to {profile.get('label', 'profile')}.",
            "evidenceIds": [document.get("id", "") for document in template.get("documents", [])[:4]],
        },
        {
            "eventType": "profile",
            "label": "Canara loan profile loaded",
            "actor": "SuRaksha policy engine",
            "detail": f"Risk weights loaded for {profile.get('segment', 'underwriting')}.",
            "evidenceIds": [profile.get("id", "")],
        },
    ]
    for anomaly in anomalies[:4]:
        seed_events.append(
            {
                "eventType": "anomaly",
                "label": anomaly.get("title", "Anomaly detected"),
                "actor": "Deterministic detector",
                "detail": anomaly.get("why", ""),
                "evidenceIds": anomaly.get("evidenceIds", []),
            }
        )
    seed_events.extend(
        [
            {
                "eventType": "qwen-pack",
                "label": "Evidence pack prepared for local Qwen",
                "actor": "Evidence compressor",
                "detail": "Only cited anomaly facts, source traces and risk weights are sent to local Qwen.",
                "evidenceIds": [item.get("id", "") for item in anomalies[:3]],
            },
            {
                "eventType": "decision",
                "label": risk_decomposition.get("decision", "Decision support generated"),
                "actor": "Underwriting decision support",
                "detail": template.get("memo", case.get("nextAction", "")),
                "evidenceIds": [case["id"]],
            },
        ]
    )
    return _hash_events(case["id"], seed_events, now)


def _append_override_events(audit_trail: dict[str, Any], overrides: list[dict[str, Any]]) -> dict[str, Any]:
    events = list(audit_trail.get("events", []))
    previous_hash = events[-1]["hash"] if events else "GENESIS"
    for override in overrides:
        event = {
            "sequence": len(events) + 1,
            "timestamp": override.get("createdAt", datetime.now(timezone.utc).isoformat()),
            "eventType": "human-override",
            "label": override.get("decision", "Reviewer override"),
            "actor": override.get("actor", "Canara underwriter"),
            "detail": override.get("rationale", ""),
            "evidenceIds": [override.get("anomalyId", "")] if override.get("anomalyId") else [],
            "previousHash": previous_hash,
        }
        event["hash"] = _event_hash(event)
        events.append(event)
        previous_hash = event["hash"]
    return {**audit_trail, "events": events, "lastHash": previous_hash, "eventCount": len(events), "chainValid": _validate_chain(events)}


def _hash_events(case_id: str, seed_events: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    events = []
    previous_hash = "GENESIS"
    for index, seed in enumerate(seed_events):
        event = {
            "sequence": index + 1,
            "timestamp": (now - timedelta(seconds=(len(seed_events) - index) * 11)).isoformat(),
            "caseId": case_id,
            **seed,
            "previousHash": previous_hash,
        }
        event["hash"] = _event_hash(event)
        events.append(event)
        previous_hash = event["hash"]
    return {
        "mode": "local-hash-chain",
        "caseId": case_id,
        "chainValid": _validate_chain(events),
        "eventCount": len(events),
        "lastHash": previous_hash,
        "events": events,
    }


def _event_hash(event: dict[str, Any]) -> str:
    stable = {key: value for key, value in event.items() if key != "hash"}
    payload = json.dumps(stable, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _validate_chain(events: list[dict[str, Any]]) -> bool:
    previous_hash = "GENESIS"
    for event in events:
        if event.get("previousHash") != previous_hash:
            return False
        if _event_hash(event) != event.get("hash"):
            return False
        previous_hash = str(event.get("hash", ""))
    return True


def _source_pressure(signals: list[dict[str, Any]], connector_status: list[dict[str, Any]]) -> dict[str, Any]:
    top_signal = max(signals, key=lambda item: item.get("confidence", 0), default={})
    live_count = sum(1 for item in connector_status if item.get("status") == "live")
    return {
        "topSignalId": top_signal.get("id", ""),
        "topSignalTitle": top_signal.get("title", ""),
        "topSignalConfidence": top_signal.get("confidence", 0),
        "liveConnectors": live_count,
        "totalConnectors": len(connector_status),
    }


def _workflow_for_payload(snapshot: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    doc_intel = snapshot.get("documentIntelligence", {})
    workflows = doc_intel.get("workflows", {})
    case_id = str(payload.get("caseId") or payload.get("case_id") or doc_intel.get("selectedCaseId") or "")
    return workflows.get(case_id) or doc_intel.get("current", {})


def _find_anomaly(snapshot: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    workflow = _workflow_for_payload(snapshot, payload)
    anomaly_id = str(payload.get("anomalyId") or payload.get("anomaly_id") or workflow.get("selectedAnomalyId") or "")
    anomalies = workflow.get("anomalies", [])
    return next((item for item in anomalies if item.get("id") == anomaly_id), anomalies[0] if anomalies else {})


def _compact_anomaly(anomaly: dict[str, Any]) -> dict[str, Any]:
    return {
        key: anomaly.get(key)
        for key in (
            "id",
            "stream",
            "documentId",
            "severity",
            "confidence",
            "title",
            "why",
            "observed",
            "baseline",
            "microViz",
            "sourceTrace",
            "evidenceIds",
            "attentionPath",
            "counterfactualRiskDelta",
        )
    }


def _localized_explanation(anomaly: dict[str, Any], language: str, granularity: str) -> str:
    title = anomaly.get("title", "anomaly")
    why = anomaly.get("why", "")
    observed = anomaly.get("observed", "")
    baseline = anomaly.get("baseline", "")
    if language == "hi":
        if granularity == "executive":
            return f"यह क्षेत्र संदिग्ध है: {title}. मानव सत्यापन आवश्यक है।"
        return f"Qwen ने इस संकेत को इसलिए उच्च जोखिम माना: {why} देखी गई बात: {observed} अपेक्षित आधार: {baseline}"
    if language == "kn":
        if granularity == "executive":
            return f"ಈ ಭಾಗ ಅನುಮಾನಾಸ್ಪದವಾಗಿದೆ: {title}. ಮಾನವ ಪರಿಶೀಲನೆ ಅಗತ್ಯ."
        return f"Qwen ಈ ಸೂಚನೆಯನ್ನು ಅಪಾಯಕರವೆಂದು ವಿವರಿಸುತ್ತದೆ: {why} ಗಮನಿಸಿದುದು: {observed} ನಿರೀಕ್ಷಿತ ಆಧಾರ: {baseline}"
    if granularity == "executive":
        return f"{title} materially changes the underwriting risk and requires human verification."
    if granularity == "forensic":
        return f"{why} The model-observed evidence is: {observed} The expected baseline is: {baseline} This explanation is tied to the cited detector facts and source traces, not an uncited model guess."
    return f"{why} Observed: {observed} Baseline: {baseline}"


def _audit_html(report: dict[str, Any]) -> str:
    escaped_case = html.escape(str(report.get("caseId", "")))
    escaped_profile = html.escape(str(report.get("loanProfile", "")))
    escaped_memo = html.escape(str(report.get("memo", "")))
    rows = []
    for event in report.get("auditTrail", {}).get("events", []):
        rows.append(
            "<tr>"
            f"<td>{html.escape(str(event.get('sequence', '')))}</td>"
            f"<td>{html.escape(str(event.get('eventType', '')))}</td>"
            f"<td>{html.escape(str(event.get('label', '')))}</td>"
            f"<td>{html.escape(str(event.get('hash', '')))[:16]}</td>"
            "</tr>"
        )
    risk_rows = []
    for item in report.get("riskDecomposition", {}).get("items", []):
        risk_rows.append(
            "<tr>"
            f"<td>{html.escape(str(item.get('label', '')))}</td>"
            f"<td>{html.escape(str(item.get('weight', '')))}%</td>"
            f"<td>{html.escape(str(item.get('score', '')))}</td>"
            "</tr>"
        )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{escaped_case} audit report</title>"
        "<style>body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#152033}"
        "h1{color:#003c7b}table{border-collapse:collapse;width:100%;margin:16px 0}"
        "td,th{border:1px solid #d8e2f0;padding:8px;text-align:left}"
        ".badge{display:inline-block;background:#ffca05;color:#003c7b;padding:6px 10px;font-weight:700}"
        "@media print{button{display:none}}</style></head><body>"
        f"<p class='badge'>Local hash-chain audit export</p><h1>{escaped_case}</h1>"
        f"<h2>{escaped_profile}</h2><p>{escaped_memo}</p>"
        f"<p><strong>Decision:</strong> {html.escape(str(report.get('riskDecomposition', {}).get('decision', '')))}</p>"
        f"<p><strong>Composite risk:</strong> {html.escape(str(report.get('riskDecomposition', {}).get('compositeScore', '')))}</p>"
        "<h2>Risk Decomposition</h2><table><thead><tr><th>Score</th><th>Weight</th><th>Risk</th></tr></thead><tbody>"
        + "".join(risk_rows)
        + "</tbody></table><h2>Audit Timeline</h2><table><thead><tr><th>#</th><th>Event</th><th>Label</th><th>Hash Prefix</th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
        f"<p><strong>Boundary:</strong> {html.escape(str(report.get('dataBoundary', '')))}</p>"
        f"<p><strong>Qwen:</strong> {html.escape(str(report.get('qwenRuntime', {}).get('model', '')))} | {html.escape(str(report.get('qwenRuntime', {}).get('mode', '')))}</p>"
        "</body></html>"
    )
