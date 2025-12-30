# opencode-debug-helper

OpenCode plugin for Cursor-style debug mode. Automated project detection, instrumentation-based debugging, and root cause analysis.

## Installation

```bash
# In your project directory
npx opencode-debug-helper setup
```

This adds the plugin to your `.opencode/config.json`:

```json
{
  "plugins": ["opencode-debug-helper"]
}
```

## Usage

Start debug mode with the `/debug` command in OpenCode:

```
/debug
```

The debug-helper agent will:
1. Detect your project type and run commands
2. Start your application in background
3. Guide you through instrumenting suspected code
4. Help reproduce and capture the bug
5. Analyze logs and identify root cause
6. Apply fix and clean up

## Tools

### Project Detection

| Tool | Description |
|------|-------------|
| `project_detector` | Detects project type (Node/Python/Rust/Go), package manager, framework, and run commands |

### Instrumentation

| Tool | Description |
|------|-------------|
| `add_instrumentation` | Insert debug logging at a specific line with a unique marker |
| `remove_instrumentation` | Remove a marker by ID |
| `list_instrumentation` | List all active markers in session |
| `remove_all_instrumentation` | Clean up all markers |
| `scan_file_instrumentation` | Find existing markers in a file |

### Log Analysis

| Tool | Description |
|------|-------------|
| `parse_logs` | Extract errors, warnings, and debug output from log content |
| `extract_debug_values` | Parse DEBUG-HELPER marker output into structured data |
| `correlate_logs` | Map log output to instrumentation markers |

### Process Management

| Tool | Description |
|------|-------------|
| `start_process` | Start application in background with output capture |
| `stop_process` | Stop a running debug process |
| `capture_output` | Get recent stdout/stderr with optional filter |
| `list_processes` | List all running debug processes |

## Marker Format

Instrumentation markers are language-specific:

**JavaScript/TypeScript:**
```javascript
// [DEBUG-HELPER:abc123] START
console.log("[abc123] before fetch:", requestData);
// [DEBUG-HELPER:abc123] END
```

**Python:**
```python
# [DEBUG-HELPER:abc123] START
print(f"[abc123] before fetch: {request_data}")
# [DEBUG-HELPER:abc123] END
```

**Rust:**
```rust
// [DEBUG-HELPER:abc123] START
println!("[abc123] before fetch: {:?}", request_data);
// [DEBUG-HELPER:abc123] END
```

**Go:**
```go
// [DEBUG-HELPER:abc123] START
fmt.Printf("[abc123] before fetch: %+v\n", requestData)
// [DEBUG-HELPER:abc123] END
```

## Configuration

Optional config in `.opencode/debug-helper.json`:

```json
{
  "models": {
    "analyzer": "google/gemini-3-flash",
    "rca": "google/gemini-3-flash"
  }
}
```

## Session Data

Debug sessions are stored in `/tmp/opencode-debug-helper/{session_id}/`:
- `session.json` - Markers, logs, RCA history
- Log files captured during debugging

## Workflow Example

```
User: /debug
Agent: I'll detect your project configuration...
       [runs project_detector]
       Found: Node.js project with npm, entry: src/index.js
       Starting your app...
       [runs start_process]
       
User: The /users API returns 500 sometimes
Agent: I'll add instrumentation to trace the issue.
       [runs add_instrumentation on routes/users.js]
       Please trigger the bug.

User: Done, made a request
Agent: [runs capture_output with filter="DEBUG-HELPER"]
       I see the error occurs when user.email is undefined.
       [spawns debug-helper:rca agent]
       
       Root cause: Missing null check on line 42.
       Applying fix...
       [runs edit]
       
       Cleaning up instrumentation...
       [runs remove_all_instrumentation, stop_process]
       
       Fixed! The null check prevents the 500 error.
```

## Development

```bash
yarn build      # Compile TypeScript
yarn dev        # Watch mode
yarn typecheck  # Type check without emit
```

## License

MIT
