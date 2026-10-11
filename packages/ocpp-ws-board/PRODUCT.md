# OCPP WS IO

<!-- impeccable:product-schema 1 -->

## Platform
web

## Product purpose
An embedded operations console for ocpp-ws-io. It observes stations and OCPP traffic through the public plugin interface and provides authenticated operator actions.

## Users
Inferred from the existing package: CSMS developers and charging-network operators investigating connections, traffic, and failures. No additional audience constraints were supplied after the optional clarification.

## Capabilities and constraints
Preserve authentication, custom storage, Hono/Express/Nest integration, connection management, telemetry, messages, and security monitoring. Add useful operations through public core APIs only. All changes remain in this package. Never present illustrative data as a live deployment. Do not modify core code. Compatibility claims must name the checks actually performed.

## Brand commitments
The user's supplied reference establishes a charcoal, two-sidebar, table-focused desktop console with restrained pastel status colors. Adapt it to mobile and provide a light theme.

## Evidence
The package source and the sibling core's exported types and implementation are the integration authority. Optional integrations require explicit binding and must show an unavailable state when absent.
