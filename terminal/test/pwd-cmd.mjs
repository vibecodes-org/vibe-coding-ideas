// A cheap, NON-interactive stand-in for `claude` in the folder tests (card
// 6b2cb8ac): prints the folder it was started in between fixed markers, then
// echoes stdin like sentinel-cmd.mjs, so a test can prove WHERE the agent ran.
process.stdout.write(`PWD_BEGIN${process.cwd()}PWD_END\n`);
process.stdout.write("READY\n");
process.stdin.on("data", (d) => process.stdout.write(d));
process.stdin.resume();
