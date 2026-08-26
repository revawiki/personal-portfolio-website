"""CDK stacks for the personal site (wiki-sandbox account, Jakarta).

Naming: every resource carries the `wiki-` prefix, matching how the sandbox
account is organized.

Layout (SiteStack, ap-southeast-3):
  S3 bucket (static frontend, private, OAC-only access)
  Lambda (FastAPI chatbot via Mangum) behind an HTTP API (API Gateway v2)
  SSM Parameter Store SecureString holding the chat API key -- created
    out-of-band (CloudFormation cannot create SecureStrings):
      aws ssm put-parameter --name /wiki-personal-site/chat-api-key \
        --type SecureString --value <key> --region ap-southeast-3
    The stack only grants the Lambda read access. Standard-tier parameters
    are free, unlike Secrets Manager.
  CloudFront: default behavior -> S3, "/api/*" -> HTTP API

CertificateStack (us-east-1, only when a domain is passed): CloudFront only
accepts ACM certificates from us-east-1, regardless of where the rest of the
stack lives, so the cert gets its own stack wired over with
cross_region_references.

Requires backend/build/ to already exist (run backend/build.sh first) --
that's the Lambda asset this stack deploys.
"""
from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as apigwv2_integrations,
    aws_certificatemanager as acm,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_iam as iam,
    aws_lambda as _lambda,
    aws_logs as logs,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_s3_deployment as s3_deploy,
)
from constructs import Construct

FRONTEND_DIR = "../frontend"
LAMBDA_ASSET_DIR = "../backend/build"
PREFIX = "wiki-personal-site"

# Must match backend/app/claude_client.py defaults.
CHAT_PROVIDER = "anthropic"
CHAT_MODEL = "claude-haiku-4-5-20251001"
CHAT_PARAM_NAME = f"/{PREFIX}/chat-api-key"


class CertificateStack(Stack):
    """us-east-1 holder for the CloudFront certificate (CloudFront requirement)."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        domain_name: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        hosted_zone = route53.HostedZone.from_lookup(
            self, "HostedZone", domain_name=domain_name
        )
        self.certificate = acm.Certificate(
            self,
            "SiteCertificate",
            certificate_name=f"{PREFIX}-cert",
            domain_name=domain_name,
            subject_alternative_names=[f"www.{domain_name}"],
            validation=acm.CertificateValidation.from_dns(hosted_zone),
        )


class SiteStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        domain_name: str | None = None,
        certificate: acm.ICertificate | None = None,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        site_bucket = s3.Bucket(
            self,
            "SiteBucket",
            bucket_name=f"{PREFIX}-frontend-{self.account}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
        )

        chat_role = iam.Role(
            self,
            "ChatFunctionRole",
            role_name=f"{PREFIX}-chat-role",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ],
        )

        chat_log_group = logs.LogGroup(
            self,
            "ChatFunctionLogs",
            log_group_name=f"/aws/lambda/{PREFIX}-chat",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        chat_fn = _lambda.Function(
            self,
            "ChatFunction",
            function_name=f"{PREFIX}-chat",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="app.main.handler",
            code=_lambda.Code.from_asset(LAMBDA_ASSET_DIR),
            role=chat_role,
            timeout=Duration.seconds(30),
            memory_size=256,
            log_group=chat_log_group,
            environment={
                "CHAT_PROVIDER": CHAT_PROVIDER,
                "CHAT_PARAM_NAME": CHAT_PARAM_NAME,
                "CHAT_MODEL": CHAT_MODEL,
            },
        )
        # SecureString read; decryption uses the AWS-managed aws/ssm key, so
        # no explicit KMS grant is needed.
        chat_role.add_to_policy(
            iam.PolicyStatement(
                actions=["ssm:GetParameter"],
                resources=[
                    f"arn:aws:ssm:{self.region}:{self.account}:parameter{CHAT_PARAM_NAME}"
                ],
            )
        )

        http_api = apigwv2.HttpApi(
            self,
            "ChatHttpApi",
            api_name=f"{PREFIX}-chat-api",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_methods=[apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
                allow_origins=["*"],
                allow_headers=["content-type"],
            ),
        )
        http_api.add_routes(
            path="/api/{proxy+}",
            methods=[apigwv2.HttpMethod.ANY],
            integration=apigwv2_integrations.HttpLambdaIntegration("ChatIntegration", chat_fn),
        )
        # Throttle the API so a scripted client can't burn Claude credits:
        # the widget's own cooldown allows ~7 requests/90s per visitor, so
        # 10 rps with a small burst is generous for real traffic and a hard
        # wall for abuse.
        default_stage = http_api.default_stage.node.default_child
        default_stage.default_route_settings = apigwv2.CfnStage.RouteSettingsProperty(
            throttling_rate_limit=10,
            throttling_burst_limit=25,
        )

        distribution = cloudfront.Distribution(
            self,
            "SiteDistribution",
            comment=PREFIX,
            default_root_object="index.html",
            # S3 behind OAC answers 403 (not 404) for objects that don't exist,
            # so both have to be mapped for frontend/404.html to ever show.
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=404,
                    response_page_path="/404.html",
                    ttl=Duration.minutes(5),
                ),
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=404,
                    response_page_path="/404.html",
                    ttl=Duration.minutes(5),
                ),
            ],
            domain_names=[domain_name, f"www.{domain_name}"] if domain_name else None,
            certificate=certificate,
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(site_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                response_headers_policy=cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
            ),
            additional_behaviors={
                "/api/*": cloudfront.BehaviorOptions(
                    origin=origins.HttpOrigin(
                        f"{http_api.http_api_id}.execute-api.{self.region}.amazonaws.com"
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    response_headers_policy=cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                ),
            },
        )

        s3_deploy.BucketDeployment(
            self,
            "DeploySite",
            sources=[s3_deploy.Source.asset(FRONTEND_DIR)],
            destination_bucket=site_bucket,
            distribution=distribution,
            distribution_paths=["/*"],
        )

        if domain_name:
            hosted_zone = route53.HostedZone.from_lookup(
                self, "HostedZone", domain_name=domain_name
            )
            route53.ARecord(
                self,
                "AliasRecord",
                zone=hosted_zone,
                target=route53.RecordTarget.from_alias(route53_targets.CloudFrontTarget(distribution)),
            )
            route53.ARecord(
                self,
                "WwwAliasRecord",
                zone=hosted_zone,
                record_name="www",
                target=route53.RecordTarget.from_alias(route53_targets.CloudFrontTarget(distribution)),
            )

        CfnOutput(self, "DistributionDomainName", value=distribution.distribution_domain_name)
        CfnOutput(self, "ChatApiEndpoint", value=http_api.api_endpoint)
        CfnOutput(self, "ChatParamName", value=CHAT_PARAM_NAME)
