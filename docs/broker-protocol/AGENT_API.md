# Agent API

All Agent requests use:

```http
Authorization: Bearer <agent_token>
```

Error responses should use JSON with at least:

```json
{
  "code": "ERROR_CODE",
  "message": "Human readable message"
}
```

Polling responses should include `next_poll_after` in seconds. Terminal states may return `next_poll_after: null`.

## Heartbeat

```http
POST /api/lc/agent/heartbeat
```

Request:

```json
{
  "available": true,
  "capabilities": {
    "providers": ["baidu"],
    "max_file_size": 0,
    "daily_remaining_bytes": 53687091200,
    "daily_remaining_tasks": 20
  },
  "client_version": "0.0.0"
}
```

Response:

```json
{
  "status": "ok",
  "next_poll_after": 30
}
```

If the Agent polls too early:

```json
{
  "status": "too_early",
  "next_poll_after": 3
}
```

## Poll Task Summaries

```http
GET /api/lc/agent/tasks?limit=20
```

Rules:

- Return only tasks that are open for participation.
- Do not return share URL, password, directory, file name, or other real task payload.
- `capabilities.max_file_size` is optional. Missing, `null`, or `0` means the Agent does not declare a maximum file-size limit.

Response:

```json
{
  "status": "ok",
  "next_poll_after": 5,
  "tasks": [
    {
      "task_id": "uuid",
      "provider": "baidu",
      "file_size": 5368709120,
      "price": 100,
      "primary_reward": 40,
      "secondary_pool": 10,
      "tax": 50,
      "max_candidates": 3,
      "apply_deadline": "2026-05-13T12:00:00Z",
      "blocking_timeout_seconds": 10,
      "parse_timeout_seconds": 30
    }
  ]
}
```

## Participate In Task

```http
POST /api/lc/agent/tasks/:task_id/participations
```

Request body may be an empty JSON object.

Rules:

- The task must be in `APPLYING`.
- The apply window must still be open.
- The task participation limit must not be full.
- The same Agent can have only one Participation per task.
- Repeated calls should return the existing Participation.

Response:

```json
{
  "participation_id": "uuid",
  "task_id": "uuid",
  "status": "APPLIED",
  "next_poll_after": 5
}
```

## Poll Participation

```http
GET /api/lc/agent/participations/:participation_id
```

The Participation must belong to the authenticated Agent.

Waiting response:

```json
{
  "status": "APPLIED",
  "next_poll_after": 5
}
```

Not selected response:

```json
{
  "status": "NOT_SELECTED",
  "next_poll_after": null
}
```

Active response:

```json
{
  "status": "ACTIVE",
  "next_poll_after": 10,
  "task_payload": {
    "provider": "baidu",
    "share_url": "https://example.invalid/share",
    "password": "",
    "dir": "/",
    "file_id": "file-id",
    "file_name": "demo.bin",
    "file_size": 5368709120,
    "file_size_bytes": 5368709120
  },
  "activated_at": "2026-05-13T12:01:00Z",
  "blocking_deadline": "2026-05-13T12:01:30Z",
  "parse_deadline": "2026-05-13T12:03:00Z"
}
```

If a primary result already exists but this Participation is still active and before its parse deadline:

```json
{
  "status": "ACTIVE",
  "task_status": "PRIMARY_COMPLETED",
  "allow_secondary_submit": true,
  "next_poll_after": 10,
  "task_payload": {
    "provider": "baidu",
    "share_url": "https://example.invalid/share",
    "password": "",
    "dir": "/",
    "file_id": "file-id",
    "file_name": "demo.bin",
    "file_size": 5368709120,
    "file_size_bytes": 5368709120
  },
  "parse_deadline": "2026-05-13T12:03:00Z"
}
```

## Submit Result

```http
POST /api/lc/agent/participations/:participation_id/submit
```

Success request:

```json
{
  "type": "success",
  "result_url": "https://example.invalid/download",
  "expires_at": "2026-05-13T12:30:00Z",
  "headers": {
    "User-Agent": "..."
  },
  "note": ""
}
```

Failure request:

```json
{
  "type": "failure",
  "failure_code": "INVALID_SHARE_LINK",
  "note": "share expired"
}
```

Rules:

- The Participation must belong to the authenticated Agent.
- The Participation must be `ACTIVE`.
- The submission must arrive before `parse_deadline`.
- A Participation can submit only once.
- Success may become `primary` or `secondary`.
- Failure receives no reward.

Accepted responses:

```json
{
  "status": "accepted",
  "submission_role": "primary"
}
```

```json
{
  "status": "accepted",
  "submission_role": "secondary"
}
```

```json
{
  "status": "accepted",
  "submission_role": "none"
}
```
