/**
 * A ToolError is an error the agent caused and can fix (bad path, stale version,
 * no match). Its message is sent back to the agent with isError: true, so it
 * must say what went wrong AND what to do next.
 *
 * Any other error is a bug in the server; those are reported as a short
 * "Internal error" without a stack trace.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
