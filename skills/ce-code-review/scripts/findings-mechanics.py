#!/usr/bin/env python3
"""Apply deterministic validation, exact dedup, confidence gates, and numbering."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


SEVERITIES = ("P0", "P1", "P2", "P3")
CONFIDENCES = (0, 25, 50, 75, 100)
AUTOFIX_CLASSES = ("gated_auto", "manual", "advisory")
OWNERS = ("downstream-resolver", "human", "release")
REQUIRED_TOP = {
    "reviewer": str,
    "findings": list,
    "residual_risks": list,
    "testing_gaps": list,
}
REQUIRED_FINDING = {
    "title": str,
    "severity": str,
    "file": str,
    "line": (int, str),
    "confidence": int,
    "autofix_class": str,
    "owner": str,
    "requires_verification": bool,
    "pre_existing": bool,
}


def valid_return(value: Any) -> bool:
    return isinstance(value, dict) and all(
        isinstance(value.get(key), expected) for key, expected in REQUIRED_TOP.items()
    )


def nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def valid_finding(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if not all(isinstance(value.get(key), expected) for key, expected in REQUIRED_FINDING.items()):
        return False
    if type(value["confidence"]) is not int:
        return False
    if "first_evidence" in value and not nonempty_string(value["first_evidence"]):
        return False
    line = value["line"]
    line_valid = (type(line) is int and line > 0) or (
        isinstance(line, str) and bool(line.strip())
    )
    return (
        value["severity"] in SEVERITIES
        and value["confidence"] in CONFIDENCES
        and value["autofix_class"] in AUTOFIX_CLASSES
        and value["owner"] in OWNERS
        and line_valid
    )


def fingerprint(finding: dict[str, Any]) -> tuple[str, str, str]:
    return (
        finding["file"].strip().lower(),
        str(finding["line"]).strip(),
        " ".join(finding["title"].lower().split()),
    )


HOST_FAMILY = "host"
HOST_ENTRY = {"family": HOST_FAMILY, "external": False, "independence_verified": False}


class FinishInputError(Exception):
    pass


def peer_artifact_paths(finish_input: Path) -> list[Path]:
    # Only the dispatch context writes finish-input.json, so a reviewer is
    # external only when an entry here names its artifact (KTD6).
    try:
        data = json.loads(finish_input.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise FinishInputError(f"unreadable finish input: {error}") from error
    if not isinstance(data, dict):
        raise FinishInputError("finish input is not an object")
    entries: list[Any] = []
    if isinstance(data.get("peers"), list):
        entries.extend(data["peers"])
    if isinstance(data.get("peer"), dict):
        entries.append(data["peer"])
    paths: list[Path] = []
    for entry in entries:
        artifact = entry.get("artifact") if isinstance(entry, dict) else None
        if not nonempty_string(artifact):
            continue
        path = Path(artifact)
        if not path.is_absolute():
            path = finish_input.parent / path
        if path not in paths:
            paths.append(path)
    return paths


def load_peer_artifacts(finish_input: Path) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for path in peer_artifact_paths(finish_input):
        try:
            artifact = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise FinishInputError(f"listed peer artifact is unreadable: {path}: {error}") from error
        if not valid_return(artifact):
            raise FinishInputError(f"listed peer artifact is not a reviewer return: {path}")
        if any(existing["reviewer"] == artifact["reviewer"] for existing in artifacts):
            continue
        artifacts.append(artifact)
    return artifacts


def peer_family_entry(artifact: dict[str, Any]) -> dict[str, Any]:
    family = artifact.get("serving_family")
    return {
        "family": family if nonempty_string(family) else "unknown",
        "external": True,
        "independence_verified": artifact.get("independence_verified") is True,
    }


def family_entry(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("external") is not True:
        return dict(HOST_ENTRY)
    family = value.get("family")
    return {
        "family": family if nonempty_string(family) and family != HOST_FAMILY else "unknown",
        "external": True,
        "independence_verified": value.get("independence_verified") is True,
    }


def counts_as_independent(entry: dict[str, Any]) -> bool:
    return not entry["external"] or entry["independence_verified"]


def corroborated(independent: set[str], families: dict[str, dict[str, Any]]) -> bool:
    # In-process reviewers are one family, and external reviewers of one family
    # are one reading; only a verified external family plus the host family is
    # cross-family agreement (R11).
    entries = [families.get(name, HOST_ENTRY) for name in independent]
    has_host = any(not entry["external"] for entry in entries)
    has_verified_external = any(
        entry["external"] and entry["independence_verified"] for entry in entries
    )
    return has_host and has_verified_external


def promote(confidence: int) -> int:
    return {50: 75, 75: 100, 100: 100}.get(confidence, confidence)


GroupItem = tuple[dict[str, Any], str, tuple[str, ...], dict[str, dict[str, Any]]]


def merge_group(group: list[GroupItem]) -> dict[str, Any]:
    # Start with the most urgent/high-confidence representation, then merge conservatively.
    group.sort(key=lambda item: (SEVERITIES.index(item[0]["severity"]), -item[0]["confidence"]))
    merged = dict(group[0][0])
    # A current-diff classification wins a disagreement so an exact duplicate
    # cannot disappear merely because the pre-existing reviewer arrived first.
    merged["pre_existing"] = all(item[0]["pre_existing"] for item in group)
    reviewer_names: list[str] = []
    independent: set[str] = set()
    families: dict[str, dict[str, Any]] = {}
    for finding, reviewer, independent_names, finding_families in group:
        supplied = finding.get("reviewers")
        names = supplied if isinstance(supplied, list) else [reviewer]
        for name in names:
            if isinstance(name, str) and name not in reviewer_names:
                reviewer_names.append(name)
        independent.update(independent_names)
        for name, entry in finding_families.items():
            if name not in families or entry["external"]:
                families[name] = entry

        if AUTOFIX_CLASSES.index(finding["autofix_class"]) > AUTOFIX_CLASSES.index(merged["autofix_class"]):
            merged["autofix_class"] = finding["autofix_class"]
        if OWNERS.index(finding["owner"]) > OWNERS.index(merged["owner"]):
            merged["owner"] = finding["owner"]
        merged["requires_verification"] = (
            merged["requires_verification"] or finding["requires_verification"]
        )
        if not nonempty_string(merged.get("first_evidence")) and nonempty_string(
            finding.get("first_evidence")
        ):
            merged["first_evidence"] = finding["first_evidence"]
        if not merged.get("suggested_fix") and finding.get("suggested_fix"):
            merged["suggested_fix"] = finding["suggested_fix"]
        if not merged.get("settled_conflict") and finding.get("settled_conflict"):
            merged["settled_conflict"] = finding["settled_conflict"]

    confidence = max(item[0]["confidence"] for item in group)
    has_first_evidence = nonempty_string(merged.get("first_evidence"))
    if confidence >= 75 and not has_first_evidence:
        confidence = 50
    if has_first_evidence and corroborated(independent, families):
        confidence = promote(confidence)
    merged["confidence"] = confidence
    merged["reviewers"] = reviewer_names
    merged["independent_reviewers"] = [
        reviewer for reviewer in reviewer_names if reviewer in independent
    ]
    merged["reviewer_families"] = {
        name: families.get(name, dict(HOST_ENTRY)) for name in reviewer_names
    }
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--finish-input", help="finish-input.json naming the external peer artifacts to fold")
    args = parser.parse_args()
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError) as error:
        print(json.dumps({"status": "failed", "reason": str(error)}))
        return 2

    if not isinstance(payload, list):
        print(json.dumps({"status": "failed", "reason": "expected an array of reviewer returns"}))
        return 2

    peer_families: dict[str, dict[str, Any]] = {}
    if args.finish_input:
        try:
            artifacts = load_peer_artifacts(Path(args.finish_input))
        except FinishInputError as error:
            print(json.dumps({"status": "failed", "reason": str(error)}))
            return 2
        peer_families = {artifact["reviewer"]: peer_family_entry(artifact) for artifact in artifacts}
        # A return that reuses a peer's name is not the peer; the artifact is.
        payload = [
            source
            for source in payload
            if not (isinstance(source, dict) and source.get("reviewer") in peer_families)
        ] + artifacts

    malformed_returns = 0
    malformed_findings = 0
    first_evidence_backfilled = 0
    grouped: dict[tuple[str, str, str], list[GroupItem]] = {}
    residual_risks: list[Any] = []
    testing_gaps: list[Any] = []

    for source in payload:
        if not valid_return(source):
            malformed_returns += 1
            continue
        reviewer = source["reviewer"]
        residual_risks.extend(source["residual_risks"])
        testing_gaps.extend(source["testing_gaps"])
        for finding in source["findings"]:
            backfilled = False
            if isinstance(finding, dict):
                finding = dict(finding)
                evidence = finding.get("evidence")
                if (
                    finding.get("confidence") in (75, 100)
                    and ("first_evidence" not in finding or isinstance(finding["first_evidence"], str))
                    and not nonempty_string(finding.get("first_evidence"))
                    and isinstance(evidence, list)
                    and evidence
                    and nonempty_string(evidence[0])
                ):
                    finding["first_evidence"] = evidence[0]
                    backfilled = True
            if not valid_finding(finding):
                malformed_findings += 1
                continue
            first_evidence_backfilled += int(backfilled)
            if reviewer == "fast-pass":
                finding["confidence"] = min(finding["confidence"], 50)
            independent_names: tuple[str, ...]
            finding_families: dict[str, dict[str, Any]]
            if reviewer == "synthesis":
                supplied_reviewers = finding.get("reviewers")
                supplied_independent = finding.get("independent_reviewers")
                reviewer_set = (
                    {name for name in supplied_reviewers if isinstance(name, str)}
                    if isinstance(supplied_reviewers, list)
                    else set()
                )
                independent_list = (
                    supplied_independent if isinstance(supplied_independent, list) else []
                )
                supplied_families = finding.pop("reviewer_families", None)
                if not isinstance(supplied_families, dict):
                    supplied_families = {}
                finding_families = {
                    name: family_entry(supplied_families.get(name)) for name in reviewer_set
                }
                independent_names = tuple(
                    name
                    for name in independent_list
                    if isinstance(name, str)
                    and name in reviewer_set
                    and name != "fast-pass"
                    and counts_as_independent(finding_families[name])
                )
            else:
                entry = peer_families.get(reviewer, dict(HOST_ENTRY))
                finding_families = {reviewer: entry}
                independent_names = (
                    (reviewer,)
                    if reviewer != "fast-pass" and counts_as_independent(entry)
                    else ()
                )
            grouped.setdefault(fingerprint(finding), []).append(
                (finding, reviewer, independent_names, finding_families)
            )

    merged = [merge_group(group) for group in grouped.values()]
    suppressed: Counter[str] = Counter()
    suppressed_findings: list[dict[str, Any]] = []
    survivors: list[dict[str, Any]] = []
    pre_existing: list[dict[str, Any]] = []
    for finding in merged:
        if finding["pre_existing"]:
            pre_existing.append(finding)
            continue
        if (
            finding["confidence"] < 75
            and finding["severity"] != "P0"
            and not finding.get("settled_conflict")
        ):
            suppressed[str(finding["confidence"])] += 1
            suppressed_findings.append(finding)
            continue
        survivors.append(finding)

    suppressed_findings.sort(
        key=lambda item: (
            SEVERITIES.index(item["severity"]),
            -item["confidence"],
            item["file"].lower(),
            str(item["line"]),
            item["title"].lower(),
        )
    )
    survivors.sort(
        key=lambda item: (
            SEVERITIES.index(item["severity"]),
            -item["confidence"],
            item["file"].lower(),
            str(item["line"]),
            item["title"].lower(),
        )
    )
    for number, finding in enumerate(survivors, 1):
        finding["#"] = number

    print(
        json.dumps(
            {
                "status": "complete",
                "findings": survivors,
                "suppressed_findings": suppressed_findings,
                "pre_existing_findings": pre_existing,
                "residual_risks": residual_risks,
                "testing_gaps": testing_gaps,
                "suppressed_by_confidence": dict(sorted(suppressed.items())),
                "malformed_returns": malformed_returns,
                "malformed_findings": malformed_findings,
                "first_evidence_backfilled": first_evidence_backfilled,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
