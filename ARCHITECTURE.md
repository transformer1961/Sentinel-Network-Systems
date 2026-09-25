# SNS Watchtower

This repository is SNS Watchtower, a security, investigation, monitoring, and response product within Sentinel Network Systems. It is not Core and does not become a central authority because it is connected to the SNS Network.

The shared authority, trust-boundary, data, recovery, and release requirements are defined in [SNS-Architecture-Operations](../../Docs/SNS-Architecture-Operations.md).

## Watchtower owns

- Security monitoring and threat analysis
- Investigation profiles, cases, evidence, and watch workflows
- Product-scoped blacklist and lockdown operations
- Product audit events and controlled reporting to Core

## Watchtower boundaries

- Local Discord roles grant only the product permissions explicitly defined in its permission model.
- Global commands are restricted to the configured SNS server and required clearance.
- Core enrollment and approval are separate from local command authorization.
- Watchtower must not treat heartbeat, network connectivity, or a shared secret as permission to perform unrelated Core administration.
- Credentials and deployment configuration belong in environment or host secret management, never source control.
