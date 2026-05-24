from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from .data_provider import DATA_DIR, read_json


BENCHMARK_PATH = DATA_DIR / "canara_public_benchmark.json"


def build_flow_intelligence(
    cases: list[dict[str, Any]],
    active_case: dict[str, Any],
    signals: list[dict[str, Any]],
    connector_status: list[dict[str, Any]],
    epoch: float,
    now: datetime,
) -> dict[str, Any]:
    benchmark = _canara_benchmark(active_case, signals, connector_status, now)
    events: list[dict[str, Any]] = []
    for case_index, case in enumerate(cases):
        events.extend(_case_events(case, case_index, signals, epoch, now))

    events.sort(key=lambda item: (item["timestamp"], item["id"]), reverse=True)
    paths = _flow_paths(events)
    graph_3d = _fund_flow_graph(cases, events, paths, epoch)
    entity_3d = _entity_graph_3d(cases, active_case, signals, epoch)
    controls = _control_checklist(active_case, signals, graph_3d, benchmark, now)
    qwen_flow_brief = deterministic_flow_brief(active_case, events, paths, controls, signals)

    return {
        "transactionFlow": {
            "mode": "demo-simulated",
            "generatedAt": now.isoformat(),
            "selectedCaseId": active_case["id"],
            "summary": _flow_summary(events, active_case["id"]),
            "caseSummaries": _case_summaries(cases, events),
            "events": events,
            "paths": paths,
            "sourceFactors": _source_factors(signals, connector_status),
            "provenance": {
                "mode": "demo-simulated",
                "sourceUrl": "data/dossiers.json + live connector pressure",
                "retrievedAt": now.isoformat(),
                "detail": "Locally generated demo transaction stream derived from dossier financial series, case risk, and live connector pressure. Not production bank transaction data.",
            },
        },
        "fundFlowGraph3d": graph_3d,
        "entityGraph3d": entity_3d,
        "canaraBenchmark": benchmark,
        "controlChecklist": controls,
        "qwenFlowBrief": qwen_flow_brief,
    }


def build_filtered_flow(snapshot: dict[str, Any], case_id: str | None = None) -> dict[str, Any]:
    flow = snapshot.get("transactionFlow", {})
    target_case_id = case_id or flow.get("selectedCaseId") or snapshot.get("activeCase", {}).get("id", "")
    events = [event for event in flow.get("events", []) if not target_case_id or event.get("caseId") == target_case_id]
    event_ids = {event.get("id") for event in events}
    paths = [path for path in flow.get("paths", []) if path.get("caseId") == target_case_id or any(event_id in event_ids for event_id in path.get("eventIds", []))]
    node_ids = {event.get("fromNode") for event in events} | {event.get("toNode") for event in events}
    graph = snapshot.get("fundFlowGraph3d", {})
    return {
        "caseId": target_case_id,
        "generatedAt": snapshot.get("generatedAt", ""),
        "mode": flow.get("mode", "demo-simulated"),
        "summary": _flow_summary(events, target_case_id),
        "events": events,
        "paths": paths,
        "graph": {
            **graph,
            "nodes": [node for node in graph.get("nodes", []) if node.get("id") in node_ids or node.get("caseId") == target_case_id],
            "links": [link for link in graph.get("links", []) if link.get("source") in node_ids and link.get("target") in node_ids],
            "particles": [particle for particle in graph.get("particles", []) if particle.get("eventId") in event_ids],
        },
        "provenance": flow.get("provenance", {}),
    }


def deterministic_flow_brief(
    active_case: dict[str, Any],
    events: list[dict[str, Any]],
    paths: list[dict[str, Any]],
    controls: list[dict[str, Any]],
    signals: list[dict[str, Any]],
) -> dict[str, Any]:
    case_events = [event for event in events if event.get("caseId") == active_case["id"]]
    top_event = max(case_events or events, key=lambda item: item.get("riskScore", 0), default={})
    top_path = max([path for path in paths if path.get("caseId") == active_case["id"]] or paths, key=lambda item: item.get("riskScore", 0), default={})
    failed_controls = [item for item in controls if item.get("status") in {"critical", "review"}]
    top_signal = max(signals, key=lambda item: item.get("confidence", 0), default={})
    action = "Escalate fund-flow and document review" if active_case["riskScore"] >= 72 else "Hold for enhanced source-backed verification" if active_case["riskScore"] >= 52 else "Proceed with monitored controls"
    return {
        "mode": "deterministic",
        "headline": f"{action}: {active_case['id']} has {len(case_events)} live demo flow events under review.",
        "summary": (
            f"Highest-risk path is {top_path.get('label', 'not available')} at {top_path.get('riskScore', 0)} risk. "
            f"Peak event {top_event.get('id', 'n/a')} uses {top_event.get('channel', 'n/a')} for INR {top_event.get('amountInr', 0):,}."
        ),
        "recommendedAction": action,
        "confidence": round(min(98, max(40, active_case["riskScore"] * 0.82 + len(failed_controls) * 4)), 1),
        "materialityScore": round(min(100, max(0, active_case["riskScore"] * 0.68 + top_path.get("riskScore", 0) * 0.32)), 1),
        "citations": [
            {"id": top_event.get("id", f"FLOW-{active_case['id']}"), "label": top_event.get("riskReason", "Top fund-flow event"), "sourceUrl": ""},
            {"id": top_path.get("id", f"PATH-{active_case['id']}"), "label": top_path.get("label", "Top routed path"), "sourceUrl": ""},
            {"id": top_signal.get("id", "SIG-LOCAL"), "label": top_signal.get("title", "Top source pressure"), "sourceUrl": top_signal.get("sourceUrl", "")},
        ],
        "nextChecks": [
            "Compare routed fund path against declared business purpose and borrower cash-flow seasonality.",
            "Verify document and legal evidence behind the flow before disbursement.",
            "Ask Qwen for a cited path explanation only after selecting a concrete event or path.",
        ],
        "guardrails": [
            "Demo flow stream is locally simulated from dossier and connector pressure.",
            "Qwen must cite event IDs, evidence IDs, and source URLs when explaining paths.",
            "No borrower data is sent outside the local Qwen runtime.",
        ],
    }


def flow_prompt_pack(snapshot: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    case_id = str(payload.get("caseId") or snapshot.get("transactionFlow", {}).get("selectedCaseId") or snapshot["activeCase"]["id"])
    path_id = str(payload.get("pathId") or "")
    event_id = str(payload.get("eventId") or "")
    flow = snapshot.get("transactionFlow", {})
    events = [event for event in flow.get("events", []) if event.get("caseId") == case_id]
    if event_id:
        events = [event for event in events if event.get("id") == event_id] or events[:8]
    paths = [path for path in flow.get("paths", []) if path.get("caseId") == case_id]
    if path_id:
        paths = [path for path in paths if path.get("id") == path_id] or paths[:4]
    return {
        "caseId": case_id,
        "selectedPathId": path_id,
        "selectedEventId": event_id,
        "events": sorted(events, key=lambda item: item.get("riskScore", 0), reverse=True)[:8],
        "paths": sorted(paths, key=lambda item: item.get("riskScore", 0), reverse=True)[:4],
        "controls": snapshot.get("controlChecklist", [])[:5],
        "sourceFactors": flow.get("sourceFactors", [])[:5],
        "qwenRuntime": snapshot.get("qwenRuntime", {}),
        "provenance": flow.get("provenance", {}),
    }


def _case_events(case: dict[str, Any], case_index: int, signals: list[dict[str, Any]], epoch: float, now: datetime) -> list[dict[str, Any]]:
    financial_rows = case.get("financialSeries", []) or []
    channels = ["NEFT", "RTGS", "IMPS", "UPI", "Cash", "GST", "Loan"]
    account_types = ["current account", "escrow", "supplier account", "tax ledger", "loan account", "cash ledger"]
    events: list[dict[str, Any]] = []
    for index, row in enumerate(financial_rows[-6:]):
        signal = signals[(case_index + index) % max(len(signals), 1)] if signals else {}
        anomaly = float(row.get("anomaly", 0))
        inflow = float(row.get("inflow", 0))
        outflow = float(row.get("outflow", 0))
        pressure = float(signal.get("confidence", 35)) * 0.18
        pulse = abs(_wave(epoch, case_index * 7 + index, 6))
        risk = round(_bounded(case["riskScore"] * 0.54 + anomaly * 0.86 + pressure + pulse, 8, 99), 1)
        amount = int(max(250000, (inflow + outflow + anomaly + 8 + pulse) * 92500))
        channel = channels[(case_index * 2 + index + int(epoch // 17)) % len(channels)]
        from_node = f"{case['id']}-applicant"
        to_node = f"{case['id']}-{_counterparty_slug(case, index)}"
        if index % 3 == 1:
            from_node, to_node = to_node, f"{case['id']}-branch"
        elif index % 3 == 2:
            to_node = f"{case['id']}-collateral"
        timestamp = (now - timedelta(minutes=(len(financial_rows) - index) * 7 + case_index * 3)).isoformat()
        reason = _risk_reason(case, signal, index)
        events.append(
            {
                "id": f"FLOW-{case['id']}-{row.get('month', index).upper()}-{int(epoch // 9) % 10000}",
                "caseId": case["id"],
                "timestamp": timestamp,
                "month": row.get("month", ""),
                "fromNode": from_node,
                "toNode": to_node,
                "fromEntity": _node_label(case, from_node),
                "toEntity": _node_label(case, to_node),
                "fromAccountType": account_types[(index + case_index) % len(account_types)],
                "toAccountType": account_types[(index + case_index + 2) % len(account_types)],
                "amountInr": amount,
                "channel": channel,
                "riskScore": risk,
                "riskReason": reason,
                "geo": {"lat": case["lat"], "lng": case["lng"], "label": case["location"]},
                "evidenceIds": [f"EV-{case['id']}-DOC", f"EV-{case['id']}-FIN-{row.get('month', index).upper()}"],
                "sourceIds": [signal.get("id", "SIG-DEMO")],
                "provenance": {
                    "mode": "demo-simulated",
                    "derivedFrom": ["data/dossiers.json", signal.get("provenance", {}).get("connectorId", "connector-pressure")],
                    "sourceUrl": signal.get("sourceUrl", "") or signal.get("provenance", {}).get("sourceUrl", ""),
                    "retrievedAt": signal.get("retrievedAt", now.isoformat()),
                },
            }
        )
    return events


def _flow_paths(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for event in events:
        grouped.setdefault((event["caseId"], event["fromNode"], event["toNode"]), []).append(event)
    paths = []
    for index, ((case_id, source, target), rows) in enumerate(grouped.items()):
        total = sum(row["amountInr"] for row in rows)
        risk = round(sum(row["riskScore"] for row in rows) / max(len(rows), 1), 1)
        paths.append(
            {
                "id": f"PATH-{case_id}-{index + 1}",
                "caseId": case_id,
                "source": source,
                "target": target,
                "label": f"{rows[0]['fromEntity']} to {rows[0]['toEntity']}",
                "totalAmountInr": total,
                "eventCount": len(rows),
                "riskScore": risk,
                "channelMix": sorted({row["channel"] for row in rows}),
                "eventIds": [row["id"] for row in rows],
                "evidenceIds": sorted({evidence_id for row in rows for evidence_id in row.get("evidenceIds", [])}),
            }
        )
    return sorted(paths, key=lambda item: item["riskScore"], reverse=True)


def _fund_flow_graph(cases: list[dict[str, Any]], events: list[dict[str, Any]], paths: list[dict[str, Any]], epoch: float) -> dict[str, Any]:
    nodes_by_id: dict[str, dict[str, Any]] = {}
    for case_index, case in enumerate(cases):
        base_angle = (math.pi * 2 * case_index) / max(len(cases), 1)
        base_x = math.cos(base_angle) * 18
        base_z = math.sin(base_angle) * 18
        case_nodes = [
            (f"{case['id']}-applicant", case["applicant"], "applicant", case["riskScore"], 0, 4, 0),
            (f"{case['id']}-branch", case["branch"], "branch", case["riskScore"] - 10, -7, 1, -5),
            (f"{case['id']}-collateral", case["location"], "collateral", case["riskScore"] - 5, 8, 2, 5),
        ]
        for node_id, label, node_type, risk, dx, dy, dz in case_nodes:
            nodes_by_id[node_id] = {
                "id": node_id,
                "caseId": case["id"],
                "label": label,
                "type": node_type,
                "risk": round(_bounded(risk, 0, 99), 1),
                "x": round(base_x + dx, 2),
                "y": round(dy + case["riskScore"] / 25, 2),
                "z": round(base_z + dz, 2),
            }
        for index in range(3):
            node_id = f"{case['id']}-{_counterparty_slug(case, index)}"
            nodes_by_id[node_id] = {
                "id": node_id,
                "caseId": case["id"],
                "label": _node_label(case, node_id),
                "type": "counterparty",
                "risk": round(_bounded(case["riskScore"] - 12 + index * 7 + abs(_wave(epoch, case_index + index, 4)), 0, 99), 1),
                "x": round(base_x + math.cos(index * 2.1) * 13, 2),
                "y": round(1.5 + index * 1.4, 2),
                "z": round(base_z + math.sin(index * 2.1) * 13, 2),
            }

    links = []
    for path in paths:
        links.append(
            {
                "id": path["id"],
                "caseId": path["caseId"],
                "source": path["source"],
                "target": path["target"],
                "risk": path["riskScore"],
                "amountInr": path["totalAmountInr"],
                "eventCount": path["eventCount"],
                "channels": path["channelMix"],
            }
        )
    particles = [
        {
            "id": f"P-{event['id']}",
            "eventId": event["id"],
            "caseId": event["caseId"],
            "source": event["fromNode"],
            "target": event["toNode"],
            "risk": event["riskScore"],
            "amountInr": event["amountInr"],
            "phase": round((index * 0.17 + epoch / 19) % 1, 3),
            "speed": round(_bounded(event["riskScore"] / 130, 0.18, 0.82), 3),
        }
        for index, event in enumerate(events)
    ]
    return {
        "mode": "demo-simulated",
        "layout": "deterministic-risk-orbit",
        "nodes": list(nodes_by_id.values()),
        "links": links,
        "particles": particles,
        "legend": [
            {"label": "blue", "meaning": "normal routed value"},
            {"label": "yellow", "meaning": "review threshold"},
            {"label": "red", "meaning": "critical anomaly path"},
        ],
    }


def _entity_graph_3d(cases: list[dict[str, Any]], active_case: dict[str, Any], signals: list[dict[str, Any]], epoch: float) -> dict[str, Any]:
    nodes = []
    links = []
    active_id = active_case["id"]
    nodes.append({"id": active_id, "label": active_id, "type": "case", "caseId": active_id, "risk": active_case["riskScore"], "x": 0, "y": 5, "z": 0})
    for index, case in enumerate(cases):
        angle = (math.pi * 2 * index) / max(len(cases), 1)
        case_node = f"case-{case['id']}"
        nodes.append(
            {
                "id": case_node,
                "label": case["applicant"],
                "type": "applicant",
                "caseId": case["id"],
                "risk": case["riskScore"],
                "x": round(math.cos(angle) * 17, 2),
                "y": round(1 + case["riskScore"] / 30, 2),
                "z": round(math.sin(angle) * 17, 2),
            }
        )
        links.append({"id": f"ENTITY-{active_id}-{case['id']}", "source": active_id, "target": case_node, "risk": case["riskScore"], "label": case["stage"]})
    for index, signal in enumerate(signals[:8]):
        angle = (math.pi * 2 * index) / max(min(len(signals), 8), 1) + 0.42
        node_id = f"source-{signal['id']}"
        risk = signal.get("confidence", 35)
        nodes.append(
            {
                "id": node_id,
                "label": signal.get("source", "source"),
                "type": signal.get("type", "OSINT").lower(),
                "caseId": active_id,
                "risk": risk,
                "x": round(math.cos(angle) * 24, 2),
                "y": round(4 + abs(_wave(epoch, index, 3)), 2),
                "z": round(math.sin(angle) * 24, 2),
                "sourceUrl": signal.get("sourceUrl", ""),
            }
        )
        links.append({"id": f"SOURCE-{signal['id']}", "source": node_id, "target": active_id, "risk": risk, "label": signal.get("provenance", {}).get("connectorStatus", "source")})
    return {"mode": "source-backed-demo", "nodes": nodes, "links": links, "focusCaseId": active_id}


def _canara_benchmark(active_case: dict[str, Any], signals: list[dict[str, Any]], connector_status: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    payload = read_json(BENCHMARK_PATH, {"researchBoundary": "", "systems": [], "controlTemplates": []})
    live_connectors = sum(1 for item in connector_status if item.get("status") == "live")
    systems = []
    for index, system in enumerate(payload.get("systems", [])):
        coverage = round(_bounded(58 + active_case["riskScore"] * 0.22 + live_connectors * 2 + index * 3, 40, 98), 1)
        systems.append({**system, "prototypeCoverage": coverage, "status": "mapped"})
    return {
        "researchBoundary": payload.get("researchBoundary", ""),
        "retrievedAt": now.isoformat(),
        "systems": systems,
        "sourceCount": len({item.get("sourceUrl", "") for item in systems if item.get("sourceUrl")}),
        "themeCoverage": [
            {"area": "Land records", "status": "covered", "evidence": active_case["anomalies"][0] if active_case.get("anomalies") else "Collateral evidence review"},
            {"area": "Legal documents", "status": "covered", "evidence": "Legal opinion, seal, signature, and due-diligence control checks"},
            {"area": "Financial statements", "status": "covered", "evidence": "Statement rhythm, GST/inflow comparison, and 3D fund-flow anomaly paths"},
            {"area": "Intelligent insights", "status": "covered", "evidence": "Local Qwen 3.5 4B briefs with citations and reviewer prompts"},
        ],
        "liveSourcePressure": round(sum(signal.get("confidence", 0) for signal in signals[:6]) / max(min(len(signals), 6), 1), 1) if signals else 0,
    }


def _control_checklist(
    active_case: dict[str, Any],
    signals: list[dict[str, Any]],
    graph_3d: dict[str, Any],
    benchmark: dict[str, Any],
    now: datetime,
) -> list[dict[str, Any]]:
    payload = read_json(BENCHMARK_PATH, {"controlTemplates": []})
    text = " ".join(active_case.get("anomalies", [])).lower()
    source_text = " ".join(f"{signal.get('type', '')} {signal.get('title', '')} {signal.get('summary', '')}" for signal in signals[:8]).lower()
    checklist = []
    for index, template in enumerate(payload.get("controlTemplates", [])):
        tokens = [part for part in str(template.get("sourcePattern", "")).split("|") if part]
        evidence_hits = sum(1 for token in tokens if token.lower() in text or token.lower() in source_text)
        score = round(_bounded(active_case["riskScore"] * 0.52 + evidence_hits * 13 + len(graph_3d.get("links", [])) * 0.18 + index * 2, 12, 99), 1)
        status = "critical" if score >= 76 else "review" if score >= 54 else "clear"
        checklist.append(
            {
                "id": template.get("id", f"control-{index}"),
                "label": template.get("label", "Control"),
                "themeArea": template.get("themeArea", "underwriting"),
                "reviewQuestion": template.get("reviewQuestion", ""),
                "score": score,
                "status": status,
                "evidenceIds": [f"EV-{active_case['id']}-DOC", f"FLOW-{active_case['id']}"],
                "sourceUrls": [system.get("sourceUrl", "") for system in benchmark.get("systems", [])[:2]],
                "updatedAt": now.isoformat(),
            }
        )
    return checklist


def _flow_summary(events: list[dict[str, Any]], case_id: str) -> dict[str, Any]:
    case_events = [event for event in events if event.get("caseId") == case_id] if case_id else events
    total = sum(event.get("amountInr", 0) for event in case_events)
    high = [event for event in case_events if event.get("riskScore", 0) >= 70]
    peak = max(case_events, key=lambda item: item.get("riskScore", 0), default={})
    return {
        "caseId": case_id,
        "eventCount": len(case_events),
        "totalAmountInr": total,
        "highRiskEvents": len(high),
        "peakRisk": peak.get("riskScore", 0),
        "peakEventId": peak.get("id", ""),
        "channels": sorted({event.get("channel", "") for event in case_events if event.get("channel")}),
    }


def _case_summaries(cases: list[dict[str, Any]], events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries = []
    for case in cases:
        summary = _flow_summary(events, case["id"])
        summaries.append({**summary, "applicant": case["applicant"], "riskScore": case["riskScore"], "status": case["status"]})
    return sorted(summaries, key=lambda item: item["peakRisk"], reverse=True)


def _source_factors(signals: list[dict[str, Any]], connector_status: list[dict[str, Any]]) -> list[dict[str, Any]]:
    factors = []
    for signal in signals[:8]:
        factors.append(
            {
                "id": signal.get("id", ""),
                "type": signal.get("type", "OSINT"),
                "source": signal.get("source", ""),
                "title": signal.get("title", ""),
                "confidence": signal.get("confidence", 0),
                "sourceUrl": signal.get("sourceUrl", ""),
                "status": signal.get("provenance", {}).get("connectorStatus", ""),
            }
        )
    if not factors:
        for connector in connector_status:
            factors.append({"id": connector.get("id", ""), "type": connector.get("type", ""), "source": connector.get("name", ""), "title": connector.get("detail", ""), "confidence": 32, "sourceUrl": connector.get("sourceUrl", ""), "status": connector.get("status", "")})
    return factors


def _risk_reason(case: dict[str, Any], signal: dict[str, Any], index: int) -> str:
    anomalies = case.get("anomalies", [])
    reason = anomalies[index % len(anomalies)] if anomalies else "Dossier-derived flow anomaly"
    if signal:
        return f"{reason}; connector pressure from {signal.get('source', 'public source')} at {signal.get('confidence', 0)} confidence"
    return reason


def _counterparty_slug(case: dict[str, Any], index: int) -> str:
    labels = ["supplier", "tax-ledger", "related-party"]
    return labels[index % len(labels)]


def _node_label(case: dict[str, Any], node_id: str) -> str:
    if node_id.endswith("-applicant"):
        return case["applicant"]
    if node_id.endswith("-branch"):
        return case["branch"]
    if node_id.endswith("-collateral"):
        return case["location"]
    if node_id.endswith("-supplier"):
        return f"{case['applicant'].split()[0]} Supplier Ledger"
    if node_id.endswith("-tax-ledger"):
        return "GST / statutory ledger"
    if node_id.endswith("-related-party"):
        return "Related-party counterparty"
    return node_id


def _wave(epoch: float, seed: int, amplitude: float) -> float:
    return math.sin(epoch / 8.5 + seed * 1.713) * amplitude + math.cos(epoch / 17 + seed * 0.7) * amplitude * 0.32


def _bounded(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))
