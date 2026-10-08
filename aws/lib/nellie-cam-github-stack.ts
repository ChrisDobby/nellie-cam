import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface NellieCamGitHubStackProps extends cdk.StackProps {
  /**
   * The GitHub repository whose workflow deploys, as it appears in its OIDC tokens' `sub` claim.
   * With immutable subjects that's `owner@ownerId/name@repoId`, so a repository that later takes
   * the same name can't deploy; see `gh api repos/OWNER/REPO/actions/oidc/customization/sub`.
   */
  repository: string;
  /** The only branch whose workflow runs can deploy. */
  branch: string;
}

/**
 * Lets the GitHub Actions deploy workflow (.github/workflows/deploy.yml) deploy the other stacks,
 * with short-lived credentials from GitHub's OIDC provider rather than stored AWS keys.
 *
 * Deployed by hand, not by the workflow, so the workflow can't change who may assume its role.
 */
export class NellieCamGitHubStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NellieCamGitHubStackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'nellie-cam-github-deploy',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.repository}:ref:refs/heads/${props.branch}`,
        },
      }),
    });

    // CDK deploys through the roles created by `cdk bootstrap`, so this role only needs to assume
    // them, plus what scripts/deploy-app.sh reads to build the app.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStacks'],
      resources: [cdk.Arn.format({ service: 'cloudformation', resource: 'stack', resourceName: 'NellieCamStack/*' }, this)],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['iot:DescribeEndpoint'],
      resources: ['*'],
    }));

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
