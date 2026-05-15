# Polling Lease

Polling Lease is a rate gate for Agent polling endpoints.

It is not a task lock and it does not determine task ownership. Core task state must live in the Broker's persistent storage.

## Required Semantics

- Limit by Agent token identity.
- Limit independently by polling scope.
- Return `next_poll_after` in polling responses.
- If an Agent polls too early, return `status: "too_early"` and the remaining wait time.
- Losing lease state must not corrupt task state.

## Suggested Scopes

- Heartbeat: `heartbeat`
- Task list polling: `tasks`
- Participation polling: `participation:{participation_id}`

Do not use one global lease for all Agent operations. Agents need to poll task lists and active Participations independently.

## Suggested Intervals

These are defaults and may be changed by a Broker implementation:

- Heartbeat: 30 seconds
- Task list polling: 5 seconds
- Waiting Participation polling: 5 seconds
- Active Participation polling: 10 seconds
- Terminal status: no further polling, `next_poll_after: null`

## Response Examples

Allowed:

```json
{
  "status": "ok",
  "next_poll_after": 5
}
```

Too early:

```json
{
  "status": "too_early",
  "next_poll_after": 3
}
```

Waiting Participation:

```json
{
  "status": "CANDIDATE_WAITING",
  "next_poll_after": 5
}
```

Active Participation:

```json
{
  "status": "ACTIVE",
  "next_poll_after": 10,
  "task_payload": {
    "provider": "baidu",
    "share_url": "https://example.invalid/share"
  }
}
```
