#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import { NellieCamStack } from '../lib/nellie-cam-stack';
import { NellieCamWebStack } from '../lib/nellie-cam-web-stack';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new NellieCamStack(app, 'NellieCamStack', { env });

// The web stack deploys the built app, which needs NellieCamStack's outputs to build, so it only
// exists once the app has been built (scripts/deploy-app.sh).
const openNextDir = path.join(__dirname, '../../app/.open-next');
if (fs.existsSync(path.join(openNextDir, 'open-next.output.json'))) {
  new NellieCamWebStack(app, 'NellieCamWebStack', { env, openNextDir, thingName: 'nellie-cam' });
}
