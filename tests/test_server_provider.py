"""Hermetic provenance, isolated import and evidence regressions; no network/LLM."""
import copy
import json
import os

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from server.main import app
from server import provider
from server.adapter import format_company_for_ui


@pytest.fixture
def client(tmp_path, monkeypatch):
    for area in ("outputs", "processed", "raw"):
        (tmp_path / area).mkdir()
    store = provider.SnapshotStore(outputs=tmp_path / "outputs", raw=tmp_path / "raw", processed=tmp_path / "processed")
    monkeypatch.setattr(provider, "_builtin", store)
    monkeypatch.setattr(provider, "_snapshots", {})
    yield TestClient(app), store
    for _, directory in provider._snapshots.values():
        directory.cleanup()


def bundle():
    months = pd.period_range("2021-01", "2023-12", freq="M").astype(str).tolist()
    tables = {
        "greenness": [{"firm_id": "0002.HK", "year": 2023, "e_score": 8, "e_weight": 40, "g": -0.8}],
        "universe_hsi": [{"firm_id": "0002.HK", "name": "Imported Company", "sector": "Utilities", "industry": "Power", "country": "Hong Kong"}],
        "prices_hk": [{"firm_id": "0002.HK", "month": m, "ret": 0.01, "mktcap": 1000000} for m in months],
        "factors_asia_pacific_ex_japan": [{"month": m, **{k: 0.001 for k in provider.FACTOR_COLUMNS[1:]}} for m in months],
        "fx_monthly": [{"month": m, "pair": "USDHKD", "rate": 7.8} for m in months],
    }
    return {"metadata": {"source": "Test export", "markets": ["hk"], "units": provider.UNITS.copy(),
                         "currencies": {k: v for k, v in provider.CURRENCIES.items() if k in tables}, "is_latest": True, "snapshot_date": "2099-01-01"}, "tables": tables}


@pytest.mark.parametrize("missing", [None, pd.NA, float("nan"), float("inf"), -float("inf"), np.float64("nan")])
def test_adapter_missing_scalars_and_zero(missing):
    company = format_company_for_ui({"firm_id": "0002.HK", "name": missing, "sector": missing, "region": missing,
                                     "e_score": missing, "e_weight": missing, "talk": missing, "walk": missing,
                                     "greenwasher": missing, "greenhusher": missing, "carbon": 0, "walk_intensity_level": 9})
    assert company["carbon"] == 0
    assert company["greenwasher"] is None and company["greenhusher"] is None
    assert company["score"] is None and company["talk"] is None and company["walk"] is None
    assert company["name"] == "0002.HK" and company["sector"] == "General"
    assert company["assessment_status"] == "insufficient_data"
    json.dumps(company, allow_nan=False)


def test_no_audit_claim_and_no_implied_safe_flag():
    row = {"firm_id": "0002.HK", "e_score": 7, "talk": 6, "walk": 5}
    company = format_company_for_ui(row)
    assert company["greenwasher"] is None
    assert company["assessment_status"] == "insufficient_data"
    assert "audited" not in company["note"].lower()
    company = format_company_for_ui({**row, "greenwasher": 0, "greenhusher": 0})
    assert company["greenwasher"] is False and company["assessment_status"] == "assessed"


def test_mount_is_immutable_selected_and_freshness_untrusted(client):
    http, builtin = client
    before = http.get("/api/companies").json()
    payload = bundle()
    first = http.post("/api/data/mount", json=payload)
    assert first.status_code == 200, first.text
    mounted = first.json()
    assert mounted["status"]["is_latest"] is False
    assert mounted["status"]["snapshot_date"] == "2023-12"
    assert http.post("/api/data/mount", json=payload).json()["dataset_id"] == mounted["dataset_id"]
    headers = mounted["selection_header"]
    companies = http.get("/api/companies", headers=headers).json()
    assert len(companies) == 1 and companies[0]["name"] == "Imported Company"
    assert companies[0]["greenwasher"] is None
    assert http.get("/api/health", headers=headers).json()["data"]["dataset_id"] == mounted["dataset_id"]
    assert http.get("/api/data/status?market=tw", headers=headers).json()["mode"] == "missing"
    assert http.get("/api/companies?market=tw", headers=headers).json() == []
    assert http.get("/api/companies").json() == before
    assert not any(builtin.outputs.iterdir()) and not any(builtin.raw.iterdir())
    selected = provider.get_store(mounted["dataset_id"])
    assert selected.prices("hk").firm_id.tolist() == ["0002.HK"] * 36
    # Engine routes use the same provider override (rather than their default store).
    from esgx.api import portfolio_routes
    assert app.dependency_overrides[portfolio_routes._store] is provider.get_store
    assert http.get("/api/portfolio/filters?market=hk", headers=headers).status_code == 200
    changed = copy.deepcopy(payload)
    changed["tables"]["universe_hsi"][0]["name"] = "Second export"
    other = http.post("/api/data/mount", json=changed).json()
    assert other["dataset_id"] != mounted["dataset_id"]
    assert http.get("/api/companies", headers=headers).json()[0]["name"] == "Imported Company"


@pytest.mark.parametrize("mutation", [
    lambda b: b["metadata"]["units"].update(returns="percent"),
    lambda b: b["metadata"]["currencies"].update(prices_hk="USD"),
    lambda b: b["tables"]["prices_hk"][0].pop("ret"),
    lambda b: b["tables"].update({"../../escape": []}),
    lambda b: b["tables"]["prices_hk"][0].update(month="2023-13"),
    lambda b: b["tables"]["prices_hk"][0].update(ret="0.01"),
    lambda b: b["tables"]["fx_monthly"][0].update(rate=0),
    lambda b: b["tables"]["greenness"][0].update(e_score=11),
    lambda b: b["tables"]["greenness"][0].update(g=0),
    lambda b: b["tables"]["prices_hk"][0].update(firm_id="9999.HK"),
    lambda b: b["tables"]["prices_hk"].append(b["tables"]["prices_hk"][0]),
    lambda b: b["metadata"].update(sql="SELECT * FROM prices"),
    lambda b: b["metadata"].update(markets=[["hk"]]),
    lambda b: b["tables"].update(fx_monthly=[]),
    lambda b: b["tables"]["greenness"][0].update(available_date="yesterday"),
    lambda b: b["tables"]["greenness"][0].update(available_date="2099-01-01"),
    lambda b: b["tables"]["fx_monthly"][0].update(observation_date="2021-02-28"),
])
def test_strict_bundle_rejections(client, mutation):
    http, _ = client
    payload = bundle()
    mutation(payload)
    response = http.post("/api/data/mount", json=payload)
    assert response.status_code == 422, response.text
    assert not provider._snapshots


def test_nonfinite_json_size_limit_unknown_id(client, monkeypatch):
    http, _ = client
    payload = bundle()
    payload["tables"]["prices_hk"][0]["ret"] = float("inf")
    assert http.post("/api/data/mount", content=json.dumps(payload)).status_code == 422
    monkeypatch.setattr(provider, "MAX_BYTES", 50)
    assert http.post("/api/data/mount", content=json.dumps(bundle())).status_code == 413
    assert http.get("/api/companies", headers={"X-Dataset-Id": "missing"}).status_code == 404


def test_missing_market_and_dates_do_not_use_mtime(client):
    http, store = client
    pd.DataFrame(bundle()["tables"]["greenness"]).to_csv(store.outputs / "det_greenness_hk.csv", index=False)
    os.utime(store.outputs / "det_greenness_hk.csv", (4102444800, 4102444800))
    status = http.get("/api/data/status").json()
    assert status["snapshot_date"] == "2023" and status["is_latest"] is False
    assert status["missing_markets"] == ["tw"]
    assert status["markets"]["tw"]["status"] == "missing"
    assert http.get("/api/data/status?market=tw").json()["mode"] == "missing"
    assert http.get("/api/companies?market=tw").json() == []
    assert http.get("/api/health").json()["capabilities"]["liveData"] is False


def test_partial_unscored_snapshot_never_substitutes_demo(client):
    http, store = client
    pd.DataFrame(bundle()["tables"]["universe_hsi"]).to_parquet(store.raw / "universe_hsi.parquet", index=False)
    assert http.get("/api/companies").json() == []
    status = http.get("/api/data/status").json()
    assert status["mode"] == "missing"
    assert status["missing_markets"] == ["hk", "tw"]
    assert http.get("/api/data/sources").json()["sources"][10]["available"] is True


def test_semantic_evidence_separate_from_dictionary(client):
    http, store = client
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "talk": 7, "walk": 3, "gap": 4, "talk_ambition": 8}]).to_csv(store.outputs / "talkwalk_firm_year_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "period": "2023-12-31", "filing_date": "2024-03-10", "accession": "https://example.org/report.pdf",
                   "summary": "Reported claim", "evidence_talk": '["Target claim"]', "evidence_walk": '["Action claim"]', "usage_model": "test-model"}]).to_csv(store.outputs / "talkwalk_documents_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "talk": 9, "walk": 2, "greenwasher": 1, "greenhusher": 0}]).to_csv(store.outputs / "det_greenwashing_hk.csv", index=False)
    body = http.get("/api/talk-walk?market=hk&firm_id=0002-hk").json()
    semantic = body["semantic_llm"]["firms"][0]
    assert semantic["talk"] == 7 and semantic["greenwasher"] is None
    assert semantic["source"] == "talkwalk_firm_year_hk.csv"
    assert semantic["documents"][0]["evidence_talk"] == ["Target claim"]
    assert semantic["documents"][0]["model"] == "test-model"
    assert body["dictionary"]["firms"][0]["talk"] == 9
    assert body["dictionary"]["firms"][0]["greenwasher"] is True
    assert body["semantic_llm"]["coverage"] == {"firms": 1, "documents": 1}
    from esgx.measures.greenwash import TALK_CUT, WALK_CUT
    assert body["dictionary"]["methodology"]["talk_min"] == TALK_CUT
    assert body["dictionary"]["methodology"]["walk_max"] == WALK_CUT
    assert body["dictionary"]["methodology"]["gap_is_classifier"] is False
    assert body["semantic_llm"]["methodology"]["classification"] == "not_provided"
    unknown = http.get("/api/talk-walk?firm_id=9999.HK").json()
    assert unknown["assessment_status"] == "insufficient_data"
    assert unknown["semantic_llm"]["firms"] == [] and unknown["dictionary"]["firms"] == []


def test_dated_fx_real_source_no_fallback(client):
    http, store = client
    assert http.get("/api/data/fx").json()["rates"] == []
    pd.DataFrame([{"month": "2023-12", "pair": "USDHKD", "rate": 7.8, "observation_date": "2023-12-29", "source": "Historical official source"},
                  {"month": "2023-11", "pair": "USDHKD", "rate": 7.7, "observation_date": "2023-11-30", "source": "Historical official source"}]).to_parquet(store.raw / "fx_monthly.parquet", index=False)
    row = http.get("/api/data/fx").json()["rates"][0]
    assert row["date"] == "2023-12-29" and row["rate"] == 7.8 and row["source"] == "Historical official source"
    assert row["is_latest"] is False


def test_talk_walk_raw_full_precision_no_adapter_defaults(client):
    http, store = client
    score = 10 / 3
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "provider": "walk_hard", "e_score": score,
                   "e_weight": 17.123456789, "g": -1.1415637859333334}]).to_csv(store.outputs / "det_greenness_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "walk": score, "walk_intensity_level": score,
                   "intensity": 0.123456789012345, "sector": "Utilities", "rank_group": "_all"}]).to_csv(store.outputs / "det_walk_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "talk": 7.999999999, "walk": score,
                   "greenwasher": 0, "greenhusher": 0}]).to_csv(store.outputs / "det_greenwashing_hk.csv", index=False)
    body = http.get("/api/talk-walk?market=hk").json()
    dictionary = body["dictionary"]["firms"][0]
    assert dictionary["talk"] == 7.999999999 and dictionary["walk"] == score
    assert dictionary["gap"] is None and dictionary["greenwasher"] is False
    assert dictionary["source"] == "det_greenwashing_hk.csv"
    assert dictionary["claim_per_1000"] is None and dictionary["rank_group"] is None
    row = body["environmental"]["firms"][0]
    assert row["e_score"] == score and row["e_weight"] == 17.123456789
    assert row["g"] == -1.1415637859333334
    assert row["intensity"] == 0.123456789012345
    assert row["walk_matches_e_score"] and row["default_hard_values_match"]
    assert row["default_hard_path"] is False
    assert row["source"] == "det_greenness_hk.csv" and row["input_source"] is None
    assert row["score_path_provenance"] == "numerical_equality_only"
    assert row["rank"] is None and row["comparison_count"] is None and row["revenue"] is None
    assert row["scope1"] is None and row["scope2"] is None
    assert body["dictionary"]["methodology"]["provenance"] == "builtin_pipeline"
    assert body["environmental"]["methodology"]["reference_applies_to_all_rows"] is False


@pytest.mark.parametrize("walk,level,confirmed", [(4.123456789, 4.123456789, True), (4.123456789, 2, False), (4.123456788, 4.123456788, False), (4.123456789, None, False)])
def test_hard_path_requires_saved_exact_equality(client, walk, level, confirmed):
    http, store = client
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "provider": "walk_hard", "e_score": 4.123456789, "e_weight": None, "g": None}]).to_csv(store.outputs / "det_greenness_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "walk": walk, "walk_intensity_level": level}]).to_csv(store.outputs / "det_walk_hk.csv", index=False)
    row = http.get("/api/talk-walk?market=hk").json()["environmental"]["firms"][0]
    assert row["default_hard_values_match"] is confirmed
    assert row["default_hard_path"] is False
    assert row["e_weight"] is None and row["g"] is None


def test_exact_year_duplicates_and_absent_walk_never_reconstruct(client):
    http, store = client
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "provider": "walk_hard", "e_score": 8, "e_weight": 40, "g": -0.8}]).to_csv(store.outputs / "det_greenness_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "scope1": 1, "scope2": 2, "source": "first"},
                  {"firm_id": "0002.HK", "year": 2023, "scope1": 9, "scope2": 8, "source": "second"},
                  {"firm_id": "0002.HK", "year": 2023, "scope1": 3, "scope2": 4, "source": "third"}]).to_csv(store.outputs / "emissions_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2022, "revenue": 999}]).to_parquet(store.raw / "fundamentals_yf_hk.parquet", index=False)
    row = http.get("/api/talk-walk?market=hk").json()["environmental"]["firms"][0]
    assert row["scope1"] is None and row["scope2"] is None and row["revenue"] is None
    assert row["intensity"] is None and row["rank"] is None and row["sector"] is None
    assert not row["default_hard_path"] and not row["walk_matches_e_score"]
    assert row["ambiguous_tables"] == ["emissions"]
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "walk": 8},
                  {"firm_id": "0002.HK", "year": 2023, "walk": 1}]).to_csv(store.outputs / "det_walk_hk.csv", index=False)
    row = http.get("/api/talk-walk?market=hk").json()["environmental"]["firms"][0]
    assert not row["walk_matches_e_score"] and "walk" in row["ambiguous_tables"]


def test_saved_boolean_flags_and_dictionary_inputs(client):
    http, store = client
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "talk": 8.123456789, "walk": 2,
                   "greenwasher": True, "greenhusher": False, "claim_per_1000": 0.987654321,
                   "rank_group": "_all"}]).to_csv(store.outputs / "det_greenwashing_hk.csv", index=False)
    row = http.get("/api/talk-walk?market=hk").json()["dictionary"]["firms"][0]
    assert row["greenwasher"] is True and row["greenhusher"] is False
    assert row["claim_per_1000"] == 0.987654321 and row["rank_group"] == "_all"
    assert row["assessment_status"] == "assessed"


@pytest.mark.parametrize("multi", [4.123456789, 7.5])
def test_equal_scores_cannot_confirm_pipeline_variant(client, multi):
    http, store = client
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "provider": "walk_hard", "e_score": 4.123456789}]).to_csv(store.outputs / "det_greenness_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "year": 2023, "walk": 4.123456789, "walk_intensity_level": 4.123456789,
                   "walk_multi": multi}]).to_csv(store.outputs / "det_walk_hk.csv", index=False)
    pd.DataFrame([{"firm_id": "0002.HK", "sector": "Utilities"}]).to_parquet(store.raw / "universe_hsi.parquet", index=False)
    row = http.get("/api/talk-walk?market=hk").json()["environmental"]["firms"][0]
    assert row["walk_matches_e_score"] and row["default_hard_values_match"]
    assert row["default_hard_path"] is False and row["score_path_provenance"] == "numerical_equality_only"
    assert row["sector"] == "Utilities" and row["rank_group"] is None


def test_mounted_rule_provenance_and_custom_contract(client):
    http, _ = client
    payload = bundle()
    mounted = http.post("/api/data/mount", json=payload).json()
    method = http.get("/api/talk-walk", headers=mounted["selection_header"]).json()["dictionary"]["methodology"]
    assert method["provenance"] == "reference_only" and method["rule_applies"] is False
    payload["metadata"]["talk_walk_methodology"] = {"rule": "high_talk_low_walk", "talk_min": 7.5, "walk_max": 2.25, "source": "Export's documented thresholds"}
    mounted = http.post("/api/data/mount", json=payload)
    assert mounted.status_code == 200, mounted.text
    method = http.get("/api/talk-walk", headers=mounted.json()["selection_header"]).json()["dictionary"]["methodology"]
    assert method["provenance"] == "dataset_supplied" and method["rule_applies"] is True
    assert method["talk_min"] == 7.5 and method["walk_max"] == 2.25
    assert method["independently_verified"] is False
    payload["metadata"]["talk_walk_methodology"]["talk_min"] = True
    assert http.post("/api/data/mount", json=payload).status_code == 422


@pytest.mark.parametrize("talk,walk,flagged", [(6, 1, False), (9, 5, False), (9, 2, True), (8, 10 / 3, True), (7.999, 0, False), (9, 10 / 3 + 0.0001, False)])
def test_explained_rule_matches_engine_double_condition(talk, walk, flagged):
    from esgx.measures.greenwash import greenwashing_table
    talk_data = pd.DataFrame([{"firm_id": "0002.HK", "year": 2025, "talk": talk, "talk_unfiltered": talk,
                               "n_docs": 1, "n_words": 1000, "n_claim": 10, "claim_per_1000": 10, "risk_context_share": 0}])
    walk_data = pd.DataFrame([{"firm_id": "0002.HK", "year": 2025, "sector": "Utilities", "walk": walk,
                               "intensity": 1, "walk_intensity_trend": None, "walk_emission_trend": None, "walk_composite": walk}])
    result = greenwashing_table(talk_data, walk_data).iloc[0]
    assert bool(result.greenwasher) is flagged
    assert result.gap == pytest.approx(talk - walk)


def test_mounted_bundle_drives_complete_recommendation(client):
    """Exercise the actual optimizer through the mounted provider, not a stub."""
    http, _ = client
    rng = np.random.default_rng(713)
    months = pd.period_range("2020-01", "2024-12", freq="M").astype(str).tolist()
    firm_ids = [f"{9000 + i:04d}.HK" for i in range(12)]
    factors = rng.normal(0.004, 0.016, size=(60, 6))
    payload = bundle()
    payload["tables"]["greenness"] = [{"firm_id": f, "year": 2021, "available_date": "2022-04-01", "e_score": 2 + i / 2,
                                         "e_weight": 40, "g": -(8 - i / 2) * 0.4} for i, f in enumerate(firm_ids)]
    payload["tables"]["universe_hsi"] = [{"firm_id": f, "name": f"Mounted firm {i}", "sector": "Utilities", "industry": "Power", "country": "Hong Kong"} for i, f in enumerate(firm_ids)]
    payload["tables"]["factors_asia_pacific_ex_japan"] = [{"month": m, **dict(zip(provider.FACTOR_COLUMNS[1:7], factors[j].tolist())), "rf": 0.001} for j, m in enumerate(months)]
    prices = []
    for i, firm in enumerate(firm_ids):
        local_ret = factors @ rng.uniform(0.15, 1, 6) + rng.normal(0.001, 0.008, 60)
        prices += [{"firm_id": firm, "month": m, "ret": float(local_ret[j]), "mktcap": float((i + 1) * 1000000)} for j, m in enumerate(months)]
    payload["tables"]["prices_hk"] = prices
    payload["tables"]["fx_monthly"] = [{"month": m, "pair": "USDHKD", "rate": float(7.8 + 0.02 * np.sin(j / 3))} for j, m in enumerate(months)]
    payload["tables"]["last_close_hk"] = [{"firm_id": f, "date": "2024-12-31", "close": 100 + i} for i, f in enumerate(firm_ids)]
    payload["metadata"]["currencies"]["last_close_hk"] = "HKD"
    mounted = http.post("/api/data/mount", json=payload)
    assert mounted.status_code == 200, mounted.text
    headers = mounted.json()["selection_header"]
    response = http.post("/api/portfolio/recommend", headers=headers, json={"market": "hk", "holdings": {f: 1000 for f in firm_ids},
                           "capital_currency": "HKD", "risk_score": 3, "green_score": 1, "w_max": 0.25, "kappa": 0})
    assert response.status_code == 200, response.text
    recommendation = response.json()
    assert recommendation["model_currency"] == "USD" and recommendation["return_basis"] == "excess"
    assert recommendation["capital_currency"] == recommendation["pricing_currency"] == "HKD"
    assert recommendation["coverage"]["n_modeled"] == 12
    assert recommendation["coverage"]["n_scored"] == 12
    assert recommendation["model_period"]["end"] == "2024-12"
    assert recommendation["trades"] and {r["firm_id"] for r in recommendation["trades"]}.issubset(set(firm_ids))
    assert all(r["price_currency"] == "HKD" for r in recommendation["trades"])
    assert http.get("/api/health", headers=headers).json()["data"]["dataset_id"] == mounted.json()["dataset_id"]
    # The clean builtin remains a demo and cannot use mounted data implicitly.
    assert http.get("/api/data/status").json()["mode"] == "demo"
    assert http.post("/api/portfolio/recommend", json={"market": "hk", "holdings": {firm_ids[0]: 1000}}).status_code == 503
