# MOERAND v7 — HTF Confluence Gate Verification

## Purpose

Systematic walkthrough confirming that `entryConfirmed` (and therefore every BUY webhook) is always `false` when fewer than `minimumConfluentTfs` (default: **3**) of the 4 higher timeframes are fully bullish. Produced by static analysis of `indicators/MOERAND_v7.pine`.

---

## Logic Chain

### Step 1 — Bullish classification per HTF (lines 156–200)

Each of the four HTFs (5m, 15m, 1h, 4h) produces two independent booleans:

| Variable | Condition |
|---|---|
| `htfXmBullish` | `fast > slow` AND `close > slow` AND `rsi in [45, 70]` |
| `htfXmAcceptable` | `close >= slow * 0.992` AND `rsi >= 44` (looser, partial credit only) |

`htfXmAcceptable` is **not** the same as `htfXmBullish`. A timeframe that is only acceptable does **not** increment the bullish count.

---

### Step 2 — Confluence count and gate (lines 211–212)

```pine
int  confluenceBullishCount = (htf5mBullish ? 1 : 0) + (htf15mBullish ? 1 : 0)
                            + (htf1hBullish ? 1 : 0) + (htf4hBullish ? 1 : 0)
bool minimumTfsMet          = confluenceBullishCount >= minimumConfluentTfs
```

`minimumTfsMet` is a simple comparison. It is `false` whenever `confluenceBullishCount < minimumConfluentTfs`. There is no other assignment to this variable anywhere in the script.

---

### Step 3 — Gate 1: Setup creation (line 297)

```pine
bool opportunityReady = barstate.isconfirmed and enoughHistory
                     and anyHtfAcceptable
                     and minimumTfsMet          -- ← required
                     and zoneNearPrice
                     and volumeAcceptable
                     and confluenceScore >= minimumOpportunityScore
```

A new buy zone (`setupActive := true`) can only be created when `opportunityReady` is true (line 355). Because `minimumTfsMet` is a required AND term, **no setup is ever opened** when the bullish count is below the threshold.

---

### Step 4 — Gate 2: Entry confirmation (line 441)

```pine
bool entryConfirmed = setupActive
                   and not tradeEntered
                   and confirmationWindowOpen
                   and bullishConfirmation
                   and zoneRiskAcceptable
                   and minimumTfsMet          -- ← required (second independent check)
                   and relativeVolume >= minimumRelativeVolume
```

`minimumTfsMet` appears again as a mandatory AND term. Even in the theoretical case where a setup persists from a prior bar (e.g., the HTF picture degraded after the zone was opened), entry is still gated on the **current** value of `minimumTfsMet`. The gate re-evaluates on every bar.

---

### Step 5 — Webhook fires only inside `if entryConfirmed` (lines 486–491)

```pine
if entryConfirmed
    ...
    if enableAlerts
        if enableMoeWebhook and str.length(moeWebhookSecret) > 0
            alert(webhookMsg, alert.freq_once_per_bar_close)
        else
            alert(simpleMsg, alert.freq_once_per_bar_close)
```

The webhook (and every non-webhook alert) is nested inside the `if entryConfirmed` block. There is no other call site for `alert()` that fires on a buy signal. No webhook can fire unless `entryConfirmed` is `true`, which requires `minimumTfsMet`, which requires `confluenceBullishCount >= minimumConfluentTfs`.

---

## Edge Case Walkthroughs

### Edge Case A — Exactly 2 of 4 HTFs bullish, score above threshold, price in buy zone

| Condition | Value |
|---|---|
| `confluenceBullishCount` | 2 |
| `minimumConfluentTfs` (default) | 3 |
| `minimumTfsMet` | **false** (2 < 3) |
| `opportunityReady` | **false** — Gate 1 blocks setup creation |
| `entryConfirmed` | **false** — Gate 2 blocks entry even on an existing setup |
| Webhook fires? | **No** |

The score can be elevated above the threshold (the score engine awards partial credit via `htfXmAcceptable`, lines 286–290), but the score is not consulted by `minimumTfsMet`. The count and the score are independent checks. A high score with only 2 bullish HTFs **does not** bypass the gate.

---

### Edge Case B — 3 HTFs acceptable but not bullish (0 fully bullish)

| Condition | Value |
|---|---|
| `htf5mBullish / htf15mBullish / htf1hBullish / htf4hBullish` | all `false` |
| `htf5mAcceptable / htf15mAcceptable / htf1hAcceptable / …` | 3 of 4 `true` |
| `confluenceBullishCount` | **0** (acceptable ≠ bullish) |
| `minimumTfsMet` | **false** (0 < 3) |
| `opportunityReady` | **false** — Gate 1 |
| `entryConfirmed` | **false** — Gate 2 |
| Webhook fires? | **No** |

`anyHtfAcceptable` (line 295) is satisfied when at least one HTF is acceptable, but this flag only unlocks the score contribution path. It does **not** substitute for `minimumTfsMet`. Both must be true for `opportunityReady`.

---

## Summary

The `minimumTfsMet` gate is enforced at **two independent points** in the signal chain:

1. **Setup creation** (`opportunityReady`, line 297) — prevents a buy zone from being drawn
2. **Entry confirmation** (`entryConfirmed`, line 441) — prevents a trade from being entered on any existing setup

Both gates check the live value of `minimumTfsMet` on every confirmed bar. The webhook is unreachable unless `entryConfirmed` is `true`. There is no code path that allows a BUY entry or alert when `confluenceBullishCount < minimumConfluentTfs`.

**Verdict: The confluence gate is sound. No false entry signal can fire when fewer than 3 HTFs are fully bullish.**
