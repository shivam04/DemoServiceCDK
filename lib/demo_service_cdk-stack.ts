import { Stack, StackProps, Stage} from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer, ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CodeBuildStep, CodePipeline, CodePipelineSource } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class DemoServiceCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // vpc
    const vpc = new Vpc(this, "DemoServiceVpc", {
      maxAzs: 3
    });

    // cluster
    const cluster = new Cluster(this, "DemoServiceCluster", { vpc });

    // ECR repository for Docker images
    const repository = new Repository(this, 'DemoServiceRepository');

    // Define ECS Task Definition
    const taskDefinition = new FargateTaskDefinition(this, 'DemoServiceTaskDef');

    const container = taskDefinition.addContainer('DemoServiceContainer', {
      image: ContainerImage.fromEcrRepository(repository),
      memoryLimitMiB: 512,
      cpu: 256,
    });

    container.addPortMappings({
      containerPort: 8080,
    });

    const loadBalancer = new ApplicationLoadBalancer(this, 'DemoServiceALB', {
      vpc,
      internetFacing: true,
    });

    const listener = loadBalancer.addListener('Listener', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
    });

    // Create Fargate service in ECS
    const service = new FargateService(this, 'DemoServiceFargateService', {
      cluster,
      taskDefinition,
    });

    listener.addTargets('DemoServiceTarget', {
      port: 80,
      targets: [service],
    });

    // IAM Role for CodeBuild to allow pushing Docker images to ECR
    const codeBuildRole = new Role(this, 'CodeBuildRole', {
      assumedBy: new ServicePrincipal('codebuild.amazonaws.com'),
    });

    codeBuildRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'));

    // CodePipeline for CI/CD
    const pipeline = new CodePipeline(this, 'DemoServicePipeline', {
      pipelineName: 'SpringBootPipeline',
      synth: new CodeBuildStep('SynthStep', {
        input: CodePipelineSource.gitHub('shivam04/DemoServiceSpringBoot', 'main'), // GitHub repo
        commands: ['npm install -g aws-cdk', 'cdk synth'],
      }),
      role: codeBuildRole
    });

    // CodeBuild step to build Docker image and push to ECR
    const buildStep = new CodeBuildStep('DemoServiceBuildStep', {
      input: pipeline.synth, 
      commands: [
        'echo Logging in to Amazon ECR...',
        'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com',
        'docker build -t springboot-app .',
        'docker tag springboot-app:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/springboot-app:latest',
        'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/springboot-app:latest',
      ]
    });

    const stage = pipeline.addStage(new Stage(this, "BuildAndDeploy", {
      stageName: "BuildAndDeploy"
    }));

    stage.addPost(buildStep);
  }
}
