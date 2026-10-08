import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NellieCamWebStack } from '../lib/nellie-cam-web-stack';

// A minimal stand-in for the app's `npx open-next build` output.
const openNextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-next-'));
for (const dir of ['assets/_next/static', 'cache', 'server-functions/default']) {
  fs.mkdirSync(path.join(openNextDir, dir), { recursive: true });
}
fs.writeFileSync(path.join(openNextDir, 'assets/favicon.ico'), '');
fs.writeFileSync(path.join(openNextDir, 'server-functions/default/index.mjs'), '');
fs.writeFileSync(path.join(openNextDir, 'open-next.output.json'), JSON.stringify({
  origins: { default: { handler: 'index.handler' } },
  behaviors: [
    { pattern: '*', origin: 'default' },
    { pattern: '_next/*', origin: 's3' },
    { pattern: 'favicon.ico', origin: 's3' },
  ],
}));

const template = Template.fromStack(new NellieCamWebStack(new cdk.App(), 'TestWebStack', { openNextDir, thingName: 'nellie-cam' }));

test('server function can only read the assets bucket and use the camera shadow', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: { Roles: [{ Ref: Match.stringLikeRegexp('ServerFunction') }] },
  });
  const statements = Object.values(policies).flatMap((p) => p.Properties.PolicyDocument.Statement);
  const actions = statements.flatMap((s: { Action: string | string[] }) => [s.Action].flat());
  expect(actions.filter((a) => !a.startsWith('s3:'))).toEqual(['iot:GetThingShadow', 'iot:UpdateThingShadow']);
  expect(actions.filter((a) => a.startsWith('s3:')).length).toBeGreaterThan(0);

  template.hasResourceProperties('AWS::IAM::Policy', {
    Roles: [{ Ref: Match.stringLikeRegexp('ServerFunction') }],
    PolicyDocument: {
      Statement: Match.arrayWith([{
        Effect: 'Allow',
        Action: ['iot:GetThingShadow', 'iot:UpdateThingShadow'],
        Resource: {
          'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iot:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':thing/nellie-cam']],
        },
      }]),
    },
  });
});

test('Server Functions reach the server: POSTs allowed, nothing cached, host forwarded', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      DefaultCacheBehavior: {
        AllowedMethods: Match.arrayWith(['POST']),
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
        OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader
        FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
      },
    },
  });
  template.hasResourceProperties('AWS::CloudFront::Function', {
    FunctionCode: Match.stringLikeRegexp('x-forwarded-host'),
  });
});

test('static files come from S3 at the paths OpenNext lists', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      CacheBehaviors: [
        Match.objectLike({ PathPattern: '_next/*' }),
        Match.objectLike({ PathPattern: 'favicon.ico' }),
      ],
    },
  });
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true },
  });
});
