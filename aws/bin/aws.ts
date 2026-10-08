#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import { NellieCamGitHubStack } from '../lib/nellie-cam-github-stack';
import { NellieCamStack } from '../lib/nellie-cam-stack';
import { NellieCamWebStack } from '../lib/nellie-cam-web-stack';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new NellieCamStack(app, 'NellieCamStack', { env });
new NellieCamGitHubStack(app, 'NellieCamGitHubStack', { env, repository: 'ChrisDobby@434389/nellie-cam@1388800070', branch: 'main' });

// The web stack deploys the built app, which needs NellieCamStack's outputs to build, so it only
// exists once the app has been built (scripts/deploy-app.sh).
const appDir = path.join(__dirname, '../../app');
const openNextDir = path.join(appDir, '.open-next');
const buildOutput = path.join(openNextDir, 'open-next.output.json');
if (fs.existsSync(buildOutput)) {
  const web = new NellieCamWebStack(app, 'NellieCamWebStack', { env, openNextDir, thingName: 'nellie-cam' });

  // Deploying an old build ships old code with this stack's current infrastructure. An error
  // blocks deploying this stack only, so NellieCamStack can still be deployed.
  const changed = changedSince(fs.statSync(buildOutput).mtimeMs);
  if (changed.length > 0) {
    cdk.Annotations.of(web).addError(
      `The app has changed since it was built (${changed.slice(0, 3).join(', ')}). ` +
      'Run ./scripts/deploy-app.sh to rebuild and deploy it.',
    );
  }
}

/** App source files, including its build-time env files, modified after `time`. */
function changedSince(time: number): string[] {
  const sources = [
    'app', 'components', 'lib', 'public',
    'proxy.ts', 'next.config.ts', 'open-next.config.ts', 'package.json', 'package-lock.json',
    '.env.local', '.env.production', '.env.production.local',
  ];
  return sources
    .map((source) => path.join(appDir, source))
    .filter((p) => fs.existsSync(p))
    .flatMap((p) => fs.statSync(p).isDirectory()
      ? fs.readdirSync(p, { recursive: true, encoding: 'utf8' }).map((f) => path.join(p, f))
      : [p])
    .filter((p) => fs.statSync(p).mtimeMs > time)
    .map((p) => path.relative(appDir, p));
}
