import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NellieCamStack } from '../lib/nellie-cam-stack';

const template = Template.fromStack(new NellieCamStack(new cdk.App(), 'TestStack'));

test('creates the nellie-cam-live stream', () => {
  template.hasResourceProperties('AWS::KinesisVideo::Stream', {
    Name: 'nellie-cam-live',
  });
});

test('streaming credentials come from an IoT role alias, not an IAM user', () => {
  template.resourceCountIs('AWS::IAM::User', 0);
  template.resourceCountIs('AWS::IAM::AccessKey', 0);

  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'nellie-cam-streamer',
    AssumeRolePolicyDocument: {
      Statement: [
        { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'credentials.iot.amazonaws.com' } },
      ],
    },
  });

  template.hasResourceProperties('AWS::IoT::RoleAlias', {
    RoleAlias: 'nellie-cam-streamer',
    RoleArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('StreamerRole'), 'Arn'] },
    CredentialDurationSeconds: 3600,
  });
});

test('streamer role can only put media to that stream', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    Roles: [{ Ref: Match.stringLikeRegexp('StreamerRole') }],
    PolicyDocument: {
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'kinesisvideo:DescribeStream',
            'kinesisvideo:GetDataEndpoint',
            'kinesisvideo:PutMedia',
          ],
          Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('LiveStream'), 'Arn'] },
        },
      ],
    },
  });
});

test('creates the nellie-cam IoT thing', () => {
  template.hasResourceProperties('AWS::IoT::Thing', { ThingName: 'nellie-cam' });
  // The device certificate is registered from a CSR made on the Pi, never in CDK.
  template.resourceCountIs('AWS::IoT::Certificate', 0);
});

test('device policy only allows its own shadow and the streamer role alias', () => {
  const iotArn = (resource: string) => ({
    'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iot:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, `:${resource}`]],
  });
  const shadow = '$aws/things/nellie-cam/shadow';

  template.hasResourceProperties('AWS::IoT::Policy', {
    PolicyName: 'nellie-cam-device',
    PolicyDocument: {
      Statement: [
        { Effect: 'Allow', Action: 'iot:Connect', Resource: iotArn('client/nellie-cam') },
        { Effect: 'Allow', Action: 'iot:Publish', Resource: [iotArn(`topic/${shadow}/get`), iotArn(`topic/${shadow}/update`)] },
        { Effect: 'Allow', Action: 'iot:Subscribe', Resource: [iotArn(`topicfilter/${shadow}/get/*`), iotArn(`topicfilter/${shadow}/update/*`)] },
        { Effect: 'Allow', Action: 'iot:Receive', Resource: [iotArn(`topic/${shadow}/get/*`), iotArn(`topic/${shadow}/update/*`)] },
        {
          Effect: 'Allow',
          Action: 'iot:AssumeRoleWithCertificate',
          Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('StreamerRoleAlias'), 'RoleAliasArn'] },
        },
      ],
    },
  });
});
