#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { NellieCamStack } from '../lib/nellie-cam-stack';

const app = new cdk.App();
new NellieCamStack(app, 'NellieCamStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
