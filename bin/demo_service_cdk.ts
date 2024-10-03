#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DemoServiceCdkStack } from '../lib/demo_service_cdk-stack';

const app = new cdk.App();
new DemoServiceCdkStack(app, 'DemoServiceCdkStack', {});
app.synth();