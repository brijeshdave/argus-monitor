---
title: Uptime, reports & logs
order: 60
---

## Uptime & SLA

The **Uptime** page shows availability history and SLA percentages over time,
derived from the durable event log — so the numbers reflect what actually happened,
not a sampled guess.

## Reports

Generate operational **reports** for a chosen period and export them for sharing
with stakeholders.

## Notifications

Status changes raise **notifications** (for example a critical transition to DOWN).
Acknowledge them to track who is handling what.

## Logs & events

Every status change and client connect/disconnect produces a durable **event** row.
The live dashboard is derived from current state, but the event log is the
authoritative history.

The **Logs** page shows collected, categorised logs (including scan activity and
agent debug output) with filtering, so you can investigate incidents after the fact.
Administrative changes are additionally recorded in the **Audit** trail with a
field-level before→after diff.
