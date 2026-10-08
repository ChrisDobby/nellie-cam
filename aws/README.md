# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Stacks

* `NellieCamStack`: the stream, the IoT thing, and sign-in for the viewer app
* `NellieCamWebStack`: hosting for the viewer app (`../app`). It only exists once the app has been
  built, because the build needs `NellieCamStack`'s outputs. Deploy it with
  `./scripts/deploy-app.sh`, after `npx cdk deploy NellieCamStack`.
* `NellieCamGitHubStack`: the role the GitHub Actions workflow deploys with. Deployed by hand.

## Deploying from GitHub Actions

`.github/workflows/deploy.yml` checks every pull request, and deploys `NellieCamStack` and
`NellieCamWebStack` on every push to `main`. To set it up, once:

1. `npx cdk deploy NellieCamGitHubStack`. It creates GitHub's OIDC provider in the account and a
   role that only this repository's `main` branch can assume, so no AWS keys are stored in GitHub.
2. Set the repository variable `AWS_DEPLOY_ROLE_ARN` to the stack's `DeployRoleArn` output:

   ```sh
   gh variable set AWS_DEPLOY_ROLE_ARN --body <DeployRoleArn>
   ```

The role deploys through the `cdk bootstrap` roles, which can change anything in the account, so
anyone who can push to `main` can too. Protect `main` so changes reach it through reviewed pull
requests.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy NellieCamStack`  deploy the stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
