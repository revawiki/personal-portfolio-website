"""CDK stack for the personal site.

Layout:
  S3 bucket (static frontend, private, OAC-only access)
  Lambda (FastAPI chatbot via Mangum) behind an HTTP API (API Gateway v2)
  CloudFront: default behavior -> S3, "/api/*" -> HTTP API
  Secrets Manager secret holding the Anthropic API key (value set out-of-band,
    see README) with read access granted to the Lambda
  Optional Route53 + ACM custom domain, enabled by passing domain_name

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
    aws_lambda as _lambda,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_s3_deployment as s3_deploy,
    aws_secretsmanager as secretsmanager,
)
from constructs import Construct

FRONTEND_DIR = "../frontend"
LAMBDA_ASSET_DIR = "../backend/build"
ANTHROPIC_SECRET_NAME = "personal-site/anthropic-api-key"


class SiteStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        domain_name: str | None = None,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        api_key_secret = secretsmanager.Secret(
            self,
            "AnthropicApiKeySecret",
            secret_name=ANTHROPIC_SECRET_NAME,
            description="Anthropic API key used by the portfolio chatbot Lambda",
        )

        site_bucket = s3.Bucket(
            self,
            "SiteBucket",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
        )

        chat_fn = _lambda.Function(
            self,
            "ChatFunction",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="app.main.handler",
            code=_lambda.Code.from_asset(LAMBDA_ASSET_DIR),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "ANTHROPIC_SECRET_ARN": api_key_secret.secret_arn,
                "CLAUDE_MODEL": "claude-sonnet-5",
            },
        )
        api_key_secret.grant_read(chat_fn)

        http_api = apigwv2.HttpApi(
            self,
            "ChatHttpApi",
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

        certificate = None
        hosted_zone = None
        if domain_name:
            hosted_zone = route53.HostedZone.from_lookup(self, "HostedZone", domain_name=domain_name)
            certificate = acm.Certificate(
                self,
                "SiteCertificate",
                domain_name=domain_name,
                subject_alternative_names=[f"www.{domain_name}"],
                validation=acm.CertificateValidation.from_dns(hosted_zone),
            )

        distribution = cloudfront.Distribution(
            self,
            "SiteDistribution",
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
            ),
            additional_behaviors={
                "/api/*": cloudfront.BehaviorOptions(
                    origin=origins.HttpOrigin(
                        f"{http_api.http_api_id}.execute-api.{self.region}.amazonaws.com"
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
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

        if domain_name and hosted_zone:
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
        CfnOutput(self, "AnthropicSecretName", value=api_key_secret.secret_name)
