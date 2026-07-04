# Response Data Shapes (Recovered from Client Code)

This documents the contract between the server handlers (`lib/assistant.js`) and the browser client (`index.html`, `completions.html`). Any backend implementation must ensure the returned `data` matches these shapes exactly.

Source files: `index.html` (doPrompt, explainSelectedNodes, inline completions), `completions.html` (predict_next), `lib/assistant.js` (handlers).

---

## 1. Function Builder

**Route:** `POST /nr-assistant/function` (via `doPrompt` with `method: 'function'`)

**Request body:** `{ prompt, transactionId, context: { type, subType, scope: 'inline', modulesAllowed, codeSection } }`

**Response shape:**
```json
{
  "status": "ok",
  "data": {
    "transactionId": "<string>",
    "func": "<JavaScript code string>",
    "outputs": 1,
    "node_modules": ["lodash", "moment"]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `func` | string | ✅ | JavaScript function body code. Inserted into Monaco editor. |
| `outputs` | number | ❌ | Number of outputs. Updates `#node-input-outputs` field. |
| `node_modules` | string[] | ❌ | npm modules to add to the function node's setup. |

**Client code reference:** `index.html` line ~508-535 (doPrompt callback for function-builder)

---

## 2. JSON Generator

**Route:** `POST /nr-assistant/json`

**Request body:** `{ prompt, transactionId, context: { ... } }` (same pattern as function-builder)

**Response shape:**
```json
{
  "status": "ok",
  "data": {
    "transactionId": "<string>",
    "json": "<JSON string>"
  }
}
```

**Client code reference:** `index.html` line ~594-606

---

## 3. CSS Generator

**Route:** `POST /nr-assistant/css`

**Response shape:**
```json
{
  "status": "ok",
  "data": {
    "transactionId": "<string>",
    "css": "<CSS string>"
  }
}
```

**Client code reference:** `index.html` line ~655-668

---

## 4. HTML Generator

**Route:** `POST /nr-assistant/html`

**Response shape:**
```json
{
  "status": "ok",
  "data": {
    "transactionId": "<string>",
    "html": "<HTML string>"
  }
}
```

**Client code reference:** `index.html` line ~717-730

---

## 5. SQL Query Generator

**Route:** `POST /nr-assistant/sql-query`

**Response shape:**
```json
{
  "status": "ok",
  "data": {
    "transactionId": "<string>",
    "sql": "<SQL string>"
  }
}
```

**Client code reference:** `index.html` line ~781-800

---

## 6. FIM (Fill-in-the-Middle / Inline Completions)

**Route:** `POST /nr-assistant/fim/{nodeModule}/{nodeType}`

**Request body:** `{ prompt: "<prefix><|fim_completion|><suffix>", transactionId, context }`

**Response shape:** (double-nested — server does `{ data: JSON.parse(body) }` and backend returns `{ data: { fim_completion } }`)
```json
{
  "status": "ok",
  "data": {
    "data": {
      "fim_completion": "<code string>"
    }
  }
}
```
Or equivalently, the client accesses `res.data.data.fim_completion`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fim_completion` | string | ✅ | The completed code to insert at cursor. |

**Client code reference:** `index.html` line ~1009-1010 (`const responseData = res?.data?.data`)

---

## 7. Flow Explainer

**Route:** `POST /nr-assistant/mcp/prompts/explain_flow`

**Request body:** `{ transactionId, nodes: "<JSON string of flow>", flowName, userContext }`

**Response shape:**
```json
{
  "status": "ok",
  "data": "<markdown string>"
}
```

The `data` field is a **plain markdown string** (not an object). The client renders it as HTML via `RED.utils.renderMarkdown(text)`.

**Client code reference:** `index.html` line ~1513-1515 (`const text = reply.data`)

**Server note:** `handlePostPromptRequest` does `res.json({ status: 'ok', data: responseBody.data || responseBody })`. So if the backend returns `{ data: "markdown" }`, the client gets `data: "markdown"`. If the backend returns the markdown directly, the client also gets `data: "markdown"`.

---

## 8. Predict Next (Next-Node Autocomplete)

**Route:** `POST /nr-assistant/mcp/tools/predict_next`

**Local only** — no network call. Uses in-process MCP + ONNX.

**Response shape:**
```json
{
  "status": "ok",
  "data": {
    "tool": "predict_next",
    "transactionId": "<string>",
    "result": {
      "structuredContent": {
        "sourceId": "<node id>",
        "sourcePort": 0,
        "suggestions": [
          [{ "type": "debug" }],
          [{ "type": "mqtt out" }],
          [{ "type": "function" }]
        ]
      }
    }
  }
}
```

**Client code reference:** `completions.html` line ~350-362

---

## Common Patterns

### Transaction ID
Every request sends a `transactionId` and the client verifies it matches in the response. Always echo the `transactionId` back.

### Error Responses
```json
{ "status": "error", "message": "description of error" }
```
Or HTTP error status codes with the same JSON body. The `doPrompt` callback checks `reply?.error`.

### doPrompt Generic Flow
The `doPrompt` function in `index.html` is the generic entry point for method-based AI calls (function-builder, JSON, CSS, HTML, SQL). It:
1. Shows a prompt dialog
2. POSTs to `nr-assistant/{method}` with `{ prompt, transactionId, context }`
3. Checks `reply?.data?.transactionId === transactionId`
4. Passes `reply?.data` to the feature-specific callback
