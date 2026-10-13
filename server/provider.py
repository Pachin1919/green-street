"""Request-scoped, immutable snapshots. Bundle import never changes builtin files.

API and SQL sources can export the documented JSON contract; no credentials, remote
fetches, arbitrary paths, or SQL are accepted by this read-only provider.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import tempfile
import threading
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from esgx.api.store import DataStore
from esgx.measures.greenwash import TALK_CUT, WALK_CUT
from server.dataset import load_market

MAX_BYTES = 32 * 1024 * 1024
MAX_ROWS = 500_000
MAX_SNAPSHOTS = 16
UNITS = {"returns": "decimal", "market_cap": "listing currency", "revenue": "USD million",
         "emissions": "tCO2e", "scores": "0-10", "materiality": "percent",
         "fx": "second currency per unit of first currency"}
FACTOR_COLUMNS = ["month", "mkt_rf", "smb", "hml", "rmw", "cma", "mom", "rf"]
# key: (location, filename, required columns, unique key)
SPECS = {
    "greenness": ("outputs", "det_greenness_hk.csv", ["firm_id", "year", "e_score", "e_weight", "g"], ["firm_id", "year"]),
    "greenness_tw": ("outputs", "det_greenness_tw.csv", ["firm_id", "year", "e_score", "e_weight", "g"], ["firm_id", "year"]),
    "dictionary_hk": ("outputs", "det_greenwashing_hk.csv", ["firm_id", "year", "talk", "walk", "greenwasher", "greenhusher"], ["firm_id", "year"]),
    "dictionary_tw": ("outputs", "det_greenwashing_tw.csv", ["firm_id", "year", "talk", "walk", "greenwasher", "greenhusher"], ["firm_id", "year"]),
    "walk_hk": ("outputs", "det_walk_hk.csv", ["firm_id", "year", "walk"], ["firm_id", "year"]),
    "walk_tw": ("outputs", "det_walk_tw.csv", ["firm_id", "year", "walk"], ["firm_id", "year"]),
    "talkwalk_firm_year": ("outputs", "talkwalk_firm_year_hk.csv", ["firm_id", "year", "talk", "walk"], ["firm_id", "year"]),
    "talkwalk_firm_year_tw": ("outputs", "talkwalk_firm_year_tw.csv", ["firm_id", "year", "talk", "walk"], ["firm_id", "year"]),
    "talkwalk_documents": ("outputs", "talkwalk_documents_hk.csv", ["firm_id", "period", "filing_date", "summary", "evidence_talk", "evidence_walk", "usage_model"], ["firm_id", "period", "filing_date", "accession"]),
    "talkwalk_documents_tw": ("outputs", "talkwalk_documents_tw.csv", ["firm_id", "period", "filing_date", "summary", "evidence_talk", "evidence_walk", "usage_model"], ["firm_id", "period", "filing_date", "accession"]),
    "universe_hsi": ("raw", "universe_hsi.parquet", ["firm_id", "name", "sector", "industry", "country"], ["firm_id"]),
    "universe_hsci": ("raw", "universe_hsci.parquet", ["firm_id", "name", "sector", "industry", "country"], ["firm_id"]),
    "universe_twse": ("raw", "universe_twse.parquet", ["firm_id", "name", "sector", "industry", "country"], ["firm_id"]),
    "prices_hk": ("raw", "prices_monthly_hk.parquet", ["firm_id", "month", "ret", "mktcap"], ["firm_id", "month"]),
    "prices_tw": ("raw", "prices_monthly_tw.parquet", ["firm_id", "month", "ret", "mktcap"], ["firm_id", "month"]),
    "last_close_hk": ("raw", "last_close_hk.parquet", ["firm_id", "date", "close"], ["firm_id"]),
    "last_close_tw": ("raw", "last_close_tw.parquet", ["firm_id", "date", "close"], ["firm_id"]),
    "factors_asia_pacific_ex_japan": ("raw", "factors_monthly_asia_pacific_ex_japan.parquet", FACTOR_COLUMNS, ["month"]),
    "factors_emerging": ("raw", "factors_monthly_emerging.parquet", FACTOR_COLUMNS, ["month"]),
    "fx_monthly": ("raw", "fx_monthly.parquet", ["month", "pair", "rate"], ["month", "pair"]),
    "fundamentals_hk": ("raw", "fundamentals_yf_hk.parquet", ["firm_id", "year", "revenue", "book_equity"], ["firm_id", "year"]),
    "fundamentals_tw": ("raw", "fundamentals_twse.parquet", ["firm_id", "year", "revenue", "book_equity"], ["firm_id", "year"]),
    "emissions_hk": ("outputs", "emissions_hk.csv", ["firm_id", "year", "scope1", "scope2", "source"], []),
    "emissions_tw": ("processed", "emissions_tw.parquet", ["firm_id", "year", "scope1", "scope2", "source"], []),
    "gmb_monthly": ("outputs", "gmb_monthly_hk.csv", ["month", "gmb"], ["month"]),
    "gmb_monthly_tw": ("outputs", "gmb_monthly_tw.csv", ["month", "gmb"], ["month"]),
}
REQUIRED = {
    "hk": ["greenness", "universe_hsi", "prices_hk", "factors_asia_pacific_ex_japan", "fx_monthly"],
    "tw": ["greenness_tw", "universe_twse", "prices_tw", "factors_emerging", "fx_monthly"],
}
CURRENCIES = {"prices_hk": "HKD", "prices_tw": "TWD", "last_close_hk": "HKD", "last_close_tw": "TWD",
              "factors_asia_pacific_ex_japan": "USD", "factors_emerging": "USD",
              "fundamentals_hk": "USD", "fundamentals_tw": "USD"}


class SnapshotStore(DataStore):
    dataset_id = "builtin"
    source = "Local pipeline snapshot (no live connector)"
    metadata: dict[str, Any] = {}

    def _paths(self):
        return {key: getattr(self, area) / name for key, (area, name, _, _) in SPECS.items()}


_builtin = SnapshotStore()
_snapshots: dict[str, tuple[SnapshotStore, tempfile.TemporaryDirectory]] = {}
_lock = threading.Lock()


def get_store(x_dataset_id: Annotated[str | None, Header()] = None) -> DataStore:
    if not x_dataset_id or x_dataset_id == "builtin":
        return _builtin
    if x_dataset_id not in _snapshots:
        raise HTTPException(404, "Dataset ID is unknown or expired after server restart; select builtin or reimport the bundle.")
    return _snapshots[x_dataset_id][0]


Store = Annotated[DataStore, Depends(get_store)]
router = APIRouter(prefix="/api")


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (pd.Timestamp, pd.Period)):
        return str(value)
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def dates(frame):
    """Dates come from observation columns, never filesystem timestamps."""
    ranges = {}
    for col in ("observation_date", "date", "month", "year", "period", "filing_date", "available_date"):
        if col not in frame:
            continue
        values = frame[col].dropna()
        if values.empty:
            continue
        if col == "year":
            values = pd.to_numeric(values, errors="coerce").dropna().astype(int).astype(str)
        else:
            values = values.astype(str).str.slice(0, 7 if col == "month" else 10)
            values = values[pd.to_datetime(values, errors="coerce").notna()]
        if not values.empty:
            ranges[col] = {"start": min(values), "end": max(values)}
    primary = next((ranges[c] for c in ("observation_date", "date", "month", "year", "period", "filing_date") if c in ranges), {"start": None, "end": None})
    return {**primary, "columns": ranges}


def market_for(key):
    if key.endswith("_tw") or key in ("universe_twse", "factors_emerging", "talkwalk_firm_year_tw", "talkwalk_documents_tw"):
        return "tw"
    return "all" if key == "fx_monthly" else "hk"


def sources(store):
    rows = []
    for key, path in store._paths().items():
        frame = store.table(path)
        kind = "semantic_llm" if key.startswith("talkwalk_") else "dictionary" if key.startswith("dictionary_") else "quantitative"
        row_sources = frame["source"].dropna().astype(str).unique().tolist()[:20] if "source" in frame else []
        rows.append({"key": key, "kind": kind, "market": market_for(key), "available": not frame.empty,
                     "rows": len(frame), "data_dates": dates(frame), "source": getattr(store, "source", "Local pipeline snapshot"),
                     "source_details": row_sources, "is_latest": False})
    return rows


def data_status(store, market="all"):
    if market not in ("hk", "tw", "all"):
        raise HTTPException(400, "market must be hk, tw, or all")
    available = sources(store)
    markets = {}
    for m in (("hk", "tw") if market == "all" else (market,)):
        frame = load_market(m, store.outputs, store.raw)
        own = [s for s in available if s["market"] in (m, "all") and s["available"]]
        ranges = [s["data_dates"] for s in own if s["data_dates"]["end"]]
        markets[m] = {"status": "snapshot" if frame is not None and not frame.empty else "missing",
                      "company_count": len(frame) if frame is not None else 0,
                      "data_dates": {"start": min((r["start"] for r in ranges), default=None),
                                     "end": max((r["end"] for r in ranges), default=None)},
                      "sources": [s["key"] for s in own]}
    has_snapshot = any(m["status"] == "snapshot" for m in markets.values())
    # Demo is only available for builtin when ALL requested markets are missing.
    any_market_snapshot = has_snapshot or any(load_market(m, store.outputs, store.raw) is not None for m in ("hk", "tw") if m not in markets)
    demo = not any_market_snapshot and not any(path.exists() for path in store._paths().values()) and getattr(store, "dataset_id", "builtin") == "builtin"
    if demo:
        for m in markets.values():
            m["status"] = "demo"
    return {"dataset_id": getattr(store, "dataset_id", "builtin"), "mode": "snapshot" if has_snapshot else "demo" if demo else "missing",
            "label": "Snapshot" if has_snapshot else "Demo" if demo else "Missing", "is_latest": False,
            "snapshot_date": max((s["data_dates"]["end"] for s in available if s["market"] in (*markets, "all") and s["data_dates"]["end"]), default=None) if has_snapshot else None,
            "markets": markets, "missing_markets": [m for m, data in markets.items() if data["status"] == "missing"],
            "source": getattr(store, "source", "Local snapshot"),
            "limitations": ["Frozen observations; freshness has not been independently verified. Dates describe source observations, not ingestion time.",
                            "Semantic LLM rubric scores and dictionary percentile scores are separate measures."]}


@router.get("/data/status")
def status_endpoint(store: Store, market: str = "all"):
    return data_status(store, market)


@router.get("/data/sources")
def sources_endpoint(store: Store):
    return {"dataset_id": getattr(store, "dataset_id", "builtin"), "sources": sources(store),
            "capabilities": {"bundle_import": True, "native_api_connector": False, "native_sql_connector": False}}


@router.get("/data/schema")
def schema_endpoint():
    return {"version": 1, "format": "esgx-snapshot-bundle", "max_bytes": MAX_BYTES, "max_rows": MAX_ROWS,
            "required_by_market": REQUIRED, "units": UNITS, "currencies": CURRENCIES,
            "supported_tables": {k: {"required_columns": cols, "unique_key": keys, "market": market_for(k)} for k, (_, _, cols, keys) in SPECS.items()},
            "metadata": {"required": ["source", "markets", "units", "currencies"], "latest": "Ignored: uploaded freshness claims are never trusted",
                         "talk_walk_methodology": {"optional": True, "rule": "high_talk_low_walk", "talk_min": "finite number in [0,10]", "walk_max": "finite number in [0,10]", "source": "nonempty source description; dataset-supplied declaration, not independently verified"}},
            "example": {"metadata": {"source": "Your source/export description", "markets": ["hk"], "units": UNITS, "currencies": {k: v for k, v in CURRENCIES.items() if k in REQUIRED["hk"]}}, "tables": {k: [] for k in REQUIRED["hk"]}},
            "limitations": ["Complete hk or tw market bundle required; empty required tables are rejected. At least 24 price/factor/FX months must overlap.", "API/SQL systems must export this contract; native connectors are not implemented.", "Immutable in-memory selection survives only until server restart; default builtin data is unchanged."]}


def fail(message):
    raise HTTPException(422, message)


def validate_bundle(bundle):
    if not isinstance(bundle, dict) or set(bundle) != {"metadata", "tables"}:
        fail("Bundle must contain exactly metadata and tables.")
    meta, tables = bundle["metadata"], bundle["tables"]
    if not isinstance(meta, dict) or not isinstance(tables, dict):
        fail("metadata and tables must be objects.")
    if set(meta) - {"source", "markets", "units", "currencies", "snapshot_date", "is_latest", "latest", "talk_walk_methodology"}:
        fail("Unsupported metadata fields; credentials, connector URLs, SQL and filesystem paths are not accepted.")
    if "talk_walk_methodology" in meta:
        rule = meta["talk_walk_methodology"]
        if (not isinstance(rule, dict) or set(rule) != {"rule", "talk_min", "walk_max", "source"}
                or rule.get("rule") != "high_talk_low_walk"
                or not isinstance(rule.get("source"), str) or not 1 <= len(rule["source"].strip()) <= 2000
                or any(isinstance(rule.get(k), bool) or not isinstance(rule.get(k), (int, float))
                       or not math.isfinite(rule[k]) or not 0 <= rule[k] <= 10 for k in ("talk_min", "walk_max"))):
            fail("metadata.talk_walk_methodology requires rule=high_talk_low_walk, finite talk_min/walk_max in [0,10], and source.")
    if not isinstance(meta.get("source"), str) or not 1 <= len(meta["source"].strip()) <= 2000:
        fail("metadata.source must identify the source (1-2000 characters).")
    markets = meta.get("markets")
    if not isinstance(markets, list) or not markets or any(not isinstance(m, str) or m not in REQUIRED for m in markets) or len(set(markets)) != len(markets):
        fail("metadata.markets must list hk and/or tw exactly once.")
    if meta.get("units") != UNITS:
        fail("metadata.units must exactly match the downloadable schema; unit conversions must be performed before import.")
    if not isinstance(meta.get("currencies"), dict):
        fail("metadata.currencies must explicitly specify each currency-bearing table.")
    if set(meta["currencies"]) - set(CURRENCIES):
        fail("Unsupported currency table keys.")
    if unknown := set(tables) - set(SPECS):
        fail(f"Unsupported table keys: {sorted(unknown)}")
    required = set().union(*(set(REQUIRED[m]) for m in markets))
    if missing := required - set(tables):
        fail(f"Missing required tables: {sorted(missing)}")
    frames, row_count = {}, 0
    for key, rows in tables.items():
        if market_for(key) not in (*markets, "all"):
            fail(f"{key} belongs to a market not declared in metadata.markets.")
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            fail(f"{key} must be an array of row objects.")
        if not rows:
            fail(f"{key} must not be empty; omit optional empty tables.")
        row_count += len(rows)
        if row_count > MAX_ROWS:
            fail(f"Bundle exceeds {MAX_ROWS} rows.")
        if key in CURRENCIES and meta["currencies"].get(key) != CURRENCIES[key]:
            fail(f"{key} currency must be {CURRENCIES[key]}.")
        _, _, cols, unique = SPECS[key]
        if any(not set(cols).issubset(r) for r in rows):
            fail(f"{key} every row requires columns {cols}.")
        frame = pd.DataFrame(rows)
        if len(frame.columns) > 100 or any(not isinstance(c, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", c) for c in frame.columns):
            fail(f"{key} has invalid or excessive columns.")
        for row in rows:
            for value in row.values():
                if isinstance(value, (dict, list)):
                    fail(f"{key} values must be scalar; evidence arrays must be JSON-encoded strings.")
                if isinstance(value, float) and not math.isfinite(value):
                    fail(f"{key} contains a non-finite number.")
                if isinstance(value, str) and len(value) > 100_000:
                    fail(f"{key} contains an oversized string.")
        if "firm_id" in frame:
            suffix = ".TW" if market_for(key) == "tw" else ".HK"
            if any(not isinstance(v, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,20}\.(HK|TW|TWO)", v) or (not v.endswith((".TW", ".TWO")) if suffix == ".TW" else not v.endswith(suffix)) for v in frame["firm_id"]):
                fail(f"{key}.firm_id must use the declared market ticker suffix.")
        for col in ("name", "sector", "industry", "country", "summary", "usage_model", "source"):
            if col in cols and any(not isinstance(v, str) for v in frame[col]):
                fail(f"{key}.{col} requires strings.")
        for col in ("evidence_talk", "evidence_walk"):
            if col in frame:
                for value in frame[col]:
                    try:
                        parsed = json.loads(value)
                    except (ValueError, TypeError):
                        fail(f"{key}.{col} must be a JSON-encoded array of strings.")
                    if not isinstance(parsed, list) or any(not isinstance(v, str) for v in parsed):
                        fail(f"{key}.{col} must be a JSON-encoded array of strings.")
        for col in ("month", "observation_date", "date", "period", "filing_date", "available_date"):
            if col in frame:
                pattern = r"\d{4}-\d{2}" if col == "month" else r"\d{4}-\d{2}-\d{2}"
                date_format = "%Y-%m" if col == "month" else "%Y-%m-%d"
                if any(not isinstance(v, str) or re.fullmatch(pattern, v) is None for v in frame[col]) or pd.to_datetime(frame[col], format=date_format, errors="coerce").isna().any():
                    fail(f"{key}.{col} must contain valid ISO {'YYYY-MM' if col == 'month' else 'YYYY-MM-DD'} dates.")
                if (pd.to_datetime(frame[col], format=date_format) > pd.Timestamp.now(tz="UTC").tz_localize(None) + pd.Timedelta(days=1)).any():
                    fail(f"{key}.{col} contains a future observation date.")
        numeric = {"year", "e_score", "e_weight", "g", "talk", "walk", "gap", "greenwasher", "greenhusher", "ret", "mktcap", "close", "rate", "revenue", "book_equity", "scope1", "scope2", "scope3", "gmb", *FACTOR_COLUMNS[1:]}
        numeric.update(c for c in frame if c.startswith(("talk_", "walk_")))
        for col in numeric.intersection(frame.columns):
            present = frame[col].dropna()
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in present):
                fail(f"{key}.{col} requires finite JSON numbers, not strings/booleans.")
            if col in ("year", "mktcap", "rate", "close", "ret", *FACTOR_COLUMNS[1:]) and frame[col].isna().any():
                fail(f"{key}.{col} cannot be null.")
            if col == "year" and any(v != int(v) or not 1900 <= v <= pd.Timestamp.now().year for v in present):
                fail(f"{key}.year must be a plausible integer observation year.")
            if col in ("e_score", "talk", "walk") or col.startswith(("talk_", "walk_")) and col not in ("walk_intensity_trend", "walk_emission_trend", "walk_composite"):
                if ((present < 0) | (present > 10)).any():
                    fail(f"{key}.{col} must be on the documented 0-10 scale.")
            if col == "e_weight" and ((present < 0) | (present > 100)).any():
                fail(f"{key}.e_weight must be between 0 and 100 percent.")
            if col in ("greenwasher", "greenhusher") and not present.isin([0, 1]).all():
                fail(f"{key}.{col} must be 0, 1 or null.")
            if col in ("rate", "close", "mktcap") and (present <= 0).any():
                fail(f"{key}.{col} must be positive.")
            if col == "ret" and (present < -1).any():
                fail(f"{key}.ret must be a decimal simple return >= -1.")
            if col.startswith("scope") and (present < 0).any():
                fail(f"{key}.{col} cannot be negative.")
        unique = [c for c in unique if c in frame]
        if unique and frame.duplicated(unique).any():
            fail(f"{key} has duplicate keys {unique}.")
        if key == "fx_monthly":
            if not frame["pair"].isin(["TWDHKD", "USDHKD"]).all():
                fail("fx_monthly supports TWDHKD and USDHKD only.")
            if "observation_date" in frame and not (frame.observation_date.str[:7] == frame.month).all():
                fail("FX observation_date must belong to its month.")
        frames[key] = frame
    for m in markets:
        universe = frames["universe_hsi" if m == "hk" else "universe_twse"]
        ids = set(universe.firm_id)
        if m == "hk" and "universe_hsci" in frames:
            ids |= set(frames["universe_hsci"].firm_id)
        for key in ("greenness" if m == "hk" else "greenness_tw", f"prices_{m}"):
            if not set(frames[key].firm_id).issubset(ids):
                fail(f"{key} contains firms absent from the supplied universe.")
        green = frames["greenness" if m == "hk" else "greenness_tw"]
        complete = green.dropna(subset=["e_score", "e_weight", "g"])
        if complete.empty:
            fail(f"{m} greenness requires at least one complete score.")
        expected_g = -(10 - complete.e_score) * complete.e_weight / 100
        if ((complete.g - expected_g).abs() > 0.00001).any():
            fail(f"{m} g must match -(10-e_score)*e_weight/100.")
        needed_pairs = ["USDHKD"] + (["TWDHKD"] if m == "tw" else [])
        if not set(needed_pairs).issubset(set(frames["fx_monthly"].pair)):
            fail(f"{m} requires dated FX pairs {needed_pairs} for USD factor modeling.")
        factor_key = "factors_asia_pacific_ex_japan" if m == "hk" else "factors_emerging"
        months = set(frames[f"prices_{m}"].month) & set(frames[factor_key].month)
        for pair in needed_pairs:
            months &= set(frames["fx_monthly"].loc[frames["fx_monthly"].pair == pair, "month"])
        if len(months) < 24:
            fail(f"{m} requires at least 24 overlapping price/factor/FX months.")
    return frames


@router.post("/data/mount")
async def mount_endpoint(request: Request):
    # Bound the body while reading, before JSON parsing/DataFrame allocation.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BYTES:
            raise HTTPException(413, f"Bundle exceeds {MAX_BYTES} bytes.")
    try:
        bundle = json.loads(body, parse_constant=lambda value: fail(f"Non-finite JSON constant {value} is prohibited."))
    except (json.JSONDecodeError, UnicodeDecodeError):
        fail("Invalid JSON bundle.")
    frames = validate_bundle(bundle)
    canonical = json.dumps(bundle, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    dataset_id = "snapshot-" + hashlib.sha256(canonical).hexdigest()[:24]
    with _lock:
        if dataset_id not in _snapshots:
            if len(_snapshots) >= MAX_SNAPSHOTS:
                raise HTTPException(429, "Snapshot limit reached for this server session.")
            directory = tempfile.TemporaryDirectory(prefix="esgx-snapshot-")
            root = Path(directory.name)
            for area in ("raw", "outputs", "processed"):
                (root / area).mkdir()
            try:
                for key, frame in frames.items():
                    area, name, _, _ = SPECS[key]
                    path = root / area / name
                    if path.suffix == ".csv":
                        frame.to_csv(path, index=False)
                    else:
                        frame.to_parquet(path, index=False)
            except Exception:
                directory.cleanup()
                raise
            store = SnapshotStore(outputs=root / "outputs", raw=root / "raw", processed=root / "processed")
            store.dataset_id = dataset_id
            store.source = bundle["metadata"]["source"]
            store.metadata = bundle["metadata"]
            _snapshots[dataset_id] = store, directory
    return {"dataset_id": dataset_id, "status": data_status(_snapshots[dataset_id][0]), "selection_header": {"X-Dataset-Id": dataset_id}}


def evidence(value):
    if not isinstance(value, str):
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


def dimensions(row):
    return {k: clean(v) for k, v in row.items() if k.startswith(("talk_", "walk_")) and k not in ("talk_unfiltered", "walk_composite", "walk_intensity_trend", "walk_emission_trend")}


def raw_table(store, path):
    """Preserve stored CSV float precision for teaching and threshold comparisons."""
    return pd.read_csv(path, float_precision="round_trip") if path.exists() and path.suffix == ".csv" else store.table(path)


def raw_number(value):
    value = clean(value)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def raw_text(value):
    value = clean(value)
    return value if isinstance(value, str) and value.strip() else None


def raw_flag(value):
    value = clean(value)
    if isinstance(value, bool):
        return value
    return bool(value) if raw_number(value) in (0, 1) else None


def exact_rows(frame):
    """Duplicate firm-year records are ambiguous, including identical duplicates."""
    rows = {}
    if not {"firm_id", "year"}.issubset(frame.columns):
        return rows
    for row in frame.to_dict("records"):
        key = (raw_text(row.get("firm_id")), raw_number(row.get("year")))
        if None not in key:
            rows[key] = None if key in rows else row
    return rows


def dictionary_methodology(store):
    supplied = getattr(store, "metadata", {}).get("talk_walk_methodology")
    if supplied:
        return {**supplied, "provenance": "dataset_supplied", "rule_applies": True,
                "gap_is_classifier": False, "independently_verified": False}
    builtin = getattr(store, "dataset_id", "builtin") == "builtin"
    return {"rule": "high_talk_low_walk", "talk_min": TALK_CUT, "walk_max": WALK_CUT,
            "gap_is_classifier": False, "source": "esgx.measures.greenwash",
            "provenance": "builtin_pipeline" if builtin else "reference_only", "rule_applies": builtin,
            "independently_verified": False}


def environmental_rows(store, market, normalized):
    paths = store._paths()
    green_key = "greenness" if market == "hk" else "greenness_tw"
    tables = {name: exact_rows(raw_table(store, paths[key])) for name, key in
              (("greenness", green_key), ("walk", f"walk_{market}"), ("dictionary", f"dictionary_{market}"),
               ("fundamentals", f"fundamentals_{market}"), ("emissions", f"emissions_{market}"))}
    # Builtin HK extraction is a processed parquet; mounted exports use the documented CSV.
    if market == "hk" and not paths["emissions_hk"].exists() and getattr(store, "dataset_id", "builtin") == "builtin":
        tables["emissions"] = exact_rows(store.table(store.processed / "emissions_hk.parquet"))
    universe_sectors = {}
    for key in (("universe_hsi", "universe_hsci") if market == "hk" else ("universe_twse",)):
        for row in store.table(paths[key]).to_dict("records"):
            firm = raw_text(row.get("firm_id"))
            if firm:
                universe_sectors[firm] = None if firm in universe_sectors else raw_text(row.get("sector"))
    keys = set(tables["greenness"]) | set(tables["walk"]) | set(tables["dictionary"])
    result = []
    for firm, year in sorted(keys):
        if normalized and firm.upper() != normalized:
            continue
        rows = {name: table.get((firm, year)) or {} for name, table in tables.items()}
        g, w, d, f, e = (rows[name] for name in ("greenness", "walk", "dictionary", "fundamentals", "emissions"))
        item = {"firm_id": firm, "market": market, "year": year,
                **{field: raw_number(g.get(field)) for field in ("e_score", "e_weight", "g")},
                "provider": raw_text(g.get("provider")),
                "sector": raw_text(w.get("sector")) or raw_text(d.get("sector")) or raw_text(g.get("sector")) or universe_sectors.get(firm),
                "intensity": raw_number(w.get("intensity")), "scope1": raw_number(e.get("scope1")),
                "scope2": raw_number(e.get("scope2")), "revenue": raw_number(f.get("revenue")),
                "rank": raw_number(w.get("rank")), "comparison_count": raw_number(w.get("comparison_count")),
                "rank_group": raw_text(w.get("rank_group")),
                "source": paths[green_key].name,
                "input_source": raw_text(e.get("source")),
                "dataset_source": getattr(store, "source", "Local pipeline snapshot")}
        if (firm, year) not in tables["walk"]:
            item["intensity"] = raw_number(d.get("intensity"))
        walk = raw_number(w.get("walk"))
        # Dictionary equality cannot establish which walk variant produced E_score.
        item["walk_matches_e_score"] = walk is not None and item["e_score"] is not None and walk == item["e_score"]
        level = raw_number(w.get("walk_intensity_level"))
        item["default_hard_values_match"] = item["walk_matches_e_score"] and level is not None and level == walk
        # Saved numerical equality cannot distinguish coincidentally equal multi-walk.
        # No pipeline run-option provenance is currently supplied by these snapshots.
        item["default_hard_path"] = False
        item["score_path_provenance"] = "numerical_equality_only" if item["default_hard_values_match"] else "not_confirmed"
        item["missing_fields"] = [k for k, value in item.items() if value is None]
        item["ambiguous_tables"] = [name for name, table in tables.items() if (firm, year) in table and table[(firm, year)] is None]
        result.append(item)
    return result


@router.get("/talk-walk")
def talk_walk_endpoint(store: Store, market: str = "all", firm_id: str | None = None):
    if market not in ("hk", "tw", "all"):
        raise HTTPException(400, "market must be hk, tw, or all")
    semantic, dictionary, environmental, document_count = [], [], [], 0
    normalized = firm_id.upper().replace("-HK", ".HK").replace("-TW", ".TW") if firm_id else None
    for m in (("hk", "tw") if market == "all" else (market,)):
        paths = store._paths()
        suffix = "" if m == "hk" else "_tw"
        yearly = store.table(paths[f"talkwalk_firm_year{suffix}"])
        documents = store.table(paths[f"talkwalk_documents{suffix}"])
        if firm_id:
            normalized = firm_id.upper().replace("-HK", ".HK").replace("-TW", ".TW")
            yearly = yearly[yearly.firm_id.str.upper() == normalized] if "firm_id" in yearly else yearly
            documents = documents[documents.firm_id.str.upper() == normalized] if "firm_id" in documents else documents
        for row in yearly.to_dict("records"):
            docs = documents[documents.firm_id == row["firm_id"]] if "firm_id" in documents else documents
            if "period" in docs:
                docs = docs[docs.period.astype(str).str.startswith(str(int(row["year"])))]
            doc_items = [{"filing_date": d.get("filing_date"), "period": d.get("period"), "source_url": d.get("accession"), "summary": d.get("summary"),
                          "evidence_talk": evidence(d.get("evidence_talk")), "evidence_walk": evidence(d.get("evidence_walk")),
                          "model": d.get("usage_model"), "dimensions": dimensions(d), "skipped": d.get("skipped", False)} for d in docs.to_dict("records")]
            document_count += len(doc_items)
            semantic.append({"firm_id": row["firm_id"], "market": m, "year": row["year"], "talk": row.get("talk"), "walk": row.get("walk"), "gap": row.get("gap"),
                             "source": paths[f"talkwalk_firm_year{suffix}"].name,
                             "assessment_status": "evidence_available" if doc_items else "insufficient_data", "dimensions": dimensions(row), "documents": doc_items,
                             "greenwasher": None, "greenhusher": None})
        environmental.extend(environmental_rows(store, m, normalized))
        dict_frame = raw_table(store, paths[f"dictionary_{m}"])
        if firm_id and "firm_id" in dict_frame:
            dict_frame = dict_frame[dict_frame.firm_id.str.upper() == normalized]
        for row in dict_frame.to_dict("records"):
            values = {k: raw_number(row.get(k)) for k in ("talk", "walk", "gap")}
            flags = {k: raw_flag(row.get(k)) for k in ("greenwasher", "greenhusher")}
            assessed = all(values[k] is not None for k in ("talk", "walk")) and all(v is not None for v in flags.values())
            dictionary.append({"firm_id": row["firm_id"], "market": m, "year": row["year"], **values,
                               "source": paths[f"dictionary_{m}"].name,
                               "claim_per_1000": raw_number(row.get("claim_per_1000")),
                               "rank_group": raw_text(row.get("rank_group")),
                               **{k: v if assessed else None for k, v in flags.items()},
                               "assessment_status": "assessed" if assessed else "insufficient_data"})
    return clean({"dataset_id": getattr(store, "dataset_id", "builtin"), "market": market,
                  "assessment_status": "evidence_available" if semantic or dictionary else "insufficient_data",
                  "semantic_llm": {"kind": "semantic_llm", "scale": "0-10 semantic rubric", "firms": semantic, "coverage": {"firms": len({r["firm_id"] for r in semantic}), "documents": document_count},
                                   "methodology": {"classification": "not_provided", "gap_is_classifier": False}},
                  "dictionary": {"kind": "dictionary", "scale": "0-10 within-sector percentile", "firms": dictionary,
                                 "methodology": dictionary_methodology(store)},
                  "environmental": {"firms": environmental, "methodology": {
                      "formula": "g = -(10 - e_score) * e_weight / 100", "g_source": "saved_greenness_table",
                      "score_source": "saved_firm_year_tables", "raw_inputs": True, "missing_policy": "null_without_defaults_or_reconstruction",
                      "default_hard_path": "Unconfirmed without pipeline run-option provenance; saved equality only establishes default_hard_values_match, even when provider is walk_hard",
                      "default_hard_reference": {"scope": "scope1 + scope2", "intensity_unit": "tCO2e / USD million revenue",
                                                 "percentile": "average ties; (rank - 1)/(n - 1); lower intensity is greener; singleton score 5",
                                                 "min_sector_size": 5, "small_sample_group": "_all pools only sectors below min_sector_size, within year",
                                                 "e_weight": "5 + 45 * average percentile rank of industry aggregate intensity within year"},
                      "reference_applies_to_all_rows": False}},
                  "limitations": ["LLM evidence summarizes report claims and is not an independent audit.", "Semantic rubric and dictionary percentile values must not be averaged or compared on a single scale."]})


@router.get("/data/fx")
def fx_endpoint(store: Store):
    rates = []
    for pair in ("TWDHKD", "USDHKD"):
        frame = store.fx(pair)
        if frame.empty:
            continue
        frame = frame.assign(month=frame.month.astype(str)).sort_values("month")
        row = frame.iloc[-1]
        observed = clean(row.get("observation_date")) or clean(row.get("date")) or row.month
        rates.append({"pair": pair, "rate": clean(row.rate), "date": str(observed),
                      "source": clean(row.get("source")) or getattr(store, "source", "Local FX snapshot"), "is_latest": False})
    return {"dataset_id": getattr(store, "dataset_id", "builtin"), "rates": rates, "is_latest": False,
            "convention": "Pair ABCDEF means DEF per unit of ABC; dates are observation dates, not live quotes."}
