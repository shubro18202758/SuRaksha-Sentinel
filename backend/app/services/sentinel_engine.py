from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any

from .connectors import connector_snapshot, source_signals
from .data_provider import load_dossier_data
from .document_intelligence import build_document_snapshot
from .flow_engine import build_flow_intelligence
from .media_store import media_catalog
from .qwen_runtime import build_qwen_decision_brief, build_qwen_runtime


def build_snapshot() -> dict[str, Any]:
    data = load_dossier_data()
    now = datetime.now(timezone.utc)
    epoch = time.time()
    connector_data = connector_snapshot(force=False)
    connector_status = connector_data.get("connectors", [])
    signals = _signals(epoch, connector_status)
    cases = [_build_case(template, index, epoch, now) for index, template in enumerate(data.get("cases", []))]
    active_case = max(cases, key=lambda item: item["riskScore"])
    high_risk_count = sum(1 for case in cases if case["riskScore"] >= 70)
    average_risk = round(sum(case["riskScore"] for case in cases) / max(len(cases), 1), 1)
    category_scores = _category_scores(epoch, cases, signals)
    qwen_runtime = build_qwen_runtime(epoch)
    source_freshness = _source_freshness(connector_status)
    financial_series = _financial_series(epoch, active_case)
    flow_intelligence = build_flow_intelligence(cases, active_case, signals, connector_status, epoch, now)
    document_intelligence = build_document_snapshot(cases, active_case, signals, connector_status, epoch, now)

    return {
        "generatedAt": now.isoformat(),
        "portfolio": data.get("portfolio", {}),
        "overview": {
            "activeCases": len(cases),
            "highRiskCases": high_risk_count,
            "averageRisk": average_risk,
            "freshSignals": len(signals),
            "sourceFreshness": source_freshness,
            "qwenStatus": qwen_runtime["mode"],
        },
        "activeCase": active_case,
        "cases": cases,
        "riskTrend": _risk_trend(epoch, cases, signals),
        "categoryScores": category_scores,
        "signals": signals,
        "geoSignals": _geo_signals(cases, data.get("portfolio", {}).get("regions", [])),
        "graph": _graph(cases, active_case, signals),
        "sourceHealth": _source_health(connector_status),
        "connectorStatus": connector_status,
        "financialSeries": financial_series,
        "qwenRuntime": qwen_runtime,
        "qwenBrief": build_qwen_decision_brief(active_case, category_scores, signals or _connector_signals(connector_status), epoch),
        "anomalyMatrix": _anomaly_matrix(epoch, category_scores, signals),
        **document_intelligence,
        **flow_intelligence,
        "windowState": {"open": [], "minimized": [], "active": ""},
        "agentTrace": [],
    }


def _build_case(template: dict[str, Any], index: int, epoch: float, now: datetime) -> dict[str, Any]:
    risk = round(_bounded(float(template["baseRisk"]) + _wave(epoch, index, 9), 4, 98), 1)
    trend = round(_wave(epoch / 2, index + 4, 3), 1)
    media = [_build_media_item(template["id"], item, risk, media_index, index, epoch) for media_index, item in enumerate(template.get("media", []))]
    media.extend(_uploaded_media_for_case(template["id"]))
    forensic_checks = _forensic_checks(risk, index, epoch)
    priority = "P1 red desk" if risk >= 72 else "P2 legal review" if risk >= 52 else "P3 monitored pass"
    next_action = (
        "Lock disbursement, request original-chain validation, and escalate to legal risk cell."
        if risk >= 72
        else "Hold until source corroboration and reviewer challenge questions are resolved."
        if risk >= 52
        else "Proceed with monitored approval and keep external-source watcher active."
    )
    return {
        "id": template["id"],
        "applicant": template["applicant"],
        "loanType": template["loanType"],
        "loanAmount": template.get("loanAmount", "not supplied"),
        "branch": template.get("branch", "not supplied"),
        "location": template["location"],
        "lat": template["lat"],
        "lng": template["lng"],
        "riskScore": risk,
        "riskDelta": trend,
        "status": template["status"] if risk >= 35 else "Proceed",
        "stage": template["stage"],
        "anomalies": template.get("anomalies", []),
        "lastUpdated": now.isoformat(),
        "media": media,
        "documentsProcessed": len(media) + 4 + index,
        "evidenceCount": len(media) * 4 + len(template.get("anomalies", [])) + int(abs(_wave(epoch, index, 4))),
        "priority": priority,
        "owner": template.get("owner", "Underwriting"),
        "slaMinutes": int(_bounded(95 - risk + abs(_wave(epoch, index + 5, 18)), 12, 140)),
        "nextAction": next_action,
        "forensicChecks": forensic_checks,
        "timeline": [
            {"stage": "Dossier intake", "state": "complete", "score": round(_bounded(92 - risk * 0.18, 40, 99), 1)},
            {"stage": template["stage"], "state": "active", "score": risk},
            {"stage": "Reviewer challenge", "state": "queued", "score": round(_bounded(risk - 8, 0, 99), 1)},
            {"stage": "Decision pack", "state": "pending", "score": round(_bounded(risk - 16, 0, 99), 1)},
        ],
        "financialSeries": template.get("financialSeries", []),
        "provenance": {
            "connectorId": "dossier-file",
            "connectorStatus": "local",
            "sourceUrl": "data/dossiers.json",
            "retrievedAt": now.isoformat(),
        },
    }


def _build_media_item(case_id: str, item: dict[str, Any], risk: float, media_index: int, case_index: int, epoch: float) -> dict[str, Any]:
    kind = item.get("kind", "document")
    return {
        "id": item["id"],
        "type": "video" if kind == "video" else "document",
        "kind": kind,
        "title": item.get("title", item["id"].replace("-", " ").title()),
        "url": item.get("url", ""),
        "previewUrl": item.get("previewUrl", ""),
        "streamState": "uploaded" if item.get("url") else "metadata-only",
        "integrityScore": round(_bounded(97 - risk * 0.38 + _wave(epoch, media_index + case_index, 5), 38, 99), 1),
        "ocrConfidence": round(_bounded(98 - risk * 0.12 + _wave(epoch, media_index + 4, 3), 72, 99), 1),
        "tamperHeat": round(_bounded(risk + _wave(epoch, media_index + 9, 10), 0, 99), 1),
        "framesAnalyzed": int(_bounded(124 + media_index * 57 + abs(_wave(epoch, media_index + 12, 42)), 64, 420)),
        "detector": item.get("detector", "forensic worker"),
        "provenance": {
            "connectorId": "dossier-file",
            "connectorStatus": "local-seed",
            "sourceUrl": "data/dossiers.json",
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


def _uploaded_media_for_case(case_id: str) -> list[dict[str, Any]]:
    uploaded = []
    for item in media_catalog():
        if item.get("caseId") == case_id:
            uploaded.append({**item, "type": "video" if item.get("kind") == "video" else "document", "streamState": "uploaded"})
    return uploaded


def _forensic_checks(risk: float, index: int, epoch: float) -> list[dict[str, Any]]:
    labels = [
        "Document raster/noise consistency",
        "Identity/entity cross-source match",
        "Financial flow plausibility",
        "Open-source adverse mention overlap",
    ]
    checks = []
    for check_index, label in enumerate(labels):
        score = round(_bounded(risk + _wave(epoch, index + check_index + 3, 12), 4, 99), 1)
        checks.append({"label": label, "score": score, "verdict": "critical" if score >= 76 else "elevated" if score >= 54 else "clear"})
    return checks


def _signals(epoch: float, connector_status: list[dict[str, Any]]) -> list[dict[str, Any]]:
    signals = source_signals()
    if signals:
        return _diversified_signals(signals, epoch, limit=18)
    return _connector_signals(connector_status, epoch)


def _diversified_signals(signals: list[dict[str, Any]], epoch: float, limit: int) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for signal in signals:
        connector_id = signal.get("provenance", {}).get("connectorId") or signal.get("source", "source")
        grouped.setdefault(str(connector_id), []).append(signal)

    cycle = int(epoch // 11)
    for connector_id, rows in grouped.items():
        offset = (cycle + sum(ord(char) for char in connector_id)) % max(len(rows), 1)
        grouped[connector_id] = rows[offset:] + rows[:offset]

    connector_order = sorted(grouped, key=lambda item: (-max(row["confidence"] for row in grouped[item]), item))
    if connector_order:
        offset = cycle % len(connector_order)
        connector_order = connector_order[offset:] + connector_order[:offset]

    selected: list[dict[str, Any]] = []
    cursor = 0
    while len(selected) < limit and any(cursor < len(grouped[connector_id]) for connector_id in connector_order):
        for connector_id in connector_order:
            rows = grouped[connector_id]
            if cursor < len(rows):
                selected.append(rows[cursor])
                if len(selected) >= limit:
                    break
        cursor += 1
    return selected[:limit]


def _connector_signals(connector_status: list[dict[str, Any]], epoch: float = 0) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    signals = []
    for index, connector in enumerate(connector_status):
        status = connector.get("status", "degraded")
        confidence = 72 if status == "live" else 48 if status == "stale" else 32
        signals.append(
            {
                "id": f"SIG-CONNECTOR-{connector.get('id', index)}",
                "source": connector.get("name", "Connector"),
                "type": connector.get("type", "OSINT"),
                "title": f"{connector.get('name', 'Connector')} is {status}",
                "severity": "Medium" if status != "live" else "Low",
                "summary": connector.get("detail", "Connector status unavailable"),
                "confidence": round(_bounded(confidence + _wave(epoch, index, 3), 0, 99), 1),
                "observedAt": connector.get("retrievedAt", now),
                "retrievedAt": connector.get("retrievedAt", now),
                "sourceUrl": connector.get("sourceUrl", ""),
                "previewUrl": "",
                "provenance": {
                    "connectorId": connector.get("id", "connector"),
                    "connectorStatus": status,
                    "sourceUrl": connector.get("sourceUrl", ""),
                    "retrievedAt": connector.get("retrievedAt", now),
                },
            }
        )
    return signals


def _risk_trend(epoch: float, cases: list[dict[str, Any]], signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    average_case_risk = sum(case["riskScore"] for case in cases) / max(len(cases), 1)
    source_pressure = sum(signal["confidence"] for signal in signals[:5]) / max(min(len(signals), 5), 1) if signals else 20
    points: list[dict[str, Any]] = []
    for offset in range(16, -1, -1):
        marker = int((epoch // 60) - offset)
        label = f"T-{offset * 2}m" if offset else "Now"
        points.append(
            {
                "time": label,
                "document": round(_bounded(average_case_risk + math.sin(marker / 2) * 12, 0, 100), 1),
                "financial": round(_bounded(average_case_risk - 8 + math.cos(marker / 3) * 11, 0, 100), 1),
                "external": round(_bounded(source_pressure + math.sin(marker / 2.7 + 1.4) * 14, 0, 100), 1),
            }
        )
    return points


def _category_scores(epoch: float, cases: list[dict[str, Any]], signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    avg_risk = sum(case["riskScore"] for case in cases) / max(len(cases), 1)
    external = sum(signal["confidence"] for signal in signals[:6]) / max(min(len(signals), 6), 1) if signals else 35
    categories = [
        ("Document Integrity", avg_risk + 8),
        ("Financial Consistency", avg_risk - 2),
        ("External Intelligence", external),
        ("Entity Graph Risk", avg_risk + 1),
        ("Underwriting Materiality", (avg_risk * 0.65) + (external * 0.35)),
    ]
    return [{"name": name, "score": round(_bounded(score + _wave(epoch, index + 2, 7), 0, 100), 1)} for index, (name, score) in enumerate(categories)]


def _geo_signals(cases: list[dict[str, Any]], regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    case_rows = [
        {"id": case["id"], "label": case["location"], "lat": case["lat"], "lng": case["lng"], "risk": case["riskScore"], "status": case["status"]}
        for case in cases
    ]
    region_rows = [
        {
            "id": f"REG-{region['name']}",
            "label": region["name"],
            "lat": region["lat"],
            "lng": region["lng"],
            "risk": region["risk"],
            "status": f"{region['branchLoad']} active branch items",
        }
        for region in regions
    ]
    return case_rows + region_rows


def _graph(cases: list[dict[str, Any]], active_case: dict[str, Any], signals: list[dict[str, Any]]) -> dict[str, Any]:
    nodes = [
        {"id": "case", "label": active_case["id"], "type": "case", "risk": active_case["riskScore"]},
        {"id": "applicant", "label": active_case["applicant"], "type": "entity", "risk": active_case["riskScore"]},
        {"id": "property", "label": active_case["location"], "type": "property", "risk": active_case["riskScore"] - 7},
        {"id": "statement", "label": "Financial Statement", "type": "document", "risk": active_case["riskScore"] - 12},
    ]
    edges = [
        {"source": "case", "target": "applicant", "label": "submitted by"},
        {"source": "case", "target": "property", "label": "collateral"},
        {"source": "case", "target": "statement", "label": "income proof"},
    ]
    for index, signal in enumerate(signals[:3]):
        node_id = f"signal-{index}"
        nodes.append({"id": node_id, "label": signal["source"], "type": signal["type"].lower(), "risk": signal["confidence"]})
        edges.append({"source": node_id, "target": "case", "label": signal.get("provenance", {}).get("connectorStatus", "source")})
    return {"nodes": nodes, "edges": edges, "relatedCases": [case["id"] for case in cases]}


def _source_health(connector_status: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for connector in connector_status:
        status = connector.get("status", "degraded")
        rows.append(
            {
                "name": connector.get("name", "Connector"),
                "freshness": 96 if status == "live" else 62 if status == "stale" else 22,
                "latencyMs": connector.get("latencyMs", 0),
                "status": status,
                "detail": connector.get("detail", ""),
                "sourceUrl": connector.get("sourceUrl", ""),
                "retrievedAt": connector.get("retrievedAt", ""),
            }
        )
    return rows


def _financial_series(epoch: float, active_case: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    base = active_case.get("financialSeries", []) or []
    for index, item in enumerate(base):
        rows.append(
            {
                "month": item["month"],
                "inflow": round(_bounded(item["inflow"] + _wave(epoch, index, 3), 0, 120), 1),
                "outflow": round(_bounded(item["outflow"] + _wave(epoch, index + 3, 3), 0, 120), 1),
                "anomaly": round(_bounded(item["anomaly"] + abs(_wave(epoch, index + 6, 3)), 0, 50), 1),
            }
        )
    return rows


def _anomaly_matrix(epoch: float, category_scores: list[dict[str, Any]], signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    external_pressure = sum(signal["confidence"] for signal in signals[:4]) / max(min(len(signals), 4), 1) if signals else 35
    rows: list[dict[str, Any]] = []
    for index, category in enumerate(category_scores):
        detector = round(_bounded(category["score"] + _wave(epoch, index + 9, 6), 0, 100), 1)
        qwen = round(_bounded(category["score"] - 4 + _wave(epoch, index + 13, 5), 0, 100), 1)
        external = round(_bounded((category["score"] * 0.45) + (external_pressure * 0.55) + _wave(epoch, index + 17, 7), 0, 100), 1)
        rows.append({"category": category["name"], "detector": detector, "qwen": qwen, "external": external, "consensus": round((detector + qwen + external) / 3, 1)})
    return rows


def _source_freshness(connector_status: list[dict[str, Any]]) -> float:
    if not connector_status:
        return 0
    values = [96 if item.get("status") == "live" else 62 if item.get("status") == "stale" else 22 for item in connector_status]
    return round(sum(values) / len(values), 1)


def _wave(epoch: float, seed: int, amplitude: float) -> float:
    return math.sin(epoch / 9 + seed * 1.618) * amplitude + math.cos(epoch / 23 + seed) * amplitude * 0.28


def _bounded(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))
