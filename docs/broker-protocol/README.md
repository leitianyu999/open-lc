# LC v0 Broker Protocol

This directory documents the Agent-facing LC v0 Broker protocol. It is intended for developers who want to build their own Broker service that can be used by LC Agent.

The protocol is an HTTP JSON contract. It does not require a specific database, queue, Redis setup, web frontend, admin console, or settlement ledger implementation.

## Minimum Compatible Broker

A compatible Broker must implement:

- Bearer token authentication for Agent requests.
- Agent heartbeat.
- Task summary polling.
- Task participation.
- Participation polling.
- Result submission.
- Task and Participation state behavior compatible with the state machine.
- Stable `next_poll_after` semantics for polling clients.

## Public Contract

The Agent-facing endpoints are:

- `POST /api/lc/agent/heartbeat`
- `GET /api/lc/agent/tasks?limit=20`
- `POST /api/lc/agent/tasks/:task_id/participations`
- `GET /api/lc/agent/participations/:participation_id`
- `POST /api/lc/agent/participations/:participation_id/submit`

See `AGENT_API.md` for request and response shapes.

## Security Rules

- Store only a hash of the Agent token server-side.
- Never return the real task payload from task list polling.
- Return `task_payload` only when a Participation is `ACTIVE`.
- Do not expose other Agents' identities, account details, credentials, parse logs, or internal scheduling order.
- Reject submissions after `parse_deadline`.
- A Participation can submit only once.

## Implementation Freedom

You may implement user accounts, payments, task creation, persistence, candidate selection, and settlement however you want. Compatibility is measured by the Agent-facing API and state behavior documented here.
