#!/usr/bin/env python3
import os

import aws_cdk as cdk

from infra.site_stack import SiteStack

app = cdk.App()

domain_name = app.node.try_get_context("domainName") or None

SiteStack(
    app,
    "PersonalSiteStack",
    domain_name=domain_name,
    env=cdk.Environment(
        account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
        region=os.environ.get("CDK_DEFAULT_REGION", "us-east-1"),
    ),
)

app.synth()
