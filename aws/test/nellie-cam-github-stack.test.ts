import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NellieCamGitHubStack } from '../lib/nellie-cam-github-stack';

const template = Template.fromStack(new NellieCamGitHubStack(new cdk.App(), 'TestGitHubStack', {
  repository: 'chrisdobby/nellie-cam',
  branch: 'main',
}));

test('only the main branch of the repository can assume the deploy role', () => {
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'nellie-cam-github-deploy',
    AssumeRolePolicyDocument: {
      Statement: [{
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: { Federated: Match.anyValue() },
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': 'repo:chrisdobby/nellie-cam:ref:refs/heads/main',
          },
        },
      }],
    },
  });
});

test('deploy role can only assume the CDK bootstrap roles and read what the build needs', () => {
  const policies = Object.values(template.findResources('AWS::IAM::Policy'));
  const actions = policies
    .flatMap((p) => p.Properties.PolicyDocument.Statement)
    .flatMap((s: { Action: string | string[] }) => [s.Action].flat());
  expect(actions.sort()).toEqual(['cloudformation:DescribeStacks', 'iot:DescribeEndpoint', 'sts:AssumeRole']);
});
