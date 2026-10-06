import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as kinesisvideo from 'aws-cdk-lib/aws-kinesisvideo';
import { Construct } from 'constructs';

export class NellieCamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stream = new kinesisvideo.CfnStream(this, 'LiveStream', {
      name: 'nellie-cam-live',
      dataRetentionInHours: 24,
    });

    // The Pi's certificate is created from a CSR generated on the Pi (scripts/register-device-cert.sh),
    // so the private key never leaves the device and isn't in stack state. The certificate is used to
    // connect to IoT (to watch the device shadow) and to get temporary AWS credentials for streaming.
    const thingName = 'nellie-cam';
    const thing = new iot.CfnThing(this, 'CameraThing', { thingName });

    // Assumed through the IoT credentials provider, so the Pi holds no long-lived AWS keys.
    const streamerRole = new iam.Role(this, 'StreamerRole', {
      roleName: 'nellie-cam-streamer',
      assumedBy: new iam.ServicePrincipal('credentials.iot.amazonaws.com'),
    });
    streamerRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'kinesisvideo:DescribeStream',
        'kinesisvideo:GetDataEndpoint',
        'kinesisvideo:PutMedia',
      ],
      resources: [stream.attrArn],
    }));

    const roleAlias = new iot.CfnRoleAlias(this, 'StreamerRoleAlias', {
      roleAlias: 'nellie-cam-streamer',
      roleArn: streamerRole.roleArn,
      credentialDurationSeconds: 3600,
    });

    const iotArn = (resource: string) =>
      cdk.Arn.format({ service: 'iot', resource, arnFormat: cdk.ArnFormat.NO_RESOURCE_NAME }, this);
    const shadowTopic = `$aws/things/${thingName}/shadow`;

    const devicePolicy = new iot.CfnPolicy(this, 'CameraDevicePolicy', {
      policyName: 'nellie-cam-device',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: iotArn(`client/${thingName}`),
          },
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: [
              iotArn(`topic/${shadowTopic}/get`),
              iotArn(`topic/${shadowTopic}/update`),
            ],
          },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: [
              iotArn(`topicfilter/${shadowTopic}/get/*`),
              iotArn(`topicfilter/${shadowTopic}/update/*`),
            ],
          },
          {
            Effect: 'Allow',
            Action: 'iot:Receive',
            Resource: [
              iotArn(`topic/${shadowTopic}/get/*`),
              iotArn(`topic/${shadowTopic}/update/*`),
            ],
          },
          {
            Effect: 'Allow',
            Action: 'iot:AssumeRoleWithCertificate',
            Resource: roleAlias.attrRoleAliasArn,
          },
        ],
      },
    });

    new cdk.CfnOutput(this, 'StreamName', { value: stream.name! });
    new cdk.CfnOutput(this, 'StreamArn', { value: stream.attrArn });
    new cdk.CfnOutput(this, 'ThingName', { value: thing.thingName! });
    new cdk.CfnOutput(this, 'DevicePolicyName', { value: devicePolicy.policyName! });
    new cdk.CfnOutput(this, 'StreamerRoleAliasName', { value: roleAlias.roleAlias! });
  }
}
