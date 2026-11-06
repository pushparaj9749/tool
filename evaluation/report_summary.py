"""Assemble reports/RELEASE_REPORT.md from the machine-generated JSON reports.

Nothing in this file invents numbers: every value is read from a report produced by
an actual run. Missing reports are listed as 'not run'.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"


def load(name: str):
    path = REPORTS / name
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def fmt(value):
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.4g}"
    return str(value)


def main() -> None:
    lm = load("eval_lm.json")
    chat = load("eval_chat.json")
    langs = load("eval_languages.json")
    pers = load("eval_personality.json")
    eng = load("eval_engineering.json")
    data_val = load("data_validation.json")
    params = load("parameter_count.json")
    train_summaries = sorted(p.name for p in (ROOT / "logs").glob("*-summary.json"))

    lines = ["# ANKIT LLM v0.1 — release report", "",
             "Generated from `reports/*.json` by `evaluation/report_summary.py`. "
             "Values are copied verbatim from runs in this repository.", ""]

    lines += ["## Model", ""]
    if params:
        lines += [f"- Measured trainable parameters: **{params['measured_trainable_parameters']:,}** "
                  f"({params['measured_millions']}M), analytic estimate matches: "
                  f"{params['analytic_matches_measured']}"]
        lines += [f"- Architecture: {params['config']['n_layers']} layers, d_model "
                  f"{params['config']['d_model']}, {params['config']['n_heads']} heads, d_ff "
                  f"{params['config']['d_ff']}, vocab {params['config']['vocab_size']}"]
    else:
        lines += ["- parameter count report not run"]

    lines += ["", "## Training runs (from logs/*-summary.json)", ""]
    if train_summaries:
        for name in train_summaries:
            s = json.loads((ROOT / "logs" / name).read_text(encoding="utf-8"))
            lines.append(
                f"- `{s.get('run_name', name)}` (run id {s.get('run_id', '?')}): "
                f"{fmt(s.get('params'))} params, steps={fmt(s.get('steps'))}, "
                f"tokens={fmt(s.get('tokens_seen'))}, final val loss={fmt(s.get('final_val_loss') or s.get('sft_val_loss'))}, "
                f"duration={fmt(s.get('duration_s'))}s, stop={fmt(s.get('stop_reason'))}")
    else:
        lines.append("- no training summaries found")

    lines += ["", "## Language modelling", ""]
    if lm:
        v, t = lm.get("validation", {}), lm.get("test", {})
        lines += [f"- validation: loss {fmt(v.get('loss'))}, perplexity {fmt(v.get('perplexity'))}, "
                  f"docs {fmt(v.get('docs'))}",
                  f"- test: loss {fmt(t.get('loss'))}, perplexity {fmt(t.get('perplexity'))}",
                  "", "| language | docs | loss | perplexity |", "|---|---|---|---|"]
        for lang, m in (v.get("per_language") or {}).items():
            lines.append(f"| {lang} | {fmt(m.get('docs'))} | {fmt(m.get('loss'))} | {fmt(m.get('perplexity'))} |")
    else:
        lines.append("- not run")

    lines += ["", "## Conversation", ""]
    if chat:
        lines += [f"- instruction/expectation hit rate: **{fmt(chat.get('single_turn_expectation_rate'))}**",
                  f"- multi-turn context hit rate: **{fmt(chat.get('context_expectation_rate'))}**",
                  f"- mean 3-gram repetition rate: {fmt(chat.get('mean_repetition_3gram_rate'))}",
                  f"- contradiction probe identical answers: {fmt(chat.get('contradiction_probe', {}).get('identical'))}",
                  "", "| probe | expectation hit | response (truncated) |", "|---|---|---|"]
        for r in chat.get("single_turn", []):
            resp = (r["response"] or "").replace("|", "/").replace("\n", " ")[:90]
            lines.append(f"| {r['id']} | {r['expectation_hit']} | {resp} |")
    else:
        lines.append("- not run")

    lines += ["", "## Multilingual", ""]
    if langs:
        lines += [f"- overall language consistency: **{fmt(langs.get('overall_consistency'))}**", "",
                  "| expected language | probes | consistency | mean chars |", "|---|---|---|---|"]
        for lang, m in (langs.get("per_language") or {}).items():
            lines.append(f"| {lang} | {fmt(m.get('probes'))} | {fmt(m.get('language_consistency'))} | "
                         f"{fmt(m.get('mean_chars'))} |")
    else:
        lines.append("- not run")

    lines += ["", "## Personality", ""]
    if pers:
        lines += [f"- adaptive language match rate: **{fmt(pers.get('adaptive_language_match_rate'))}**",
                  f"- mode separation (1 - lexical overlap, professional vs friendly): "
                  f"{fmt(pers.get('mode_separation_mean'))}", "",
                  "| mode | responses | mean chars | formality ratio |", "|---|---|---|---|"]
        for mode, m in (pers.get("summary") or {}).items():
            lines.append(f"| {mode} | {fmt(m.get('responses'))} | {fmt(m.get('mean_chars'))} | "
                         f"{fmt(m.get('mean_formality_ratio'))} |")
    else:
        lines.append("- not run")

    lines += ["", "## Engineering", ""]
    if eng:
        lines += [f"- reload weight identity: {fmt(eng.get('reload_weight_identity'))}",
                  f"- greedy output reproducible across two loads: {fmt(eng.get('greedy_reproducible_across_loads'))}",
                  f"- peak RSS: {fmt(eng.get('peak_rss_mb'))} MB; threads: {fmt(eng.get('torch_threads'))}",
                  f"- long context: {fmt(eng.get('long_context'))}"]
        for s in eng.get("speed", []):
            lines.append(f"- {s['max_new_tokens']} new tokens in {s['seconds']}s "
                         f"(≈{s['tokens_per_second_approx']} tok/s, CPU)")
        bad = [c for c in eng.get("checkpoint_inventory", []) if not c["integrity_ok"]]
        lines.append(f"- checkpoints verified: {len(eng.get('checkpoint_inventory', [])) - len(bad)}"
                     f" ok, {len(bad)} failed integrity")
    else:
        lines.append("- not run")

    lines += ["", "## Data validation", ""]
    if data_val:
        lines += [f"- status: **{data_val.get('status')}**", f"- errors: {data_val.get('errors')}",
                  f"- leakage: {data_val.get('checks', {}).get('split_leakage')}",
                  f"- token shards: {data_val.get('checks', {}).get('token_shards')}"]
    else:
        lines.append("- not run")

    lines += ["", "---", "",
              "**Interpretation warning.** A passing software test is not evidence of language "
              "intelligence. The scores above come from small, deterministic probes over an "
              "undertrained model on CPU-only hardware. See `LIMITATIONS.md`.", ""]

    out = REPORTS / "RELEASE_REPORT.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"[report] {out}")


if __name__ == "__main__":
    main()
