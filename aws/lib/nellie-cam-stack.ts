import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as identitypool from 'aws-cdk-lib/aws-cognito-identitypool';
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

    // Sign-in for the viewer app. Users are created by an admin; there's no self sign-up.
    const userPool = new cognito.UserPool(this, 'ViewerUserPool', {
      userPoolName: 'nellie-cam-viewers',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient('ViewerAppClient', {
      userPoolClientName: 'nellie-cam-app',
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    // Signed-in users get temporary AWS credentials to watch the stream and start/stop it,
    // so the app needs no server or stored AWS keys.
    const viewerIdentityPool = new identitypool.IdentityPool(this, 'ViewerIdentityPool', {
      identityPoolName: 'nellie-cam-viewers',
      allowUnauthenticatedIdentities: false,
      authenticationProviders: {
        userPools: [new identitypool.UserPoolAuthenticationProvider({ userPool, userPoolClient })],
      },
    });
    viewerIdentityPool.authenticatedRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'kinesisvideo:GetDataEndpoint',
        'kinesisvideo:GetHLSStreamingSessionURL',
        'kinesisvideo:GetHLSMasterPlaylist',
        'kinesisvideo:GetHLSMediaPlaylist',
        'kinesisvideo:GetMP4InitFragment',
        'kinesisvideo:GetMP4MediaFragment',
        'kinesisvideo:GetTSFragment',
      ],
      resources: [stream.attrArn],
    }));
    viewerIdentityPool.authenticatedRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['iot:GetThingShadow', 'iot:UpdateThingShadow'],
      resources: [iotArn(`thing/${thingName}`)],
    }));

    new cdk.CfnOutput(this, 'StreamName', { value: stream.name! });
    new cdk.CfnOutput(this, 'StreamArn', { value: stream.attrArn });
    new cdk.CfnOutput(this, 'ThingName', { value: thing.thingName! });
    new cdk.CfnOutput(this, 'DevicePolicyName', { value: devicePolicy.policyName! });
    new cdk.CfnOutput(this, 'StreamerRoleAliasName', { value: roleAlias.roleAlias! });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: viewerIdentityPool.identityPoolId });
  }
}
