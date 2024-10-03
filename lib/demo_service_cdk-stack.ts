import { CfnOutput, Stack, StackProps} from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer, ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { BuildSpec, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, EcsDeployAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
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

    // Retrieve the GitHub token from Secrets Manager
    const githubToken = secretsmanager.Secret.fromSecretNameV2(this, 'GitHubToken', 'github-token');

    const buildProject = new PipelineProject(this, "DemoServiceBuild", {
      environment: {
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_5,
        privileged: true, // To allow Docker
      },
      environmentVariables: {
        'REPOSITORY_URI': {
          value: repository.repositoryUri,
        },
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            "runtime-versions": {
              java: "latest"
            }
          },
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI',
            ],
          },
          build: {
            commands: [
              'echo Build started on `date`',
              'mvn clean package',
              'docker build -t $REPOSITORY_URI:latest .',
              'docker push $REPOSITORY_URI:latest',
            ],
          },
          post_build: {
            commands: [
              'echo imagedefinitions.json',
              'printf \'[{ "name": "DemoServiceContainer", "imageUri": "%s" }]\' $REPOSITORY_URI:latest > imagedefinitions.json'
            ]
          }
        },
        artifacts: {
          files: ['**/*'],
        },
      }),
    });
    
    repository.grantPullPush(buildProject.grantPrincipal);
    const pipeline = new Pipeline(this, 'DemoServicePipeline', {
      pipelineName: 'DemoServicePipeline',
    });

    const sourceOutput = new Artifact();

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new GitHubSourceAction({
          actionName: 'GitHubSource',
          owner: 'shivam04',
          repo: 'DemoServiceSpringBoot',
          oauthToken: githubToken.secretValue,
          output: sourceOutput,
          branch: 'main'
        })
      ]
    });

    const buildOutput = new Artifact();
    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new CodeBuildAction({
          actionName: 'CodeBuild',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        })
      ]
    });

    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new EcsDeployAction({
          actionName: 'DeployToECS',
          service: service,
          input: buildOutput,
        })
      ]
    })

    new CfnOutput(this, "DemoServiceLoadBalancerDNS", {
      value: loadBalancer.loadBalancerDnsName
    });
  }
}
