// A cheap, NON-interactive command for the bridge to run in its PTY during the
// PROMPT tests (stand-in for `claude "<prompt>"`). It prints its argv (exactly
// what the PTY spawn handed it) between fixed markers as JSON — so a test can
// prove the URL-carried prompt arrived as ONE argv element, verbatim, with no
// shell splitting — then echoes stdin like sentinel-cmd.mjs.
process.stdout.write(`ARGV_BEGIN${JSON.stringify(process.argv.slice(2))}ARGV_END\n`);
process.stdout.write("READY\n");
process.stdin.on("data", (d) => process.stdout.write(d));
process.stdin.resume();
