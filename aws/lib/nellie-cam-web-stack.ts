import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface NellieCamWebStackProps extends cdk.StackProps {
  /** The viewer app's `.open-next` directory, from `npx open-next build`. */
  openNextDir: string;
  /** The camera's IoT thing, whose shadow the app reads and updates to start and stop it. */
  thingName: string;
}

/**
 * Hosts the viewer app, built with OpenNext: CloudFront in front of a Lambda for server rendering
 * and Server Functions, and S3 for static files. The app's configuration (the NellieCamStack
 * outputs) is built into it, so this is a separate stack, deployed after the app is built.
 */
export class NellieCamWebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NellieCamWebStackProps) {
    super(scope, id, props);

    const { openNextDir, thingName } = props;
    const output = JSON.parse(fs.readFileSync(path.join(openNextDir, 'open-next.output.json'), 'utf8'));

    // Static files under _assets/, and prerendered pages under _cache/ for OpenNext's S3
    // incremental cache. Everything in it comes from the build, so it can be recreated.
    const bucket = new s3.Bucket(this, 'AssetsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Besides reading the bucket, the function can only use the camera's shadow. Kinesis calls use
    // the signed-in user's credentials from the identity pool.
    const server = new lambda.Function(this, 'ServerFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: output.origins.default.handler,
      code: lambda.Code.fromAsset(path.join(openNextDir, 'server-functions/default')),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment: {
        CACHE_BUCKET_NAME: bucket.bucketName,
        CACHE_BUCKET_KEY_PREFIX: '_cache',
        CACHE_BUCKET_REGION: this.region,
      },
    });
    bucket.grantRead(server);
    server.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iot:GetThingShadow', 'iot:UpdateThingShadow'],
      resources: [cdk.Arn.format({ service: 'iot', resource: 'thing', resourceName: thingName }, this)],
    }));

    // Public, because CloudFront can't sign POST bodies (Server Functions) for an IAM-authorized
    // URL. Calling it directly gets you nothing CloudFront doesn't: the app checks the session
    // before every shadow call.
    const serverUrl = server.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // Function URLs need their own Host header, so CloudFront can't forward the viewer's. Next
    // checks a Server Function's Origin against the host, and OpenNext takes the host from
    // x-forwarded-host.
    const forwardHost = new cloudfront.Function(this, 'ForwardHostFunction', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.headers['x-forwarded-host'] = { value: request.headers.host.value };
  return request;
}`),
    });

    const assetsOrigin = origins.S3BucketOrigin.withOriginAccessControl(bucket, { originPath: '/_assets' });
    const assetBehavior: cloudfront.BehaviorOptions = {
      origin: assetsOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    };
    // Files at the top of assets/ (_next/, favicon.ico, ...) come from S3; OpenNext lists them.
    const assetPatterns: string[] = output.behaviors
      .filter((b: { origin: string }) => b.origin === 's3')
      .map((b: { pattern: string }) => b.pattern);

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'nellie-cam viewer',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(serverUrl),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Server Functions are POSTs, and every page is per-user, so nothing is cached and the
        // session cookies and Next's RSC headers all reach the function.
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [{ function: forwardHost, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: Object.fromEntries(assetPatterns.map((pattern) => [pattern, assetBehavior])),
    });

    const assetsDir = path.join(openNextDir, 'assets');
    // Hashed build files. Old builds' files are kept, so tabs open during a deploy still load.
    new s3deploy.BucketDeployment(this, 'DeployNextAssets', {
      sources: [s3deploy.Source.asset(path.join(assetsDir, '_next'))],
      destinationBucket: bucket,
      destinationKeyPrefix: '_assets/_next',
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public,max-age=31536000,immutable')],
    });
    new s3deploy.BucketDeployment(this, 'DeployPublicAssets', {
      sources: [s3deploy.Source.asset(assetsDir, { exclude: ['_next', '_next/**'] })],
      destinationBucket: bucket,
      destinationKeyPrefix: '_assets',
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public,max-age=0,s-maxage=31536000,must-revalidate')],
      distribution,
      distributionPaths: ['/*'],
    });
    new s3deploy.BucketDeployment(this, 'DeployCache', {
      sources: [s3deploy.Source.asset(path.join(openNextDir, 'cache'))],
      destinationBucket: bucket,
      destinationKeyPrefix: '_cache',
    });

    new cdk.CfnOutput(this, 'Url', { value: `https://${distribution.distributionDomainName}` });
  }
}
