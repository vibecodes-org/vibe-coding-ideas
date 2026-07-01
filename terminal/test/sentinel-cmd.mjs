// A cheap, NON-interactive command for the bridge to run in its PTY during
// tests (stand-in for `claude`). It prints a known sentinel, then echoes back
// anything it receives on stdin — letting the test prove bytes flow both ways
// through the relay without launching interactive `claude` (which could hang).
process.stdout.write("READY\n");
process.stdin.on("data", (d) => process.stdout.write(d));
process.stdin.resume();
