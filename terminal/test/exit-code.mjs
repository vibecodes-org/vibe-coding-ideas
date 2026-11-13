// Stand-in agent that just exits with the code it is given (the Windows twin of `sh -c 'exit N'`).
process.exit(Number(process.argv[2] ?? 0));
