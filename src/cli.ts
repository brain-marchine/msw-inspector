#!/usr/bin/env node

import { runCli } from './cli-main'

void runCli(process.argv).then((code) => {
  process.exitCode = code
})
