# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Stacks

* `NellieCamStack`: the stream, the IoT thing, and sign-in for the viewer app
* `NellieCamWebStack`: hosting for the viewer app (`../app`). It only exists once the app has been
  built, because the build needs `NellieCamStack`'s outputs. Deploy it with
  `./scripts/deploy-app.sh`, after `npx cdk deploy NellieCamStack`.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy NellieCamStack`  deploy the stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
