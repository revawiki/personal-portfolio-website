#!/usr/bin/env python3
import os

import aws_cdk as cdk

from infra.site_stack import CertificateStack, SiteStack

app = cdk.App()

domain_name = app.node.try_get_context("domainName") or None
account = os.environ.get("CDK_DEFAULT_ACCOUNT")

# Everything lives in Jakarta, matching how the wiki-sandbox account is
# organized. The one exception is the CloudFront certificate, which AWS
# requires to be in us-east-1 -- it gets its own stack, referenced across
# regions.
site_env = cdk.Environment(
    account=account,
    region=os.environ.get("CDK_DEFAULT_REGION", "ap-southeast-3"),
)

certificate = None
if domain_name:
    cert_stack = CertificateStack(
        app,
        "wiki-personal-site-cert",
        domain_name=domain_name,
        env=cdk.Environment(account=account, region="us-east-1"),
        cross_region_references=True,
    )
    certificate = cert_stack.certificate

SiteStack(
    app,
    "wiki-personal-site",
    domain_name=domain_name,
    certificate=certificate,
    env=site_env,
    cross_region_references=bool(domain_name),
)

app.synth()
