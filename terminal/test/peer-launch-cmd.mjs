// Fake agent for peer-launch-files.test.mjs: prints its own argv, the
// peer-hook environment variable (a file path) and whether it inherited the launch link, then stays alive.
process.stdout.write(`ARGV_BEGIN${JSON.stringify(process.argv.slice(2))}ARGV_END\n`);
process.stdout.write(`ENV_BEGIN${JSON.stringify({ hook: process.env.VIBECODES_PEER_HOOK ?? null, launchUrl: process.env.BRIDGE_LAUNCH_URL ?? null })}ENV_END\n`);
process.stdout.write("READY\n");
process.stdin.on("data", (d) => process.stdout.write(d));
process.stdin.resume();
