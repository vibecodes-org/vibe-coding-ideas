// Windows stand-in for `sleep <mark>`: a node process that just stays alive.
// The mark is in its command line so tests can find exactly this process.
setInterval(() => {}, 1_000_000);
