// Facts that the landing page and the guide both state. Keep them here so the two
// can never disagree. No "use client" line: server components import this.

/** Must equal the number of tools the MCP server registers (a unit test checks it). */
export const MCP_TOOL_COUNT = 90;

// Always the production address: this is the command a visitor should run.
export const INSTALL_COMMAND =
  "claude mcp add -s user --transport http vibecodes https://vibecodes.co.uk/api/mcp";
